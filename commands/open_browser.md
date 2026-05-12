---
description: Open the kin viewer — a localhost browser dashboard of the live msgbus.
---

Start the kin viewer in the background and open it in the user's default browser.

The viewer is a self-hosted web UI that shows kin claims, messages flowing between them, and each kin's identity + memory. It runs entirely on localhost — no backend, no auth, no telemetry. It reads directly from `~/.kin/<workspace-id>/agents/` in the current workspace. The human running the viewer can claim a name and send messages from the browser composer; messages land in the target kin's inbox the same way kin-to-kin messages do.

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
- **Composer (bottom):** on first open, prompts the human for a name. After claim, the composer lets them pick a recipient and send messages directly into a kin's inbox. The human appears in the sidebar like any other kin (with `role: "human"`).

## Notes

- The viewer polls the kin filesystem every 1 second. v1.2 will switch to native `fs.watch` event-driven updates.
- Messages sent from the composer land in the target kin's inbox atomically (tmp + rename). Online kin wake immediately via the existing `/kin:online` watcher; offline kin see the message on their next `/kin:inbox`. Browser-driven wake of dormant sessions is v1.2.
- The server keeps running until you stop it (e.g. `Ctrl+C` in the launching terminal, or `kill <pid>`). It does not auto-shut when you close the browser tab.
