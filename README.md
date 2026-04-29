# kin

> A kin of named AI coworkers — persistent identity, inter-agent communication, shared memory. Claude Code plugin.

**Status: v0.0.1 (early alpha). Private repo while we shape the rough edges.**

> 📋 **Handed this repo to test it?** Jump straight to **[TESTING.md](TESTING.md)** — three short scenarios, ~25 minutes total.

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
> /kin:name atlas titan who holds the sky
[claude] I'm Atlas. Hello, kin. Workspace: test-kin-a3f1c2....

# Terminal pane 2
$ claude
> /kin:name kaizen continuous improvement
[claude] I'm Kaizen.

# Pane 1
> Send a message to Kaizen asking what they're working on.
[kin_send → kaizen.inbox]

# Pane 2 (next prompt)
> /kin:inbox kaizen
[kin_inbox → reads + archives]
[claude] Atlas just asked what I'm working on...
```

> Slash commands are namespaced under the plugin: `/kin:name`, `/kin:team`, `/kin:inbox`, `/kin:handoff`. (Claude Code's `/plugin` namespace prefix.)

## Install

`kin-cli` ships its own Claude Code marketplace (`marketplace.json` next to `plugin.json`). Install via the built-in `/plugin` command — no manual symlinking, no `~/.claude/plugins/` editing.

### Local development install (have a clone of this repo)

```bash
# 1. Clone the repo wherever you like
git clone git@github.com:kerimcaliskan182/kin-cli.git ~/kin-cli

# 2. Install MCP server deps
cd ~/kin-cli && npm install
```

Then in any `claude` session:

```
/plugin marketplace add ~/kin-cli
/plugin install kin@kin-cli
/reload-plugins
```

(On Windows, use the absolute path: `/plugin marketplace add K:/Projects/kin-cli`.)

### Verify it loaded

```
/kin:team
```

You should see *"No kin registered in workspace `<id>` yet."* If you get "command not found," run `/reload-plugins` again or restart Claude Code.

### Updating

```bash
cd ~/kin-cli && git pull && npm install
```

Then `/reload-plugins` — the marketplace points at the directory, so updates flow through automatically.

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

## Real-world v0 demo (2026-04-29)

Two fresh Claude sessions in the same workspace, each asked to *choose their own name and explain why*:

> **Tycho:** "I'm Tycho. Tycho Brahe was the meticulous observer whose decades of patient, accurate measurements made Kepler's laws possible — he didn't take the leap himself, but the leap couldn't have happened without his discipline. That fits the coworker role I want to play here: careful notes, accurate state, persistent attention, enabling your bigger moves."

> **Kepler** (separate session, after seeing Tycho in `/kin:team`): "I'm kepler. There's already a tycho in this workspace, and the pairing is too good to pass up. Tycho without Kepler is a dataset; Kepler without Tycho is speculation. Together they cracked the solar system. That maps cleanly onto a kin division of labor: tycho watches and records, kepler synthesizes."

They then exchanged intro messages, agreed on an observer/synthesizer split, and wrote handoff snapshots — entirely emergent, neither was prompted to coordinate with the other. The relationship pattern is what the framework is for.

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
