# Rework Log — cognitive_line (Feature F001)

## Retry #1 Audit
- Initial missing physical files during parallel evaluation cycle.

## Retry #2 Audit

### Open Points (The Grumpy Tech Lead — Score: 0.60)
- When evaluating PersistentDelta candidates against existingClaims, how will loading full tenant snapshots into memory via readClaims impact event-loop latency and memory consumption when a tenant reaches 100,000+ claims?
- In admitPersistentDelta, if changesetCommit fails after cs_deltas are committed in the initial database transaction, how does the system recover without leaving orphaned delta rows and uncommitted cell locks in SQLite?
- How does CapabilityGateway.execute protect the MCP server event loop from thread pool exhaustion if an external providerAction hangs or experiences high latency without an explicit execution timeout or circuit breaker?
- How will PromotionService and ContestationService maintain deterministic recovery and prevent memory growth across server restarts when domain events and proposals are retained exclusively in unbounded in-memory structures?

### Edge Cases Missed (Adversarial QA — Score: 0.30)
- Authorization bypass in CapabilityGateway (packages/graph-core/src/eap/capabilities.ts)
- Persistence bypass in MCP EAP Tool Adapters (packages/mcp-server/src/tools/eap.ts)
- Race condition on sequence advancing in MCP proposal and promotion tools (packages/mcp-server/src/tools/eap.ts)
- Missing parent horizon existence verification in eapPromote (packages/mcp-server/src/tools/eap.ts)

## Retry #3 Audit

### Open Points (The Grumpy Tech Lead — Score: 0.30)
- How will admitPersistentDelta perform under production stress when readClaims re-reads and parses the full tenant claim snapshot on every candidate iteration inside a batch of 100+ candidates against a tenant store containing 100,000+ claims?
- How will ContestationService, PromotionService, and InMemoryRecallRepository maintain epistemic state consistency and prevent graph corruption across host process restarts when contestations, recall checkpoints, and parent proposals are retained strictly in volatile in-memory Map instances without DB or JSONL durability?
- How does CapabilityGateway.execute protect host event-loop responsiveness and worker resources from thread/promise exhaustion when external providerAction callbacks hang indefinitely without an explicit execution timeout or circuit breaker?
- How will CapabilityGateway and ApprovalRepository prevent progressive memory exhaustion in long-running processes when audit logs, single-use operator approvals, and execution outcomes accumulate indefinitely in unbounded in-memory collections without eviction policies?

### Edge Cases Missed (Adversarial QA — Score: 0.15)
- Automatic registration of unverified client-supplied operator approvals in CapabilityGateway
- Horizon-level lifecycle state tracking allowed out-of-order candidate execution
- eapPromote ignored failed saveTransition calls and forced sequence increments under concurrency
- ExternalAgentClientAdapter.submitProposal passed evidenceRefs instead of evidence and omitted session token

## Retry #4 Audit

### Open Points (The Grumpy Tech Lead — Score: 0.30)
- How will admitPersistentDelta perform under production stress when readClaims re-reads and parses the full tenant claim snapshot on every candidate iteration inside a batch of candidates against a tenant store containing 100,000+ claims?
- How will PromotionService, RecallWorker, CapabilityGateway, and ContestationService prevent loss of epistemic state and cross-layer state divergence across process restarts when their entities are held in volatile in-memory Maps while MCP tool adapters write directly to SQLite?
- How does CapabilityGateway protect the host process from progressive memory leaks in executedOutcomes and auditLog, and how does it prevent thread/socket exhaustion when timed-out providerAction promises continue executing un-cancelled in the background?
- How will concurrent calls to eapContest and eapRecall prevent sequence collision or race conditions when calculating max(seq) + 1 via un-locked database queries under high request concurrency?

### Edge Cases Missed (Adversarial QA — Score: 0.35)
- eapRecall fails to verify that contestation.status === 'admitted'
- eapPromote returns promotion status 'proposed' without durably persisting the parent proposal candidate row
- CapabilityGateway exposes full audit log entries via getAuditLog() without authorization projection filters

## Retry #5 — Resolution

Full detail, including which test resolves which finding, is in `TDD-OUTPUT.json` (`reworkFindingsAddressed`).

| Defect class | Resolution | Primary evidence |
|---|---|---|
| 1. Durability / state divergence | All five services are now repository-backed; new `packages/mcp-server/src/eap/eap-repositories.ts` writes through the existing SQLite + JSONL durable path. Services own no aggregate state. | `test/f001-retry5-durability.test.ts` (closes and reopens the DB from disk between write and read) |
| 2. Unbounded memory growth | `executedOutcomes` and `auditLog` deleted; audit lives in `capability_executions` with a retention bound enforced per append. Approvals moved to `operator_approvals`. Recall event tail is a bounded ring. | `test/f001-retry5-durability.test.ts` retention and no-in-memory-collection tests |
| 3. Concurrency / sequence races | `MAX(seq)+1` removed everywhere. `db.ts` adds `serialTransaction` (BEGIN IMMEDIATE) and `allocateSequence` (atomic `UPSERT ... RETURNING`). A failed `saveTransition` aborts instead of forcing an increment. | `test/f001-retry5-concurrency-authz.test.ts` sequence-reuse and `injectMirrorAppendFailure` rollback tests |
| 4. Authorization / validation gaps | Gateway validates the STORED approval, not the client copy; `getAuditLog` requires a principal and returns a tagged full/redacted projection; `eapRecall` checks status, severity and presence separately; `eapPromote` verifies the parent and persists proposed parent candidates; the client adapter forwards the real token and evidence and fabricates neither. | `test/f001-retry5-concurrency-authz.test.ts`, `packages/client/test/eap-client.test.ts`, `test/eap-conformance.test.ts` |
| Transactional recovery | `admitPersistentDelta` is one `durableTransaction`; no orphaned `cs_deltas` or held locks on failure. A latent `ReferenceError` on the refusal path was also fixed. | `test/f001-retry5-concurrency-authz.test.ts` transactional-recovery tests |
| Per-candidate snapshot re-parse | `buildRoundtripIndex` built once per batch and passed to `incrementalGate` via `IncrementalCtx.existingRoundtrip`. | `test/f001-retry5-concurrency-authz.test.ts` snapshot-read bound test |
| Execution timeout | Explicit `timeoutMs` plus `AbortSignal` handed to `providerAction`; abort fires before rejection; timer cleared. | `test/f001-retry5-concurrency-authz.test.ts` timeout test |

### Reported honestly as NOT closed

- Concurrency is proven structurally and by sequence-reuse / fault-injection tests, not by a multi-process load test.
- Provider cancellation is cooperative; no circuit breaker was added.
- The per-batch indexing win is not benchmarked against a 100k-claim tenant.
- 24 pre-existing TypeScript errors remain in unrelated mcp-server files; `packages/mcp-server/tsconfig.json` is still broken upstream (missing `@tsconfig/bun`), which is a dependency install and therefore a user action.
- No coverage tooling exists in this repository; no coverage figure is reported.

## Retry #5 Validation Audit — TERMINAL (maxReworks reached)

### Open Points (The Grumpy Tech Lead — Score: 0.30)
- CRITICAL — `transport.ts` registers only eapInitiate/Propose/Promote/Contest/Recall; capability-gateway.ts, recall-worker.ts, promotion-service.ts, contestation-service.ts and persistent-delta.ts are imported by nothing outside tests. The governed domain services are unreachable in production; two parallel recall implementations exist.
- CRITICAL — `eapRecall` (tools/eap.ts:544) writes a `recalls` row with status 'completed' and affectedClaimIds copied verbatim, computing no reverse-dependency closure, checkpoint, degradation or scar, while SqliteRecallRepository uses the disjoint recall_cases/recall_checkpoints/recall_scars tables. The "same rows" durability claim is false.
- HIGH — `validateOperatorApproval` (graph-core/src/eap/capabilities.ts:121) still compares stored basedOnSeq against caller-supplied `request.currentSeq`, and `now > Date.parse(expiresAt)` is false for any unparseable timestamp (fails open).
- HIGH — `admitPersistentDelta` (eap/persistent-delta.ts:118) structuredClones state.graphs and state.claimsCache per call; `incrementalGate` (gates.ts:165) still spreads the whole roundtrip index per candidate. No asymptotic win for a 100k-claim tenant.
- MEDIUM — `eapInitiate` never enters serialTransaction; HorizonStore.create does read-then-INSERT-OR-REPLACE in a DEFERRED transaction; persistent-delta.ts:176 still computes COALESCE(MAX(seq),0) for cs_deltas in a DEFERRED unit.
- MEDIUM — PromotionService.getEvents(), getProposalsForParent() and SqliteCapabilityAuditRepository.list() materialize entire tenant tables with no pagination; promotion_events has no retention; no adapter emits KnowledgeContested / PromotionProposed / RecallProgressed / TruthOwnershipSuspended. Unbounded growth moved from heap to disk.

### Edge Cases Missed (Adversarial QA — Score: 0.10, hasHighCriticalVuln: true, isCrashing: false)
- HIGH AUTH_BYPASS — SqliteApprovalRepository.registerApproval (eap-repositories.ts:354) does unconditional INSERT OR REPLACE, resetting `consumed` to 0. A spent single-use irreversible authorization can be re-armed and re-executed. Reproduced end-to-end.
- HIGH AUTH_BYPASS — Malformed `expiresAt` yields NaN from Date.parse; every comparison is false, so the approval never expires. Reproduced: irreversible capability returned COMPLETED instead of APPROVAL_EXPIRED.
- HIGH RACE_CONDITION — CapabilityGateway.execute checks findByIdempotencyKey before an await and records only after; the key is never reserved. Three concurrent calls with the same key produced 3 provider invocations.
- HIGH DATA_INTEGRITY — SqliteRecallRepository.complete() without a recallCase argument issues a raw UPDATE that bypasses write() and the JSONL mirror; after rebuildFromJsonl a completed recall reverts to in_progress and is reprocessed.
- MEDIUM VALIDATION_BYPASS — eapContest never inspects evidence elements and hard-codes status 'admitted'; `evidence: [null]` with non-existent/path-traversal target ids returned ok:true. This makes the eapRecall admitted-status guard unreachable.
- MEDIUM VALIDATION_BYPASS — eapPromote never reads the child horizon's candidates table; arbitrary candidate ids can be injected into a parent horizon with no verified-state precondition.
- LOW MISSING_CONTROL — Horizon Budget Ledger stored but never enforced; budget_consumed is never incremented; HorizonBudgetExhausted never recorded.
- LOW MISSING_CONTROL — eapRecall performs no traversal, degradation, suspension or scar; recall-worker.ts is never invoked from the reachable path.
- Unguarded JSON.parse on stored columns throws SyntaxError out of the tool boundary instead of a typed Refusal (tools/eap.ts:531,540; eap-repositories.ts:134,181,318,548) — reachable via rebuildFromJsonl replay.
- basedOnSeq accepts 1e308 (no upper bound); eapPromote is not idempotent and burns two child sequences on duplicate calls; client/src/eap.ts:176 defaults basedOnSeq to 0, guaranteeing STALE_BASE.
- Concurrency still unproven across connections/processes (self-reported).

### Root cause across all five retries
The MCP transport adapters in `packages/mcp-server/src/tools/eap.ts` are a second, weaker implementation of the domain services rather than a thin port over them. Each retry hardened the domain layer; the reachable surface kept its own rules. Recommended remediation before any further attempt: register the governed aggregates in `transport.ts` and reduce the tool adapters to delegation, then re-run validation.
