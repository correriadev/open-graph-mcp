# CLAIMS AND HISTORY PAGINATION

## OVERVIEW

- **Use** `since=<seq>&limit=<n>` for bounded claims and history reads.
- **Treat** `since` as an exclusive tenant-local sequence cursor.
- **Return** `nextCursor` and `hasMore` with each page.
- **Merge** pages incrementally in the web projection.

## RESOURCE CONTRACT

| Parameter | Rule |
|---|---|
| `since` | Use a non-negative safe integer; default to `0`. |
| `limit` | Use an integer from `1` through `500`; default to `100`. |
| ordering | Return records in ascending `seq` order. |
| `nextCursor` | Return the last record sequence or the input cursor for an empty page. |
| `hasMore` | Derive from a bounded `limit + 1` query. |

## SERVER BEHAVIOR

- REQUIRED: **Filter claims and history by tenant and `seq > since`**.
- REQUIRED: **Keep cell claim reads indexed by tenant, domain, canonical level, and sequence**.
- REQUIRED: **Exclude private `lock.denied` events** before deriving history continuation.
- PROHIBITED: **Materialize an entire tenant claim set in one resource response**.

## WEB BEHAVIOR

- **Deduplicate** cell requests by generation, cell, and cursor.
- **Deduplicate** snapshot and history requests by cursor.
- **Merge** claims by identifier and history events by sequence.
- **Extend** the reverse-reference index per claim page.
- **Discard** stale claim responses after graph invalidation.
- **Preserve** accumulated rows when a continuation request fails.

## DURABILITY CONSTRAINT

- REQUIRED: **Persist claim levels canonically as `P<n>` in SQLite and JSONL**.
- REQUIRED: **Normalize legacy numeric levels during JSONL replay before indexed cell reads resume**.
- PROHIBITED: **Rely only on the SQLite-open normalization**, because recovery can restore numeric JSONL values and hide claims from equality-based cell pagination.

## FOLDER STRUCTURE

| Path | Responsibility |
|---|---|
| `packages/mcp-server/src/resources.ts` | Validate cursors and return bounded claims/history envelopes. |
| `packages/mcp-server/src/db.ts` | Define sequence indexes and durable replay behavior. |
| `packages/mcp-server/src/store.ts` | Canonicalize claim writes and manage tenant claim caches. |
| `packages/mcp-server/test/resources.test.ts` | Verify pagination, isolation, compatibility, and boundaries. |
| `packages/mcp-server/README.md` | Publish MCP resource usage. |
| `packages/mcp-web/src/store.ts` | Store page cursors and idempotently merge projections. |
| `packages/mcp-web/src/og.ts` | Coordinate bounded reads, continuation, and invalidation. |
| `packages/mcp-web/src/single-flight.ts` | Collapse duplicate in-flight requests by cursor key. |
| `packages/mcp-web/src/reverse-index.ts` | Merge reverse references incrementally. |
| `packages/mcp-web/src/claims-browser.tsx` | Render cell and reference continuation controls. |
| `packages/mcp-web/src/history-view.tsx` | Render bounded history and load-more behavior. |
| `packages/mcp-web/test/pagination.test.ts` | Verify projection and pagination state behavior. |
| `packages/mcp-web/test/single-flight.test.ts` | Verify request deduplication. |

## CROSS-REFERENCES

- **Keep** this feature document self-contained until a human approves a related ADR.
