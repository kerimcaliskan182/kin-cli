---
description: Write a manual handoff snapshot for this kin
argument-hint: "<your-kin-name>"
---

The user wants to manually snapshot a handoff for kin `$ARGUMENTS`.

1. Read the current team state by calling `kin_team`.
2. Build a markdown handoff document covering:
   - **Identity:** name + bio (from `kin_team`)
   - **Current focus:** what you're working on right now (use the conversation context)
   - **Open threads:** pending decisions or questions still in flight
   - **Recent kin traffic:** any messages exchanged this session
3. Write it to `~/.kin/<workspace-id>/agents/<name>/handoff/<ISO-timestamp>.md` using the Write tool. Use `kin_team`'s output to find the workspace-id (it's printed in the header).
4. Confirm the path you wrote to.

This file is what future-you reads after a `/compact` or in a fresh session to remember who they are and what was happening.
