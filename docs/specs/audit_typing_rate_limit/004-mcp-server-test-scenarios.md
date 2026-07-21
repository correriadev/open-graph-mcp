# F006 — mcp-server Test Scenarios

## Feature: Indexed typing activity updates

### Scenario 1 — Multi-session actor update

Given one tenant user owns two live presence sessions, when `presence.typing` is called with that user's token, then both sessions receive the same new `lastDeltaAt` value.

### Scenario 2 — Cross-tenant isolation

Given two tenants contain users with the same user ID, when tenant A emits typing, then only tenant A's sessions change.

### Scenario 3 — Unrelated presence is not traversed

Given one actor session and hundreds of unrelated sessions, when that actor emits typing, then lookup visits only the actor's indexed session IDs and unrelated timestamps remain unchanged.

### Scenario 4 — Explicit close cleans the index

Given a registered presence, when its SSE session closes, then the presence and its index membership are removed; if it was the final actor session, the empty actor bucket is removed.

### Scenario 5 — Heartbeat expiry cleans the index

Given a presence exceeds the heartbeat TTL, when the presence sweep runs, then removal has the same index cleanup semantics as explicit close.

### Scenario 6 — Repeated touches are idempotent

Given repeated heartbeat/focus calls for one session, when index membership is inspected, then the session identifier appears exactly once.

### Scenario 7 — Ownership rejection cannot corrupt index membership

Given a session already belongs to one tenant/user, when another token attempts to focus or beat that session, then the call is rejected and the original actor bucket remains unchanged.

### Scenario 8 — Stale index entries self-heal

Given an actor bucket contains a nonexistent or mismatched session identifier, when typing is touched, then no unrelated presence changes, the stale identifier is pruned, and the tool does not throw.

### Scenario 9 — Actor without presence is a safe no-op

Given an authenticated user has no registered presence session, when `presence.typing` is called, then it returns `{ ok: true }` and creates no presence or index entry.

### Scenario 10 — Existing transition semantics are preserved

Given a focused visible presence, when indexed activity is touched and the typing sweep runs repeatedly, then only actual quiet/typing/idle transitions are broadcast and typing events remain absent from SQLite and JSONL.

### Scenario 11 — Invisible behavior is preserved

Given an invisible session, when typing activity and sweeps occur, then no typing state is broadcast; changing from visible typing to invisible emits exactly one final quiet transition.

## Complexity Acceptance

- The per-signal `touchDelta` path contains no iteration over all presence values.
- Work grows with the actor's session count, independent of unrelated users or tenants.
- Index storage contains one membership per live presence and releases empty buckets.

