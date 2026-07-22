# DENY-BY-DEFAULT CLAIM PATHS AND CANONICAL LEVELS

## OVERVIEW

- **Constrain** claim levels to the `0`–`5` ladder before durable effects.
- **Persist** claim levels as exact `P0`–`P5` values.
- **Project** claim file metadata without exposing untrusted filesystem ancestry.

## LEVEL CONTRACT

| Boundary | Accepted form | Canonical form |
|---|---|---|
| claim API | integer `0`–`5` or exact string `P0`–`P5` | numeric `0`–`5` before staging |
| SQLite and JSONL | canonical writes only | exact string `P0`–`P5` |
| recovery | canonical form or legacy digit string `0`–`5` | exact string `P0`–`P5` |
| claim resources | valid stored form | numeric `0`–`5` |

- REQUIRED: **Reject missing, negative-zero, non-integer, out-of-range, coerced, or malformed levels**.
- REQUIRED: **Normalize a cloned claim payload before gates and staging**.
- REQUIRED: **Revalidate at gate, store, import, database-open, and recovery boundaries**.
- REQUIRED: **Reject invalid imports before graph, SQLite, mirror, cache, or event mutation**.
- REQUIRED: **Exclude invalid stored rows from claim resource pages**.

## FILE PROJECTION

| Classification | Output |
|---|---|
| proven repository-contained path | Normalized repository-relative path. |
| safe traversal-free relative path | Normalized relative path. |
| untrusted absolute, drive, UNC, scheme, or traversal path | Sanitized basename only. |
| control, bidirectional-control, root-only, or unsafe basename | Omit the file field. |

- CURRENT LIMITATION: **A URL-scheme repository root can still be treated as lexically contained and expose path ancestry instead of falling back to a basename**.
- REQUIRED: **Normalize both slash dialects before classification**.
- REQUIRED: **Compare Windows containment case-insensitively**.
- REQUIRED: **Reject raw and repeatedly encoded traversal markers from relative projection**.
- PROHIBITED: **Treat a string prefix as repository containment without a path boundary**.
- PROHIBITED: **Expose drive, host, share, parent directory, or control characters**.

## DURABILITY AND RECOVERY

- **Batch** SQLite writes and JSONL appends in one rollback-aware durable transaction.
- **Restore** touched mirrors to their original sizes when an append fails.
- **Parse and validate** recovery rows before deleting current tenant state.
- **Reject** recovery rows whose tenant differs from the requested tenant.
- **Apply** recovered rows in one SQLite transaction.
- **Invalidate** claim caches after import replaces durable claim state.
- **Keep** file-projection metrics aggregate and identifier-free.

## FOLDER STRUCTURE

| Path | Responsibility |
|---|---|
| `packages/mcp-server/src/claim-level.ts` | Normalize API, stored, and recovered claim levels. |
| `packages/mcp-server/src/tools/changeset.ts` | Canonicalize claim deltas before staging and activity effects. |
| `packages/mcp-server/src/gates.ts` | Defensively reject nonnumeric or invalid claim levels. |
| `packages/mcp-server/src/store.ts` | Persist canonical claim levels and maintain claim caches. |
| `packages/mcp-server/src/db.ts` | Coordinate rollback-aware mirrors, database-open normalization, and atomic recovery. |
| `packages/mcp-server/src/tools/graph-import.ts` | Validate imported levels and apply durable import atomically. |
| `packages/mcp-server/src/sweeper.ts` | Apply TTL durability changes through rollback-aware transactions. |
| `packages/mcp-server/src/resources.ts` | Project safe file values and quarantine invalid stored levels. |
| `packages/mcp-server/src/state.ts` | Store aggregate file-projection counters. |
| `packages/mcp-server/test/claim-level.test.ts` | Verify accepted and rejected level forms. |
| `packages/mcp-server/test/resources.test.ts` | Verify path dialects, containment, omission, and claim reads. |
| `packages/mcp-server/test/rebuild-from-jsonl.test.ts` | Verify canonical and tenant-safe recovery behavior. |
| `packages/mcp-server/test/f009-retry2.test.ts` | Verify import, mirror rollback, quarantine, and projection counters. |

## CROSS-REFERENCES

- **Keep** this feature document self-contained until a human approves a related ADR.
