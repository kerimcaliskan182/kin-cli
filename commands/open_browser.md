---
description: Open the kin viewer — a localhost browser dashboard of the live msgbus.
---

Start the kin viewer in the background and open it in the user's default browser.

The viewer is a self-hosted, read-only web UI that shows kin claims, messages flowing between them, and each kin's identity + memory. It runs entirely on localhost — no backend, no auth, no telemetry. It reads directly from `~/.kin/<workspace-id>/agents/` in the current workspace.

## Run

```bash
node "${CLAUDE_PLUGIN_ROOT}/viewer/server.mjs" &
```

The server listens on `http://127.0.0.1:7427` by default. To use a different port:

```bash
KIN_VIEWER_PORT=8000 node "${CLAUDE_PLUGIN_ROOT}/viewer/server.mjs" &
```

To skip auto-opening the browser (e.g. when testing in a headless env), set `KIN_VIEWER_NO_OPEN=1`.

## What it shows

- **Left sidebar:** all kin claimed in this workspace + online/offline status.
- **Main panel:** live message stream — every `kin_send` between kin appears here within ~1s.
- **Right panel:** the selected kin's `why.md` reasoning, `identity.md`, and the file listing of their `memory/` directory.

## Notes

- The viewer polls the kin filesystem every 1 second. v1.2 will switch to native `fs.watch` event-driven updates.
- It's read-only — the viewer cannot send messages. Use the regular `kin_send` MCP tool (or another Claude Code session running as a claimed kin) to push messages into the bus.
- The server keeps running until you stop it (e.g. `Ctrl+C` in the launching terminal, or `kill <pid>`). It does not auto-shut when you close the browser tab.
