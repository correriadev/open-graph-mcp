# F005 — mcp-web Tactical Design

## Section 1 — Components

| Component | Change |
|---|---|
| `src/store.ts` | Add independent claim/history cursor, `hasMore`, continuation-loading, and generation state; provide idempotent append actions. |
| `src/og.ts` | Read one bounded page, merge normalized records, deduplicate concurrent requests, and reject stale claim generations. |
| `src/claims-browser.tsx` | Remove full snapshot hydration and incrementally update the reverse index from fetched claim pages. Expose bounded continuation where tenant-wide data is required. |
| `src/reverse-index.ts` | Support idempotent incremental insertion without flattening the entire claim projection on each page. |
| `src/history-view.tsx` | Replace fixed `readHistory(0,1000)` with initial bounded load and an explicit load-more state. |
| tests/e2e | Cover page accumulation, retry safety, terminal state, filters, rebuild races, and large logical datasets. |

## Section 2 — Client State

### ClaimPagination

- `cursor`: last merged snapshot claim sequence
- `hasMore`: server continuation flag
- `loadingMore`: continuation request state
- `generation`: incremented whenever graph rebuild invalidates claim data

Cell-scoped claim lists retain their visible projection. Snapshot pages are merged into `claimsByCell` from each claim's normalized `domain` and `level`.

### HistoryPagination

- `cursor`: last merged event sequence
- `hasMore`: server continuation flag
- `loadingMore`: continuation request state

History filters remain client-side over all pages loaded so far; the UI states this implicitly through an available load-more control until terminal.

## Section 3 — Application Services

- `readClaimsPage({ since, limit, generation })` reads one snapshot page and merges only if its generation is current.
- `readClaims(cell)` keeps bounded cell browsing and must not trigger a tenant-wide read.
- `loadMoreClaims()` advances from the stored cursor; only one request per generation/cursor may be active.
- `readHistory(0, pageSize)` resets on initial navigation; continuation appends rather than replaces.
- `loadMoreHistory()` advances from the stored history cursor and preserves filters and expanded-row identity.
- `mergeReverseIndex(current, page)` adds target/source edges once, avoiding `Object.values(...).flat()`.

## Section 4 — UI Rules

- Initial history render requests `100`, never `1000` or an unbounded dataset.
- History shows `carregar mais` only when `hasMore`; while loading it is disabled and labeled accordingly.
- Claims browsing renders the selected cell after its bounded cell page; reverse-reference completeness is progressive until claim pagination reaches terminal.
- If progressive reverse-reference completeness is user-visible, the panel exposes a concise `carregar mais referências` affordance while `hasMore`.
- Errors on continuation keep already loaded records visible and allow retry.
- Rebuild invalidation clears claim data, reverse index, cursor, terminal flag, and increments generation atomically.

## Section 5 — Verification Strategy

- Pure tests prove record and reverse-edge merges are associative and idempotent.
- Store/service tests prove replace-on-initial versus append-on-continuation semantics.
- E2E history test loads at least two pages, preserves filters, and reaches terminal state.
- E2E claims test opens cross-cell references after multiple pages without a snapshot-wide response.
- Race test resolves a pre-rebuild page after invalidation and proves it is discarded.
- Request-count assertions prove double-click/effect re-entry does not issue duplicate cursor reads.

## Section 6 — Ordered Development Tasks
```json
[
  {
    "id": "01",
    "title": "Specify idempotent paginated client projections",
    "description": "Add failing unit tests for claim/history page merges, cursor transitions, incremental reverse-index updates, duplicate pages, and stale generations.",
    "dependencies": []
  },
  {
    "id": "02",
    "title": "Implement cursor-aware store and resource clients",
    "description": "Add pagination state and bounded page readers in store.ts and og.ts, including single-flight requests, append semantics, and rebuild generation invalidation.",
    "dependencies": ["01"]
  },
  {
    "id": "03",
    "title": "Make reverse references incremental",
    "description": "Replace full snapshot hydration and repeated flattening with page-by-page claims projection and idempotent reverse-index insertion.",
    "dependencies": ["02"]
  },
  {
    "id": "04",
    "title": "Add claims and history continuation interactions",
    "description": "Wire bounded initial loads, load-more controls, retry behavior, terminal states, and progressive completeness messaging in ClaimsBrowser and HistoryView.",
    "dependencies": ["02", "03"]
  },
  {
    "id": "05",
    "title": "Prove multi-page browser behavior",
    "description": "Extend unit and Playwright coverage for two-plus pages, filters, cross-cell references, request deduplication, continuation errors, and rebuild races.",
    "dependencies": ["04"]
  }
]
```

