# Problem Space — OpenGraph Coding Agents Plugin

**Domain:** `open_graph_coding_agents_plugin`  
**Mode:** autonomous refinement  
**Normative baseline:** OpenGraph Graph v2 / EAP; no Graph v1 compatibility

## Section 1 — Event Storming

| # | Domain Event (past tense) | Command (trigger) | Aggregate | External Systems | Read Models |
|---:|---|---|---|---|---|
| 1 | Workflow Readiness Probed | Probe Workflow Readiness | WorkflowCase | Coding Agent Host, MCP transport | Readiness Report |
| 2 | Doctor Handoff Requested | Request Doctor Handoff after objective failure | WorkflowCase | Coding Agent Host | Readiness Report |
| 3 | Codex Agent Profiles Provisioned | Provision Consented Agent Profiles | WorkflowCase | Coding Agent Host, Target Repository | Readiness Report, Provisioning Receipt |
| 4 | Operator Intent Recorded | Record Operator Intent | WorkflowCase | Operator | Workflow Timeline |
| 5 | Negotiation Initiated | Submit NegotiationSeed | Negotiation | — | Negotiation View |
| 6 | Persistent Evidence Queried | Query Graph v2 at based_on_seq | Negotiation | — | Impact and Coverage View |
| 7 | Deliberation Round Materialized | Record Typed Mailbox Entry | Negotiation | Coding Agent Host | Mailbox / Journal View |
| 8 | Change Readiness Recommended | Recommend CHANGE_READY | Negotiation | — | Readiness Predicate View |
| 9 | Change Readiness Verified | Verify CHANGE_READY predicates | WorkflowCase | — | Workflow State View |
| 10 | Change Contract Submitted | Submit ChangeContract and ExecutionPlan | WorkflowCase | — | Contract View |
| 11 | Changeset Opened | Open Changeset for mapped cells | Changeset | Source Repository | Changeset Scope View |
| 12 | Transformation Horizon Instantiated | Initiate Transformation | WorkflowCase | — | Horizon Topology View |
| 13 | Work Order Issued | Issue WorkOrder | Transformation | — | Work Queue View |
| 14 | Execution Grant Issued | Grant Executor use of existing changeset | Changeset | Coding Agent Host | Grant Registry |
| 15 | Focused Horizon Projection Built | Project governed subgraph for WorkOrder | HorizonProjection | — | Focused Graph View |
| 16 | Executor Attached | Attach Executor with lease generation | WorkflowCase | Coding Agent Host | Active Lease View |
| 17 | Artifact Bundle Proposed | Submit ArtifactBundle and PromotionProposal | Microtask | Source Repository, Tool Runtime | Evidence View |
| 18 | Audit Assessment Recorded | Record AuditAssessment | Transformation | Coding Agent Host | Audit View |
| 19 | Audit Decision Applied | Apply accepted, revise, or escalate | Transformation | — | Workflow State View |
| 20 | Executor Reattached | Reattach after lease fencing and state replay | WorkflowCase | Coding Agent Host | Recovery View |
| 21 | Persistent Delta Proposed | Submit PersistentDelta | Transformation | — | Promotion View |
| 22 | Persistent Delta Admitted | Evaluate through baseline gate | Persistent Graph | Source Repository | Persistent Graph View |
| 23 | Changeset Committed | Commit admitted Changeset | Changeset | Source Repository | Completion View |
| 24 | Workflow Case Closed | Close ephemeral horizons with excluded_summary | WorkflowCase | Coding Agent Host | Audit Timeline |

## Section 2 — Subdomain Classification

| Subdomain | Type | Justification |
|---|---|---|
| Governed Agent Workflow | Core | Converts agent collaboration into a verifiable Graph v2 workflow without giving agents gate authority. |
| Cross-Horizon Contracts | Core | Preserves authority, provenance, topology, and promotion semantics across disposable agents. |
| Capability-Driven Host Adaptation | Core | Makes the same correctness contract executable across unequal coding-agent hosts. |
| Workflow Recovery | Core | Keeps a durable case correct across crashes, compaction, stale bases, and identity changes. |
| Focused Horizon Projection | Supporting | Bounds cognitive context while retaining governed references to the full graph. |
| Changeset Delegation | Supporting | Allows Maître and Executor identities to cooperate without transferring ownership implicitly. |
| Typed Mailbox and Journal | Supporting | Materializes decision-influencing handoffs and makes native messaging non-canonical. |
| Doctor Diagnostics | Supporting | Restores objective readiness, including explicit conflict-safe Codex profile provisioning, but remains outside the normal workflow loop. |
| Plugin Packaging | Generic | Uses each host's standard discovery and distribution conventions. |
| Transport and Process Supervision | Generic | Relies on MCP, stdio, filesystem, and host lifecycle facilities. |

## Section 3 — Ubiquitous Language Glossary

| Term | Definition | Notes |
|---|---|---|
| WorkflowCase | Durable identity and lifecycle record for one operator change from intent through closure. | Not an agent transcript and not an authority shortcut. |
| Maître | Session agent that converses with the operator, composes the full plan, opens the Changeset, and dispatches work. | Coordinates; does not host a gate. |
| Guardião | Negotiation agent that evaluates evidence, impact, assumptions, and unresolved questions and recommends readiness. | Recommends `CHANGE_READY`; Router verifies it. |
| Intermediador | Transformation agent that governs implementation cognitively and emits an AuditAssessment. | Does not implement, open Changesets, or apply AuditDecision. |
| Executor | Microtask agent that edits and tests only within a WorkOrder, ExecutionGrant, budget, and Changeset scope. | May be replaced; identity is explicit. |
| Router | Deterministic control plane that verifies predicates and applies workflow transitions. | Never an LLM role. |
| Changeset | Audited authorization envelope required before editing every graph-mapped file. | Presence and locks do not replace it. |
| ExecutionGrant | Scoped, expiring delegation allowing an Executor identity to use a Maître-opened Changeset. | It never transfers Changeset ownership or gate authority. |
| Focused Horizon Graph Projection | Governed, reproducible subgraph view for a transformation or microtask. | Projection is context, not a new source of truth. |
| Typed Mailbox Entry | Addressed, acknowledged handoff object stored in the relevant OpenGraph. | Native host messaging is only a delivery accelerator. |
| Lease Generation | Monotonic fencing number that makes superseded workers unable to mutate a WorkflowCase. | Reattach must obtain the current generation. |
| ChangeContract | Negotiated contract that fixes intent, constraints, risks, approvals, and references an ExecutionPlan. | It is not a broad permission to edit. |
| WorkOrder | Typed initiation contract from transformation to one microtask. | Each WorkOrder has bounded scope, budget, tests, and rollback. |
| AuditAssessment | Probabilistic semantic judgment emitted by the Intermediador. | Cannot transition authority by itself. |
| AuditDecision | Governed consequence applied by the transformation host. | Values include accepted, revise, and escalate. |

## Section 4 — Socratic Questions

### Business Invariants and Consistency

1. How is it proven that every decision-influencing handoff was admitted to the correct horizon before the Router consumed it?
2. What prevents an ExecutionGrant from becoming an implicit transfer of Changeset ownership or from outliving the WorkOrder that justified it?
3. If several WorkOrders share one Changeset, which invariant makes their accepted deltas composable without silent semantic conflict?
4. How does a Focused Horizon Graph Projection prove completeness for its declared purpose while preserving `unknown` when coverage is insufficient?

### Scalability and Performance

5. At one million nodes, what bounds projection construction, mailbox replay, and impact traversal without representing a truncated result as `known-zero`?
6. How are journal pagination and replay cursors kept stable while new events arrive and old ephemeral horizons are destroyed?

### Security and Sensitive Data

7. Which fields are redacted from mailbox entries, hook output, audit logs, and ArtifactBundles before they can leak credentials or operator data?
8. How does the Router reject a forged ExecutionGrant, stale lease generation, cross-tenant WorkflowCase, or host adapter claiming capabilities it did not demonstrate?

### Concurrency and Failures

9. When Codex crashes after editing but before recording evidence, how do fencing, reattach, repository inspection, and rebase avoid duplicate effects?
10. What happens when persistent `seq` advances between projection creation, Executor work, AuditAssessment, and final PersistentDelta submission?
11. Can a delayed native subagent message overwrite a newer governed mailbox round, and what monotonic key prevents that race?

### Responsibility Boundaries Between Layers

12. Which observable tests prove that a host adapter contains no EAP rule duplicated from the Router or correctness core?
13. If a hook blocks a tool call while MCP would allow it, which result is authoritative and how is the disagreement audited?
14. How does the Codex reference adapter remain concrete without making `.codex/agents`, hook names, or spawn APIs part of the portable contract?

**Architecture Tip:** Keep normative EAP invariants and Router transitions inside the OpenGraph product; let the portable harness express roles and contracts, and let adapters map only demonstrated host capabilities.
