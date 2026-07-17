---
description: Show who is present on the open-graph, optionally scoped to one cell.
argument-hint: "[cell]"
disable-model-invocation: true
---

Call the open-graph MCP tool `presence.who` (no `token` argument needed — the
plugin's proxy injects it automatically). If an argument was given
(`$ARGUMENTS`), pass it as `cell`; otherwise call with no `cell` to list
everyone.

Print the result as a short human-readable list, one line per user: name,
agentKind, and the cell they're focused on (if any). If the list is empty,
say so plainly — don't call any other tool.
