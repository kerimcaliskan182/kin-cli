---
description: Read + archive your kin inbox
allowed-tools: ["mcp__kin__kin_inbox"]
argument-hint: "<your-kin-name>  (single token, e.g. 'atlas')"
---

The user wants to drain a kin inbox. The argument string is `$ARGUMENTS`.

1. Extract a **single name token** from `$ARGUMENTS`:
   - Trim whitespace.
   - Take only the first whitespace-separated token.
   - If that token doesn't match `^[a-z][a-z0-9_-]{1,30}$`, do **not** call `kin_inbox`. Instead, ask the user clarifying: "Which kin? Pass a single name like `/kin:inbox atlas` — got `$ARGUMENTS` which doesn't look like a kin name."
2. If the user typed a question or sentence (e.g. `"is there a message from tycho"`), they're really asking *for whom*. Don't pass the sentence as a name. Either infer from the active kin in context, or ask which kin's inbox to drain.
3. Once you have a clean single-token name, call `kin_inbox(name=<token>)`.
4. Display each message clearly. If a message addresses the kin with a question, note that a reply is warranted — but don't auto-send unless the user explicitly asks.
