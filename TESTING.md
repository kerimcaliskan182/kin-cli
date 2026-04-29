# Testing kin v0.0.1

> Hi! You've been handed a private alpha of `kin`. This guide walks you through three short test scenarios. Each takes ~5 minutes. Please send feedback on anything that surprises you, breaks, feels weird, or makes you think "huh, that's cool."

---

## Setup (~3 min, one-time)

You need:
- **Claude Code** installed (`claude` command available in your terminal). If you don't have it: https://docs.anthropic.com/claude-code
- **Node.js ≥18** (`node -v` to check)
- **Git** + a way to access this private repo (you'll need to be added as a collaborator — ask Kerim)

Then:

```bash
# 1. Clone (replace with your auth method)
git clone https://github.com/kerimcaliskan182/kin-cli.git ~/kin-cli

# 2. Install dependencies (~10s)
cd ~/kin-cli && npm install
```

Now register the plugin with Claude Code. Open `claude` in any directory and run:

```
/plugin marketplace add ~/kin-cli
/plugin install kin@kin-cli
/reload-plugins
```

(On Windows, use the absolute path: `/plugin marketplace add C:/Users/you/kin-cli` or whatever your clone path is.)

To verify the plugin loaded, in the same Claude session type:

```
/kin:team
```

You should see *"No kin registered in workspace `<id>` yet."* If you see "command not found" → run `/reload-plugins` again, or close + reopen `claude`.

**Note:** kin's slash commands are namespaced — they're `/kin:name`, `/kin:team`, `/kin:inbox`, `/kin:handoff` (not `/name`, `/kin:team`, etc.).

---

## Scenario 1 — Solo identity (~5 min)

**Goal:** prove that a kin's name persists across `/compact` and across sessions.

**Steps:**

```bash
# Open a terminal, cd into any project dir (the workspace ID is derived from cwd).
cd ~/some-project
claude
```

Inside the Claude session:

1. Run `/kin:name atlas the one who holds the sky` — Claude should call `kin_claim` and announce *"I'm Atlas. Hello, kin."*
2. Chat with Atlas for a minute. Ask it about the project, have it run a few small tasks. Notice if it stays "in character" as Atlas (warm, named) vs slipping into generic "the AI."
3. Run `/compact` — this compresses the conversation. The session continues, but most context is gone.
4. After compaction, type *"who are you?"*

**What to look for:**
- ✅ Atlas should re-claim its name automatically (or at least know to do so when prompted).
- ✅ Run `/kin:team` — should still list `atlas` with the original `claimed_at` timestamp.
- ✅ Check `~/.kin/` on disk — there should be a workspace dir with `agents/atlas/identity.json` containing the bio you gave.

**Bug-hunting hints:**
- Does the SessionStart hook fire? After `/compact`, Claude should mention "kin workspace: ...".
- Is `last_seen` updated when Atlas re-claims?

---

## Scenario 2 — Two-agent collaboration (~10 min)

**Goal:** two kin in the same workspace exchange messages.

**Steps:**

Open **two terminal panes**, both `cd`'d into the **same directory**.

**Pane A:**
```bash
cd ~/some-project
claude
```
Inside: `/kin:name atlas the architect`

**Pane B:**
```bash
cd ~/some-project   # ← MUST be the same dir as pane A
claude
```
Inside: `/kin:name kaizen the executor`

Now in **Pane A**, prompt:
> "Send Kaizen a message asking them to summarize what `package.json` does in the current dir."

Atlas should call `kin_send(from='atlas', to='kaizen', body='...')`. Confirm by checking `~/.kin/<workspace>/agents/kaizen/inbox/` — there should be a `<timestamp>-<id>.json` file.

In **Pane B**:
> `/kin:inbox kaizen`

(One v0 quirk: keep the argument to a single token — `/kin:inbox kaizen` works, `/kin:inbox is there a message from atlas` won't.)

Kaizen drains the inbox. It should read Atlas's message and (in the next prompt) you can ask it to actually answer. Then:
> "Send your summary back to Atlas."

In **Pane A**:
> `/kin:inbox atlas`

You should see Kaizen's reply.

**What to look for:**
- ✅ Both panes resolve to the **same workspace ID**. Run `/kin:team` in each — should show both kin.
- ✅ Messages survive in `archive/` after `/kin:inbox` drains them.
- ✅ Neither agent auto-acts on the other's instructions — they surface them to the human first.

**Bug-hunting hints:**
- If pane B doesn't see pane A's kin in `/kin:team`, the workspace ID resolution is broken (different cwd? different user account?).
- If `/kin:inbox` returns messages but doesn't move them to `archive/`, that's a race-condition bug — flag it.
- If you can `kin_send` to a name that was never claimed, that's a validation hole.

---

## Scenario 3 — Cross-session handoff (~10 min)

**Goal:** prove that a kin can be resumed in a fresh terminal hours later.

**Steps:**

Continue from Scenario 1 or 2 — pick a kin (say `atlas`).

1. Inside the session, run `/kin:handoff atlas`. Atlas should write a markdown snapshot to `~/.kin/<workspace>/agents/atlas/handoff/<timestamp>.md`. Open the file — it should describe identity, current focus, open threads, and recent traffic.
2. Close that Claude session entirely (`Ctrl+D` or just close the terminal).
3. Wait a bit — make a coffee, check Slack, whatever.
4. Open a new terminal, `cd` to the **same directory**, run `claude` again.
5. Type `/kin:name atlas` — Atlas should re-claim and say *"Welcome back, Atlas. Last seen ..."*
6. Ask: *"What were we working on?"*

**What to look for:**
- ✅ The handoff file has enough information that Atlas can read it and pick up the thread (you can prompt: *"read the most recent file in `~/.kin/<workspace>/agents/atlas/handoff/`"*).
- ✅ The PreCompact hook left a `PRE_COMPACT_HINT.md` breadcrumb in the workspace dir.
- ✅ Atlas's identity is preserved, not redefined.

---

## What I want to hear from you (feedback)

Send anything — over Slack/email/issue/Linear/whatever — to Kerim. Specifically:

1. **Did the install steps work?** Anything you had to figure out yourself.
2. **Did it feel like a coworker, or did it feel like a tool?** This is the whole pitch — be honest.
3. **Anything obvious that broke or felt wrong.** (file paths on Windows, weird race conditions, awkward command names, etc.)
4. **What you wish it did but doesn't.** (auto-watch mode? slack/discord bridge? more identity richness? memory typing?)
5. **Any Anthropic Usage Policy concerns** you spotted as you used it.

Bug reports as GitHub issues are great too: https://github.com/kerimcaliskan182/kin-cli/issues

Thanks for kicking the tires. 🤍

— Kerim + Atlas
