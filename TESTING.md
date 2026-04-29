# Testing kin v0.1.0

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

**Note:** kin's slash commands are namespaced — `/kin:claim`, `/kin:team`, `/kin:inbox`, `/kin:handoff`.

---

## Scenario 1 — Self-chosen identity + brain (~5 min)

**Goal:** the kin chooses its own name and writes its first `identity.md` to memory.

**Steps:**

```bash
cd ~/some-project
claude
```

Inside the Claude session:

1. Run `/kin:claim` — **with no argument**. The kin should:
   - Call `kin_workspace_context` to ground itself
   - Pick a name + reasoning
   - Call `kin_claim` and announce itself with the *why*
   - Write `identity.md` to its memory dir
2. Ask: *"show me your identity.md"* — the kin should `Read` the file from its memory dir.
3. Run `/kin:team` — should list the chosen name.
4. Run `/compact`. After compaction, type *"who are you?"*

**What to look for:**
- ✅ Self-choice — the kin reflected and explained, not just "I'm AI-1."
- ✅ `~/.kin/<workspace>/agents/<name>/memory/identity.md` exists, has YAML frontmatter, and the body explains the name choice in real terms.
- ✅ `~/.kin/<workspace>/agents/<name>/memory/MEMORY.md` has an entry pointing at `identity.md`.
- ✅ After `/compact`, the kin can re-claim and remembers itself by reading `MEMORY.md`.

**Override path** (also worth a try): `/kin:claim atlas the architect` — the kin uses the explicit name without reflection. Useful for testing re-claim flows.

**Bug-hunting hints:**
- If the kin asks *you* to pick a name on `/kin:claim`, that's a regression of issue #6 — flag it.
- If `identity.md` isn't written on first claim, the skill ritual didn't fire — flag it.

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
Inside: `/kin:claim` (let the kin choose).

**Pane B:**
```bash
cd ~/some-project   # ← MUST be the same dir as pane A
claude
```
Inside: `/kin:claim` — and watch whether this kin notices the first one in `kin_team` and chooses a complementary name (Tycho/Kepler-style). That's the demo.

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
5. Type `/kin:claim atlas` — Atlas should re-claim and say *"Welcome back, Atlas. Last seen ..."*
6. Ask: *"What were we working on?"*

**What to look for:**
- ✅ The handoff file has enough information that Atlas can read it and pick up the thread (you can prompt: *"read the most recent file in `~/.kin/<workspace>/agents/atlas/handoff/`"*).
- ✅ The PreCompact hook left a `PRE_COMPACT_HINT.md` breadcrumb in the workspace dir.
- ✅ Atlas's identity is preserved, not redefined.

---

## Scenario 4 — Autonomous memory (~10 min)

**Goal:** the kin writes to its brain *without being told to*, in response to a real correction.

**Steps:**

In an active kin session (claim a name first, e.g. `/kin:claim`):

1. Give the kin a real preference correction. Something like:
   - *"Don't use single-letter variable names in code — always full words. We got burned by debugging `i j k l` collisions last month."*
2. After the kin acknowledges, look in `~/.kin/<workspace>/agents/<name>/memory/`. Within a few prompts, there should be a `feedback_*.md` file capturing the rule (with **Why:** and **How to apply:** lines per the skill schema), and `MEMORY.md` should be updated to point at it.
3. **The user should never have to say "save this to memory."** If they did, that's a regression of issue #7.

**What to look for:**
- ✅ Spontaneous `feedback_<topic>.md` write after a real correction.
- ✅ `MEMORY.md` index updated.
- ✅ The frontmatter follows the skill schema (name / description / type).
- ✅ Body has rule + Why + How to apply.

**Variations worth trying:**
- A *project fact* (the kin should write `project_*.md`).
- A *pointer to an external system* like "Linear bugs go in INGEST" (should write `reference_*.md`).
- A *user preference* like "I write Turkish, you reply English" (should write `user_*.md`).

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
