#!/usr/bin/env node
// kin SessionStart hook — list the kin in this workspace, hint at /name.
// Stdout JSON is merged into the assistant context as additionalContext.

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

async function main() {
  const wsId = workspaceId();
  const wsDir = path.join(KIN_HOME, wsId);
  const agents = await listAgents(wsDir);

  const lines = [`kin workspace: ${wsId}`];
  if (agents.length > 0) {
    lines.push(`Registered kin in this workspace: ${agents.join(", ")}.`);
    lines.push(
      `If you have a name from a previous session, claim it now with /name <name> so other kin can address you.`
    );
  } else {
    lines.push(`No kin registered yet. Use /name <name> to claim one.`);
  }

  // Claude Code SessionStart hook output schema:
  //   { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "..." } }
  const out = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: lines.join("\n"),
    },
  };
  process.stdout.write(JSON.stringify(out));
}

main().catch((err) => {
  // Don't break the session — log and exit clean.
  console.error("[kin session-start hook]", err);
  process.exit(0);
});
