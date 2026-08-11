# Cognitive Line — Context Map

## Scope and Modeling Status

This context map refines the proposed OpenGraph v1.0 domain described in `001-problem-space.md`. It models intended boundaries and relationships; it does not claim that the proposed capabilities are operational. The Epistemic Admission Protocol (EAP) is the implementation-independent domain contract, while transport, storage, and the reference host remain replaceable collaborators.

## 1. Bounded Context Identification

| Bounded Context | Responsibility | Boundary (excluded) | Team Ownership | Key Entities |
|---|---|---|---|---|
| Epistemic Admission | Own the EAP lifecycle semantics, the single Admission Gate, typed Refusals, and completion of Relative Authority within a Horizon. | Excludes horizon topology, cross-horizon Promotion, persistence technology, workflow progression, and external capability execution. | Epistemic Protocol Team | Epistemic Lifecycle, Admission Gate, Proposal, Deliberation Record, Refusal |
| Horizon Governance | Initiate Horizons, govern their topology and Budget Ledgers, and move candidates across exactly one declared Promotion edge without transferring authority. | Excludes admission decisions inside either Horizon, truth ownership, capability effects, and operator authorization. | Horizon Governance Team | Horizon, Promotion, Negotiation Seed, Budget Ledger |
| Persistent Knowledge | Own admitted persistent cells, dependency relationships, Persistent Deltas, and the durable coordinates of epistemic status and Truth Ownership. | Excludes deciding whether a candidate is admissible, calculating recall policy, storage-engine details, and transient scratch. | Knowledge Integrity Team | Persistent Delta, Persistent Cell, Dependency, Truth Ownership |
| Correction and Recall | Accept provenanced Contestations, govern Recall, calculate admitted dependency closure, and coordinate cell-by-cell Rehabilitation while preserving historical scars. | Excludes direct editing or deletion of admitted knowledge, ordinary admission, and physical graph traversal implementation. | Knowledge Integrity Team | Contestation, Recall, Recall Case, Dependency Closure, Rehabilitation Case |
| Workflow Orchestration | Coordinate operational progress and expose workflow readiness without manufacturing epistemic state or authority. | Excludes deterministic epistemic transitions, evidence assessment ownership, and external-effect policy. | Cognitive Operations Team | Workflow, Change Readiness, Escalation |
| Operator Governance | Capture scoped, expiring, sequence-bound risk acceptance and irreversible authorization while preventing approval from substituting for evidence. | Excludes epistemic admission, mechanical verification waivers, identity-provider implementation, and capability execution. | Cognitive Operations Team | Operator Approval, Change Contract, Authorization Record |
| Capability Governance | Classify tool effects, enforce execution contracts at the Capability Gateway, and audit external effects during Concretization. | Excludes deciding epistemic authority, agent-specific transport, and the internal materialization of knowledge with no external effect. | Runtime Safety Team | Capability Policy, Capability Classification, Execution Contract, Execution Audit |
| Protocol Conformance | Assess Agent Client and Horizon Host obligations independently and publish evidence-based conformance results. | Excludes granting domain authority, adapting host behavior per client flavor, and defining EAP semantics. | Protocol Assurance Team | Conformance Profile, Conformance Assessment, Conformance Report |
| Audit and Evidence | Preserve append-only domain observations, evidence references, refusals, metrics, and ledgers for verification by log. | Excludes interpreting evidence, choosing transitions, and owning domain truth. | Platform Observability Team | Audit Entry, Evidence Reference, Metric Record |
| Durable Graph Storage | Persist domain state and derived indexes without changing the meaning of admission, authority, recall, or Promotion. | Excludes domain policy, protocol decisions, and client-facing transport. | Data Platform Team | Stored Cell, Stored Edge, Sequence, Derived Index |
| Transport Binding | Carry EAP interactions between clients and hosts through MCP or another binding without defining their meaning. | Excludes lifecycle semantics, host conformance decisions, client adaptation policy, and persistence. | Integration Platform Team | Protocol Request, Protocol Response, Transport Session |

## 2. Context Map

### Normative domain relationships

```text
[Horizon Governance] → [Epistemic Admission]
Pattern   : Customer-Supplier
Direction : upstream / downstream
Justification: Horizon Governance supplies scoped proposals and Promotion candidates; Epistemic Admission controls whether they enter and complete the lifecycle.
```

```text
[Epistemic Admission] → [Persistent Knowledge]
Pattern   : Customer-Supplier
Direction : upstream / downstream
Justification: admitted outcomes are supplied as Persistent Deltas, while Persistent Knowledge requires the admission contract to protect its integrity.
```

```text
[Correction and Recall] → [Epistemic Admission]
Pattern   : Customer-Supplier
Direction : upstream / downstream
Justification: Contestations and Recall requests enter as candidates, and the single Admission Gate retains authority over their acceptance.
```

```text
[Persistent Knowledge] → [Correction and Recall]
Pattern   : Open Host Service
Direction : upstream / downstream
Justification: correction requires a stable query contract for admitted dependencies, sequences, status, and Truth Ownership without owning storage internals.
```

```text
[Correction and Recall] → [Persistent Knowledge]
Pattern   : Customer-Supplier
Direction : upstream / downstream
Justification: an admitted Recall supplies calculated suspension and Rehabilitation outcomes that Persistent Knowledge applies while preserving history.
```

```text
[Epistemic Admission] → [Workflow Orchestration]
Pattern   : Published Language
Direction : upstream / downstream
Justification: workflow consumes explicit lifecycle and Relative Authority events rather than inferring readiness from duplicated flags.
```

```text
[Horizon Governance] → [Workflow Orchestration]
Pattern   : Published Language
Direction : upstream / downstream
Justification: Horizon initiation, Promotion outcomes, budget exhaustion, and escalation use stable event contracts to coordinate progress.
```

```text
[Operator Governance] → [Workflow Orchestration]
Pattern   : Customer-Supplier
Direction : upstream / downstream
Justification: scoped approvals and authorizations enable defined workflow transitions without becoming epistemic evidence.
```

```text
[Workflow Orchestration] → [Capability Governance]
Pattern   : Customer-Supplier
Direction : upstream / downstream
Justification: workflow requests Concretization, while Capability Governance retains control over classified external effects and execution contracts.
```

```text
[Operator Governance] → [Capability Governance]
Pattern   : Published Language
Direction : upstream / downstream
Justification: irreversible actions require a stable Change Contract and Authorization Record that the Capability Gateway can validate without interpreting operator intent.
```

```text
[Epistemic Admission] → [Protocol Conformance]
Pattern   : Published Language
Direction : upstream / downstream
Justification: conformance tests consume the normative EAP vocabulary, transition obligations, and Refusal taxonomy as an executable contract.
```

```text
[Horizon Governance] → [Protocol Conformance]
Pattern   : Published Language
Direction : upstream / downstream
Justification: host and client assessments require stable contracts for Horizon roles, Promotion boundaries, and Budget Ledger obligations.
```

### Infrastructure and integration relationships

```text
[Epistemic Admission] → [Audit and Evidence]
Pattern   : Open Host Service
Direction : downstream / upstream
Justification: admission records all transitions and Refusals through a stable append-only service, but audit infrastructure cannot choose outcomes.
```

```text
[Horizon Governance] → [Audit and Evidence]
Pattern   : Open Host Service
Direction : downstream / upstream
Justification: Horizon and Promotion events, budget consumption, and escalation must be observable by log through a shared service.
```

```text
[Correction and Recall] → [Audit and Evidence]
Pattern   : Open Host Service
Direction : downstream / upstream
Justification: Contestation provenance, recall closure, suspension, and Rehabilitation must remain traceable without coupling correction policy to log storage.
```

```text
[Capability Governance] → [Audit and Evidence]
Pattern   : Open Host Service
Direction : downstream / upstream
Justification: external-effect requests and outcomes require append-only evidence, especially when execution succeeds but acknowledgement fails.
```

```text
[Persistent Knowledge] → [Durable Graph Storage]
Pattern   : Anti-Corruption Layer (ACL)
Direction : downstream / upstream
Justification: Persistent Knowledge translates its cells, dependencies, sequences, and ownership into storage operations so schemas cannot define domain semantics.
```

```text
[Transport Binding] → [Epistemic Admission]
Pattern   : Anti-Corruption Layer (ACL)
Direction : downstream / upstream
Justification: transport handlers translate wire requests into EAP commands so replacing MCP cannot change the meaning of ADMIT or Refusal.
```

```text
[Transport Binding] → [Horizon Governance]
Pattern   : Anti-Corruption Layer (ACL)
Direction : downstream / upstream
Justification: wire-level INITIATE and PROMOTE requests are translated into domain commands without leaking client flavor into Horizon policy.
```

```text
[Transport Binding] → [Protocol Conformance]
Pattern   : Conformist
Direction : downstream / upstream
Justification: each binding accepts the published conformance model and may not redefine client or host obligations.
```

No Shared Kernel is declared. The contexts exchange explicit commands, events, and value contracts; sharing mutable domain models would obscure ownership and allow transport, workflow, or persistence concerns to alter EAP semantics.

## 3. Core Domain Highlight

```text
Context   : Epistemic Admission
Reason    : It embodies the Epistemic Admission Protocol and the protected recursive lifecycle that distinguish governed knowledge from ordinary graph mutation.
Investment: Use rigorous aggregates and invariants for the single Admission Gate, typed Refusals, deterministic transitions, and Relative Authority; verify every transition by observable evidence.
```

```text
Context   : Horizon Governance
Reason    : It prevents authority leakage across governed scopes by making topology, INITIATE, Promotion, and budget exhaustion explicit domain behavior.
Investment: Model the Horizon DAG, one-edge Promotion invariant, sequence freshness, idempotency, and escalation rules with strong consistency boundaries and adversarial tests.
```

```text
Context   : Persistent Knowledge
Reason    : It protects the orthogonal coordinates of epistemic status and Truth Ownership and makes admitted dependency structure available without surrendering domain meaning to storage.
Investment: Model Persistent Deltas, cells, dependencies, sequences, ownership transitions, and historical preservation explicitly; isolate all storage schemas behind domain ports.
```

```text
Context   : Correction and Recall
Reason    : It provides the evidence-based, dependency-aware correction mechanism needed for governed knowledge to remain corrigible without silent editing or erasure.
Investment: Apply rigorous modeling to Contestation severity, admitted Recall, deterministic closure, resumable cascade behavior, Rehabilitation, provenance, and preserved scars.
```

These contexts implement the Core subdomains identified in `001-problem-space.md`: Epistemic Admission Protocol, Recursive Epistemic Lifecycle, Horizon Governance and Promotion, Contestation, Recall, and Rehabilitation, and Authority and Truth Ownership. The remaining contexts are supporting or generic and must not absorb Core Domain decisions.

## 4. Architectural Decisions

```text
Decision    : Keep EAP semantics in Epistemic Admission and translate every transport binding through an Anti-Corruption Layer.
Context     : The meaning of ADMIT, PROMOTE, and Refusal must survive replacement of MCP or any client flavor.
Consequences: Protocol semantics remain portable and testable; adapters require explicit translation and cannot rely on transport-native models.
```

```text
Decision    : Separate Horizon Governance from Epistemic Admission and permit Promotion across exactly one declared DAG edge as a new proposal.
Context     : Relative Authority belongs to one Horizon and must never transfer implicitly to a parent or newly initiated Horizon.
Consequences: Authority leakage is structurally constrained and topology is explicit; cross-horizon workflows require additional commands, sequence checks, and reconciliation.
```

```text
Decision    : Keep Correction and Recall separate from Persistent Knowledge, using the single Admission Gate for correction and a stable dependency-query contract for closure.
Context     : Correction must be admitted, evidence-backed, and deterministic without allowing direct edits or making graph storage the policy owner.
Consequences: Recall remains auditable and storage-independent; cascade processing spans contexts and therefore needs idempotency, resumability, and explicit consistency guarantees.
```

```text
Decision    : Separate Workflow Orchestration, Operator Governance, and Capability Governance from epistemic transitions.
Context     : Operational readiness, human intent, and permission to cause effects are distinct from evidence and Relative Authority.
Consequences: Neither an LLM recommendation nor an operator approval can manufacture authority; coordination requires published events and explicit Change Contracts.
```

```text
Decision    : Use published contracts and append-only observations at context boundaries; do not introduce a Shared Kernel.
Context     : Conformance, audit, transport, and storage serve multiple domain contexts but must not become alternate owners of EAP vocabulary or state.
Consequences: Teams can evolve implementations independently and verify behavior by log; contract versioning and translation overhead become first-class operational costs.
```
