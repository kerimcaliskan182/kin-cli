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
import { promises as fsp } from "node:fs";
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
const POLL_MS = 1000;

const DIST_DIR = path.join(__dirname, "dist");
const WORKSPACE_DIR = workspaceDir(process.cwd());
const AGENTS_DIR = path.join(WORKSPACE_DIR, "agents");

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

let lastSig = "";
async function pollLoop() {
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
  setTimeout(pollLoop, POLL_MS);
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
    req.on("close", () => subscribers.delete(res));
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

// ---- boot ----

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  // eslint-disable-next-line no-console
  console.log(`kin viewer — ${url}`);
  console.log(`workspace ${workspaceId(process.cwd())}`);
  console.log(`reading   ${WORKSPACE_DIR}`);
  if (process.env.KIN_VIEWER_NO_OPEN !== "1") openBrowser(url);
  pollLoop();
});

// graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`\nkin viewer — ${sig}, shutting down`);
    for (const r of subscribers) try { r.end(); } catch {}
    server.close(() => process.exit(0));
  });
}
