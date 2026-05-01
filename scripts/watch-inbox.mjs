#!/usr/bin/env node
// Tiny inbox watcher — meant to be run as a long-lived background process
// inside a kin's Claude Code session. Each new inbox file emits one line on
// stdout, which the Claude Code harness surfaces as a notification (the
// "wake" signal). The kin then calls kin_inbox to actually read.
//
// Usage:
//   node scripts/watch-inbox.mjs <kin-name>
//
// Workspace is derived from cwd via lib/workspace.mjs (same logic as the MCP
// server), so as long as you run this from inside the kin's claimed
// workspace dir, the watcher and `kin_send` agree on where messages land.
//
// Presence: on startup the watcher writes
//   ~/.kin/<ws>/agents/<name>/presence.json
// containing { pid, watcher_pid, started_at, command, cwd }. SIGINT/SIGTERM
// remove the file. A consumer (e.g. /kin:online) can `kill -0 pid` to test
// liveness, since SIGKILL won't run our cleanup.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceDir } from "../lib/workspace.mjs";

const __filename = fileURLToPath(import.meta.url);

const NAME = process.argv[2];
if (!NAME) {
  console.error(`usage: node ${path.basename(__filename)} <kin-name>`);
  process.exit(2);
}

const agentDir = path.join(workspaceDir(), "agents", NAME);
const inboxDir = path.join(agentDir, "inbox");
const presencePath = path.join(agentDir, "presence.json");

await fs.mkdir(inboxDir, { recursive: true });

// Refuse to start if another live watcher already exists for this kin.
async function existingLivePresence() {
  let raw;
  try {
    raw = await fs.readFile(presencePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // corrupt — treat as absent, we'll overwrite
  }
  const pid = parsed.pid;
  if (typeof pid !== "number") return null;
  try {
    process.kill(pid, 0); // signal 0 = liveness probe, no actual signal
    return parsed;
  } catch (err) {
    if (err.code === "ESRCH") return null; // dead, stale marker
    if (err.code === "EPERM") return parsed; // alive, owned by another user
    throw err;
  }
}

const live = await existingLivePresence();
if (live) {
  console.error(
    `[watch] refusing: another watcher for '${NAME}' is already live ` +
      `(pid ${live.pid}, started ${live.started_at}). Stop it first or attach to that session.`
  );
  process.exit(3);
}

const presence = {
  pid: process.pid,
  watcher_pid: process.pid,
  name: NAME,
  started_at: new Date().toISOString(),
  command: process.argv.slice(1).join(" "),
  cwd: process.cwd(),
};
await fs.writeFile(presencePath, JSON.stringify(presence, null, 2) + "\n");

let cleaningUp = false;
async function cleanup(reason) {
  if (cleaningUp) return;
  cleaningUp = true;
  try {
    const raw = await fs.readFile(presencePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.pid === process.pid) {
      await fs.unlink(presencePath);
    }
  } catch {
    // file gone or unreadable — leave it
  }
  console.error(`[watch] exiting (${reason})`);
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => cleanup(sig));
}

const POLL_MS = 1000;
const seen = new Set();

async function tick() {
  let files;
  try {
    files = (await fs.readdir(inboxDir)).filter((f) => f.endsWith(".json"));
  } catch (err) {
    if (err.code === "ENOENT") return;
    console.error(`[watch] readdir err: ${err.message}`);
    return;
  }

  for (const f of files) {
    if (seen.has(f)) continue;
    seen.add(f);
    let from = "?";
    let topic = "(no topic)";
    try {
      const raw = await fs.readFile(path.join(inboxDir, f), "utf8");
      const msg = JSON.parse(raw);
      from = msg.from || "?";
      topic = msg.topic || "(no topic)";
    } catch {
      // file may have been archived between readdir and read — ignore
    }
    const id = f.replace(/\.json$/, "");
    console.log(`INBOX from=${from} topic=${JSON.stringify(topic)} id=${id}`);
  }

  // Forget archived files so a re-delivered ID would re-fire (defensive).
  const live = new Set(files);
  for (const f of seen) if (!live.has(f)) seen.delete(f);
}

console.log(`[watch] ${NAME} watching ${inboxDir} (pid ${process.pid})`);
await tick();
setInterval(tick, POLL_MS);
