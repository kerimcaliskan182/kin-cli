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
