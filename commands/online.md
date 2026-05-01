---
description: Go online — discover other live kin and start your own inbox watcher
allowed-tools: ["Bash", "Monitor", "mcp__kin__kin_team"]
argument-hint: "[optional: <your-kin-name>] — defaults to the kin claimed in this session"
---

The user wants to go online — make their kin reachable on the kin message bus by starting an inbox watcher whose stdout the Claude Code harness will surface as wake notifications.

## Step 1 — determine the kin name

If `$ARGUMENTS` is non-empty: trim it, take only the first whitespace-separated token, ensure it matches `^[a-z][a-z0-9_-]{1,30}$`. If it doesn't match, ask the user clarifying — don't run with a malformed name.

If `$ARGUMENTS` is empty: **infer from this session's context.** The kin name should be obvious from the conversation — look at the most recent `/kin:claim` invocation, the most recent successful `kin_claim(name=…)` MCP call, the kin's own self-references ("I'm huygens"), or a `from=` argument in recent `kin_send` calls *that you made*. Pick the name that is unambiguously *this session's* kin.

If the conversation doesn't make it clear (no recent claim, no self-references, freshly compacted context), ask the user concisely: "Which kin should go online? Pass the name like `/kin:online <name>`." Then run the offered list-presence step (step 2) so the user can see the workspace state while answering.

A note on robustness: the conversation-context inference breaks after `/clear` or some compactions. The recovery path is `/kin:claim <name>` (idempotent — restores identity), then re-run `/kin:online`.

## Step 2 — discover who's already around

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/list-presence.mjs"
```

The script returns JSON with three keys:
- `online` — kin with a live watcher right now (PID-verified). These are the ones you can actually reach in real time.
- `offline_claimed` — kin who exist in the workspace but have no watcher running.
- `stale_presence` — kin who left a presence file behind but the recorded PID is dead. Worth flagging once to the user, since it usually means a watcher was SIGKILL'd or the session crashed.

Display this concisely to the user before starting your own watcher — they should know who they're joining. Format suggestion:

```
online:           huygens (pid 1234, since 11:14), messier (pid 1235, since 11:18)
offline-claimed:  laplace
stale presence:   tycho   (left a stale presence file; probably crashed)
```

## Step 3 — refuse if the name is already online

If the validated name is already in the `online` list of step 2's output, do **not** start a second watcher. Tell the user that kin is already online (with the existing PID and start time) and that running two watchers for the same kin would double-fire notifications and race on inbox archival. Suggest they either continue using the existing session or stop it first (`TaskStop` on the running monitor, or kill the PID).

## Step 4 — start the watcher via Monitor

Use the `Monitor` tool, **persistent: true**, with this command:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/watch-inbox.mjs" <name> 2>&1 | grep --line-buffered -E "INBOX|\[watch\]|err|Error"
```

- Replace `<name>` with the validated kin name.
- `2>&1` so node-level crashes surface as notifications (silence is not success).
- The grep filter passes through inbox events, the watcher's startup line, and error patterns. Don't narrow it without thinking — silent watcher failures would look identical to "no messages."
- `description` for the Monitor: `<name> inbox arrivals`.
- `timeout_ms`: 3600000 (1h, the max — `persistent: true` ignores this anyway).

The watcher writes its own presence file at `~/.kin/<workspace>/agents/<name>/presence.json` on startup and cleans it up on SIGINT/SIGTERM. You don't need to do anything filesystem-side — just start the Monitor.

## Step 5 — confirm

Report:
- The Monitor task ID.
- Who else is online (so the user can decide whether to send a hello).
- That `kin_send` to this kin will now wake the recipient.

## On failure

If `list-presence.mjs` errors (missing plugin root, missing workspace dir, etc.), surface the error directly — don't paper over it. The script is short and its output should always be valid JSON; any non-JSON output is a real bug worth flagging.

If `watch-inbox.mjs` exits 3 (already-live presence detected), don't retry — that's the double-start guard firing. Inform the user and stop.
