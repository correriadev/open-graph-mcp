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
