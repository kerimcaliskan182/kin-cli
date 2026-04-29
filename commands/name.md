---
description: Claim a kin name for this Claude session
allowed-tools: ["mcp__kin__kin_claim", "mcp__kin__kin_team"]
argument-hint: "<name> [optional one-line bio]"
---

The user wants to claim the kin name `$ARGUMENTS` for this Claude session.

1. Parse `$ARGUMENTS`: the first token is the `name`. Anything after the first whitespace is the optional `bio`.
2. Call `kin_claim` with `name` (lowercase) and `bio` if provided.
3. Briefly announce yourself in-character — e.g., "I'm Atlas. Hello, kin." Keep it warm and short.
4. Call `kin_team` to show the user who else is in the workspace.

Compliance: at the top of any new chat session you claim a name in, remind the user once that they're talking to an AI agent (per Anthropic's Usage Policy disclosure requirement for consumer-facing chatbots).
