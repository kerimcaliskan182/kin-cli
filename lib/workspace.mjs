// Shared workspace helpers for the kin MCP server + hooks.
//
// The workspace ID is derived from the cwd: a slug + an 8-char hash prefix.
// (v0.1.2 shortened from 12 → 8 chars per issue #4. Migration is handled
// idempotently below for users coming from v0.1.x.)

import { promises as fs, statSync, renameSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const KIN_HOME =
  process.env.KIN_HOME || path.join(os.homedir(), ".kin");

export const WORKSPACE_HASH_LEN = 8;
export const LEGACY_WORKSPACE_HASH_LEN = 12;

export function workspaceId(cwd = process.cwd()) {
  const fullHash = crypto.createHash("sha1").update(cwd).digest("hex");
  const slug = path.basename(cwd).replace(/[^a-zA-Z0-9-_]/g, "-");
  return `${slug}-${fullHash.slice(0, WORKSPACE_HASH_LEN)}`;
}

// Idempotent migration: if a v0.1.x workspace dir exists with a 12-char hash
// and the new 8-char dir doesn't, rename the legacy dir in place. Safe to
// call repeatedly. Returns true if a migration happened.
//
// Sync because we want it to run before any other workspace I/O at script
// startup. fs.statSync on two paths is microseconds.
export function migrateLegacyWorkspaceIfPresent(cwd = process.cwd()) {
  const fullHash = crypto.createHash("sha1").update(cwd).digest("hex");
  const slug = path.basename(cwd).replace(/[^a-zA-Z0-9-_]/g, "-");
  const newId = `${slug}-${fullHash.slice(0, WORKSPACE_HASH_LEN)}`;
  const legacyId = `${slug}-${fullHash.slice(0, LEGACY_WORKSPACE_HASH_LEN)}`;
  if (newId === legacyId) return false; // shouldn't happen, but safe
  const newDir = path.join(KIN_HOME, newId);
  const legacyDir = path.join(KIN_HOME, legacyId);
  let legacyExists = false;
  try {
    statSync(legacyDir);
    legacyExists = true;
  } catch {
    return false;
  }
  let newExists = false;
  try {
    statSync(newDir);
    newExists = true;
  } catch {
    newExists = false;
  }
  if (legacyExists && !newExists) {
    renameSync(legacyDir, newDir);
    return true;
  }
  return false;
}

export function workspaceDir(cwd = process.cwd()) {
  return path.join(KIN_HOME, workspaceId(cwd));
}

// Ensure migration runs once per process import. The cost is two statSync calls
// in the common no-migration case — negligible.
migrateLegacyWorkspaceIfPresent();
