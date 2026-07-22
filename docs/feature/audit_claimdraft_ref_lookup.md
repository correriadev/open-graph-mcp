# SAFE CLAIM DRAFTS AND POINT REFERENCE LOOKUP

## OVERVIEW

- **Return** structured outcomes for malformed or oversized raw claim drafts.
- **Resolve** uncached claim references with an exact tenant-scoped resource read.
- **Avoid** snapshot reloads during dangling-reference navigation.

## CLAIM DRAFT CONTRACT

| Input condition | Outcome |
|---|---|
| malformed JSON | Return `raw JSON inválido` without invoking mutation. |
| primitive or array | Return `raw JSON deve ser um objeto` without invoking mutation. |
| more than `65,536` characters | Return `raw JSON excede o limite` without parsing or mutation. |
| valid object | Send the existing `claim.add` delta and preserve server reasons and warnings. |

- REQUIRED: **Resolve expected draft errors through `{ ok, reasons, warnings }`**.
- REQUIRED: **Preserve rejected raw input for correction**.
- PROHIBITED: **Use exception control flow for expected JSON syntax failures**.

## POINT LOOKUP CONTRACT

| Request | Response |
|---|---|
| `graph://claims?id=<encodedId>` hit | Return `{ claim: ClaimRecord }`. |
| absent or foreign-tenant ID | Return `{ claim: null }`. |

- REQUIRED: **Query by authenticated tenant and exact claim ID**.
- REQUIRED: **Reuse claim normalization and file redaction from paginated reads**.
- REQUIRED: **Reject empty, repeated, or mixed point-lookup modes**.
- REQUIRED: **Keep cell and snapshot pagination semantics unchanged**.
- PROHIBITED: **Reveal whether a missing ID belongs to another tenant**.

## REFERENCE NAVIGATION

- **Navigate** immediately when the claim already exists in loaded cell pages.
- **Collapse** duplicate point reads by projection generation and reference ID.
- **Validate** returned claim identity, owner domain, level, and sequence before merging.
- CURRENT LIMITATION: **Numeric level and sequence validation does not consistently reject unsafe integers**.
- **Merge** a point result into its owner cell without replacing existing pages.
- **Discard** hits, misses, and failures owned by a stale projection generation.
- **Cache** negative and failed results for five seconds with at most 128 entries.
- **Limit** concurrent point lookups to 16 per generation and time each out after ten seconds.
- CURRENT LIMITATION: **The ten-second timeout releases the logical slot but does not abort the underlying transport read**; stalled reads can accumulate.
- **Throttle** lookup-failure notifications per generation.
- **Expose** identifier-free client and server lookup counters and latency metrics.

## FOLDER STRUCTURE

| Path | Responsibility |
|---|---|
| `packages/mcp-web/src/claim-draft.ts` | Validate raw draft size, syntax, and object shape before mutation. |
| `packages/mcp-web/src/ref-lookup.ts` | Coordinate point reads, validation, merging, caching, limits, and metrics. |
| `packages/mcp-web/src/og.ts` | Connect draft and reference helpers to MCP and UI state. |
| `packages/mcp-web/src/turn.tsx` | Render structured draft outcomes and preserve rejected input. |
| `packages/mcp-web/src/claims-browser.tsx` | Route RefChip selection through bounded navigation. |
| `packages/mcp-web/test/claim-draft.test.ts` | Verify structured rejection and mutation boundaries. |
| `packages/mcp-web/test/ref-lookup.test.ts` | Verify request bounds, stale ownership, validation, and cache behavior. |
| `packages/mcp-web/e2e/query-and-read.e2e.ts` | Verify point navigation without snapshot fallback. |
| `packages/mcp-server/src/resources.ts` | Resolve tenant-scoped claims by ID and preserve paginated modes. |
| `packages/mcp-server/src/state.ts` | Store identifier-free point-lookup metrics. |
| `packages/mcp-server/test/resources.test.ts` | Verify exact lookup, isolation, redaction, modes, and pagination compatibility. |
| `packages/mcp-server/README.md` | Publish the claims point-lookup resource shape. |

## CROSS-REFERENCES

- **Keep** this feature document self-contained until a human approves a related ADR.
