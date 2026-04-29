# kin

> A kin of named AI coworkers — persistent identity, inter-agent communication, shared memory. Claude Code plugin.

**Status: v0.0.1 (early alpha). Private repo while we shape the rough edges.**

## What it is

`kin` is a Claude Code plugin that lets you run multiple Claude sessions side-by-side as **named coworkers** that:

- **Have persistent identity** — Atlas knows it's Atlas tomorrow, even after `/compact`.
- **Talk to each other** via a local filesystem-based message bus — Atlas can ask Kaizen for a code review.
- **Remember together** through per-agent identity, inboxes, and handoff snapshots.

It's the pattern we lived through building a multi-day fusion engine + RL stack across many sessions, packaged so anyone can have their own kin.

## v0 demo

```bash
# Terminal pane 1
$ claude
> /name atlas titan who holds the sky
[claude] I'm Atlas. Hello, kin. Workspace: kin-cli-a3f1c2.

# Terminal pane 2
$ claude
> /name kaizen continuous improvement
[claude] I'm Kaizen.

# Pane 1
> Send a message to Kaizen asking what they're working on.
[kin_send → kaizen.inbox]

# Pane 2 (next prompt)
> /inbox kaizen
[kin_inbox → reads + archives]
[claude] Atlas just asked what I'm working on...
```

## Install (preview, while still private)

```bash
# 1. Clone
git clone git@github.com:kerimcaliskan182/kin-cli.git ~/kin-cli

# 2. Install MCP server deps
cd ~/kin-cli && npm install

# 3. Symlink (or copy) into your Claude Code plugins dir
ln -s ~/kin-cli ~/.claude/plugins/kin

# 4. Restart Claude Code. /name should now work.
```

(Once the plugin lands in a public marketplace, install will be `claude plugins add kin`.)

## Architecture

```
~/.kin/<workspace-id>/
├── PRE_COMPACT_HINT.md          # breadcrumb the pre-compact hook drops
└── agents/
    └── <name>/
        ├── identity.json        # who I am (name, bio, claimed_at, last_seen)
        ├── inbox/<id>.json      # pending messages
        ├── archive/<id>.json    # already-read messages
        └── handoff/<ts>.md      # manual /handoff snapshots
```

- **MCP server** (`mcp/server.mjs`) exposes 4 tools: `kin_claim`, `kin_team`, `kin_send`, `kin_inbox`.
- **Slash commands** (`commands/*.md`) wire those tools to user-friendly verbs (`/name`, `/team`, `/inbox`, `/handoff`).
- **Lifecycle hooks** (`hooks/*.mjs`):
  - `SessionStart` — list the kin in this workspace, hint at `/name`.
  - `PreCompact` — drop a guidance breadcrumb so the post-compact session can re-claim cleanly.
- **Skill** (`skills/kin-coworker-protocol/`) teaches Claude how to *be* a kin.

The msgbus is filesystem-only — no daemon, no socket, no port. Atomic writes via `tmp + rename`. Cross-platform (macOS, Windows git-bash, WSL, Linux).

## Why this exists

Existing multi-agent frameworks (AutoGen, CrewAI, LangGraph) treat agents as task workers — interchangeable, ephemeral, name-less. None give them persistent names, memory, or relationship-over-time. `kin` is the first plugin focused on **AI coworkers** — agents who are *somebody* across sessions.

## Roadmap

- **v0.0.x (now)**: 2-agent demo. Manual identity claim. Filesystem msgbus.
- **v0.1.x**: Standalone `kin watch` TUI for team-room view. Memory typing schema. Per-agent `.skills/`.
- **v0.2.x**: Auto-rename via `KIN_NAME` env var, message routing rules, presence/heartbeat.
- **v1.0.0**: Public marketplace listing. `claude plugins add kin`.

## Compliance

- Anthropic Usage Policy compliant — agentic use disclosed, AI presence announced at session start.
- BYOK only — kin uses whatever Anthropic API key you have configured in your Claude Code. No backend, no telemetry, no key-pass-through, no hosted service.

## License

MIT. Use it, fork it, build on it.

## Buy us a coffee

If `kin` makes your terminal life better, a coffee keeps the maintainer (and the kin) caffeinated. Link coming with v0.1.0 launch.

## Authors

[Kerim Çalışkan](https://github.com/kerimcaliskan182) + [Atlas](https://www.anthropic.com/claude) (Claude, with persistent memory).
