# F005 Rework Log

## RETRY #1

### Tech-lead open points

- Add query-aligned indexes for tenant/sequence claims pagination and tenant/domain/level/sequence cell pagination so bounded pages do not require tenant-scale scans or sorts.
- Make claims beyond the first cell page discoverable without requiring a claim to already be open; keep tenant-snapshot and cell cursors semantically separate.
- Make single-flight ownership generation-aware so an older request's completion cannot clear a newer generation's request slot.
- Add automated evidence for continuation retry, stale-generation rejection, duplicate-request collapse, default bounds, tenant isolation, private-event continuation, and multi-page UI interactions.

### Adversarial edge cases missed

- Preserve an open claim outside the first tenant snapshot page when progressive reverse-reference loading begins; the continuation affordance must remain reachable.
- Deduplicate concurrent forced initial snapshot reads for the same generation and cursor.
- Preserve selected claim, accumulated pages, cursor, and reverse-index edges across continuation failure and retry.
- Reject stale records and stale loading/error state when a pre-rebuild response resolves after invalidation.

### Security and correctness findings

- HIGH `CLIENT_STATE_LOSS`: `readSnapshotClaims(true)` destructively replaces cell-loaded claims with tenant snapshot page 1, breaking valid read-to-write flows for datasets larger than one page.
- MEDIUM `DUPLICATE_REQUEST_RACE`: `force=true` bypasses snapshot single-flight protection.

## RETRY #2

### Tech-lead open points

- Ensure sparse-cell pagination uses an index-compatible predicate/query plan; the current `level IN (?, ?)` plan selects the tenant sequence index instead of the cell index.
- Track cell cache provenance/completeness explicitly so snapshot-projected claims never suppress the cell-specific cursor-zero request or continuation state.
- Add interaction-level evidence for stale response isolation, continuation failure preservation, and reachable multi-page cell/reverse-reference controls.

### Adversarial edge cases missed

- Merge a partial tenant snapshot for a cell, then select that cell and prove its dedicated cursor-zero page still loads with independent continuation metadata.
- Route snapshot continuation errors back to the snapshot cursor; do not retry the cell cursor through a shared error affordance.
- Reject stale records, errors, loading flags, and page metadata for both snapshot and cell responses after invalidation.
- Key history single-flight by cursor so only truly duplicate requests collapse.

### Security and correctness findings

- HIGH `CACHE_COMPLETENESS_CONFUSION`: partial snapshot data masquerades as a complete cell cache, hiding later valid claims.
- MEDIUM `RETRY_TARGET_CONFUSION`: a shared claims error can invoke the cell retry path for a failed snapshot continuation.
