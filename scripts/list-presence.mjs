#!/usr/bin/env node
// List which kin in the current workspace are currently "online" (watcher
// running) vs claimed-but-offline. Reads each agent's presence.json and
// uses `kill -0 pid` to test liveness — SIGKILL'd watchers leave a stale
// presence file, so the live-check is the source of truth.
//
// Usage:
//   node scripts/list-presence.mjs
//
// Output: pretty JSON, one shape:
//   {
//     "workspace_id": "kin-cli-923ec89c",
//     "online":           [{ "name": "huygens", "pid": 12345, "started_at": "..." }, ...],
//     "offline_claimed":  ["messier", "laplace"],
//     "stale_presence":   ["tycho"]   // had presence file but pid is dead
//   }

import { promises as fs } from "node:fs";
import path from "node:path";
import { workspaceDir, workspaceId } from "../lib/workspace.mjs";

const wsDir = workspaceDir();
const agentsDir = path.join(wsDir, "agents");

let entries;
try {
  entries = await fs.readdir(agentsDir, { withFileTypes: true });
} catch (err) {
  if (err.code === "ENOENT") entries = [];
  else throw err;
}

const online = [];
const offlineClaimed = [];
const stalePresence = [];

for (const e of entries) {
  if (!e.isDirectory()) continue;
  const name = e.name;
  const presencePath = path.join(agentsDir, name, "presence.json");
  let parsed;
  try {
    const raw = await fs.readFile(presencePath, "utf8");
    parsed = JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      offlineClaimed.push(name);
      continue;
    }
    // unreadable / corrupt — treat as offline-claimed
    offlineClaimed.push(name);
    continue;
  }

  const pid = parsed.pid;
  if (typeof pid !== "number") {
    stalePresence.push(name);
    continue;
  }

  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (err) {
    if (err.code === "ESRCH") alive = false;
    else if (err.code === "EPERM") alive = true;
    else throw err;
  }

  if (alive) {
    online.push({
      name,
      pid,
      started_at: parsed.started_at || null,
    });
  } else {
    stalePresence.push(name);
  }
}

const out = {
  workspace_id: workspaceId(),
  online,
  offline_claimed: offlineClaimed,
  stale_presence: stalePresence,
};
console.log(JSON.stringify(out, null, 2));
