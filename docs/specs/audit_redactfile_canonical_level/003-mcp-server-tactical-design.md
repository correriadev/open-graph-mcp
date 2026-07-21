# F009 — MCP-SERVER TACTICAL DESIGN

## SECTION 1 — COMPONENTS

| Component | Change |
|---|---|
| `src/claim-level.ts` | Define pure wire, stored, and recovery normalization for levels `0`–`5`. |
| `src/tools/changeset.ts` | Canonicalize before gates, staging, aggregation, and commit effects. |
| `src/gates.ts` | Consume canonical numeric levels and reject defensive invalid payloads. |
| `src/store.ts` | Require canonical numeric input and write exact `P<n>` rows. |
| `src/db.ts` | Canonicalize legacy claim levels during JSONL replay before insertion. |
| `src/resources.ts` | Replace permissive path stripping with a pure deny-by-default projector. |
| `test/claim-level.test.ts` | Cover wire normalization, side-effect ordering, persistence, and recovery. |
| `test/resources.test.ts` | Cover path dialects, containment, traversal, redaction, and valid reads. |
| `test/rebuild-from-jsonl.test.ts` | Verify canonical legacy replay and deterministic invalid-row handling. |

## SECTION 2 — VALUE OBJECTS

### CanonicalClaimLevel

Represent the internal level as an integer union `0 | 1 | 2 | 3 | 4 | 5`. Convert it to stored form only through `P${level}`.

### LevelNormalizationResult

Return either `{ ok: true, numeric, stored }` or `{ ok: false, reason }`. Accept integers `0`–`5` and exact strings `P0`–`P5`; reject coercion.

### SafeFileProjection

Return a normalized repository-relative path, a sanitized basename, or `undefined`. Never return an absolute prefix, drive, host, share, traversal segment, URI scheme, NUL, or control character.

## SECTION 3 — LEVEL ADMISSION FLOW

1. Authenticate and validate changeset ownership.
2. For `claim.add`, normalize a cloned payload instead of mutating caller-owned input.
3. Return a stable `claim.add: invalid level` reason on failure.
4. Run the incremental gate with canonical numeric level.
5. Stage only the canonical numeric payload after all admission checks pass.
6. Increment delta aggregation only after durable staging succeeds.
7. Revalidate canonical numeric level at commit and `writeClaim` boundaries.
8. Persist exact `P<n>` to SQLite and JSONL.

## SECTION 4 — PATH AND RECOVERY INVARIANTS

- Repository containment compares normalized segments with matching path dialect and case rules.
- `/repo2/file` is not inside `/repo`; `C:/repo2/file` is not inside `C:/repo`.
- Windows drive, drive-relative, UNC, extended-device, POSIX absolute, URL-like, NUL, control, and traversal inputs never expose ancestry unless repository containment is proven.
- Mixed separators are normalized before classification.
- A safe repository-relative or safe `src/...` value remains useful.
- Empty, dot-only, root-only, or control-only basenames omit the file field.
- SQLite and JSONL writes contain only exact `P0`–`P5` claim levels.
- Replay converts supported legacy integers and digit strings to `P<n>` before insertion.
- Replay failure is transaction-atomic; invalid claim levels do not leave a partially rebuilt tenant.
- Read mapping never converts invalid stored levels into a valid default.

## SECTION 5 — VERIFICATION STRATEGY

- Table-test every accepted and rejected wire level without JavaScript coercion.
- Assert rejected levels leave `cs_deltas`, JSONL, aggregation counters, claims cache, graph claims, and events unchanged.
- Assert accepted numeric and `P` forms stage canonically and persist identically.
- Inspect SQLite and JSONL bytes after commit and after legacy recovery.
- Table-test POSIX, Windows, UNC, device, relative, mixed, encoded-looking, traversal, root-confusion, and control-character paths.
- Regress cell, snapshot, and point claim resources plus commit atomicity.

## SECTION 6 — ORDERED DEVELOPMENT TASKS

```json
[
  {
    "id": "01",
    "title": "Specify canonical levels and deny-by-default file projection",
    "description": "Add failing table tests for accepted and rejected level forms, admission side effects, stored and replay forms, path dialects, containment confusion, traversal, controls, and resource compatibility.",
    "dependencies": []
  },
  {
    "id": "02",
    "title": "Enforce canonical claim levels at every write boundary",
    "description": "Add one strict normalizer, canonicalize cloned claim payloads before staging, defend commit and store boundaries, and normalize supported legacy JSONL rows atomically during recovery.",
    "dependencies": ["01"]
  },
  {
    "id": "03",
    "title": "Make claim file projection deny by default",
    "description": "Replace permissive path handling with dialect-aware containment proof and sanitized basename fallback while keeping safe repository-relative paths useful.",
    "dependencies": ["01"]
  },
  {
    "id": "04",
    "title": "Regress persistence recovery and claim resources",
    "description": "Run focused boundary tests and the complete server suite, confirming valid API compatibility, canonical SQLite and JSONL state, atomic recovery, and non-disclosing resource output.",
    "dependencies": ["02", "03"]
  }
]
```

