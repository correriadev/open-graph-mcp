---
description: Open a turn (changeset) locking one or more cells before editing them.
argument-hint: "<cell1,cell2,...> <intent>"
disable-model-invocation: true
---

Open a turn on the open-graph. `$ARGUMENTS[0]` is a comma-separated list of
cells (e.g. `ui:4` or `ui:4,ui:5`); `$ARGUMENTS[1]` is the intent, a short
free-text description of what you're about to do.

Call the open-graph MCP tool `changeset.open` (no `token` needed) with
`cells` set to the parsed list from `$ARGUMENTS[0]` and `intent` set to
`$ARGUMENTS[1]`.

- On success (`ok: true`): report the `csId` and remind the user it's
  locked until `changeset.commit` or `changeset.abort` (or TTL expiry).
- On failure with `reason: "cell_locked"`: report who holds it (`holder`)
  and when it expires (`expiresAt`) — do not retry automatically.
