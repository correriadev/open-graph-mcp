# F005 — mcp-web Test Scenarios

## Feature: Progressive claims and history reads

### Scenario 1 — History initial page is bounded

Given the history route opens, when its first resource request is observed, then it uses `since=0&limit=100`, renders the returned events, and does not request a fixed 1000-row page.

### Scenario 2 — Load more appends and reaches terminal state

Given a first history page with `hasMore=true`, when the user selects `carregar mais`, then the next request uses the stored `nextCursor`, prior rows remain, new rows append once, and the control disappears when `hasMore=false`.

### Scenario 3 — Filters survive page accumulation

Given a history filter is active, when another page is appended, then the filter remains selected and applies to the accumulated projection without losing URL round-trip behavior.

### Scenario 4 — Continuation error is recoverable

Given history rows are already visible and a continuation request fails, then existing rows remain visible, an error/retry affordance appears, and retry uses the same cursor without duplicates.

### Scenario 5 — Concurrent load-more requests collapse

Given a continuation is in flight, when the control is clicked twice or an effect re-enters, then only one resource request is issued for that cursor.

### Scenario 6 — Claim pages merge into cells incrementally

Given snapshot claim pages contain claims for multiple cells, when pages arrive, then each claim is grouped into its cell exactly once and cell browsing never requires a full-tenant response.

### Scenario 7 — Reverse index grows without full rebuild

Given claim B on a later page references claim A from an earlier page, when B's page is merged, then A's `referenciado por` list gains B exactly once without flattening all stored claims.

### Scenario 8 — Progressive reference loading

Given reverse-reference pagination has `hasMore=true`, when an OpenClaim is displayed, then the UI indicates incomplete/progressive references and can load the next bounded page; after terminal, the indication disappears.

### Scenario 9 — Rebuild rejects stale claim responses

Given a claims page request is in flight, when `graph.rebuilt` invalidates claims and the old request later resolves, then its records are not merged; the next demand begins at cursor zero in the new generation.

### Scenario 10 — Duplicate page retry is idempotent

Given the same claims or history page is delivered twice, when both responses are merged, then claim IDs, event sequences, and reverse-reference edges remain unique.

### Scenario 11 — Empty initial and empty continuation states

Given an empty initial page, then the existing empty state is shown and no continuation is offered. Given an empty continuation after accumulated records, then those records remain and pagination becomes terminal.

### Scenario 12 — Existing read-to-write flow remains intact

Given the query-and-read journey, when the selected cell's bounded claims page loads and a claim opens, then provenance, RefChip navigation, and `abrir turno nesta cell` continue working.

## Performance Acceptance

- No client operation uses `Object.values(claimsByCell).flat()` to rebuild the full reverse index during page ingestion.
- Store growth is proportional to pages explicitly loaded, not total tenant size on first OpenClaim.
- Every network response is bounded by the server maximum, and UI request concurrency is at most one per resource cursor.

