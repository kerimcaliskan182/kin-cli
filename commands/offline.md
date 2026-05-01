---
description: Go offline — stop your inbox watcher and clear your presence
allowed-tools: ["Bash"]
argument-hint: "[optional: <your-kin-name>] — defaults to the kin claimed in this session"
---

The user wants to go offline — stop their kin's inbox watcher so it no longer wakes on incoming messages, and clear its presence file so other kin's `/kin:online` discovery shows it as `offline_claimed` instead of `online`.

## Step 1 — determine the kin name

If `$ARGUMENTS` is non-empty: trim it, take only the first whitespace-separated token, ensure it matches `^[a-z][a-z0-9_-]{1,30}$`. If it doesn't match, ask clarifying — don't run with a malformed name.

If `$ARGUMENTS` is empty: **infer from this session's context.** The kin name should be obvious from the conversation — most recent `/kin:claim`, recent `kin_claim` MCP calls, the kin's own self-references, or `from=` in recent `kin_send` calls *that you made*. If unambiguous, proceed; otherwise ask: "Which kin should go offline?"

Don't try to infer from the workspace alone (e.g. by running `list-presence` and picking the only online kin) — that's a different question than "which kin is *this* session." Two sessions could be running watchers for two different kin; you should only take *yours* offline.

## Step 2 — stop the watcher

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/stop-watcher.mjs" <name>
```

The script:
- Reads `~/.kin/<workspace>/agents/<name>/presence.json` to find the watcher PID.
- If no presence file or the PID is already dead, removes any stale presence and reports "already offline" (idempotent — safe to re-run).
- Otherwise sends SIGTERM and waits up to 2s for the watcher to clean up.
- Exits 0 on success, 3 if the PID won't die, 4 on permission errors.

Surface the script's stdout to the user verbatim. It's already concise and tells the relevant story.

## Step 3 — note the originating Monitor will end naturally

If this command is run in the *same* Claude session that started the watcher via `/kin:online`, the persistent `Monitor` task tracking that watcher will close on its own a moment after the watcher process exits (the Monitor's command pipeline ends when the script's stdout closes). You will see a final notification from that task as it ends. No need to call `TaskStop` — but you can if you want to be explicit about it.

If this command is run in a *different* session, the originating session's Monitor will still close cleanly the same way, but that session's user won't see the closure until they next look. Mention this if relevant.

## On failure

- Exit 3 (won't die after SIGTERM) — surface the script's message. Don't auto-escalate to `kill -9`; that skips the watcher's signal handler and leaves a stale presence file. The user can choose to escalate manually.
- Exit 4 (kill failed) — usually permissions; surface the error.
- Any other non-zero — surface the output and stop. Don't paper over it.
