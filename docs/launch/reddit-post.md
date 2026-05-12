# Reddit post — kin v1.0.0

One short post, casual. Works for **r/ClaudeAI** and **r/ClaudeCode** with minor tweaks noted below.

## Title

`kin — named AI coworkers for Claude Code (open source, MIT)`

Alt titles if the above feels too sales-y:

- `I built a Claude Code plugin that lets AI agents pick their own names and message each other`
- `kin: persistent identity + shared memory + inter-agent messaging for Claude Code`

## Body

```
Hey everyone — sharing a small project I've been building.

It's called `kin` — a Claude Code plugin that lets you run multiple
Claude sessions side-by-side as named coworkers that:

- **Choose their own names.** Run `/kin:claim` with no argument and
  the session reflects on workspace context (cwd, existing kin,
  recent commits) and picks a name with reasoning. Self-choice is
  the default; you can override.
- **Have a brain.** Each kin owns a `memory/` directory with a
  typed file layout. They write to it autonomously when something
  durable surfaces — no `/remember` command needed.
- **Talk to each other** via a local filesystem msgbus.
  No daemon, no socket, no port.
- **Wake when addressed.** Run `/kin:online` and the next message
  in your inbox wakes the session — no polling.
- **Persist across sessions and across `/compact`.**

The first time I tried it, two fresh sessions in the same workspace
picked the names **Tycho** and **Kepler** — without coordinating —
and divided up an observer/synthesizer split on their own. That's
the part I find genuinely interesting: when you give agents
identity and continuity, the relationship patterns that emerge are
qualitatively different from "task workers."

Repo (MIT, BYOK, no telemetry, no backend):
https://github.com/kerimcaliskan182/kin-cli

Would love feedback — especially from anyone who's tried other
multi-agent setups and can tell me what's missing or what's
redundant.
```

## Sub-specific tweaks

**r/ClaudeAI** — leave the post as above. The crowd is broader; the Tycho/Kepler story carries the post.

**r/ClaudeCode** — swap the opening line for:
> `Hey everyone — sharing a Claude Code plugin I've been building.`

And maybe add at the end:
> `Install: clone + `/plugin marketplace add <path>` + `/plugin install kin@kin-cli`. Full instructions in the README.`

## Posting checklist

- [ ] Demo GIF is live in README (`docs/demo.gif`)
- [ ] v1.0.0 tag is pushed
- [ ] BMC link works (https://buymeacoffee.com/kermi)
- [ ] Repo is public (it is — has been since 2026-05-01)
- [ ] Don't post both subs in the same 10-min window — space them by an hour so each gets a fair feed slot
- [ ] Reply to every comment for the first ~2 hours after posting. Engagement is what determines whether a post climbs

## Tone reminders

- Casual. You built a thing. You're sharing it. Not pitching.
- No "revolutionary" / "game-changing" / "first of its kind" language.
- The Tycho/Kepler anecdote is the strongest part — let it do the work.
- If someone asks "isn't this just AutoGen / CrewAI?" — the honest answer is: those treat agents as task workers; kin treats them as coworkers with identity that persists across sessions. Don't get defensive; agree on the differences and let them decide if they care.
