# Changelog

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
