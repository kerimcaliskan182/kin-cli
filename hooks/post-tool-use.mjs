#!/usr/bin/env node
// kin PostToolUse hook — surfaces pending inbox counts as additionalContext
// so kin notice when other kin have sent them messages.
//
// Behavior (v0.2):
//   - On every PostToolUse for the matched tools (Bash/Read/Edit/Write/Grep/Glob),
//     scan all agents/<name>/inbox/ in this workspace.
//   - For each kin with pending messages, check if it has a *live watcher*
//     (presence.json with a live PID). If yes, skip — the watcher already
//     wakes them, the PostToolUse mention would be redundant.
//   - For kin without a live watcher (offline_claimed) that have pending
//     traffic, emit a one-line notification — that's the whole point: catch
//     mail that landed while no one was watching.
//   - Skip silently if no offline kin has pending mail.
//   - Skip entirely if env KIN_QUIET=1.

import { promises as fs } from "node:fs";
import path from "node:path";
import { KIN_HOME, workspaceId } from "../lib/workspace.mjs";

async function listAgents(workspaceDir) {
  try {
    const entries = await fs.readdir(path.join(workspaceDir, "agents"), {
      withFileTypes: true,
    });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function pendingCount(workspaceDir, name) {
  try {
    const entries = await fs.readdir(
      path.join(workspaceDir, "agents", name, "inbox")
    );
    return entries.filter((f) => f.endsWith(".json")).length;
  } catch (err) {
    if (err.code === "ENOENT") return 0;
    throw err;
  }
}

// True if the kin has a presence.json with a live (PID-verified) watcher.
// On any error / missing file / dead PID, returns false (treat as offline).
async function hasLiveWatcher(workspaceDir, name) {
  const presencePath = path.join(workspaceDir, "agents", name, "presence.json");
  let parsed;
  try {
    const raw = await fs.readFile(presencePath, "utf8");
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const pid = parsed?.pid;
  if (typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === "ESRCH") return false;
    if (err.code === "EPERM") return true; // process exists, owned by another user
    return false;
  }
}

async function main() {
  if (process.env.KIN_QUIET === "1") {
    process.exit(0);
  }
  const wsDir = path.join(KIN_HOME, workspaceId());
  const agents = await listAgents(wsDir);
  if (agents.length === 0) {
    process.exit(0);
  }
  // Compute pending count and watcher liveness in parallel for each kin.
  const stats = await Promise.all(
    agents.map(async (name) => ({
      name,
      n: await pendingCount(wsDir, name),
      online: await hasLiveWatcher(wsDir, name),
    }))
  );
  // Only notify about offline kin with pending mail. Online kin already get
  // wake notifications from their own watcher — don't double-fire.
  const offlineWithMail = stats.filter((c) => c.n > 0 && !c.online);
  if (offlineWithMail.length === 0) {
    process.exit(0);
  }
  const summary = offlineWithMail.map((c) => `${c.name}(${c.n})`).join(", ");
  const out = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `kin offline inboxes have mail: ${summary}. If one of these is yours, run /kin:inbox <your-name> to drain. Set KIN_QUIET=1 to mute.`,
    },
  };
  process.stdout.write(JSON.stringify(out));
}

main().catch((err) => {
  // Never break a tool call because of a kin hook
  console.error("[kin post-tool-use hook]", err);
  process.exit(0);
});
