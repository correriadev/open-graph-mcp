# F008 — MCP-SERVER TACTICAL DESIGN

## SECTION 1 — COMPONENTS

| Component | Change |
|---|---|
| `src/resources.ts` | Add exact claim-ID resolution and extend the claims resource contract without changing pagination. |
| `test/resources.test.ts` | Verify hit, miss, isolation, encoding, ambiguity, redaction, and query shape. |
| `README.md` | Publish point lookup alongside cell and snapshot claim modes. |

## SECTION 2 — RESOURCE CONTRACT

`graph://claims?id=<claimId>` returns:

| Outcome | Envelope |
|---|---|
| tenant claim exists | `{ claim: ClaimRecord }` |
| claim absent or belongs to another tenant | `{ claim: null }` |

Reuse `claimFromRow` so point and paginated responses share level normalization, reference parsing, verdict shape, and file redaction.

## SECTION 3 — QUERY FLOW

1. Parse the claims URI with `URLSearchParams`.
2. Detect a non-empty `id` point-lookup mode before pagination parsing.
3. Reject empty or ambiguous mode selectors with a stable resource error.
4. Query `claims` with `WHERE tenant_id = ? AND id = ? LIMIT 1`.
5. Return a nullable claim envelope without exposing why a row was absent.

## SECTION 4 — INVARIANTS AND EDGE CASES

- Exact lookup uses the authenticated tenant supplied by transport.
- Query input cannot override tenant identity.
- URL-encoded spaces, slashes, colons, Unicode, and reserved characters round-trip through `URLSearchParams`.
- Empty IDs are rejected rather than interpreted as cell mode.
- Foreign-tenant and unknown IDs produce identical envelopes.
- Cell and snapshot `since`, `limit`, `nextCursor`, and `hasMore` behavior remains unchanged.
- Point lookup does not scan or serialize a tenant claim set.
- Returned files retain the existing redaction policy.

## SECTION 5 — VERIFICATION STRATEGY

- Seed equal and distinct IDs across isolated tenants and assert exact visibility.
- Instrument or structure the query assertion around the tenant/ID lookup path.
- Cover encoded identifiers, empty input, ambiguous selectors, and absent claims.
- Regress cell and snapshot pagination tests unchanged.
- Verify resource discovery documents the point mode.

## SECTION 6 — ORDERED DEVELOPMENT TASKS

```json
[
  {
    "id": "01",
    "title": "Specify tenant-scoped claim point lookup",
    "description": "Add failing resource tests for exact hits, nullable misses, cross-tenant non-disclosure, encoded IDs, invalid mode combinations, redaction, and unchanged pagination.",
    "dependencies": []
  },
  {
    "id": "02",
    "title": "Implement bounded claims-by-ID resolution",
    "description": "Extend graph://claims with a direct tenant-and-ID query that reuses ClaimRecord mapping and preserves existing cell and snapshot modes.",
    "dependencies": ["01"]
  },
  {
    "id": "03",
    "title": "Publish and regress the claims resource contract",
    "description": "Update resource discovery and server documentation, then run focused resource and full server regression suites.",
    "dependencies": ["02"]
  }
]
```

