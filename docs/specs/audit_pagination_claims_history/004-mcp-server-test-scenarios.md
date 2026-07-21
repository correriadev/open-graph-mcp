# F005 — mcp-server Test Scenarios

## Feature: Bounded tenant resource pagination

### Scenario 1 — Traverse claims without gaps or overlap

Given five claims in one tenant with ascending sequences 1 through 5, when snapshot claims are requested with `since=0&limit=2`, then two claims are returned, `nextCursor=2`, and `hasMore=true`. When subsequent requests use each `nextCursor`, all five claims appear exactly once and the final page has `hasMore=false`.

### Scenario 2 — Cell claims honor cursor and cell predicate

Given interleaved claims across `auth:P4` and `billing:P2`, when `graph://claims?cell=auth:P4&since=<cursor>&limit=1` is traversed, then only auth claims are returned, in sequence order, one per page.

### Scenario 3 — History continuation excludes private events correctly

Given visible events interleaved with `lock.denied`, when history is requested with a small limit, then the page contains up to the requested number of visible events, never exposes `lock.denied`, and `hasMore` reflects remaining visible events.

### Scenario 4 — Empty and terminal pages

Given the last known sequence, when claims or history is requested with `since` at or above that sequence, then records are empty, `nextCursor` equals the input cursor, and `hasMore=false`.

### Scenario 5 — Tenant isolation

Given tenants A and B containing records with overlapping sequence numbers, when A's token reads each resource, then no B record appears and A's cursor remains meaningful only inside A.

### Scenario 6 — Defaults are bounded

Given more than 100 visible records and no explicit limit, when either resource is read, then at most 100 records are returned and continuation metadata advertises more data.

### Scenario 7 — Reject malformed cursors

For each explicit `since` value `-1`, `1.5`, `NaN`, an empty string, and a value beyond safe integer range, when the resource is read, then the server returns a resource error and executes no unbounded fallback.

### Scenario 8 — Reject malformed limits

For each explicit `limit` value `0`, `-1`, `1.5`, `NaN`, an empty string, `501`, and an unsafe integer, when the resource is read, then the server returns a resource error.

### Scenario 9 — Stable ordering under equal feature activity

Given records inserted through multiple changesets, when pages are read, then every returned page is strictly ascending by the authoritative sequence and `nextCursor` is the final returned sequence.

### Scenario 10 — Compatibility fields remain available

When history and cell claims are read, then existing `graphId`, `since`, `events`, `cell`, and `claims` consumers still receive their expected fields alongside pagination metadata.

## Non-functional Acceptance

- No claims/history query materializes more than `limit + 1` rows.
- Query plans use tenant and sequence predicates; supporting indexes are added only if current schema lacks a suitable prefix.
- Traversing 10,000 seeded rows with page size 100 maintains a bounded per-request response size.

