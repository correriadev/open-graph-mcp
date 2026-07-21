# F008 — MCP-WEB TACTICAL DESIGN

## SECTION 1 — COMPONENTS

| Component | Change |
|---|---|
| `src/og.ts` | Normalize raw JSON syntax errors and replace snapshot fallback with coordinated point lookup. |
| `src/store.ts` | Merge one resolved claim into its owner cell without altering pagination ownership. |
| `src/single-flight.ts` | Reuse request collapsing for generation-and-ID lookup keys. |
| `src/turn.tsx` | Render returned draft reasons without exception control flow. |
| `test/claim-draft.test.ts` | Verify raw parsing outcomes and zero-call rejection behavior. |
| `test/ref-lookup.test.ts` | Verify merge, navigation, caching, request collapse, and stale generations. |
| `e2e/query-and-read.e2e.ts` | Prove cross-cell uncached navigation without snapshot reload. |

## SECTION 2 — VALUE OBJECTS

### ClaimDraftOutcome

Use `{ ok: boolean, reasons: string[], warnings: string[] }` for form input, raw JSON, server rejection, and expected syntax failure.

### PointLookupEnvelope

Treat `{ claim: ClaimRecord | null }` as the client boundary. Validate the minimum identity, domain, level, and sequence fields before projection merge.

### LookupKey

Use `${claimsGeneration}:${refId}` with collision-safe composition or nested ownership. One key owns one in-flight resource read.

### NegativeEntry

Store `refId`, expiration, and generation. Keep a five-second lifetime and 128-entry maximum unless existing constants change centrally.

## SECTION 3 — INTERACTION FLOW

1. `claimDraft` catches only raw JSON syntax failure and returns a stable rejection envelope.
2. `navigateToClaim` first resolves locally loaded claims.
3. A local miss checks the current-generation negative cache.
4. The client starts or joins `graph://claims?id=<encodedRefId>` through single-flight ownership.
5. A current valid hit merges into its derived owner cell, opens the claim, and requests camera centering.
6. A current miss records negative knowledge and emits one missing-reference toast.
7. Projection invalidation advances generation and clears negative entries; stale completions perform no mutation or notification.

## SECTION 4 — INVARIANTS AND EDGE CASES

- Malformed raw JSON never rejects the returned promise for an expected syntax error.
- Malformed raw JSON never sends `changeset.claim` and never clears the draft.
- Empty raw input continues using the structured form path.
- Point lookup never calls `loadSnapshot` or `readSnapshotClaims`.
- A point hit does not replace existing claim pages or alter their cursors and continuation flags.
- Duplicate clicks share one request and produce one navigation or miss effect.
- A stale hit or miss after invalidation changes no projection, cache, selection, camera request, or toast.
- Negative-cache eviction handles an empty map safely and stays within its maximum size.
- Invalid response shape is treated as a bounded miss or structured read failure without corrupting state.

## SECTION 5 — VERIFICATION STRATEGY

- Extract or inject parsing and lookup dependencies so Bun tests avoid browser-only module initialization.
- Assert malformed syntax returns reasons and the MCP mutation spy remains untouched.
- Use deferred promises to prove duplicate collapse and stale-generation discard.
- Assert a point hit merges idempotently into the owner cell and preserves page metadata.
- Assert repeated misses inside TTL produce one network request and one toast; expiry permits retry.
- Intercept browser resource calls and prove uncached reference navigation performs an ID lookup with no snapshot request.

## SECTION 6 — ORDERED DEVELOPMENT TASKS

```json
[
  {
    "id": "01",
    "title": "Specify safe draft and point-navigation outcomes",
    "description": "Add failing tests for structured JSON syntax rejection, zero mutation calls, point hits and misses, merge preservation, duplicate collapse, negative TTL, and stale generations.",
    "dependencies": []
  },
  {
    "id": "02",
    "title": "Normalize malformed claim drafts",
    "description": "Move raw JSON parsing into claimDraft's result boundary and simplify Turn UI to consume structured reasons while preserving rejected input.",
    "dependencies": ["01"]
  },
  {
    "id": "03",
    "title": "Replace snapshot fallback with bounded point lookup",
    "description": "Coordinate encoded claims-by-ID reads, current-generation merges, navigation, single-flight ownership, and bounded negative caching without changing page cursors.",
    "dependencies": ["01", "02", "mcp-server:02"]
  },
  {
    "id": "04",
    "title": "Prove uncached reference UX and request bounds",
    "description": "Add browser evidence for successful cross-cell point navigation, missing-reference behavior, and the absence of snapshot reloads, then run web regression gates.",
    "dependencies": ["03"]
  }
]
```

