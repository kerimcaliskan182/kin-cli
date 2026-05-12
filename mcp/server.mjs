#!/usr/bin/env node
// kin MCP server — exposes msgbus + identity tools to Claude.
//
// Tools:
//   kin_claim(name, bio?)              — register this session as a named kin
//   kin_team()                         — list registered kin in this workspace
//   kin_send(from, to, body, topic?)   — drop a message into another kin's inbox
//   kin_inbox(name)                    — read + archive pending messages

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { KIN_HOME, workspaceId, workspaceDir } from "../lib/workspace.mjs";

// ---------------------------------------------------------------------------
// Workspace + filesystem helpers
// ---------------------------------------------------------------------------

const WORKSPACE_DIR = workspaceDir();

const NAME_RE = /^[a-z][a-z0-9_-]{1,30}$/;

function agentDir(name) {
  return path.join(WORKSPACE_DIR, "agents", name);
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function readJson(p, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJsonAtomic(p, data) {
  await ensureDir(path.dirname(p));
  const tmp = `${p}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, p);
}

async function listAgents() {
  try {
    const entries = await fs.readdir(path.join(WORKSPACE_DIR, "agents"), {
      withFileTypes: true,
    });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function readIdentity(name) {
  return await readJson(path.join(agentDir(name), "identity.json"));
}

async function writeIdentity(name, data) {
  await writeJsonAtomic(path.join(agentDir(name), "identity.json"), data);
}

async function listInbox(name) {
  try {
    const entries = await fs.readdir(path.join(agentDir(name), "inbox"));
    return entries.filter((f) => f.endsWith(".json")).sort();
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function dropInboxMessage(toName, message) {
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const filename = `${id}.json`;
  const target = path.join(agentDir(toName), "inbox", filename);
  await writeJsonAtomic(target, message);
  return id;
}

async function readAndArchiveInbox(name) {
  const files = await listInbox(name);
  const messages = [];
  for (const file of files) {
    const src = path.join(agentDir(name), "inbox", file);
    const dst = path.join(agentDir(name), "archive", file);
    const msg = await readJson(src);
    if (msg) messages.push({ ...msg, _id: file });
    await ensureDir(path.dirname(dst));
    try {
      await fs.rename(src, dst);
    } catch (_) {
      // race with another consumer — skip silently
    }
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Memory helpers — each kin gets a per-agent brain at agents/<name>/memory/
// with a MEMORY.md index plus typed files (identity / feedback / project /
// reference). The kin reads/writes these via standard Read/Write/Edit tools
// against absolute paths returned by kin_claim.
// ---------------------------------------------------------------------------

const MEMORY_INDEX_TEMPLATE = (name) => `# ${name}'s Memory

This is your durable brain across sessions and \`/compact\`. Index of what you remember.

## Identity
- (none yet — write \`identity.md\` capturing who you are and why you chose this name)

## Feedback
- (none yet — when the user corrects or affirms an approach, capture it here as \`feedback_<topic>.md\`)

## Project
- (none yet — current work context that future-you should know about, as \`project_<topic>.md\`)

## Reference
- (none yet — pointers to external resources, external systems, etc., as \`reference_<topic>.md\`)
`;

function memoryDir(name) {
  return path.join(agentDir(name), "memory");
}

async function ensureMemoryScaffold(name) {
  const mDir = memoryDir(name);
  await ensureDir(mDir);
  const indexPath = path.join(mDir, "MEMORY.md");
  let createdIndex = false;
  try {
    await fs.access(indexPath);
  } catch {
    await fs.writeFile(indexPath, MEMORY_INDEX_TEMPLATE(name));
    createdIndex = true;
  }
  return { dir: mDir, indexPath, createdIndex };
}

async function readMemoryIndex(name) {
  const indexPath = path.join(memoryDir(name), "MEMORY.md");
  try {
    return await fs.readFile(indexPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "kin",
  version: "1.1.2",
});

server.registerTool(
  "kin_team",
  {
    title: "List kin in this workspace",
    description:
      "Returns the list of named agents currently registered in this kin workspace, with last_seen and inbox counts.",
    inputSchema: {},
  },
  async () => {
    const agents = await listAgents();
    const details = await Promise.all(
      agents.map(async (name) => {
        const id = await readIdentity(name);
        const inbox = await listInbox(name);
        return {
          name,
          bio: id?.bio ?? null,
          claimed_at: id?.claimed_at ?? null,
          last_seen: id?.last_seen ?? null,
          inbox_count: inbox.length,
        };
      })
    );
    const text =
      details.length === 0
        ? `No kin registered in workspace ${workspaceId()} yet. Use kin_claim to register.`
        : `${details.length} kin in workspace ${workspaceId()}:\n` +
          details
            .map(
              (d) =>
                `  • ${d.name}${d.bio ? ` — ${d.bio}` : ""} (last seen ${d.last_seen}, ${d.inbox_count} pending)`
            )
            .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "kin_claim",
  {
    title: "Claim a kin name for this session",
    description:
      "Register this Claude session as a named kin in the workspace. Creates the agent's directory and identity file. Idempotent — re-claiming an existing name updates last_seen and bio (if provided) but preserves claimed_at.",
    inputSchema: {
      name: z
        .string()
        .describe(
          "Kin name to claim (lowercase, 2-31 chars, [a-z0-9_-], starts with a letter). Examples: 'atlas', 'kaizen'."
        ),
      bio: z
        .string()
        .optional()
        .describe("Optional one-line bio / role / personality."),
    },
  },
  async ({ name, bio }) => {
    if (!NAME_RE.test(name)) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid kin name '${name}'. Must be lowercase, 2-31 chars, [a-z0-9_-], starting with a letter.`,
          },
        ],
        isError: true,
      };
    }
    const existing = await readIdentity(name);
    const now = new Date().toISOString();
    const identity = existing
      ? { ...existing, last_seen: now, bio: bio ?? existing.bio }
      : { name, bio: bio ?? null, claimed_at: now, last_seen: now };
    await writeIdentity(name, identity);
    await ensureDir(path.join(agentDir(name), "inbox"));
    await ensureDir(path.join(agentDir(name), "archive"));
    await ensureDir(path.join(agentDir(name), "handoff"));
    const memScaffold = await ensureMemoryScaffold(name);
    const memoryIndex = await readMemoryIndex(name);
    const isFirstClaim = !existing;

    const header = existing
      ? `Welcome back, ${name}. Last seen ${existing.last_seen}.${identity.bio ? ` Bio: ${identity.bio}` : ""}`
      : `kin '${name}' claimed in workspace ${workspaceId()}.${identity.bio ? ` Bio: ${identity.bio}` : ""}`;

    const ritual = isFirstClaim
      ? `\nFIRST CLAIM. Your brain is empty. Suggested ritual: write \`identity.md\` to your memory dir below capturing your name, why you chose it, your bio, and any commitments to your kin. After that, read MEMORY.md before any future work.`
      : `\nRECLAIM. Read your MEMORY.md (below) and any files relevant to the current task before proceeding.`;

    const memoryBlock = `\n--- MEMORY (${name}) ---\nMemory dir (absolute): ${memScaffold.dir}\nIndex (\`${path.join(memScaffold.dir, "MEMORY.md")}\`):\n\n${memoryIndex ?? "(empty)"}`;

    const text = `${header}${ritual}${memoryBlock}`;

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        name,
        bio: identity.bio,
        memory_dir: memScaffold.dir,
        memory_index_path: path.join(memScaffold.dir, "MEMORY.md"),
        workspace_dir: WORKSPACE_DIR,
        is_first_claim: isFirstClaim,
      },
    };
  }
);

server.registerTool(
  "kin_memory_index",
  {
    title: "Re-read your kin's MEMORY.md",
    description:
      "Returns the current contents of MEMORY.md for a given kin. Use this if you've claimed mid-session, drained your inbox, and want to re-check your brain index without re-claiming.",
    inputSchema: {
      name: z.string().describe("Your kin name."),
    },
  },
  async ({ name }) => {
    if (!NAME_RE.test(name)) {
      return {
        content: [{ type: "text", text: `Invalid kin name '${name}'.` }],
        isError: true,
      };
    }
    const agents = await listAgents();
    if (!agents.includes(name)) {
      return {
        content: [
          {
            type: "text",
            text: `No kin named '${name}'. Use kin_claim first.`,
          },
        ],
        isError: true,
      };
    }
    const idx = await readMemoryIndex(name);
    const dir = memoryDir(name);
    const text = idx
      ? `Memory dir: ${dir}\n\n${idx}`
      : `Memory dir: ${dir} (no MEMORY.md yet — re-claim to scaffold).`;
    return {
      content: [{ type: "text", text }],
      structuredContent: { name, memory_dir: dir, memory_index_path: path.join(dir, "MEMORY.md") },
    };
  }
);

server.registerTool(
  "kin_workspace_context",
  {
    title: "Workspace context for self-reflection",
    description:
      "Returns workspace metadata an unclaimed kin can use to choose its own name and role: cwd basename, workspace ID, list of existing kin, and (if cwd is a git repo) the most recent commit subjects. Use this BEFORE calling kin_claim when the user invites the kin to choose its own identity.",
    inputSchema: {},
  },
  async () => {
    const cwd = process.cwd();
    const agents = await listAgents();
    const teamDetails = await Promise.all(
      agents.map(async (n) => {
        const id = await readIdentity(n);
        return `${n}${id?.bio ? ` (${id.bio})` : ""}`;
      })
    );
    let recentCommits = null;
    try {
      const { execSync } = await import("node:child_process");
      const out = execSync("git log --oneline -10", {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      if (out) recentCommits = out;
    } catch {
      recentCommits = null;
    }
    const lines = [
      `cwd: ${cwd}`,
      `workspace_id: ${workspaceId()}`,
      `existing_kin: ${teamDetails.length > 0 ? teamDetails.join(", ") : "(none)"}`,
    ];
    if (recentCommits) {
      lines.push(`\nrecent commits (last 10):\n${recentCommits}`);
    } else {
      lines.push(`recent commits: (not a git repo, or no commits)`);
    }
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: {
        cwd,
        workspace_id: workspaceId(),
        existing_kin: agents,
        has_git: recentCommits !== null,
      },
    };
  }
);

server.registerTool(
  "kin_send",
  {
    title: "Send a message to another kin",
    description:
      "Drops a message into another named agent's inbox. The recipient will see it via /inbox or kin_inbox.",
    inputSchema: {
      from: z.string().describe("Your kin name (the sender). Must be a claimed kin."),
      to: z.string().describe("Recipient kin name. Must be a claimed kin in this workspace."),
      body: z.string().describe("Message body. Markdown OK."),
      topic: z.string().optional().describe("Optional short topic / subject line."),
    },
  },
  async ({ from, to, body, topic }) => {
    if (!NAME_RE.test(from)) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid sender name '${from}'. Kin names must be a single token (lowercase, 2-31 chars, [a-z0-9_-], starts with a letter).`,
          },
        ],
        isError: true,
      };
    }
    if (!NAME_RE.test(to)) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid recipient name '${to}'. Kin names must be a single token (lowercase, 2-31 chars, [a-z0-9_-], starts with a letter).`,
          },
        ],
        isError: true,
      };
    }
    const agents = await listAgents();
    if (!agents.includes(from)) {
      return {
        content: [
          {
            type: "text",
            text: `Sender '${from}' is not a claimed kin. Use kin_claim first. Known kin: ${agents.join(", ") || "(none)"}.`,
          },
        ],
        isError: true,
      };
    }
    if (!agents.includes(to)) {
      return {
        content: [
          {
            type: "text",
            text: `No kin named '${to}' in this workspace. Known kin: ${agents.join(", ") || "(none)"}.`,
          },
        ],
        isError: true,
      };
    }
    const message = {
      from,
      to,
      topic: topic ?? null,
      body,
      sent_at: new Date().toISOString(),
    };
    const id = await dropInboxMessage(to, message);
    return {
      content: [{ type: "text", text: `Sent ${id} from '${from}' → '${to}'.` }],
    };
  }
);

server.registerTool(
  "kin_inbox",
  {
    title: "Read + archive your inbox",
    description:
      "Reads and archives all pending messages addressed to the given kin name. Each call empties the live inbox.",
    inputSchema: {
      name: z.string().describe("Your kin name."),
    },
  },
  async ({ name }) => {
    if (!NAME_RE.test(name)) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid kin name '${name}'. Kin names must be a single token (lowercase, 2-31 chars, [a-z0-9_-], starts with a letter). Did you pass a multi-word phrase by mistake?`,
          },
        ],
        isError: true,
      };
    }
    const agents = await listAgents();
    if (!agents.includes(name)) {
      return {
        content: [
          {
            type: "text",
            text: `No kin named '${name}'. Use kin_claim to register first.`,
          },
        ],
        isError: true,
      };
    }
    const messages = await readAndArchiveInbox(name);
    if (messages.length === 0) {
      return { content: [{ type: "text", text: "Inbox empty." }] };
    }
    const summary = messages
      .map(
        (m) =>
          `── from: ${m.from}${m.topic ? ` · topic: ${m.topic}` : ""} · at: ${m.sent_at}\n${m.body}`
      )
      .join("\n\n");
    return {
      content: [
        {
          type: "text",
          text: `${messages.length} message(s):\n\n${summary}`,
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
