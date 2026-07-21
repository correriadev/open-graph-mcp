# F008 Rework Log

## Retry 1

### Tech-lead open points

- Prevent `ClaimsBrowser` from triggering `readSnapshotClaims(true)` after a point hit when the reverse index is absent.
- Bound repeated invalid envelopes and transient failures, including request and toast amplification.
- Reject non-finite sequences, blank domains, and malformed levels before owner-cell derivation.
- Preserve tenant-indistinguishable external misses while making lookup latency/miss behavior observable internally.

### Adversarial edge cases missed

- Reject non-string/blank domains and non-finite, non-integer, negative, object, or array levels.
- Bound total distinct in-flight reference lookups under delayed responses; verify eviction and TTL.
- Reject duplicate `id` parameters and `id` combined with `since` or `limit`.
- Redact Windows drive and UNC file paths in point responses.
- Bound and structure failures for very large, primitive, or array draft JSON while retaining draft state.

### Required outcome

- Preserve tenant isolation, pagination, non-destructive projections, generation ownership, and zero mutation on invalid drafts.
- Add root-cause regression evidence for every item above and refresh `TDD-OUTPUT.json` with retry count 1.

## Retry 2

### Tech-lead open points

- Ensure indefinitely delayed or stale-generation reads cannot retain all lookup capacity forever; add timeout/cancellation or generation-local capacity ownership.
- Make lookup telemetry expose latency tails and incomplete/timeout outcomes without identifiers.

### Adversarial edge cases missed

- After `clear()`, stale unresolved keys must not consume the current generation's 16-slot budget or create false negative-cache entries.
- Require `seq` to be a non-negative safe integer.
- Redact Windows drive-relative paths such as `C:private\\secret.ts`.
- Scope failure-toast throttling to the active generation.
- Reject domain/level values containing separators or control characters before owner-cell derivation.

### Required outcome

- Root-cause fix each item with deterministic race/boundary tests and refresh `TDD-OUTPUT.json` with retry count 2.
