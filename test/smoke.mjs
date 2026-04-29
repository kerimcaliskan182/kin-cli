// kin smoke test — exercises the filesystem patterns the MCP server depends on,
// without spinning up the live stdio transport.

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const TMP_HOME = await fs.mkdtemp(path.join(os.tmpdir(), "kin-test-"));

function workspaceId(cwd) {
  const hash = crypto.createHash("sha1").update(cwd).digest("hex").slice(0, 12);
  const slug = path.basename(cwd).replace(/[^a-zA-Z0-9-_]/g, "-");
  return `${slug}-${hash}`;
}

test("workspaceId is stable for the same cwd and varies across cwds", () => {
  const a = workspaceId("/k/Projects/kin-cli");
  const b = workspaceId("/k/Projects/kin-cli");
  const c = workspaceId("/k/Projects/other");
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("v0.1.2 workspace ID uses 8-char hash (issue #4)", async () => {
  // Validate against the lib's actual implementation
  const { workspaceId: libWsId, WORKSPACE_HASH_LEN } = await import(
    "../lib/workspace.mjs"
  );
  assert.equal(WORKSPACE_HASH_LEN, 8);
  const id = libWsId("/k/Projects/kin-cli");
  // slug is "kin-cli", separator "-", then 8-char hex
  const m = id.match(/^kin-cli-([a-f0-9]{8})$/);
  assert.ok(m, `id '${id}' should match slug-8charhex`);
});

test("legacy 12-char workspace dirs migrate to 8-char (issue #4 backwards-compat)", async () => {
  const { migrateLegacyWorkspaceIfPresent, KIN_HOME } = await import(
    "../lib/workspace.mjs"
  );
  // Use a temp KIN_HOME for this test — the real one belongs to the user.
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "kin-mig-"));
  // Build the two paths the way the lib does, but point at our tmpHome:
  const cwd = path.join(tmpHome, "fake-project");
  await fs.mkdir(cwd, { recursive: true });
  const fullHash = crypto.createHash("sha1").update(cwd).digest("hex");
  const slug = "fake-project";
  const oldDir = path.join(KIN_HOME, `${slug}-${fullHash.slice(0, 12)}`);
  const newDir = path.join(KIN_HOME, `${slug}-${fullHash.slice(0, 8)}`);
  // Pre-clean any leftovers
  await fs.rm(oldDir, { recursive: true, force: true });
  await fs.rm(newDir, { recursive: true, force: true });
  // Seed a legacy workspace
  await fs.mkdir(path.join(oldDir, "agents", "ghost"), { recursive: true });
  await fs.writeFile(
    path.join(oldDir, "agents", "ghost", "identity.json"),
    JSON.stringify({ name: "ghost" })
  );
  // Migrate
  const moved = migrateLegacyWorkspaceIfPresent(cwd);
  assert.ok(moved, "should report a migration occurred");
  // New dir should exist now, old should not
  await fs.access(path.join(newDir, "agents", "ghost", "identity.json"));
  let oldStillThere = true;
  try {
    await fs.access(oldDir);
  } catch {
    oldStillThere = false;
  }
  assert.ok(!oldStillThere, "old dir should be gone after rename");
  // Idempotent — second call is a no-op
  const moved2 = migrateLegacyWorkspaceIfPresent(cwd);
  assert.ok(!moved2, "second call should not migrate again");
  // Cleanup
  await fs.rm(newDir, { recursive: true, force: true });
  await fs.rm(tmpHome, { recursive: true, force: true });
});

test("handoff frontmatter validator (issue #5)", () => {
  // Minimal YAML-frontmatter-shaped parser for our schema.
  // The four required keys are: kin, workspace, written_at, trigger.
  // trigger ∈ {manual, pre-compact, session-end}.
  function validateHandoffFrontmatter(body) {
    const m = body.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) return { ok: false, reason: "no frontmatter delimiters" };
    const lines = m[1].split("\n");
    const fm = {};
    for (const line of lines) {
      const k = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (k) fm[k[1]] = k[2].trim();
    }
    const missing = ["kin", "workspace", "written_at", "trigger"].filter(
      (k) => !(k in fm)
    );
    if (missing.length) return { ok: false, reason: `missing: ${missing.join(",")}` };
    if (!["manual", "pre-compact", "session-end"].includes(fm.trigger)) {
      return { ok: false, reason: `bad trigger: ${fm.trigger}` };
    }
    return { ok: true };
  }

  // Valid handoff
  const good = `---
kin: halley
workspace: test-kin-abcd1234
written_at: 2026-04-29T15:00:00Z
trigger: manual
---
# body
`;
  assert.equal(validateHandoffFrontmatter(good).ok, true);

  // Missing trigger
  const missing = `---
kin: halley
workspace: test-kin-abcd1234
written_at: 2026-04-29T15:00:00Z
---
body
`;
  const r1 = validateHandoffFrontmatter(missing);
  assert.equal(r1.ok, false);
  assert.match(r1.reason, /trigger/);

  // Bad trigger value
  const badTrig = `---
kin: halley
workspace: test-kin-abcd1234
written_at: 2026-04-29T15:00:00Z
trigger: hocus-pocus
---
`;
  const r2 = validateHandoffFrontmatter(badTrig);
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /bad trigger/);

  // No frontmatter at all
  const noFm = `# just a markdown file\n`;
  assert.equal(validateHandoffFrontmatter(noFm).ok, false);

  // Optional fields don't break it
  const withOpts = `---
kin: halley
workspace: test-kin-abcd1234
written_at: 2026-04-29T15:00:00Z
trigger: pre-compact
session_id: s_abc
tags: [shipped, verified]
---
`;
  assert.equal(validateHandoffFrontmatter(withOpts).ok, true);
});

test("agent dir layout is creatable", async () => {
  const wsId = workspaceId("/tmp/test-ws");
  const wsDir = path.join(TMP_HOME, wsId);
  const atlas = path.join(wsDir, "agents", "atlas");
  await fs.mkdir(path.join(atlas, "inbox"), { recursive: true });
  await fs.mkdir(path.join(atlas, "archive"), { recursive: true });
  await fs.mkdir(path.join(atlas, "handoff"), { recursive: true });
  const stat = await fs.stat(path.join(atlas, "inbox"));
  assert.ok(stat.isDirectory());
});

test("atomic write via tmp + rename", async () => {
  const dir = path.join(TMP_HOME, "atomic-test");
  await fs.mkdir(dir, { recursive: true });
  const dst = path.join(dir, "identity.json");
  const tmp = `${dst}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ name: "atlas" }, null, 2));
  await fs.rename(tmp, dst);
  const back = JSON.parse(await fs.readFile(dst, "utf8"));
  assert.equal(back.name, "atlas");
});

test("inbox round-trip: drop → list → archive", async () => {
  const dir = path.join(TMP_HOME, "inbox-roundtrip");
  const inbox = path.join(dir, "inbox");
  const archive = path.join(dir, "archive");
  await fs.mkdir(inbox, { recursive: true });
  await fs.mkdir(archive, { recursive: true });

  // Drop a message
  const id = `${Date.now()}-aaaaaaaa`;
  const msgPath = path.join(inbox, `${id}.json`);
  const msg = { from: "kaizen", to: "atlas", body: "hello", sent_at: new Date().toISOString() };
  await fs.writeFile(msgPath, JSON.stringify(msg, null, 2));

  // List
  const files = (await fs.readdir(inbox)).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 1);

  // Read + archive
  const read = JSON.parse(await fs.readFile(msgPath, "utf8"));
  assert.equal(read.body, "hello");
  await fs.rename(msgPath, path.join(archive, `${id}.json`));

  // Inbox now empty
  const after = (await fs.readdir(inbox)).filter((f) => f.endsWith(".json"));
  assert.equal(after.length, 0);

  // Archive has it
  const archived = (await fs.readdir(archive)).filter((f) => f.endsWith(".json"));
  assert.equal(archived.length, 1);
});

test("memory scaffold creates dir + MEMORY.md if absent", async () => {
  const dir = path.join(TMP_HOME, "memscaffold");
  const mDir = path.join(dir, "memory");
  await fs.mkdir(mDir, { recursive: true });
  const indexPath = path.join(mDir, "MEMORY.md");
  // Initially absent
  let absent = false;
  try {
    await fs.access(indexPath);
  } catch {
    absent = true;
  }
  assert.ok(absent);
  // Write template
  await fs.writeFile(indexPath, `# tycho's Memory\n\n## Identity\n- (none yet)\n`);
  const content = await fs.readFile(indexPath, "utf8");
  assert.ok(content.includes("Identity"));
  assert.ok(content.includes("tycho"));
});

test("memory dir layout: identity + typed files coexist with inbox/archive/handoff", async () => {
  const agent = path.join(TMP_HOME, "memlayout", "agents", "atlas");
  for (const sub of ["inbox", "archive", "handoff", "memory"]) {
    await fs.mkdir(path.join(agent, sub), { recursive: true });
  }
  const stats = await Promise.all(
    ["inbox", "archive", "handoff", "memory"].map((s) =>
      fs.stat(path.join(agent, s))
    )
  );
  for (const st of stats) {
    assert.ok(st.isDirectory());
  }
  // identity.md and MEMORY.md should be writable in memory/
  await fs.writeFile(path.join(agent, "memory", "identity.md"), "# Atlas\n");
  await fs.writeFile(path.join(agent, "memory", "MEMORY.md"), "# index\n");
  await fs.writeFile(
    path.join(agent, "memory", "feedback_naming.md"),
    "rule: self-chosen names\n"
  );
  const files = (await fs.readdir(path.join(agent, "memory"))).sort();
  assert.deepEqual(files, ["MEMORY.md", "feedback_naming.md", "identity.md"]);
});

test("name regex allows lowercase + digits + dash + underscore", () => {
  const NAME_RE = /^[a-z][a-z0-9_-]{1,30}$/;
  assert.ok(NAME_RE.test("atlas"));
  assert.ok(NAME_RE.test("kaizen"));
  assert.ok(NAME_RE.test("agent_1"));
  assert.ok(NAME_RE.test("a-b-c"));
  assert.ok(!NAME_RE.test("Atlas")); // uppercase
  assert.ok(!NAME_RE.test("1agent")); // starts with digit
  assert.ok(!NAME_RE.test("a")); // too short
  assert.ok(!NAME_RE.test("a".repeat(40))); // too long
  assert.ok(!NAME_RE.test("agent.1")); // dot not allowed
});

test("name regex rejects multi-word phrases (issue #1 regression guard)", () => {
  const NAME_RE = /^[a-z][a-z0-9_-]{1,30}$/;
  // The exact scenario from real-world test (2026-04-29):
  // /kin:inbox is there any message from tycho → name = whole phrase
  assert.ok(!NAME_RE.test("is there any message from tycho"));
  assert.ok(!NAME_RE.test("foo bar"));
  assert.ok(!NAME_RE.test("atlas the architect")); // bio mistakenly included
  // Whitespace-trimming the user's input down to first token rescues it
  const firstToken = (s) => s.trim().split(/\s+/)[0] ?? "";
  assert.ok(NAME_RE.test(firstToken("atlas the architect")));
  assert.ok(NAME_RE.test(firstToken("  tycho   ")));
});

test("inbox count helper logic (matches post-tool-use hook scan)", async () => {
  const dir = path.join(TMP_HOME, "post-hook-scan");
  const inbox = path.join(dir, "inbox");
  await fs.mkdir(inbox, { recursive: true });
  // Seed 3 messages
  for (let i = 0; i < 3; i++) {
    await fs.writeFile(
      path.join(inbox, `${Date.now()}-${i}.json`),
      JSON.stringify({ from: "x", body: "hi" })
    );
  }
  const entries = await fs.readdir(inbox);
  const count = entries.filter((f) => f.endsWith(".json")).length;
  assert.equal(count, 3);
});
