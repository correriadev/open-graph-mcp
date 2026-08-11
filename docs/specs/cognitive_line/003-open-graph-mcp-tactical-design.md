# Tactical Design — open-graph-mcp

**Domain:** `cognitive_line` | **Project:** `open-graph-mcp` | **Language:** English

## Scope and Status Discipline

This solution-space model extends the repository's existing modular TypeScript architecture; it does not replace it with a new framework. `[B]` denotes behavior evidenced in the current code. `[E]` denotes proposed OpenGraph v1.0 evolution. The MCP host remains deterministic and authoritative for transitions, admission, persistence, and audit. LLM-backed Intermediator and Executor roles are external agent clients or orchestration processes: they may propose and assess work, but they cannot directly mutate authoritative state.

## Section 1 — Main Structure

| Element | Layer / Type | Invariants / Technical Rules | 4-line Snippet |
|---|---|---|---|
| Changeset Admission Boundary `[B]` | `mcp-server` application service and pure gates | Incremental and final gates operate on snapshots; commit is atomic; tenant scope and cell locks are enforced; durable mutation uses the existing write path. | See snippet A. |
| Persistent Knowledge Store `[B]` | `graph-core` domain model plus `mcp-server` persistence adapter | Claims are append-only; authority is an orthogonal coordinate; sequence is monotonic per tenant; SQLite is derived from durable JSONL. | See snippet B. |
| Epistemic Lifecycle `[E]` | Domain aggregate | Only deterministic transitions are legal; `PROMOTE`, `CONTEST`, and `INITIATE` are boundary commands, not lifecycle states; Relative Authority is horizon-local. | See snippet C. |
| Horizon `[E]` | Aggregate root | Has exactly one declared parent except the root; owns lifecycle state and budget ledger; exhaustion escalates and never promotes; authority cannot cross its boundary. | See snippet D. |
| Admission Decision `[E]` | Domain decision model | A candidate receives exactly one admitted or typed-refused outcome; identical candidate evidence under hostile identity must produce the same verdict. | See snippet E. |
| Promotion `[E]` | Boundary aggregate | Crosses exactly one current parent edge; creates a new proposal at the parent; validates `basedOnSeq`; never inherits child authority. | See snippet F. |
| Recall Case `[E]` | Process aggregate | Begins only from an admitted invalidating contestation; traverses registered admitted dependencies deterministically and idempotently; preserves the historical scar. | See snippet G. |
| Cognitive Client Adapter `[E]` | External integration boundary | Maps Claude Code or another client to Agent Client commands; Intermediator and Executor may be LLM-driven, but have no host write authority and must use MCP gates. | See snippet H. |

```text
AdmissionBoundary [B]:
  stage(delta, snapshot): GateVerdict
  commit(changeset): AtomicCommit
```

```text
PersistentKnowledge [B]:
  claims: AppendOnlyClaim[]; seq: Sequence
  ownership: Cell -> TruthOwnership
```

```text
EpistemicLifecycle [E]:
  state: proposed|deliberated|admitted|concretized|verified
  transition(command): LifecycleOutcome
```

```text
Horizon [E]:
  id: HorizonId; parentId: HorizonId?
  budget: BudgetLedger; authority: RelativeAuthority
```

```text
AdmissionDecision [E]:
  candidateId: CandidateId
  outcome: Admitted | Refused<RefusalCode>
```

```text
Promotion [E]:
  childId: HorizonId; parentId: HorizonId
  basedOnSeq: Sequence; distilled: Candidate[]
```

```text
RecallCase [E]:
  notice: RecallNotice; closure: ClaimId[]
  progress: RecallProgress
```

```text
CognitiveClientAdapter [E]:
  propose(command): MCPResponse
  // LLM roles recommend; host decides
```

## Section 2 — Value Objects / Types / Interfaces

| Name | Context / Layer | Validation and Typing Rules | 4-line Snippet |
|---|---|---|---|
| `CellKey` `[B]` | Persistent Knowledge | Canonical `domain:level` spelling; legacy spellings normalize before lookup or persistence. | See snippet A. |
| `TruthOwnership` `[B]` | Persistent Knowledge | Closed union `source | graph | suspended`; never used as claim epistemic status. | See snippet B. |
| `LegacyClaimStatus` `[B]` | Persistent Knowledge | Current code vocabulary remains explicitly legacy until a normative migration mapping is decided. | See snippet C. |
| `HorizonId` `[E]` | Horizon Governance | Non-empty opaque identifier scoped by tenant; must not encode topology. | See snippet D. |
| `Sequence` `[E]` | Shared contract | Non-negative monotonic integer; comparisons are tenant- and horizon-aware. | See snippet E. |
| `NegotiationSeed` `[E]` | Horizon Governance DTO | Carries provenance and references only; cannot carry admission or Relative Authority. | See snippet F. |
| `RefusalCode` `[E]` | Epistemic Admission | Closed, versioned taxonomy; every code maps to an explicit client obligation; no free-text-only refusal. | See snippet G. |
| `PersistentDelta` `[E]` | Persistent Knowledge DTO | Envelope of candidate changes, claims, coverage, and rollback semantics; must disassemble into ordinary single-gate submissions. | See snippet H. |
| `OperatorApproval` `[E]` | Operator Governance | Bound to approver, scope, TTL, provenance, and `basedOnSeq`; cannot waive mechanical evidence requirements. | See snippet I. |
| `CapabilityClassification` `[E]` | Capability Governance | Closed effect class; irreversible effects require a matching single-use authorization. | See snippet J. |

```text
type CellKey [B] = canonical(domain + ":" + level)
validate: domain non-empty; level supported
```

```text
type TruthOwnership [B] = source | graph | suspended
validate: coordinate is independent of claim status
```

```text
type LegacyClaimStatus [B] = pending-verification | verified
  | contradicts-floor | test-spec
```

```text
type HorizonId [E] = OpaqueString
validate: non-empty and tenant-scoped
```

```text
type Sequence [E] = NonNegativeInteger
validate: never decreases in its scope
```

```text
interface NegotiationSeed [E]:
  provenance: EvidenceRef[]; references: ClaimRef[]
```

```text
type RefusalCode [E] = ClosedProtocolCode
validate: code has client obligation
```

```text
interface PersistentDelta [E]:
  candidates: Candidate[]; rollback: RollbackSemantics
```

```text
interface OperatorApproval [E]:
  approver: OperatorId; scope: Scope; expiresAt: Instant
  basedOnSeq: Sequence
```

```text
type CapabilityClassification [E] = reversible | irreversible
validate: irreversible requires authorization
```

## Section 3 — Domain Services / Use Cases / Actions

| Operation | Responsibility | Coordinates / Subscriptions | 4-line Snippet |
|---|---|---|---|
| `CommitChangeset` `[B]` | Applies the incremental/final gate sequence and commits accepted deltas atomically. | Pure gates, claim snapshots, locks, authority, durable transaction. | See snippet A. |
| `InitiateHorizon` `[E]` | Creates a governed child horizon from a provenanced Negotiation Seed. | Horizon repository, topology policy, budget policy, audit. | See snippet B. |
| `AdvanceEpistemicLifecycle` `[E]` | Applies one legal deterministic lifecycle transition and records its evidence. | Lifecycle aggregate, Admission Gate, audit. | See snippet C. |
| `PromoteKnowledge` `[E]` | Validates the one-edge boundary and submits distilled knowledge as a parent proposal. | Child/parent horizons, topology, sequence, Admission Gate. | See snippet D. |
| `AdmitPersistentDelta` `[E]` | Disassembles a delta and routes every candidate through the one existing Admission Gate. | Admission Gate, persistent store port, transaction, audit. | See snippet E. |
| `ContestKnowledge` `[E]` | Registers an evidence-backed challenge without directly editing admitted knowledge. | Admission Gate, evidence port, persistent query port. | See snippet F. |
| `ExecuteRecall` `[E]` | Calculates registered reverse dependency closure and applies resumable, idempotent degradation. | Dependency query, persistent store, audit, recall checkpoint. | See snippet G. |
| `AuthorizeCapability` `[E]` | Validates classification, Change Contract, and operator authorization before an external effect. | Capability policy, approvals, execution gateway, audit. | See snippet H. |
| `AssessConformance` `[E]` | Produces host/client conformance evidence without granting authority. | Published EAP contracts, host log, client transcript. | See snippet I. |

```text
CommitChangeset [B](id): CommitResult
  // gate snapshots -> atomic durable commit
```

```text
InitiateHorizon [E](seed, parentId): Horizon
  // validate provenance, topology, and budget
```

```text
AdvanceEpistemicLifecycle [E](id, command): Outcome
  // deterministic transition or typed refusal
```

```text
PromoteKnowledge [E](promotion): Proposal
  // validate one edge and sequence freshness
```

```text
AdmitPersistentDelta [E](delta): AdmissionResult
  // submit each candidate through the single gate
```

```text
ContestKnowledge [E](contestation): AdmissionResult
  // evidence-backed proposal, never direct edit
```

```text
ExecuteRecall [E](notice): RecallProgress
  // closure -> idempotent degradation -> checkpoint
```

```text
AuthorizeCapability [E](request): AuthorizationResult
  // policy + contract + approval validation
```

```text
AssessConformance [E](profile): ConformanceReport
  // evaluate observable protocol obligations
```

## Section 4 — Events / Messages / Async Flows

| Event / Action Name | Trigger | Minimum Payload | Consumers |
|---|---|---|---|
| `ChangesetCommitted` `[B]` | Existing final gate and durable transaction succeed. | `{ tenantId, changesetId, seq, blastCells }` | MCP subscribers, history, web/client projections. |
| `HorizonInitiated` `[E]` | `InitiateHorizon` succeeds. | `{ horizonId, parentId, seedRef, budgetRef }` | Workflow Orchestration, Audit and Evidence. |
| `ProposalRefused` `[E]` | Any deterministic gate rejects a proposal. | `{ proposalId, code, obligation, seq }` | Agent Client, conformance assessment, audit. |
| `KnowledgeVerified` `[E]` | Verification transition succeeds. | `{ horizonId, candidateId, evidenceRefs, seq }` | Workflow Orchestration, promotion read model. |
| `PromotionProposed` `[E]` | One-edge validation succeeds. | `{ promotionId, childId, parentId, basedOnSeq }` | Parent Admission Gate, audit. |
| `PersistentDeltaAdmitted` `[E]` | All required single-gate submissions commit atomically. | `{ deltaId, admittedClaimIds, seq }` | Persistent projections, workflow, audit. |
| `KnowledgeContested` `[E]` | Contestation is admitted. | `{ contestationId, targetClaimIds, severity, evidenceRefs }` | Correction and Recall, persistent projections. |
| `RecallProgressed` `[E]` | A deterministic recall batch is applied. | `{ recallId, checkpoint, affectedClaimIds }` | Recall worker, audit, impact view. |
| `TruthOwnershipSuspended` `[E]` | Recall degradation reaches a graph-owned cell. | `{ recallId, cellKey, seq }` | Persistent Knowledge, authority view, subscribers. |
| `HorizonBudgetExhausted` `[E]` | A ledger reaches a hard limit. | `{ horizonId, budgetRef, consumed }` | Workflow escalation, Agent Client, audit. |
| `CapabilityExecuted` `[E]` | Capability Gateway completes an authorized effect. | `{ executionId, classification, contractRef, outcome }` | Workflow, audit, recovery/reconciliation. |

Events are append-only observations, not alternative command paths. Delivery may be asynchronous, but state-changing consumers must be idempotent and sequence-aware. An external LLM may consume outcomes and submit a new command; it does not consume an event as permission to mutate host state.

## Section 5 — Persistence / Repository / Data Access Interfaces

| Resource / Adapter | Methods / Actions | Return Types / Expected State |
|---|---|---|
| `DurableStateWriter` `[B]` | `write`, `durableTransaction`, `rebuildFromJsonl` | Atomic SQLite plus JSONL result; deterministic rebuild of derived state. |
| `ClaimSnapshotStore` `[B]` | `readClaims`, `writeClaim`, `readNodes`, `authorityOf`, `writeAuthority` | Tenant-scoped snapshots and append-only durable mutations. |
| `HorizonRepository` `[E]` | `get`, `create`, `saveTransition`, `findParent` | Versioned Horizon or typed conflict/refusal; topology remains explicit. |
| `AdmissionLedger` `[E]` | `appendDecision`, `findDecision`, `historySince` | Append-only decision records ordered by Sequence. |
| `DependencyQuery` `[E]` | `reverseClosure`, `registeredEdgesSince` | Stream or page of admitted dependency edges and resumable cursor. |
| `RecallRepository` `[E]` | `create`, `checkpoint`, `complete`, `get` | Idempotent Recall Case with durable progress and preserved scar. |
| `ApprovalRepository` `[E]` | `findValid`, `consumeAuthorization` | Scope/TTL/sequence validated approval; irreversible authorization is single-use. |
| `CapabilityGateway` `[E]` | `classify`, `execute` | Classified execution result with stable idempotency key and audit reference. |
| `MCP Cognitive Binding` `[E]` | `initiate`, `propose`, `promote`, `contest`, `recall` | Protocol responses containing outcomes or typed Refusals; no client-side authority. |

```text
interface HorizonRepository [E]:
  get(id): Horizon?; create(horizon): SaveResult
  saveTransition(horizon, expectedSeq): SaveResult
```

```text
interface DependencyQuery [E]:
  reverseClosure(claimIds, cursor?): ClosurePage
  registeredEdgesSince(seq): EdgePage
```

```text
interface MCPCognitiveBinding [E]:
  propose(request): ProtocolOutcome
  promote(request): ProtocolOutcome
```

## Section 6 — Ordered Development Tasks
```json
[
  {
    "id": "01",
    "title": "Define EAP Contract Types",
    "description": "Define versioned lifecycle, horizon, sequence, refusal, and persistent-delta contracts without changing the legacy claim status model implicitly.",
    "scope": [
      "packages/graph-core/src/eap/types.ts",
      "packages/graph-core/src/eap/refusals.ts",
      "packages/graph-core/test/eap-types.test.ts"
    ],
    "acceptance": [
      "All proposed protocol unions are closed and runtime-validated",
      "TruthOwnership remains independent from epistemic status",
      "The unresolved legacy status migration is explicit and no inferred mapping is applied"
    ],
    "depends_on": null
  },
  {
    "id": "02",
    "title": "Implement Epistemic Lifecycle Aggregate",
    "description": "Implement deterministic horizon-local lifecycle transitions and Relative Authority completion with typed refusals for illegal transitions.",
    "scope": [
      "packages/graph-core/src/eap/lifecycle.ts",
      "packages/graph-core/test/eap-lifecycle.test.ts"
    ],
    "acceptance": [
      "Only the normative transition sequence can complete Relative Authority",
      "PROMOTE, CONTEST, and INITIATE are rejected as lifecycle states",
      "Every rejected transition returns a typed refusal"
    ],
    "depends_on": "01"
  },
  {
    "id": "03",
    "title": "Implement Horizon Governance Aggregate",
    "description": "Implement horizon identity, declared parent topology, budget ledger, and escalation behavior while keeping authority scoped to one horizon.",
    "scope": [
      "packages/graph-core/src/eap/horizon.ts",
      "packages/graph-core/src/eap/budget.ts",
      "packages/graph-core/test/horizon.test.ts"
    ],
    "acceptance": [
      "A non-root horizon has exactly one declared parent",
      "Budget exhaustion produces escalation and cannot produce promotion",
      "Relative Authority cannot be assigned to another horizon"
    ],
    "depends_on": "02"
  },
  {
    "id": "04",
    "title": "Add Horizon Persistence",
    "description": "Persist horizons, transitions, budgets, and admission decisions through the existing transactional SQLite and durable JSONL architecture.",
    "scope": [
      "packages/mcp-server/src/db.ts",
      "packages/mcp-server/src/eap/horizon-store.ts",
      "packages/mcp-server/test/horizon-durability.test.ts"
    ],
    "acceptance": [
      "Horizon and decision writes are atomic and tenant-scoped",
      "JSONL rebuild reproduces the same horizon state and sequence",
      "Concurrent stale transitions fail deterministically"
    ],
    "depends_on": "03"
  },
  {
    "id": "05",
    "title": "Integrate Typed Admission Refusals",
    "description": "Translate existing gate failures into the closed EAP refusal taxonomy while preserving deterministic gate behavior and actionable client obligations.",
    "scope": [
      "packages/mcp-server/src/gates.ts",
      "packages/mcp-server/src/tools/changeset.ts",
      "packages/mcp-server/test/eap-refusals.test.ts"
    ],
    "acceptance": [
      "Every governed rejection exposes a stable code and client obligation",
      "Free-text detail is supplemental rather than the protocol discriminator",
      "The same candidate evidence receives the same gate verdict regardless of agent identity"
    ],
    "depends_on": "04"
  },
  {
    "id": "06",
    "title": "Implement One-Edge Promotion",
    "description": "Implement promotion as a sequence-checked proposal to the immediate parent without transferring admission or Relative Authority.",
    "scope": [
      "packages/graph-core/src/eap/promotion.ts",
      "packages/mcp-server/src/eap/promotion-service.ts",
      "packages/mcp-server/test/promotion.test.ts"
    ],
    "acceptance": [
      "Skipping a declared parent returns HORIZON_SKIP",
      "A stale basedOnSeq returns the normative stale refusal",
      "A successful promotion is stored as a proposed parent candidate"
    ],
    "depends_on": "05"
  },
  {
    "id": "07",
    "title": "Route Persistent Deltas Through Admission",
    "description": "Implement Persistent Delta as an envelope that atomically disassembles into the existing Admission Gate rather than creating another write path.",
    "scope": [
      "packages/mcp-server/src/eap/persistent-delta.ts",
      "packages/mcp-server/src/tools/changeset.ts",
      "packages/mcp-server/test/persistent-delta.test.ts"
    ],
    "acceptance": [
      "Every candidate in a delta is evaluated by the existing gate",
      "Any refused required candidate prevents a partial durable commit",
      "No direct persistent mutation API is introduced"
    ],
    "depends_on": "06"
  },
  {
    "id": "08",
    "title": "Implement Contestation Admission",
    "description": "Implement evidence-backed contestations as governed proposals with informative, blocking, and invalidating severity.",
    "scope": [
      "packages/graph-core/src/eap/contestation.ts",
      "packages/mcp-server/src/eap/contestation-service.ts",
      "packages/mcp-server/test/contestation.test.ts"
    ],
    "acceptance": [
      "A contestation cannot directly edit or delete an admitted claim",
      "Missing evidence returns the normative terminal refusal",
      "Only admitted invalidating contestations can initiate recall"
    ],
    "depends_on": "07"
  },
  {
    "id": "09",
    "title": "Implement Resumable Recall",
    "description": "Implement deterministic registered reverse-dependency closure and checkpointed idempotent degradation while preserving audit history.",
    "scope": [
      "packages/graph-core/src/eap/recall.ts",
      "packages/mcp-server/src/eap/recall-worker.ts",
      "packages/mcp-server/test/recall.test.ts"
    ],
    "acceptance": [
      "Restarting from any checkpoint produces the same final affected set",
      "Every registered transitive dependent leaves admitted state according to the resolved normative destination",
      "Target history and recall provenance remain queryable"
    ],
    "depends_on": "08"
  },
  {
    "id": "10",
    "title": "Add Capability Governance Boundary",
    "description": "Add deterministic effect classification and authorization checks around Concretization without embedding model inference in the host.",
    "scope": [
      "packages/graph-core/src/eap/capabilities.ts",
      "packages/mcp-server/src/eap/capability-gateway.ts",
      "packages/mcp-server/test/capability-governance.test.ts"
    ],
    "acceptance": [
      "Irreversible execution requires a valid matching single-use authorization",
      "Expired, stale, or out-of-scope approval is refused",
      "Capability outcomes are append-only and idempotency-keyed"
    ],
    "depends_on": "09"
  },
  {
    "id": "11",
    "title": "Expose Cognitive MCP Commands",
    "description": "Expose INITIATE, lifecycle proposal, PROMOTE, CONTEST, and RECALL through transport adapters that preserve deterministic host semantics.",
    "scope": [
      "packages/mcp-server/src/tools/eap.ts",
      "packages/mcp-server/src/index.ts",
      "packages/mcp-server/test/eap-mcp-contract.test.ts"
    ],
    "acceptance": [
      "MCP responses expose admitted outcomes or typed refusals",
      "Transport handlers contain no independent epistemic policy",
      "No command grants an external client direct persistence authority"
    ],
    "depends_on": "10"
  },
  {
    "id": "12",
    "title": "Add External Agent Client Adapter",
    "description": "Provide a thin client adapter that lets Claude Code or another orchestrator map Intermediator and Executor work to MCP commands without placing an LLM in the host.",
    "scope": [
      "packages/client/src/eap.ts",
      "packages/client/test/eap-client.test.ts",
      "packages/claude-plugin/skills/using-open-graph/SKILL.md"
    ],
    "acceptance": [
      "Intermediator and Executor outputs are submitted only as proposals",
      "The adapter handles each typed refusal according to its declared obligation",
      "The MCP server runs and passes contract tests without any LLM provider dependency"
    ],
    "depends_on": "11"
  },
  {
    "id": "13",
    "title": "Publish Protocol Conformance Suite",
    "description": "Publish black-box host and client profiles that verify lifecycle, promotion, refusal, recall, authority, and external-agent boundary obligations by observable logs.",
    "scope": [
      "packages/mcp-server/test/eap-conformance.test.ts",
      "packages/client/test/eap-conformance.test.ts",
      "packages/mcp-server/test/mcp-client-contract.ts"
    ],
    "acceptance": [
      "Host and client conformance verdicts are reported independently",
      "All decided protocol invariants have machine-observable assertions",
      "Open ADR ambiguities are reported as exclusions rather than silently decided by tests"
    ],
    "depends_on": "12"
  }
]
```

## Explicitly Deferred Decisions

Implementation must stop at the ADR's open boundaries rather than silently decide them: topology changes during in-flight promotion; the exact destination status of indirect recall dependents; whether `RecallNotice` and invalidating Contestation are one or two admitted objects; whether unknown `faulty_since_seq` widens closure; the normative mapping from legacy claim statuses; and large-closure batching limits. Tasks whose acceptance depends on one of these decisions require a preceding ADR amendment.
