---
description: Stop the kin viewer server for this workspace.
---

Send a graceful shutdown signal to the kin viewer that's running for the current workspace. The browser tab keeps showing its last snapshot but won't receive new updates after this. Idempotent — safe to run when no viewer is up.

## Run

```bash
node "${CLAUDE_PLUGIN_ROOT}/viewer/stop.mjs"
```

## Notes

- The viewer also shuts itself down automatically after 5 minutes with no connected viewers, so this command is mostly useful when you want to free port 7427 immediately (e.g. to switch `KIN_VIEWER_PORT`).
- Workspace-scoped: the PID file lives under `~/.kin/<workspace-id>/.viewer.pid`, so stopping the viewer in one project doesn't affect another.
