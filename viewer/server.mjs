#!/usr/bin/env node
// kin viewer — HTTP + SSE server.
//
// Serves the built static viewer (./dist) and exposes a tiny read-only API
// over the local kin filesystem at ~/.kin/<workspace-id>/agents/.
//
// Endpoints:
//   GET /                   -> dist/index.html
//   GET /assets/*           -> dist/assets/*
//   GET /api/kin            -> Kin[]
//   GET /api/messages       -> Message[]
//   GET /api/stream         -> SSE: events `snapshot` and `delta`
//
// No auth, no telemetry, no backend. Listens on localhost only.
// Default port 7427 (override via KIN_VIEWER_PORT).

import http from "node:http";
import { promises as fsp, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import os from "node:os";
import crypto from "node:crypto";
import { workspaceDir, workspaceId } from "../lib/workspace.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.KIN_VIEWER_PORT) || 7427;
const HOST = "127.0.0.1";
const POLL_MS = 1500;
// Auto-shutdown after this many ms with zero connected viewers. Keeps
// laptop fans quiet when the user has long since closed the tab but
// forgot to /kin:close_browser.
const IDLE_SHUTDOWN_MS = 5 * 60 * 1000;

const DIST_DIR = path.join(__dirname, "dist");
const WORKSPACE_DIR = workspaceDir(process.cwd());
const AGENTS_DIR = path.join(WORKSPACE_DIR, "agents");
const PID_FILE = path.join(WORKSPACE_DIR, ".viewer.pid");

// Deterministic-ish color palette for kin avatars. Same algorithm the design
// suggested: stable hash on kin.id → palette index. Muted/desaturated only.
const PALETTE = [
  "#3a6e9c", // dusty blue
  "#8b6db0", // muted violet
  "#b08a4a", // dusty amber
  "#6a7079", // graphite
  "#4f8a73", // forest
  "#9c6a6a", // dusty rose
  "#5a8aa8", // steel
  "#7e9c4f", // olive
];

function colorFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ---- helpers ----

async function readJsonSafe(p) {
  try {
    const buf = await fsp.readFile(p, "utf8");
    return JSON.parse(buf);
  } catch {
    return null;
  }
}

async function lsSafe(p) {
  try {
    return await fsp.readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function statSafe(p) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

// ---- kin filesystem reader ----

// Returns a Kin[] in the viewer's expected shape, derived from
// agents/<name>/identity.json + presence.json + memory/ listing.
async function readKin() {
  const dirents = await lsSafe(AGENTS_DIR);
  const kinDirs = dirents.filter((d) => d.isDirectory()).map((d) => d.name);

  const out = [];
  for (const name of kinDirs) {
    const agentDir = path.join(AGENTS_DIR, name);
    const identity = (await readJsonSafe(path.join(agentDir, "identity.json"))) || {};
    const presence = await readJsonSafe(path.join(agentDir, "presence.json"));

    const displayName = identity.name || name;
    const status = presence && (await isPresenceLive(presence)) ? "online" : "offline";
    const since =
      status === "online"
        ? presence?.started_at
          ? new Date(presence.started_at).getTime()
          : Date.now()
        : identity.last_seen
        ? new Date(identity.last_seen).getTime()
        : identity.claimed_at
        ? new Date(identity.claimed_at).getTime()
        : Date.now();

    const memoryDir = path.join(agentDir, "memory");
    const memoryFiles = await listMemoryFiles(memoryDir);

    const identityMd = await readTextSafe(path.join(memoryDir, "identity.md"));
    const whyMd = await readTextSafe(path.join(memoryDir, "why.md"));

    out.push({
      id: name,
      name: displayName,
      color: colorFor(name),
      role: identity.role || identity.bio || "kin",
      status,
      since,
      reasoning: whyMd || identity.reasoning || identity.bio || "",
      identity: parseIdentityMd(identityMd),
      memory: memoryFiles,
    });
  }
  return out;
}

async function isPresenceLive(presence) {
  if (!presence?.pid) return false;
  try {
    process.kill(presence.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function listMemoryFiles(dir) {
  const dirents = await lsSafe(dir);
  const out = [];
  for (const d of dirents) {
    if (!d.isFile()) continue;
    if (!d.name.endsWith(".md")) continue;
    const st = await statSafe(path.join(dir, d.name));
    out.push({ name: d.name, size: humanSize(st?.size || 0) });
  }
  return out;
}

async function readTextSafe(p) {
  try {
    return await fsp.readFile(p, "utf8");
  } catch {
    return null;
  }
}

// Very small markdown-ish split for identity.md → blocks of {p} or {list}.
// Just splits on blank lines and detects "- " bullet lists.
function parseIdentityMd(md) {
  if (!md) return [];
  const blocks = md
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.map((b) => {
    const lines = b.split("\n");
    if (lines.every((ln) => ln.trimStart().startsWith("- "))) {
      return { list: lines.map((ln) => ln.replace(/^\s*-\s+/, "")) };
    }
    return { p: lines.join(" ").replace(/^#+\s*/, "") };
  });
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// ---- messages reader ----

async function readMessages() {
  const dirents = await lsSafe(AGENTS_DIR);
  const kinDirs = dirents.filter((d) => d.isDirectory()).map((d) => d.name);

  const out = [];
  for (const name of kinDirs) {
    // a kin's inbox holds messages addressed TO them. archive is messages
    // they've already read. The viewer doesn't distinguish; both are part
    // of the conversation history. We pass the inbox owner as the message
    // recipient — if the raw JSON doesn't carry an explicit `to` field
    // (legacy kin_send writes from before v1.1.3) the file path is the
    // source of truth.
    for (const sub of ["inbox", "archive"]) {
      const subDir = path.join(AGENTS_DIR, name, sub);
      const files = await lsSafe(subDir);
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith(".json")) continue;
        const msg = await readJsonSafe(path.join(subDir, f.name));
        if (!msg) continue;
        out.push(normalizeMessage(msg, f.name, name));
      }
    }
  }
  // sort by time ascending, dedupe by id
  const byId = new Map();
  for (const m of out) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.time - b.time);
}

function normalizeMessage(raw, fileName, owner) {
  const id = raw.id || fileName.replace(/\.json$/, "");
  const kin = raw.from || raw.sender || raw.kin || "unknown";
  const to = raw.to || raw.recipient || owner || null;
  const time = raw.sent_at
    ? new Date(raw.sent_at).getTime()
    : raw.time
    ? new Date(raw.time).getTime()
    : 0;
  const body = raw.body || raw.text || raw.message || "";
  return { id, kin, to, time, body, quotedId: raw.quotedId || raw.reply_to };
}

// ---- snapshot + delta ----

async function fullSnapshot() {
  const [kin, messages] = await Promise.all([readKin(), readMessages()]);
  return { kin, messages, now: Date.now() };
}

// Track the last snapshot signature so we only emit deltas when something
// actually changed. Cheap: count of kin + count of messages + max time.
function signature(snap) {
  const maxT = snap.messages.length
    ? snap.messages[snap.messages.length - 1].time
    : 0;
  return `${snap.kin.length}:${snap.messages.length}:${maxT}`;
}

// ---- SSE subscribers ----

const subscribers = new Set();

function broadcast(event, payload) {
  const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of subscribers) {
    try {
      res.write(line);
    } catch {
      subscribers.delete(res);
    }
  }
}

// Adaptive polling: only run while at least one SSE subscriber is
// connected. When the last viewer disconnects we pause; when the next
// one connects we resume. This drops idle CPU to roughly nothing.
let lastSig = "";
let pollTimer = null;
let lastSubscriberTime = Date.now();

async function pollOnce() {
  try {
    const snap = await fullSnapshot();
    const sig = signature(snap);
    if (sig !== lastSig) {
      lastSig = sig;
      broadcast("snapshot", snap);
    }
  } catch (e) {
    // swallow — don't crash the loop on filesystem hiccups
  }
}

async function pollLoop() {
  if (subscribers.size === 0) {
    pollTimer = null;
    return;
  }
  await pollOnce();
  pollTimer = setTimeout(pollLoop, POLL_MS);
}

function ensurePolling() {
  if (!pollTimer && subscribers.size > 0) pollLoop();
}

// Idle auto-shutdown check — runs once a minute, exits if no
// subscribers for > IDLE_SHUTDOWN_MS.
function startIdleWatcher() {
  setInterval(() => {
    if (subscribers.size === 0 && Date.now() - lastSubscriberTime > IDLE_SHUTDOWN_MS) {
      console.log("kin viewer — idle for 5 min, shutting down");
      gracefulShutdown(0);
    }
  }, 60 * 1000);
}

// ---- HTTP routing ----

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, "http://h").pathname);
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  // safety: no traversal
  if (pathname.includes("..")) return notFound(res);

  const file = path.join(DIST_DIR, pathname);
  // make sure resolved path is still inside DIST_DIR
  if (!file.startsWith(DIST_DIR)) return notFound(res);

  try {
    const buf = await fsp.readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(buf);
  } catch {
    notFound(res);
  }
}

function notFound(res) {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

function jsonResp(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(buf || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const KIN_NAME_RE = /^[a-z0-9_][a-z0-9_-]{0,31}$/;

async function handleClaim(req, res) {
  try {
    const body = await readBody(req);
    const name = String(body.name || "").trim().toLowerCase();
    if (!KIN_NAME_RE.test(name)) {
      return jsonResp(
        res,
        { error: "name must match /^[a-z0-9_][a-z0-9_-]{0,31}$/" },
        400
      );
    }
    const dir = path.join(AGENTS_DIR, name);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.mkdir(path.join(dir, "memory"), { recursive: true });
    await fsp.mkdir(path.join(dir, "inbox"), { recursive: true });
    await fsp.mkdir(path.join(dir, "archive"), { recursive: true });
    const idFile = path.join(dir, "identity.json");
    const existing = await readJsonSafe(idFile);
    const now = new Date().toISOString();
    const identity = existing || {
      name,
      role: body.role || "human",
      bio: body.bio || "human participant via the viewer",
      is_human: true,
      claimed_at: now,
    };
    identity.last_seen = now;
    if (!existing) identity.is_human = true; // mark fresh human kin
    await fsp.writeFile(idFile, JSON.stringify(identity, null, 2));
    lastSig = ""; // force snapshot broadcast next tick
    return jsonResp(res, { ok: true, name });
  } catch (e) {
    return jsonResp(res, { error: e.message }, 500);
  }
}

async function handleSend(req, res) {
  try {
    const body = await readBody(req);
    const from = String(body.from || "").trim().toLowerCase();
    const to = String(body.to || "").trim().toLowerCase();
    const msgBody = String(body.body || "").trim();
    if (!KIN_NAME_RE.test(from) || !KIN_NAME_RE.test(to)) {
      return jsonResp(res, { error: "invalid from/to" }, 400);
    }
    if (!msgBody) {
      return jsonResp(res, { error: "body required" }, 400);
    }
    const recipientDir = path.join(AGENTS_DIR, to);
    const recipientExists = await statSafe(recipientDir);
    if (!recipientExists) {
      return jsonResp(res, { error: `recipient '${to}' not found` }, 404);
    }
    const inboxDir = path.join(recipientDir, "inbox");
    await fsp.mkdir(inboxDir, { recursive: true });
    const id = crypto.randomBytes(8).toString("hex");
    const msg = {
      id,
      from,
      to,
      body: msgBody,
      sent_at: new Date().toISOString(),
    };
    // atomic write — tmp + rename, same discipline as the kin MCP server
    const tmpPath = path.join(inboxDir, `.${id}.tmp`);
    const finalPath = path.join(inboxDir, `${id}.json`);
    await fsp.writeFile(tmpPath, JSON.stringify(msg, null, 2));
    await fsp.rename(tmpPath, finalPath);
    lastSig = ""; // force snapshot broadcast next tick
    return jsonResp(res, { ok: true, id });
  } catch (e) {
    return jsonResp(res, { error: e.message }, 500);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (url.pathname === "/api/kin") {
    return jsonResp(res, await readKin());
  }
  if (url.pathname === "/api/messages") {
    return jsonResp(res, await readMessages());
  }
  if (url.pathname === "/api/snapshot") {
    return jsonResp(res, await fullSnapshot());
  }
  if (url.pathname === "/api/claim" && req.method === "POST") {
    return handleClaim(req, res);
  }
  if (url.pathname === "/api/send" && req.method === "POST") {
    return handleSend(req, res);
  }
  if (url.pathname === "/api/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    // initial snapshot so the client doesn't need two round-trips
    const snap = await fullSnapshot();
    res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);
    subscribers.add(res);
    lastSubscriberTime = Date.now();
    ensurePolling();
    req.on("close", () => {
      subscribers.delete(res);
      lastSubscriberTime = Date.now();
    });
    return;
  }
  return serveStatic(req, res);
});

// ---- browser opener ----

function openBrowser(url) {
  const platform = os.platform();
  try {
    if (platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // user can still copy the URL from stdout
  }
}

// ---- singleton check (avoid stacking node processes) ----

// If a previous viewer is already running for THIS workspace, don't start a
// second one. Just open the browser to the existing URL and exit. The PID
// file is workspace-scoped (lives under ~/.kin/<workspace>/.viewer.pid) so
// multiple workspaces can still each run their own viewer.
async function checkExistingInstance() {
  let pidInfo;
  try {
    const raw = await fsp.readFile(PID_FILE, "utf8");
    pidInfo = JSON.parse(raw);
  } catch {
    return false;
  }
  const { pid, port } = pidInfo || {};
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0); // signal 0 = liveness check
  } catch {
    // stale pid file — clean up and proceed with a fresh start
    await fsp.unlink(PID_FILE).catch(() => {});
    return false;
  }
  const url = `http://${HOST}:${port || PORT}/`;
  console.log(`kin viewer — already running (PID ${pid}) — ${url}`);
  console.log(`workspace ${workspaceId(process.cwd())}`);
  if (process.env.KIN_VIEWER_NO_OPEN !== "1") openBrowser(url);
  return true;
}

async function writePidFile() {
  await fsp.mkdir(WORKSPACE_DIR, { recursive: true });
  await fsp.writeFile(
    PID_FILE,
    JSON.stringify({ pid: process.pid, port: PORT, started_at: new Date().toISOString() })
  );
}

async function removePidFile() {
  await fsp.unlink(PID_FILE).catch(() => {});
}

// ---- boot ----

async function boot() {
  if (await checkExistingInstance()) {
    process.exit(0);
  }
  await writePidFile();
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}/`;
    console.log(`kin viewer — ${url}`);
    console.log(`workspace ${workspaceId(process.cwd())}`);
    console.log(`reading   ${WORKSPACE_DIR}`);
    if (process.env.KIN_VIEWER_NO_OPEN !== "1") openBrowser(url);
    // start the idle watcher; polling will engage on the first SSE
    // subscriber. Until then we burn no CPU.
    startIdleWatcher();
  });
  server.on("error", async (e) => {
    if (e.code === "EADDRINUSE") {
      console.error(`kin viewer — port ${PORT} already in use. Set KIN_VIEWER_PORT to override, or run /kin:close_browser if a stale instance is holding it.`);
    } else {
      console.error("kin viewer —", e.message);
    }
    await removePidFile();
    process.exit(1);
  });
}

// ---- graceful shutdown ----

let shuttingDown = false;
function gracefulShutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const r of subscribers) try { r.end(); } catch {}
  // best-effort sync cleanup so even SIGKILL-flavored exits drop the file
  try {
    // dynamic import is async, but unlinkSync is sync — use it through the
    // already-imported fs module for the exit path.
    // eslint-disable-next-line no-empty
  } catch {}
  removePidFile().finally(() => {
    server.close(() => process.exit(code));
    // hard timeout — close() can hang on lingering keep-alive sockets
    setTimeout(() => process.exit(code), 1500).unref();
  });
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    console.log(`\nkin viewer — ${sig}, shutting down`);
    gracefulShutdown(0);
  });
}

process.on("exit", () => {
  // best-effort sync cleanup for crashes / sudden exits
  try { unlinkSync(PID_FILE); } catch {}
});

boot();
