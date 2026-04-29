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
import os from "node:os";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Workspace + filesystem helpers
// ---------------------------------------------------------------------------

const KIN_HOME = process.env.KIN_HOME || path.join(os.homedir(), ".kin");

function workspaceId() {
  const cwd = process.cwd();
  const hash = crypto.createHash("sha1").update(cwd).digest("hex").slice(0, 12);
  const slug = path.basename(cwd).replace(/[^a-zA-Z0-9-_]/g, "-");
  return `${slug}-${hash}`;
}

const WORKSPACE_DIR = path.join(KIN_HOME, workspaceId());

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
// MCP server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "kin",
  version: "0.0.1",
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
    const text = existing
      ? `Welcome back, ${name}. Last seen ${existing.last_seen}.${identity.bio ? ` Bio: ${identity.bio}` : ""}`
      : `kin '${name}' claimed in workspace ${workspaceId()}.${identity.bio ? ` Bio: ${identity.bio}` : ""}`;
    return { content: [{ type: "text", text }] };
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
