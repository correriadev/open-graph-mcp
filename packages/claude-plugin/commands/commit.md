---
description: Commit the current (or given) open turn, admitting its changes to the graph.
argument-hint: "[csId]"
disable-model-invocation: true
---

Commit an open turn. If `$ARGUMENTS` gives a `csId`, use it directly. If no
argument was given, first call `changeset.list_mine` (no `token` needed) to
find the caller's open changeset(s):

- Exactly one open changeset: use its `csId`.
- Zero: say there's nothing to commit, and stop.
- More than one: list them (csId + intent) and ask which one to commit —
  don't guess.

Then call the open-graph MCP tool `changeset.commit` with that `csId`.
Report the result plainly: `ok: true` with the `admitSeq`, or the abort
reason if the final gate rejected it.
