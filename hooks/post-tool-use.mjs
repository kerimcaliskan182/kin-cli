#!/usr/bin/env node
// kin PostToolUse hook — surfaces pending inbox counts as additionalContext
// so kin notice when other kin have sent them messages.
//
// Behavior:
//   - On every PostToolUse for the matched tools (Bash/Read/Edit/Write/Grep/Glob),
//     scan all agents/<name>/inbox/ in this workspace.
//   - If any kin has pending messages, emit a one-line notification.
//   - Skip silently if all inboxes empty.
//   - Skip entirely if env KIN_QUIET=1.
//
// This is intentionally simple in v0.1.1: it always announces non-zero counts,
// it doesn't track "last seen." Per-session state-tracking is a v0.2 follow-up.
// The trade-off: in a session that hasn't drained inboxes for a while, the
// notification will repeat. Users can /kin:inbox <name> to clear, or set
// KIN_QUIET=1 to mute.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const KIN_HOME = process.env.KIN_HOME || path.join(os.homedir(), ".kin");

function workspaceId() {
  const cwd = process.cwd();
  const hash = crypto.createHash("sha1").update(cwd).digest("hex").slice(0, 12);
  const slug = path.basename(cwd).replace(/[^a-zA-Z0-9-_]/g, "-");
  return `${slug}-${hash}`;
}

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

async function main() {
  if (process.env.KIN_QUIET === "1") {
    process.exit(0);
  }
  const wsDir = path.join(KIN_HOME, workspaceId());
  const agents = await listAgents(wsDir);
  if (agents.length === 0) {
    process.exit(0);
  }
  const counts = await Promise.all(
    agents.map(async (name) => ({ name, n: await pendingCount(wsDir, name) }))
  );
  const nonEmpty = counts.filter((c) => c.n > 0);
  if (nonEmpty.length === 0) {
    process.exit(0);
  }
  const summary = nonEmpty.map((c) => `${c.name}(${c.n})`).join(", ");
  const out = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `kin pending inboxes: ${summary}. If one of these is yours, run /kin:inbox <your-name> to drain. Set KIN_QUIET=1 to mute.`,
    },
  };
  process.stdout.write(JSON.stringify(out));
}

main().catch((err) => {
  // Never break a tool call because of a kin hook
  console.error("[kin post-tool-use hook]", err);
  process.exit(0);
});
