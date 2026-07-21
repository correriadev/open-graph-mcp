# F005 — Claims and History Cursor Pagination: Problem Space

## Scope

Large tenants must be able to inspect claims and audit history without any request loading an unbounded tenant dataset. The shared pagination language is `since=<seq>&limit=<N>`, where `seq` is monotonic inside a tenant. This feature covers the MCP server read resources and the web consumers that accumulate pages.

## Domain Events

1. A reader requests a claims or history page after a known sequence.
2. The server validates the cursor and page size.
3. The server reads at most the bounded page size from the authenticated tenant.
4. The server returns ordered records and continuation metadata.
5. The web client merges the page without duplicating records.
6. The reader requests another page when more data is available.
7. A graph rebuild invalidates claim projections and restarts claim pagination from the initial cursor.

## Subdomains

| Subdomain | Classification | Responsibility |
|---|---|---|
| Tenant-scoped read model | Core | Return bounded, deterministic claims and history pages without cross-tenant leakage. |
| Cursor contract | Core | Define validation, ordering, continuation, and terminal-page semantics. |
| Claims projection | Supporting | Merge claim pages by stable claim identity and incrementally maintain reverse references. |
| Audit history presentation | Supporting | Append event pages and visibly expose whether older/newer records remain. |

## Ubiquitous Language

| Term | Meaning |
|---|---|
| Cursor | The last consumed tenant-local sequence, sent as `since`; records returned have `seq > since`. |
| Page limit | Maximum records requested; normalized to a documented safe bound. |
| Page | Records ordered by ascending `seq`, plus continuation metadata. |
| Next cursor | Highest `seq` returned, or the input cursor for an empty page. |
| Has more | Server-derived indication that another page exists after `nextCursor`. |
| Initial page | A request with `since=0`. |
| Claim projection | Client state accumulated from one or more bounded claims pages. |
| History projection | Client state accumulated from one or more bounded history pages. |
| Snapshot-wide claims read | Current unbounded `scope=snapshot` behavior to be retired from the web flow. |

## Business Rules

- Every claims/history database query is tenant-scoped, ordered by ascending `seq`, and bounded.
- `since` is an exclusive cursor; pages must not overlap when the next request uses `nextCursor`.
- Invalid, negative, non-integer cursors and limits fail explicitly rather than silently changing query meaning.
- The server owns the maximum limit and never permits an unbounded value.
- Empty and terminal pages are valid results.
- History continues excluding private `lock.denied` events from the shared resource.
- Web page merges are idempotent under retries and React effect re-entry.
- A graph rebuild clears claim cursor/projection state before claims are fetched again.
- Existing cell-scoped claim browsing remains available; tenant-wide reverse-index hydration becomes incremental and bounded.

## Resolved Design Questions

- Cursor basis: use existing tenant-local `claims.seq` and `events.seq`; no offset pagination.
- Direction: ascending sequence for transport and continuation; the UI may render descending where already expected.
- Continuation: return `nextCursor` and `hasMore`; query `limit + 1` rows to compute `hasMore` without a tenant-wide count.
- Bounds: default `100`, maximum `500` for both resources, declared constants on the server.
- Compatibility: history retains `graphId`, `since`, and `events`; claims cell reads remain supported. New pagination metadata is additive.
- Snapshot claims: `graph://claims?scope=snapshot` becomes a bounded page contract rather than a full `claimsByCell` payload; the web does not depend on a single all-tenant response.

