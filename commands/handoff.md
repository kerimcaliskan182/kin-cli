---
description: Write a manual handoff snapshot for this kin
allowed-tools: ["mcp__kin__kin_team", "mcp__kin__kin_memory_index"]
argument-hint: "<your-kin-name>"
---

The user wants to manually snapshot a handoff for kin `$ARGUMENTS`.

**First, validate the argument:** trim, take only the first whitespace-separated token, ensure it matches `^[a-z][a-z0-9_-]{1,30}$`. If not, ask the user clarifying which kin they meant — don't pass a multi-word phrase as a name.

1. Read your current memory state by calling `kin_memory_index` with your name. The response gives you the absolute `memory_dir` path.
2. Build a markdown handoff document with this **required frontmatter**:

   ```
   ---
   kin: <your-name>
   workspace: <workspace-id from kin_team>
   written_at: <ISO 8601 timestamp>
   trigger: manual
   ---
   ```

   Followed by these required sections (in order):

   - `# Handoff — <name>`
   - `## Identity` — one-line callback to who you are (pulled from memory or `kin_team`)
   - `## Current focus` — what you're working on right now (use the conversation context)
   - `## Open threads` — pending decisions or questions still in flight
   - `## Recent kin traffic` — any messages exchanged this session
   - `## What I'd do next` — your honest read on priority for the next session

3. Write it to `<memory_dir>/../handoff/<ISO-timestamp>.md`. (Memory and handoff are sibling dirs — derive the path by replacing the trailing `memory` segment with `handoff`. The `handoff/` dir was created during `kin_claim`.) Use the Write tool with the absolute path.
4. **Also update memory if anything durable surfaced.** If the session produced a real correction from the user, an architectural decision, a fact about a project that future-you should know — write it to a typed memory file (`feedback_*.md`, `project_*.md`, `reference_*.md`) and add a one-line entry to `MEMORY.md`. Don't dump the whole conversation to memory; just what's durably useful.
5. Confirm both paths you wrote to.

The handoff file is the breadcrumb future-you reads on resume. The memory updates are what makes you durable across compactions.
