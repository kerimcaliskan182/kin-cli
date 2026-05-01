#!/usr/bin/env node
// Stop a kin's inbox watcher by name. Reads its presence.json, SIGTERMs the
// recorded PID, and waits briefly for the watcher's signal handler to
// remove the presence file. If the PID is already dead but a presence file
// remains, removes the stale file. The watcher's parent Monitor task (if
// running in another Claude session) will end naturally when its child
// pipe closes — we don't need to coordinate that here.
//
// Usage:
//   node scripts/stop-watcher.mjs <kin-name>
//
// Exit codes:
//   0 — watcher stopped cleanly OR was already offline (idempotent)
//   2 — bad usage
//   3 — PID still alive after grace window (couldn't terminate)
//   4 — kill failed for permission or other reason

import { promises as fs } from "node:fs";
import path from "node:path";
import { workspaceDir } from "../lib/workspace.mjs";

const NAME = process.argv[2];
if (!NAME) {
  console.error(`usage: node ${path.basename(process.argv[1])} <kin-name>`);
  process.exit(2);
}

const agentDir = path.join(workspaceDir(), "agents", NAME);
const presencePath = path.join(agentDir, "presence.json");

let raw;
try {
  raw = await fs.readFile(presencePath, "utf8");
} catch (err) {
  if (err.code === "ENOENT") {
    console.log(`offline: '${NAME}' has no presence file (already offline).`);
    process.exit(0);
  }
  throw err;
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.log(`offline: '${NAME}' presence file unreadable; removing.`);
  await fs.unlink(presencePath).catch(() => {});
  process.exit(0);
}

const pid = parsed.pid;
if (typeof pid !== "number") {
  console.log(`offline: '${NAME}' presence file has no pid; removing.`);
  await fs.unlink(presencePath).catch(() => {});
  process.exit(0);
}

let alive = false;
try {
  process.kill(pid, 0);
  alive = true;
} catch (err) {
  if (err.code === "ESRCH") alive = false;
  else if (err.code === "EPERM") alive = true; // exists but we can't signal
  else throw err;
}

if (!alive) {
  console.log(
    `offline: '${NAME}' watcher pid ${pid} already dead; removing stale presence.`
  );
  await fs.unlink(presencePath).catch(() => {});
  process.exit(0);
}

try {
  process.kill(pid, "SIGTERM");
} catch (err) {
  console.error(`offline: SIGTERM to pid ${pid} failed: ${err.code || err.message}`);
  process.exit(4);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + 2000;
let stillAlive = true;
while (Date.now() < deadline) {
  await sleep(150);
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (err.code === "ESRCH") {
      stillAlive = false;
      break;
    }
  }
}

if (stillAlive) {
  console.error(
    `offline: pid ${pid} still alive 2s after SIGTERM; refusing to escalate. ` +
      `Investigate manually (kill -9 ${pid} if needed).`
  );
  process.exit(3);
}

// Watcher's SIGTERM handler should have removed the presence file. Verify
// and clean up if not.
try {
  await fs.access(presencePath);
  await fs.unlink(presencePath).catch(() => {});
  console.log(`offline: '${NAME}' watcher stopped (pid ${pid}); cleaned residual presence file.`);
} catch {
  console.log(`offline: '${NAME}' watcher stopped cleanly (pid ${pid}).`);
}
process.exit(0);
