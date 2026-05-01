#!/usr/bin/env node
// kin SessionStart hook — list the kin in this workspace, hint at /kin:claim.
// Stdout JSON is merged into the assistant context as additionalContext.

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

async function main() {
  const wsId = workspaceId();
  const wsDir = path.join(KIN_HOME, wsId);
  const agents = await listAgents(wsDir);

  const lines = [`kin workspace: ${wsId}`];
  if (agents.length > 0) {
    lines.push(`Registered kin in this workspace: ${agents.join(", ")}.`);
    lines.push(
      `If you have a name from a previous session, claim it now with /kin:claim <name> so other kin can address you. After claiming, optionally run /rename <name> to label this Claude session in the UI.`
    );
  } else {
    lines.push(
      `No kin registered yet. Use /kin:claim to claim one. After claiming, optionally run /rename <name> to label this session in the UI.`
    );
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
