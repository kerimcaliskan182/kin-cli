# Changelog

## v0.2.0 — 2026-04-29

The "kin can be **online** and wake on incoming messages" release. Closes #2.

### Added — presence + wake-on-message
- **`/kin:online [name]`** — start a long-lived inbox watcher whose stdout is surfaced as Claude Code wake notifications. Each new message in this kin's inbox emits one line and the harness wakes the session. No more polling, no more "did anyone send me anything?"
- **`/kin:offline [name]`** — stop the watcher, clean up presence, end the Monitor task. Idempotent and safe to re-run.
- **`scripts/watch-inbox.mjs`** — the watcher. Polls `agents/<name>/inbox/` every 1s, emits `INBOX from=<sender> topic=<…> id=<msgid>` on stdout for each new file. Writes presence file on startup, cleans up on SIGINT/SIGTERM/SIGHUP. Refuses to start if a live watcher already exists for the same kin (double-start guard, prevents the inbox-archival race).
- **`scripts/list-presence.mjs`** — reads all `agents/*/presence.json` files in the workspace, uses `kill -0` to test PID liveness, returns JSON with three categories: `online` / `offline_claimed` / `stale_presence`. Used by `/kin:online` for discovery.
- **`scripts/stop-watcher.mjs`** — SIGTERM the watcher, wait up to 2s for the cleanup handler to run, remove residual presence file if needed. Doesn't escalate to SIGKILL — that would skip the cleanup handler.

### Changed — PostToolUse hook is now offline-only
- The v0.1.1 PostToolUse hook used to announce *all* pending inboxes. With watchers introduced, online kin already get wake notifications from their own watcher — a PostToolUse mention would be redundant. The hook now skips kin with live watchers and only surfaces mail for kin in `offline_claimed` state. Notification message changed from `kin pending inboxes:` to `kin offline inboxes have mail:` to make the new semantics explicit.

### Changed — small UX fixes
- **SessionStart hook** now points at `/kin:claim` (was the deprecated `/kin:name`) and suggests `/rename <name>` to label the Claude Code session in the UI.
- **`/kin:claim`** suggests `/rename <name>` after a successful claim, with an explicit note that `/rename` is a Claude Code built-in and the user runs it themselves. Verified: `/rename` is a real Claude Code built-in command.

### Added — tests
- 6 new integration tests for the v0.2 scripts: presence file shape, list-presence empty workspace, list-presence with dead PID (stale_presence), list-presence with live PID (online — uses this test process's PID), stop-watcher idempotent on no-presence, stop-watcher cleans up stale file. Spawns subprocesses with controlled `KIN_HOME` + temp cwd for isolation.
- 18/18 smoke tests pass (was 12).

### Notes / known follow-ups
- Watcher polls at 1s. Real `fs.watch()` (inotify / FSEvents / RDCW) is the next step but has cross-platform gotchas; deferred.
- Presence files persist on SIGKILL. `list-presence`'s `stale_presence` bucket surfaces these so users know to investigate.
- `/kin:online`'s inference rule: when `$ARGUMENTS` is empty, infer the kin name from session context (recent `/kin:claim`, `from=` in recent `kin_send` calls, kin's self-references). After `/clear` or some compactions, re-run `/kin:claim <name>` first to restore identity.

## v0.1.2 — 2026-04-29

Closes #4 and #5 — clearing the v0.1 backlog.

### Changed
- **Workspace ID hash shortened to 8 chars** (#4). `test-kin-f07f4bf1803e` → `test-kin-f07f4bf1`. Idempotent in-place migration runs at module load: any v0.1.x workspace dirs with 12-char hashes are renamed to the 8-char form on first encounter, preserving all existing kin (identity, memory, inbox, archive, handoff). Constants `WORKSPACE_HASH_LEN` and `LEGACY_WORKSPACE_HASH_LEN` exported for future bumps.
- **Workspace helpers extracted to `lib/workspace.mjs`** — single source of truth for `KIN_HOME`, `workspaceId()`, `workspaceDir()`, and the legacy migration helper. `mcp/server.mjs` and all three hooks now import from there instead of duplicating the function.

### Added
- **Handoff frontmatter validator test** (#5). Confirms required keys (`kin / workspace / written_at / trigger`), validates `trigger ∈ {manual, pre-compact, session-end}`, and accepts optional `session_id` + `tags` fields without breaking. Foundation for the future `kin journal` command.
- **Optional handoff frontmatter fields**: `session_id` (for cross-session linking) and `tags` (list, e.g. `[shipped, blocked]`) — explicitly documented in `commands/handoff.md`.

### Tests
- 12/12 smoke tests pass (was 9). Added: 8-char ID assertion, legacy migration round-trip, handoff frontmatter validator (one test, 4 assertions — happy path, missing key, bad trigger, optional fields).

## v0.1.1 — 2026-04-29

Hardening release. Closes #1 and #3.

### Added
- **PostToolUse inbox-notification hook** (#3) — after every Bash/Read/Edit/Write/Grep/Glob, scans all kin inboxes in the workspace and emits a one-line notification if any have pending messages: *"kin pending inboxes: tycho(2), kepler(1)"*. Set env `KIN_QUIET=1` to mute.

### Fixed
- **Single-token name validation** (#1) — `kin_send`, `kin_inbox`, and `kin_memory_index` now check `NAME_RE` before lookup, with a clear error message ("Did you pass a multi-word phrase by mistake?"). Slash commands `/kin:inbox` and `/kin:handoff` now extract only the first whitespace-separated token from `$ARGUMENTS` and ask for clarification on multi-word input.

### Notes
- The notification hook is intentionally simple — it always announces non-zero counts on every relevant tool call, no "last seen" deduplication. Per-session state-tracking comes in v0.2.
- `KIN_QUIET=1` is the escape hatch if the notifications get noisy.

## v0.1.0 — 2026-04-29

The "kin actually has a brain and chooses who they are" release.

### Added
- **Self-chosen identity.** `/kin:claim` with no argument now reflects on workspace context (cwd, existing kin, recent commits) and picks a name with reasoning. Manual override still works: `/kin:claim atlas the architect`.
- **Autonomous typed memory.** Each kin owns a `memory/` directory with `MEMORY.md` index plus typed files (`identity.md`, `feedback_*.md`, `project_*.md`, `reference_*.md`, `user_*.md`). Writes happen autonomously when something durable surfaces — no `/remember` command needed.
- **`kin_workspace_context()` MCP tool** — returns cwd, workspace ID, existing kin list, and recent git commits. Used by the kin during self-reflection before claiming.
- **`kin_memory_index(name)` MCP tool** — re-fetch `MEMORY.md` mid-session without re-claiming.
- **Enhanced `kin_claim`** — response now includes the absolute `memory_dir` path, current `MEMORY.md` content, and `is_first_claim` flag, so the kin's brain is loaded into context the moment they claim.
- **Memory scaffold on first claim** — `memory/` directory and a templated `MEMORY.md` are created automatically.
- **Required handoff frontmatter** — `commands/handoff.md` now mandates `kin / workspace / written_at / trigger` YAML frontmatter and fixed body sections (Identity / Current focus / Open threads / Recent kin traffic / What I'd do next).
- **Skill rewrite** — `kin-coworker-protocol/SKILL.md` now has explicit "Your brain" section, six core principles including self-choice and autonomous memory, first-claim and re-claim rituals, and a typed-memory schema.
- **TESTING.md scenarios 1, 2, 4** rewritten / added to cover self-choice, two-agent emergent pairing, and autonomous memory writes.

### Changed
- `/kin:name` renamed to `/kin:claim`. (Alpha-only break — repo had no public users.)
- Plugin version `0.0.1` → `0.1.0` across `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and the MCP server's announced version.

### Closes
- #6 — Self-chosen identity (default flow)
- #7 — Autonomous memory (per-kin brain)

### Notes for v0.0.1 testers
- The slash command renamed from `/kin:name` to `/kin:claim`. Update any aliases / muscle memory.
- Existing v0.0.1 workspaces still work; the first time a kin re-claims under v0.1, its memory dir is scaffolded automatically.

## v0.0.1 — 2026-04-29

Initial scaffold. MCP server with `kin_claim`, `kin_team`, `kin_send`, `kin_inbox`. Slash commands `/kin:name`, `/kin:team`, `/kin:inbox`, `/kin:handoff`. SessionStart + PreCompact hooks. Filesystem msgbus.
