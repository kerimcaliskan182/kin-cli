#!/usr/bin/env node
// Stop the running kin viewer for the current workspace.
//
// Reads the PID file written by server.mjs and sends SIGTERM. The server's
// own shutdown handler cleans up the PID file; if the process is already
// dead we clean up the stale file ourselves so the next /kin:open_browser
// starts fresh.

import { promises as fsp } from "node:fs";
import path from "node:path";
import { workspaceDir, workspaceId } from "../lib/workspace.mjs";

const PID_FILE = path.join(workspaceDir(process.cwd()), ".viewer.pid");

async function main() {
  let pidInfo;
  try {
    const raw = await fsp.readFile(PID_FILE, "utf8");
    pidInfo = JSON.parse(raw);
  } catch {
    console.log(`kin viewer — no running instance for workspace ${workspaceId(process.cwd())}`);
    return;
  }
  const { pid, port } = pidInfo || {};
  if (!pid || !Number.isInteger(pid)) {
    await fsp.unlink(PID_FILE).catch(() => {});
    console.log("kin viewer — pid file was malformed, cleaned up");
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`kin viewer — stopped (PID ${pid}${port ? `, port ${port}` : ""})`);
  } catch (e) {
    if (e.code === "ESRCH") {
      await fsp.unlink(PID_FILE).catch(() => {});
      console.log(`kin viewer — PID ${pid} was already dead, cleaned up`);
    } else {
      console.error(`kin viewer — could not signal PID ${pid}: ${e.message}`);
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error("kin viewer stop —", e.message);
  process.exit(1);
});
