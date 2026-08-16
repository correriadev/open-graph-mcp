# Context Map — OpenGraph Coding Agents Plugin

**Domain:** `open_graph_coding_agents_plugin`

## Section 1 — Bounded Context Identification

| Bounded Context | Responsibility | Boundary (excluded) | Team Ownership | Key Entities |
|---|---|---|---|---|
| Epistemic Authority | Applies Graph v2 lifecycle, topology, admission, refusal, contestation, recall, and persistent promotion. | Agent prompting, host discovery, plugin packaging. | OpenGraph Core | Persistent Graph, Horizon, PromotionProposal, PersistentDelta |
| Workflow Orchestration | Maintains durable WorkflowCase state and asks the Router to apply deterministic transitions. | Semantic judgments and source edits. | OpenGraph Router | WorkflowCase, ExecutionPlan, WorkOrder, Typed Mailbox Entry |
| Negotiation | Materializes Maître–Guardião deliberation and readiness evidence. | Applying `CHANGE_READY` or implementation audit. | Portable Harness | Negotiation, NegotiationSeed, ChangeContract, Assumption |
| Transformation Governance | Coordinates WorkOrders and records AuditAssessment/AuditDecision separation. | Direct implementation and persistent admission. | Portable Harness + OpenGraph Host | Transformation, AuditAssessment, AuditDecision, ArtifactBundle |
| Execution Authorization | Owns Changeset scope, ExecutionGrant, leases, and fencing for edits. | Semantic quality judgment and host process spawning. | OpenGraph Host | Changeset, ExecutionGrant, Lease Generation |
| Projection | Builds reproducible Focused Horizon Graph Projections with declared coverage. | New truth, hidden summarization, or promotion. | OpenGraph Core | HorizonProjection, ProjectionQuery, CoverageDescriptor |
| Host Adaptation | Maps portable roles and operations to demonstrated host capabilities. | EAP semantics, Router decisions, and source of truth. | Adapter Maintainers | CapabilityProfile, AgentBinding, DeliveryReceipt |
| Codex Adapter | Packages installable skills, MCP registration, optional hooks, and agent-profile templates, then verifies explicit profile provisioning. | Portable protocol definitions, silent writes to official agent locations, and other host details. | Codex Adapter Maintainers | CodexCapabilityProfile, CodexAgentBinding, HookPolicy |
| Doctor | Diagnoses objective readiness and returns a typed report to the workflow. | Business negotiation, editing, and normal-loop orchestration. | Adapter Maintainers | ReadinessReport, RemediationAction |

## Section 2 — Context Map

### Epistemic Authority → Workflow Orchestration
Pattern   : Open Host Service + Published Language  
Direction : upstream / downstream  
Justification: Graph v2 hosts expose stable typed operations; workflow state may transition only through their governed results.

### Workflow Orchestration → Epistemic Authority
Pattern   : Customer-Supplier  
Direction : downstream / upstream  
Justification: Router workflow needs lifecycle operations while preserving the authority context's independent admission rules.

### Negotiation → Workflow Orchestration
Pattern   : Published Language  
Direction : upstream / downstream  
Justification: Negotiation emits structured assumptions, unresolved items, approvals, and ChangeContract for mechanical readiness checks.

### Transformation Governance → Workflow Orchestration
Pattern   : Published Language  
Direction : upstream / downstream  
Justification: AuditAssessment is translated into a host-owned AuditDecision before state changes.

### Execution Authorization → Transformation Governance
Pattern   : Customer-Supplier  
Direction : upstream / downstream  
Justification: Work execution consumes grants and leases but cannot redefine Changeset authorization.

### Projection → Negotiation / Transformation Governance
Pattern   : Open Host Service + Published Language  
Direction : upstream / downstream  
Justification: All agent roles consume bounded graph views with explicit query, base sequence, coverage, and provenance.

### Host Adaptation → Portable Harness Contexts
Pattern   : Anti-Corruption Layer  
Direction : downstream / upstream  
Justification: Adapter vocabulary translates host-specific spawning, messaging, and hooks without leaking them into portable contracts.

### Codex Adapter → Host Adaptation
Pattern   : Conformist  
Direction : downstream / upstream  
Justification: Codex implements the common CapabilityProfile and declares any degradation rather than changing correctness rules.

### Doctor → Workflow Orchestration
Pattern   : Published Language  
Direction : upstream / downstream  
Justification: Only a typed ReadinessReport can resume or keep the case outside the normal loop.

### Codex Adapter → Gemini / OpenCode / Claude Code Adapters
Pattern   : Separate Ways  
Direction : none  
Justification: Adapters share conformance contracts and fixtures, not implementation or proprietary host mechanisms.

## Section 3 — Core Domain Highlight

Context : Epistemic Authority  
Reason  : It is the product-level differentiator that prevents generated, executed, or agent-approved content from becoming truth without governed admission.  
Investment: Preserve the six-state lifecycle, typed horizon boundaries, closed refusals, baseline persistent gate, and adversarial conformance tests.

Context : Workflow Orchestration  
Reason  : It turns disposable multi-agent collaboration into a durable, replayable case whose transitions survive host and identity changes.  
Investment: Model WorkflowCase, journal ordering, transition idempotency, recovery, and deterministic Router predicates rigorously.

Context : Host Adaptation  
Reason  : Capability-driven portability is what makes correctness survive across Codex, Gemini, OpenCode, and Claude Code without server-side flavor logic.  
Investment: Build a conformance matrix, degradation rules, adapter test kit, and a concrete Codex reference adapter.

## Section 4 — Architectural Decisions

Decision    : Separate product authority, portable harness contract, and host adapters.  
Context     : Host conveniences must not become Graph v2 invariants or duplicate Router rules.  
Consequences: Each layer is independently testable; adapters carry translation cost and may report degraded capabilities.

Decision    : Use a durable WorkflowCase with typed mailbox and journal entries as canonical coordination state.  
Context     : Agents, sessions, and native messaging are disposable and may be reordered or lost.  
Consequences: Recovery and audit become deterministic; every decision-relevant handoff incurs governed persistence cost.

Decision    : Introduce ExecutionGrant and lease-generation fencing without transferring Changeset ownership.  
Context     : Maître opens a required Changeset while a differently identified Executor performs edits.  
Consequences: Delegation is explicit, scoped, revocable, and recoverable; clients must renew or reattach after replacement.

Decision    : Make Codex the reference adapter through an installable plugin surface plus explicitly provisioned agent profiles.  
Context     : Plugins load skills, MCP servers, and optional hooks, while Codex discovers custom agents only after profiles exist in project-scoped `.codex/agents/` or the explicitly chosen user scope.  
Consequences: v1 has an executable reference mapping; doctor/setup must obtain consent, detect conflicts, support rollback, and verify discovery before mutation, while portable schemas remain host-neutral.

Decision    : Treat hooks as adapter guardrails, never as the sole enforcement of an invariant.  
Context     : Hooks may be unavailable, untrusted, bypassed, or vary by host.  
Consequences: PreToolUse may reinforce grant/scope checks and lifecycle hooks may improve recovery, but MCP/Router remains authority and conformance must pass with hooks disabled.
