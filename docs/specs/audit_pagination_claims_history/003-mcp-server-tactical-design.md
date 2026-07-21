# F005 — mcp-server Tactical Design

## Section 1 — Components

| Component | Change |
|---|---|
| `src/resources.ts` | Centralize cursor parsing, normalize a bounded limit, page claims/history with `LIMIT limit+1`, and return continuation metadata. |
| `test/resources.test.ts` | Specify boundary, ordering, isolation, continuation, and compatibility behavior. |
| `README.md` | Document the bounded claims/history URI contracts and defaults. |

## Section 2 — Value Objects

### PageRequest

`since` is a non-negative safe integer. `limit` is a positive safe integer with default `100` and maximum `500`. Invalid explicit values raise a resource error.

### PageEnvelope<T>

Contains `since`, normalized `limit`, at most `limit` records, `nextCursor`, and `hasMore`. `nextCursor` equals the greatest returned sequence or `since` for an empty page.

## Section 3 — Resource Behavior

Claims snapshot query:

```sql
SELECT ... FROM claims
WHERE tenant_id = ? AND seq > ?
ORDER BY seq ASC
LIMIT ?
```

The final bind is `limit + 1`; the extra row is removed and determines `hasMore`. Cell-scoped claims add the existing canonical domain/level predicates. History applies the same pattern after excluding `lock.denied`.

The snapshot claims response is a flat ordered `claims` page. Grouping belongs to the web projection, preventing one resource read from constructing an unbounded `claimsByCell` object.

## Section 4 — Invariants and Errors

- All SQL includes `tenant_id = ?` and `seq > ?`.
- All returned rows are strictly ascending by `seq`.
- Explicit `since=-1`, fractional, nonnumeric, or unsafe values fail.
- Explicit `limit=0`, negative, fractional, nonnumeric, over maximum, or unsafe values fail.
- `limit + 1` is the maximum materialized row count per query.
- `lock.denied` remains absent from shared history and does not distort `hasMore`.
- Resource descriptors and README advertise both cursor parameters.

## Section 5 — Verification Strategy

- Unit/integration resource tests create more rows than a small limit and traverse every page.
- Assert no gaps, overlaps, or duplicates and terminal empty behavior.
- Assert tenant isolation with equal sequences across tenants.
- Assert claim cell and snapshot pagination independently.
- Assert invalid boundaries produce JSON-RPC resource errors.
- Assert legacy history fields and cell claims fields remain present.

## Section 6 — Ordered Development Tasks
```json
[
  {
    "id": "01",
    "title": "Specify bounded cursor pagination for claims and history resources",
    "description": "Add failing resource tests for validation, page boundaries, strict ordering, continuation metadata, tenant isolation, private history filtering, and cell-read compatibility.",
    "dependencies": []
  },
  {
    "id": "02",
    "title": "Implement the shared server cursor contract",
    "description": "Update resources.ts so claims and history use validated since/limit values, bounded LIMIT+1 SQL, and nextCursor/hasMore envelopes without full-tenant materialization.",
    "dependencies": ["01"]
  },
  {
    "id": "03",
    "title": "Document and regress the paginated MCP resource surface",
    "description": "Update resource descriptions and README examples, then run server resource and protocol regression suites.",
    "dependencies": ["02"]
  }
]
```

