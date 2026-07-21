# F009 Rework Log

## Retry 1

### Tech-lead open points

- Validate legacy SQLite levels before migration; never convert out-of-range values to `P6+`.
- Make read projection reject/quarantine noncanonical stored levels.
- Prove or redesign SQLite/JSONL atomicity for partial multi-claim and mirror-write failures.
- Add identifier-safe observability for deny-default basename fallbacks.

### Adversarial edge cases missed

- Reject numeric negative zero.
- Treat every drive-relative path as untrusted, including drive-relative repository roots.
- Require every replay row tenant to equal the directory tenant before any insertion, across durable tables.
- Reject/quarantine `P6`, `P9`, huge digit strings, and other invalid stored levels in migration and every resource mode.
- Roll back malformed/truncated middle/end JSONL recovery without changing prior tenant state.
- Prove valid-then-invalid multi-claim and mirror-write failure atomicity across SQLite, JSONL, caches, projections, aggregation, and events.
- Cover C1/bidi controls, double-encoded traversal, URL variants, and drive-relative repository roots.

### Required outcome

- Root-cause fix all findings and refresh `TDD-OUTPUT.json` with retry count 1.

## Retry 2

### Tech-lead open points

- Filter/quarantine invalid stored levels before applying pagination limits and continuation semantics.
- Add deterministic mirror append failure injection; prove rollback rather than relying on best-effort truncation.
- Keep path fallback metrics accurate across Windows case-insensitive containment.

### Adversarial findings

- Route `graph.import` claims through strict canonical level normalization; reject unsupported imports before SQLite/JSONL effects.
- Put `graph.import`, TTL sweeping, and standalone durable writers under one rollbackable SQLite+mirror boundary.
- Reject encoded traversal even when the decoded lexical path appears under the repository root.
- Ensure corrupt invalid-level rows cannot consume the page limit, hide later valid rows, or falsify `hasMore`.

### Required outcome

- Add deterministic fault/race/boundary regressions for every item and refresh `TDD-OUTPUT.json` with retry count 2.
