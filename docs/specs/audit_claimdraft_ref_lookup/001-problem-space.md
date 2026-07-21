# F008 — SAFE CLAIM DRAFTS AND POINT REFERENCE LOOKUP

## SCOPE

Return structured feedback for malformed raw claim drafts and resolve uncached claim references with one tenant-scoped point lookup instead of rebuilding or reloading a snapshot.

## DOMAIN EVENTS

1. **Raw Draft Submitted** — an author submits raw JSON from an active turn.
2. **Draft Syntax Evaluated** — the client accepts a JSON value or returns a structured syntax reason.
3. **Reference Selected** — a reader selects a claim reference not present in local pages.
4. **Point Lookup Requested** — the client requests one encoded claim identifier.
5. **Tenant Claim Resolved** — the server returns the matching claim from the caller tenant.
6. **Claim Projection Merged** — the client stores the resolved claim under its owner cell and navigates to it.
7. **Reference Declared Missing** — a bounded negative cache suppresses repeated misses.
8. **Projection Invalidated** — graph generation change clears stale lookup ownership and negative knowledge.

## SUBDOMAINS

| Subdomain | Type | Responsibility |
|---|---|---|
| Claim Authoring | Core | Convert form or raw input into safe claim deltas. |
| Reference Navigation | Core | Open locally known or point-resolved claims in their owner cell. |
| Claim Read Model | Supporting | Return one redacted tenant-scoped claim by identifier. |
| Lookup Coordination | Supporting | Collapse duplicate requests and reject stale-generation results. |

## UBIQUITOUS LANGUAGE

| Term | Meaning |
|---|---|
| Raw Draft | User-entered JSON text intended as a `claim.add` payload. |
| Structured Rejection | `{ ok: false, reasons, warnings }` returned without throwing. |
| Point Lookup | `graph://claims?id=<claimId>` returning zero or one claim. |
| Owner Cell | The canonical `domain:P<level>` location derived from a resolved claim. |
| Dangling Reference | A claim identifier absent from both local projection and tenant point lookup. |
| Negative Cache | A bounded, expiring record of point-lookup misses. |
| Lookup Generation | Client projection generation that owns an in-flight result. |

## BUSINESS RULES

- Malformed raw JSON MUST return a structured rejection and MUST NOT call `changeset.claim`.
- Rejected draft input MUST remain available for correction.
- Point lookup MUST query by exact claim ID and tenant.
- A claim from another tenant MUST be indistinguishable from a missing claim.
- Point lookup MUST return the same redacted claim shape used by paginated claim reads.
- Reference navigation MUST NOT trigger snapshot graph or snapshot-claim reloads.
- Concurrent lookups for one ID and generation MUST share one request.
- Stale lookup results MUST NOT mutate a newer projection generation.
- Negative caching MUST be time-bounded, size-bounded, and cleared on projection invalidation.

## RISKS AND RESOLUTIONS

| Risk | Autonomous Resolution |
|---|---|
| JSON parses to a primitive or array | Preserve server validation ownership; only syntax errors are normalized in this feature. |
| Claim ID contains URL control characters | Encode the complete query value and decode through `URLSearchParams`. |
| Cross-tenant identifier probing | Use `tenant_id = ? AND id = ?`; return the same empty envelope for absent and foreign claims. |
| Duplicate clicks race | Use a generation-keyed single-flight lookup. |
| Rebuild completes during lookup | Compare the owning generation before merging, navigating, caching, or toasting. |
| Negative cache grows without bound | Retain the existing TTL and maximum-size policy with safe eviction. |

## ACCEPTANCE BOUNDARY

- Invalid raw JSON produces a visible reason, preserves input, and sends no mutation request.
- A locally absent but tenant-visible reference opens after exactly one bounded point lookup.
- Missing and cross-tenant references reveal no tenant information and do not reload snapshots.
- Duplicate, stale, and repeated-miss paths remain bounded and deterministic.

