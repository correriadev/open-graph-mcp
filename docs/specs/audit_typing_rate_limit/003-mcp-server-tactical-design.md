# F006 — mcp-server Tactical Design

## Section 1 — Components

| Component | Change |
|---|---|
| `src/state.ts` | Add an in-memory actor-session index initialized with server state. |
| `src/tools/presence.ts` | Register and unregister session IDs with every presence lifecycle transition. |
| `src/tools/typing.ts` | Resolve only indexed actor sessions in `touchDelta`, validate stale entries, and preserve transition semantics. |
| `test/typing-network-aggregation.test.ts` | Add multi-session, isolation, cleanup, stale-index, and scale-shaped assertions. |
| `test/presence-ownership.test.ts` | Verify rejected ownership changes never corrupt the actor index. |

## Section 2 — Domain Structures

### ActorKey

Use a collision-safe representation of `(tenantId, userId)`, such as a nested map `Map<tenantId, Map<userId, Set<sessionId>>>`. Avoid delimiter-based keys whose values may contain the delimiter.

### ActorSessionIndex

The index is ephemeral like presence state. It contains no durable data and is empty on restart. Canonical `state.presence` remains authoritative; index lookup validates tenant and user before mutation.

## Section 3 — Lifecycle Flow

1. When `touch` creates a presence, insert its session ID into the actor bucket.
2. When the same presence is touched again, keep index registration idempotent.
3. When explicit SSE close removes a presence, remove its session ID from the actor bucket.
4. When heartbeat expiry removes a presence, perform the same removal through a shared helper.
5. When `touchDelta` runs, iterate only the resolved actor session set, validate each presence, update valid `lastDeltaAt` values with one timestamp, and prune stale entries.

## Section 4 — Invariants and Complexity

- `touchDelta` is `O(S_actor)`, where `S_actor` is the actor's live session count.
- No typing signal iterates `state.presence.values()`.
- One actor with multiple tabs updates all owned sessions.
- Same user ID across tenants uses distinct buckets.
- Ownership rejection creates no index entry and moves no session.
- Close and expiry remove empty buckets.
- `sweepTyping` may retain its periodic global scan because it runs on a fixed interval, not per keystroke; this feature optimizes the hot signal path.
- Invisible and forced-quiet behavior remains unchanged.

## Section 5 — Verification Strategy

- Assert index membership on presence creation, explicit close, and heartbeat expiry.
- Assert a two-session actor updates both timestamps.
- Assert equal user IDs in different tenants remain isolated.
- Seed hundreds of unrelated presences and instrument/structure the test so `touchDelta` visits only the actor bucket.
- Inject a stale session ID and assert lookup prunes it without throwing.
- Preserve authentication, ephemeral persistence, and transition-only network aggregation tests.

## Section 6 — Ordered Development Tasks
```json
[
  {
    "id": "01",
    "title": "Specify indexed actor-session lifecycle behavior",
    "description": "Add failing tests for multi-session updates, tenant isolation, explicit close, heartbeat expiry, ownership rejection, stale entries, and unrelated-presence scale.",
    "dependencies": []
  },
  {
    "id": "02",
    "title": "Add the ephemeral actor-session index",
    "description": "Extend ServerState and presence lifecycle helpers with collision-safe tenant/user buckets and idempotent registration/removal.",
    "dependencies": ["01"]
  },
  {
    "id": "03",
    "title": "Make typing touches proportional to actor sessions",
    "description": "Update touchDelta to use validated indexed session IDs, prune stale entries, and preserve existing typing classification and tool authentication.",
    "dependencies": ["02"]
  },
  {
    "id": "04",
    "title": "Regress presence and typing integration",
    "description": "Run focused ownership, lifecycle, typing aggregation, tenant isolation, and server regression suites.",
    "dependencies": ["03"]
  }
]
```

