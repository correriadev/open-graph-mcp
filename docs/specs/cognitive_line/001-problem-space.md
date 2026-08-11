# Cognitive Line — Problem Space

## Scope and Status

This strategic model refines the proposed OpenGraph v1.0 decisions into a problem-space view for the `cognitive_line` domain. The source ADR explicitly states that the decisions are proposed evolution unless supported by repository evidence; therefore, the events below describe intended domain behavior rather than capabilities claimed as already operational.

## 1. Big Picture Event Storming

| # | Domain Event (past tense) | Command (trigger) | Aggregate | External Systems | Read Models |
|---:|---|---|---|---|---|
| 1 | Horizon Initiated | Initiate Horizon | Horizon | Agent Client | Horizon Context |
| 2 | Knowledge Proposed | Propose Knowledge | Epistemic Lifecycle | Agent Client | Proposal Queue |
| 3 | Proposal Deliberated | Deliberate Proposal | Epistemic Lifecycle | Semantic Assessor | Deliberation Record |
| 4 | Proposal Refused | Refuse Proposal | Admission Gate | Agent Client | Refusal Record |
| 5 | Knowledge Admitted | Admit Knowledge | Admission Gate | — | Admission Ledger |
| 6 | Knowledge Concretized | Concretize Knowledge | Horizon | Capability Provider | Concretization Record |
| 7 | Knowledge Verified | Verify Knowledge | Epistemic Lifecycle | Evidence Source | Verification Record |
| 8 | Relative Authority Completed | Complete Relative Authority | Epistemic Lifecycle | — | Authority View |
| 9 | Promotion Proposed | Promote Knowledge | Promotion | Parent Horizon Host | Promotion Queue |
| 10 | Promotion Refused | Refuse Promotion | Promotion | Horizon Host | Refusal Record |
| 11 | Persistent Delta Admitted | Admit Persistent Delta | Persistent Knowledge | Evidence Source | Persistent Knowledge View |
| 12 | Knowledge Contested | Contest Knowledge | Contestation | Evidence Source | Contestation View |
| 13 | Recall Admitted | Admit Recall | Recall | Evidence Source | Recall Case |
| 14 | Dependency Closure Calculated | Calculate Recall Closure | Recall | — | Recall Impact View |
| 15 | Truth Ownership Suspended | Suspend Truth Ownership | Persistent Knowledge | — | Ownership View |
| 16 | Knowledge Rehabilitated | Rehabilitate Knowledge | Persistent Knowledge | Evidence Source | Rehabilitation View |
| 17 | Operational Staleness Approved | Approve Operational Staleness | Operator Approval | Human Operator | Active Approval View |
| 18 | Epistemically Stale Promotion Refused | Refuse Stale Promotion | Promotion | Agent Client | Refusal Record |
| 19 | Change Readiness Confirmed | Confirm Change Readiness | Workflow | Human Operator | Workflow Status |
| 20 | Tool Effect Classified | Classify Tool Effect | Capability Policy | Agent Adapter | Capability Catalog |
| 21 | Irreversible Action Authorized | Authorize Irreversible Action | Change Contract | Human Operator | Authorization Record |
| 22 | Capability Executed | Execute Capability | Execution | Capability Provider | Execution Audit |
| 23 | Horizon Budget Exhausted | Exhaust Horizon Budget | Horizon Budget | Agent Client | Budget Ledger |
| 24 | Horizon Escalated | Escalate Horizon | Workflow | Human Operator | Escalation Queue |
| 25 | Conformance Assessed | Assess Conformance | Conformance Profile | Agent Client, Horizon Host | Conformance Report |

### Event-flow notes

- `PROPOSE → DELIBERATE → ADMIT → CONCRETIZE → VERIFY → relative authority` is the protected recursive lifecycle inside every horizon.
- `PROMOTE`, `CONTEST`, and `INITIATE` operate at boundaries; they are not replacement states in that lifecycle.
- A promotion crosses exactly one declared edge in the horizon DAG and enters the parent as a proposal, never as inherited authority.
- A `PersistentDelta` is an admission envelope, not a second gate or an admission bypass.
- Recall is correction through an admitted event and calculated cascade; direct editing of admitted knowledge is forbidden.
- Workflow state and epistemic state are separate: an operational transition cannot manufacture epistemic authority.

## 2. Subdomain Classification

| Subdomain | Type | Justification |
|---|---|---|
| Epistemic Admission Protocol | Core | Defines the implementation-independent rules that distinguish governed knowledge admission from ordinary graph mutation. |
| Recursive Epistemic Lifecycle | Core | Preserves the six-state knowledge lifecycle and the meaning of authority within every horizon. |
| Horizon Governance and Promotion | Core | Controls how context and candidates cross horizons without allowing authority to leak across boundaries. |
| Contestation, Recall, and Rehabilitation | Core | Makes correction traceable, evidence-based, and dependency-aware while retaining the historical scar. |
| Authority and Truth Ownership | Core | Separates epistemic status, truth ownership, and relative authority so one dimension cannot silently substitute for another. |
| Workflow Orchestration | Supporting | Coordinates operational progress while remaining subordinate to deterministic epistemic transition rules. |
| Operator Governance | Supporting | Captures intent, risk acceptance, and irreversible authorization without treating operator preference as evidence. |
| Capability Governance | Supporting | Classifies external effects and enforces execution contracts around concretization. |
| Budget and Escalation | Supporting | Bounds cognitive and operational work and ensures exhaustion escalates rather than promotes. |
| Protocol Conformance | Supporting | Demonstrates whether clients and hosts honor the protocol roles and observable obligations. |
| Audit and Evidence Logging | Generic | Append-only audit, metrics, and trace retention are commodity capabilities adapted to the domain vocabulary. |
| Durable Graph Storage | Generic | Persistence and derived indexing are infrastructure concerns as long as normative behavior remains storage-independent. |
| Transport Binding | Generic | MCP or another binding carries protocol interactions but must not define their meaning. |

## 3. Ubiquitous Language Glossary

| Term | Definition | Notes |
|---|---|---|
| Epistemic Admission Protocol (EAP) | The proposed shared contract governing how knowledge is proposed, admitted, promoted, corrected, and refused independently of a particular implementation. | Do not use EAP as a synonym for the reference server or its MCP binding. |
| Horizon | A governed scope in which knowledge completes its own epistemic lifecycle and receives only authority relative to that scope. | A horizon is not merely a retention tier, container, or duration class. |
| Epistemic Lifecycle | The ordered progression `PROPOSE`, `DELIBERATE`, `ADMIT`, `CONCRETIZE`, and `VERIFY`, resulting in relative authority. | `PROMOTE` is not a lifecycle state; omitting `CONCRETIZE` changes the model. |
| Relative Authority | Permission earned by completing the lifecycle within one horizon, enabling only the capabilities declared for that horizon. | It never transfers automatically to another horizon and is not truth ownership. |
| Promotion | A governed proposal from a completed child horizon into its immediate parent horizon. | Promotion produces a proposed candidate, never inherited admission or authority. |
| Negotiation Seed | Provenanced context that starts a new negotiation horizon. | It may carry references and recorded operator decisions, but never authority. |
| Admission Gate | The single decision boundary through which candidate persistent knowledge and corrections must pass. | Avoid “write” or “save” when the business meaning is admission. |
| Refusal | A typed rejection whose reason and required client response are part of the protocol. | A generic error or blind identical retry is non-conformant behavior. |
| Persistent Delta | A proposed package describing candidate changes, claims, coverage impact, and rollback semantics for admission to persistent knowledge. | It is an envelope, not a bypass around the Admission Gate. |
| Contestation | A provenanced, evidence-backed event challenging admitted content with informative, blocking, or invalidating severity. | Contestation is never a direct edit. |
| Recall | An admitted invalidating contestation that triggers deterministic suspension across the admitted dependency closure. | Recall preserves history; it does not erase or rewrite prior knowledge. |
| Truth Ownership | The coordinate stating whether a persistent cell's truth is owned by the source, the graph, or is suspended. | Ownership answers “who owns truth,” not epistemic status or confidence. |
| Suspended | A truth-ownership condition in which neither graph nor source automatically owns the truth fully pending re-proof or explicit demotion. | Use only for ownership; claims are `contested` or `revoked`, not suspended. |
| Operator Approval | A scoped, expiring, sequence-bound record of accepted risk or authorized action. | It cannot waive evidence, anchor integrity, coverage, or other mechanically verifiable properties. |
| Budget Ledger | The audit record of tokens, time, attempts, and capability calls consumed within a horizon. | Budget exhaustion means escalation, never automatic promotion. |

## 4. Socratic Questions

The answers below are derived from the current `docs/` definitions: Working Paper v1.0-rc4, ADR-0001..0021 (including Appendix A ambiguities A1–A12 and code findings B1–B2), the PRD, and `002-context-map.md`. Each answer carries a status:

- **Answered** — the docs fix the behavior normatively.
- **Partial** — the docs fix part of the behavior; the unresolved residue is named.
- **Open [A]** — the docs explicitly do not decide this. Per the project's own method, the gap is recorded rather than filled by inference; where an ADR records a recommendation, it is quoted as a recommendation, not as a decision.

### Business Invariants and Consistency

1. What invariant prevents any code path—including imports, migrations, recall handling, and administrative tooling—from admitting persistent knowledge without the single Admission Gate?

   **Answered.** The invariant is "exactly one gate" (ADR-0011): every candidate for persistent knowledge must disassemble into calls to the existing Admission Gate — `PersistentDelta` is an envelope that unpacks into ordinary gate submissions, and any change to the gate to "accept promoted deltas" is defined as the second gate being born in disguise. The closure of side paths is explicit: `DIRECT_EDIT_FORBIDDEN` must be enforceable across the entire transport edge, not only the changeset path (ADR-0012); `EVIDENCE_REQUIRED` is a terminal refusal with no administrative flag, parameter, or maintenance-mode bypass (ADR-0017); recall itself passes the gate (`RECALL_UNPROVEN`) and rehabilitation travels the normal verification path (`REHAB_WITHOUT_PROOF`) (ADR-0013); federated imports enter as read-only foreign references frozen at import `seq`, and federated recall cascades execute locally at import, never over the network at the gate (ADR-0013, ADR-0014 rule 3). Verification is [G4]: the same `claims_candidate[]` under a hostile identity must receive an identical verdict, by host log.

2. How is "exactly one promotion edge" enforced when horizon topology changes while promotions are in flight, and what becomes of proposals based on the former DAG?

   **Partial.** The enforcement mechanism is fixed: `HORIZON_SKIP` refuses any promotion whose `target_horizon` is not the parent in the declared topology (ADR-0008), and `based_on_seq` plus crossing rule 3 catches content staleness (ADR-0010). What the docs do not define is the semantics of changing the declared DAG itself while promotions are in flight; §35 of the paper records that the criteria for a legitimate topology extension "are not written" — that residue is **Open [A]**.

3. Can a knowledge item be `admitted` while its truth ownership is `suspended`, and which capabilities remain legal for every combination of epistemic status, ownership, and relative authority?

   **Answered.** The combination cannot persist. `suspended` is a value of ownership and only ownership (ADR-0015), and propagation rule 1 (ADR-0014) requires that a claim sustained by a cell whose ownership degraded to `suspended` does not remain `admitted` — the recall cascade degrades two coordinates with two names: claim status `admitted → contested`, β-cell ownership `graph → suspended`. Legal capabilities are read off the third coordinate: completed relative authority enables exactly what the horizon's table lists and nothing more, no coordinate improves by composition, endorsement, approval, or import, and derived conclusions are governed by their worst dependency (the diamond case).

4. When an invalidating contestation is admitted, is the dependency closure calculated from the graph at discovery time, admission time, or the claimed `faulty_since_seq`, and which choice is normative?

   **Partial.** Admission time is normative: the closure `deps⁻¹(target_claims)`, transitive, is computed over the *admitted* derivation graph once the `RecallNotice` is admitted by the gate (ADR-0013). `faulty_since_seq` scopes the audit window — when unknown, the window assumes worst case since original admission (overestimate contamination, never underestimate). Residue: ambiguity A7 records as undecided whether an unknown `faulty_since_seq` widens only the audit window or also the closure itself.

5. What is the exact destination status of indirect dependents in a recall cascade, rather than merely the rule that they may not remain admitted?

   **Open [A].** Ambiguity A5 records exactly this gap: §10.1 names `contested` for the target claims, while §11 rule 1 says only that dependents "do not remain admitted", without naming their destination. The recorded recommendation — not yet normative — is uniform `contested` for the entire closure, with distance from the cause recorded in provenance, because grading status by distance would reintroduce a confidence gradient.

### Scalability and Performance

6. How will dependency closure remain bounded and observable when a recalled claim has millions of transitive dependents, without holding global locks or loading the entire graph into memory?

   **Open.** No document bounds memory, locking, or incremental processing for very large closures. What the docs do fix: the guarantee is deliberately scoped (Recall Propagation Completeness = 100% over *registered* derivation edges, with the Derivation Registration Ratio as the ceiling thermometer), the cascade must be deterministic, idempotent, and monotonic (property-based oracle, [G5], ADR-0013/0014), and ambiguity A8's recommendation limits blast radius by not cascading inside ephemeral horizons — only `STALE_BASE` at their boundaries. Cost visibility is a stated design stance ("the panel shows the fracture"), but no scalability mechanism is specified.

7. Which read models require pagination or streaming from the first release, particularly proposal queues, contestation histories, audit ledgers, and recall impact views?

   **Open.** No pagination or streaming requirement appears anywhere in the current docs. The reference implementation's read side (JSONL + derived SQLite, `history/since`) is described, but no read-model volume contract is defined for the release.

8. Does promotion validation re-check every distilled item or only the subgraph changed since `based_on_seq`, and what measurable upper bound prevents active graphs from making promotion prohibitively expensive?

   **Open [A].** Ambiguity A3 records exactly this: §7 rule 3 demands "rebase or explicit revalidation" without saying whether the target is all of `distilled[]` or only what the `seq` advance affected. The recorded recommendation — not yet normative — is revalidation by intersection: only what depends on the changed subgraph, using the §11 closure to compute the affected set. No measurable upper bound is defined.

9. How are repeated verification, coverage, and provenance lookups prevented from becoming N+1 access patterns across a large promotion batch?

   **Open.** Not addressed. The nearest fixed material is reuse of already-paid mechanisms — per-cell locks and the single monotonic `seq` (ADR-0011) — but no access-pattern or batching guidance exists.

10. What retention and compaction rules keep append-only audit, budget ledgers, refused attempts, and preserved recall scars from causing unbounded storage and query degradation?

    **Partial, mostly open.** Fixed: on destruction of an ephemeral horizon, audit preserves events and an `excluded_summary`, never content (ADR-0019); budget ledgers flow into audit at horizon close (ADR-0020); recall scars are normatively permanent — "history, not transient state" (ADR-0015) — so they are excluded from compaction by design. Open: replay and advanced retention of ephemeral horizons is explicitly [A] (§35, PRD), and no retention/compaction policy exists for the persistent append-only audit, ledgers, or refusal records.

### Security and Sensitive Data

11. Which fields in evidence, operator decisions, session references, tool outputs, and audit reasons may contain secrets or personal data, and who is authorized to read each projection?

    **Open.** No data-classification or read-authorization model exists in the docs. What exists is transport-level authentication only (tokens, credentials), which ADR-0017 explicitly distinguishes from operator identity; VS-1 is single-operator by design and multi-tenant Cognitive Plane is explicitly [A] (§35). Field-level sensitivity and projection-level read rights are undefined.

12. How are evidence anchors and external references sanitized so they cannot trigger path traversal, SSRF, injection, or unintended capability execution during verification?

    **Partial, mostly open.** The docs structurally narrow the surface rather than sanitize it: anchors are verbatim (I1), the L2 host verifies offline, and federation verifies by signed manifest and Merkle root without network — federated recall executes at import, never over the network at the gate (I9, ADR-0013). Any capability execution is confined to `CONCRETIZE` through the classified gateway, never to `VERIFY`. But no explicit sanitization requirements for anchor paths or external references are written.

13. Can a malicious client infer protected graph content from differences in refusal codes, timing, dependency counts, or recall impact responses?

    **Open.** The refusal taxonomy deliberately names the real cause (ADR-0006) and recall responses expose closure counts by design; no document analyzes the resulting inference or timing side channels. This tension — informative refusals versus information leakage — is not registered anywhere, including in the T1–T14 threat catalog.

14. What prevents replay of an `OperatorApproval` after its scope, TTL, sequence, operator identity, or underlying change contract has changed?

    **Answered.** The approval is a governed object bound on every axis the question names: `approver` (identity), `scope`, `ttl` ("old consent is not consent"), `based_on_seq`, and `provenance` (ADR-0017); irreversible actions must additionally be named in the `ChangeContract` and their authorization is single-use (ADR-0018, defaults in §14). Replay outside these bounds meets typed refusals — `SCOPE_EXCEEDED`, `APPROVAL_EXPIRED`, `APPROVAL_STALE_SEQ` — and T7 is the catalogued threat, tested in VS-1c with a scripted adversarial operator, by host log. Ambiguity A2's recommendation further scopes staleness approvals to `CONCRETIZE`, making them inapplicable to `PROMOTE` by construction.

15. How is tenant or project isolation preserved when a contestation references knowledge across horizons but must not cross an authorization boundary?

    **Open.** `seq` is monotonic per tenant [B], and federation keeps each tower sovereign over what it admits (no cross-tower authority), but no authorization model for cross-horizon contestation references is defined. Multi-tenant Cognitive Plane is explicitly out of scope for VS-1 (§35), and `CONTEST` is defined to travel any DAG edge on evidence alone (ADR-0008, ADR-0012) without an isolation rule.

### Concurrency and Failures

16. What happens when two promotions based on the same sequence are concurrently admitted and affect overlapping cells, coverage claims, or truth ownership?

    **Partial.** The mechanism is fixed and deliberately reuses paid infrastructure: `changeset_plan[]` acquires the baseline's per-cell locks — disjoint cells proceed in parallel, intersections serialize — and the first admission advances `seq`, so the second promotion is caught by crossing rule 3 as `STALE_BASE` and must rebase or revalidate; no approval can waive that (ADR-0011, ADR-0010). Residue: the locks detect syntactic collision only. Semantic conflict between concurrent transformations that touch no common cell is declared the hardest open problem of the Runtime Plane — **Open [A]** (§35, ADR-0011).

17. Is recall cascade processing atomic, resumable, or eventually consistent, and what can readers observe after the recall is admitted but before all affected ownership has been suspended?

    **Partial.** Required properties are fixed: the closure is deterministic, propagation is idempotent and monotonic (property-based oracle, [G5]), the recall advances `seq` immediately so every in-flight proposal over the subgraph becomes `STALE_BASE` with no special case, and the context map demands "idempotency, resumability, and explicit consistency guarantees" because the cascade spans contexts. A8's recommendation keeps the cascade out of ephemeral horizons. What is *not* written is the observable intermediate state: no atomicity or read-isolation contract defines what readers may see mid-cascade.

18. How are duplicate `PROMOTE`, `CONTEST`, `RECALL`, and irreversible execution requests identified across client retries and network timeouts?

    **Partial.** For capabilities: compensable tools require an idempotency key, and irreversible tools require a named single-use authorization with registration preceding execution (ADR-0018). For approvals: replay is bounded by scope/ttl/`based_on_seq` (ADR-0017). For the epistemic verbs themselves, the context map lists idempotency among Horizon Governance's investments, but no generic request-deduplication contract for retried `PROMOTE`/`CONTEST`/`RECALL` is specified — that residue is open.

19. If an irreversible capability succeeds but the audit acknowledgement fails, how does the domain distinguish "not executed" from "executed but not recorded" without unsafe repetition?

    **Answered (the ordering); partial (the procedure).** Registration precedes execution for the irreversible class precisely because of this failure asymmetry: dying between registration and effect leaves an *investigable intention* — one knows what was intended and can verify whether it happened — whereas the inverse order would leave effect without trace (ADR-0018 rule 2). The audit relationship exists "especially when execution succeeds but acknowledgement fails" (context map), and conformance must inspect audit *order*, not mere presence. The concrete reconciliation procedure — who verifies the effect and how — is not specified.

20. When a parent horizon becomes unavailable after accepting a promotion request but before returning its refusal or proposal reference, which side owns reconciliation?

    **Open.** Not addressed. The context map acknowledges that cross-horizon workflows "require additional commands, sequence checks, and reconciliation" as a consequence of the one-edge promotion decision, but assigns no reconciliation owner, and no ADR covers parent-host unavailability mid-promotion.

### Responsibility Boundaries Between Layers

21. Which component owns deterministic transition decisions when a probabilistic assessor recommends admission, readiness, or acceptance, and can any assessor invoke that transition indirectly?

    **Answered.** Hosts own epistemic lifecycles; the Router owns workflow transitions (ADR-0004). A probabilistic assessor produces only an `AuditAssessment`; the governed consequence is a separate `AuditDecision` under the horizon's protocol — "the model recommends; the structure transitions" (ADR-0005), and collapsing the two is named regression R5. Indirect invocation is closed at each boundary: `accepted` is admission in the medium horizon only and the persistent gate re-evaluates from zero (T3/T13 containment, ADR-0011); the Guardian recommends readiness while the Router verifies the three mechanical `CHANGE_READY` predicates (ADR-0016); no agent possesses a verb capable of transitioning the workflow.

22. How is protocol meaning kept out of MCP handlers, storage schemas, agent adapters, and UI projections so replacing one of them cannot change what `ADMIT` or `PROMOTE` means?

    **Answered.** The dependency direction is fixed by ADR-0001 — semantics live in the EAP, the binding only transports, and "if swapping the binding changes what ADMIT means, the protocol leaked" — and enforced structurally: Anti-Corruption Layers translate transport into EAP commands and domain state into storage operations (context map), ADR-0019 separates the normative layer (observable properties: refusals, propagation, promotion, `seq` invalidation) from the reference implementation's engine and schema choices, and the UI must render the authority coordinates as distinct materials without owning any semantics (ADR-0015, §26). Adapters declare conformance level and tool-effect classification; they never define verb meaning (§5.5).

23. Does the Workflow aggregate read authoritative epistemic state through an explicit contract, or can orchestration infer readiness from duplicated flags that may drift?

    **Answered.** Through an explicit contract. The context map fixes Published Language relationships: workflow "consumes explicit lifecycle and Relative Authority events rather than inferring readiness from duplicated flags." ADR-0004 fixes the asymmetric ownership — hosts own the lifecycles, the Router observes them and decides workflow transitions — and Appendix B guards are expressed as predicates over those observations (e.g., all WorkOrders with `AuditDecision(accepted)` ⇒ `VERIFYING → PROMOTING`). No aggregate operational state may pretend to summarize epistemic state.

24. Where is the boundary between `CONCRETIZE` as horizon-specific materialization and the Capability Gateway as external-effect enforcement, especially for actions with no external effect?

    **Answered.** `CONCRETIZE` means materializing admitted content in the form proper to each horizon — an answer in session, a hypothesis in negotiation, a composition in transformation — in all five horizons (ADR-0003's 6×5 table). The Capability Gateway is the implementation of its *external edge* only where materialization produces effect outside the OpenGraph — file, process, network — never its definition. Actions with no external effect concretize without touching the gateway at all. Where the gateway is crossed, it judges authorization and effect class, never merit, and nothing the action produces is knowledge until `VERIFY` (ADR-0018).

25. How will client conformance obligations remain independent from host conformance so an agent can never claim host-level authority through role confusion?

    **Answered.** Conformance certifies two distinct roles on separate tracks: L0–L1 certify agent clients (propose, deliberate, read refusals honestly); L2–L4 certify hosts (gate, admission, propagation). The normative sentence is unhedged: "no agent is L2, ever" (ADR-0007). Role confusion cannot manufacture host authority because agents possess no authoritative write verb (the T1 defense), every conformance item is verified by host log — self-report never counts — and capability does not buy level: an arbitrarily capable agent remains L1.

### Architecture Tip

Keep deterministic authority transitions and their invariants in an implementation-independent domain boundary; treat workflow, transport, storage, probabilistic assessment, and capability execution as explicit collaborators whose failures cannot manufacture authority.
