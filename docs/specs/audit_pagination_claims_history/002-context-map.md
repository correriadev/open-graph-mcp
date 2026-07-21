# F005 — Context Map

## Bounded Contexts

| Context | Project | Owns | Does not own |
|---|---|---|---|
| Paginated Resource Read Model | `mcp-server` | Cursor validation, tenant predicates, SQL ordering/limits, page envelopes | UI merge state and interaction |
| Claims Exploration | `mcp-web` | Claim page accumulation, per-cell projection, incremental reverse index, loading controls | Authoritative claim storage |
| Audit History | `mcp-web` | History page accumulation, filters, continuation controls | Event visibility policy and persistence |

## Context Relationships

```text
SQLite tenant data
  -> Paginated Resource Read Model (authoritative upstream)
       -> Claims Exploration (customer/conformist)
       -> Audit History (customer/conformist)
```

The server publishes a single pagination dialect. Both web contexts conform to it but keep independent cursors and loading/error state.

## Integration Contracts

### Claims page

Request: `graph://claims?scope=snapshot&since=<seq>&limit=<n>`

Response fields:

- `graphId: string | null`
- `since: number`
- `limit: number`
- `claims: ClaimRecord[]` ordered by ascending `seq`
- `nextCursor: number`
- `hasMore: boolean`

Cell request compatibility: `graph://claims?cell=<domain:level>&since=<seq>&limit=<n>` uses the same page metadata, with `cell` included.

### History page

Request: `graph://history?since=<seq>&limit=<n>`

Response fields:

- existing `graphId`, `since`, and `events`
- normalized `limit`
- `nextCursor`
- `hasMore`

### Anti-corruption rules in web

- Parse unknown payloads defensively and treat absent additive metadata as a terminal legacy page.
- Merge claims by `id` and history by `seq`; sort ascending in state.
- Never replace previously accumulated pages during a continuation request.
- Ignore stale responses after invalidation by associating requests with a local generation.

## Invariants Across Contexts

- A cursor from one tenant never affects another tenant's data.
- A returned page contains no record with `seq <= since`.
- `claims.length <= limit` and `events.length <= limit`.
- `hasMore=false` means a request at `nextCursor` has no currently visible next record.
- Private event visibility remains enforced before pagination metadata is calculated.

## Failure Translation

| Server condition | Web behavior |
|---|---|
| Invalid cursor or limit | Resource error shown; prior accumulated data remains usable. |
| Empty initial page | Empty state, no load-more control. |
| Empty continuation page | Keep accumulated data, mark terminal. |
| Duplicate/retried page | Idempotent merge; no duplicate rows or reverse edges. |
| Rebuild during claim request | Discard stale response and restart from cursor `0` on demand. |

