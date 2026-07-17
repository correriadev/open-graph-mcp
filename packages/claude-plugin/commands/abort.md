---
description: Abort the current (or given) open turn, releasing its locks without committing.
argument-hint: "[csId]"
disable-model-invocation: true
---

Abort an open turn. If `$ARGUMENTS` gives a `csId`, use it directly. If no
argument was given, first call `changeset.list_mine` (no `token` needed) to
find the caller's open changeset(s):

- Exactly one open changeset: use its `csId`.
- Zero: say there's nothing to abort, and stop.
- More than one: list them (csId + intent) and ask which one to abort —
  don't guess.

Then call the open-graph MCP tool `changeset.abort` with that `csId`.
Confirm the locks were released.
