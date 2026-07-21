# F009 — CONTEXT MAP

## BOUNDED CONTEXTS

| Context | Responsibility |
|---|---|
| Changeset Admission | Validate and canonicalize claim deltas before staging. |
| Gate Model | Consume canonical numeric levels for scope and integrity rules. |
| Durable Claim Store | Write canonical `P<n>` levels to SQLite and JSONL. |
| Recovery | Rebuild tenant state from legacy and canonical mirrors. |
| Claim Resources | Map stored claims and redact file metadata for readers. |

## RELATIONSHIPS

| Upstream | Downstream | Pattern | Contract |
|---|---|---|---|
| Changeset Admission | Gate Model | Anti-Corruption Layer | Convert accepted wire levels to canonical numeric values before gate execution. |
| Gate Model | Durable Claim Store | Customer/Supplier | Only admitted canonical claim payloads reach staging and commit. |
| Durable Claim Store | Recovery | Published Language | New claims JSONL rows contain exact `P0`–`P5`; replay accepts defined legacy numerics. |
| Durable Claim Store | Claim Resources | Open Host Service | Stored file and level fields are projected through one mapper. |
| Claim Resources | MCP Consumers | Anti-Corruption Layer | Return numeric levels and deny-by-default file paths. |

## LEVEL FLOW

1. Parse `claim.add.payload.level` with one pure normalizer.
2. Reject unsupported type, syntax, or range before `incrementalGate` side effects.
3. Replace the accepted payload level with its canonical numeric value.
4. Stage the canonical payload in `cs_deltas`.
5. Revalidate at commit and persist exact `P<n>` in claims SQLite and JSONL.
6. During recovery, map supported legacy numeric stored levels to exact `P<n>` before insertion.
7. Resource mapping returns the expected numeric API level.

## PATH FLOW

1. Classify path dialect before normalization.
2. Normalize separators and dot segments without resolving against the process working directory.
3. Prove containment against a compatible normalized repository root.
4. Return the proven repository-relative path when safe.
5. Otherwise return only a sanitized final filename, or omit the field when no safe filename exists.

## INTEGRATION CONSTRAINTS

- Keep the public claim resource shape unchanged.
- Keep mcp-web numeric claim submissions valid; no concrete web consumer change is required.
- Keep tenant isolation independent from path and level processing.
- Do not rely on SQLite-open migration as the only recovery normalization.
- Do not emit raw invalid values in errors, logs, or events when they may contain hostile control text.

## OWNERSHIP

| Component | Owned concern |
|---|---|
| `tools/changeset.ts` | Admission ordering, stable rejection, canonical staged payload. |
| `claim-level.ts` | Pure wire and stored level normalization. |
| `store.ts` | Canonical claim write boundary. |
| `db.ts` | Canonical recovery insertion. |
| `resources.ts` | Deny-by-default file projection and numeric read mapping. |

