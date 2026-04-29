#!/usr/bin/env node
// kin PreCompact hook — write a guidance breadcrumb so the post-compact
// session can re-claim its identity cleanly.

import { promises as fs } from "node:fs";
import path from "node:path";
import { KIN_HOME, workspaceId } from "../lib/workspace.mjs";

async function main() {
  const wsId = workspaceId();
  const wsDir = path.join(KIN_HOME, wsId);
  await fs.mkdir(wsDir, { recursive: true });
  const breadcrumb = path.join(wsDir, "PRE_COMPACT_HINT.md");
  const ts = new Date().toISOString();
  const body = `# kin pre-compact breadcrumb (${ts})

After /compact, this Claude session loses session-local state but **kin
identity is durable on disk**. To pick up cleanly:

1. Re-claim your name: \`/name <whoever-you-were>\`
2. Drain any pending messages: \`/inbox <your-name>\`
3. List the team: \`/team\`

Workspace: \`${wsId}\`
`;
  await fs.writeFile(breadcrumb, body);

  const out = {
    hookSpecificOutput: {
      hookEventName: "PreCompact",
      additionalContext: `kin: pre-compact breadcrumb written to ${breadcrumb}. After /compact, run /name to re-claim and /inbox to drain pending messages.`,
    },
  };
  process.stdout.write(JSON.stringify(out));
}

main().catch((err) => {
  console.error("[kin pre-compact hook]", err);
  process.exit(0);
});
