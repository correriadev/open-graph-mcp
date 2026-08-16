# Tactical Design — open-graph-mcp

**Domain:** `open_graph_coding_agents_plugin`  
**Project:** `open-graph-mcp`  
**Architecture:** TypeScript/Bun monorepo; pure Graph v2 core, persistent MCP host, thin client/adapters  
**Design status:** specification only; implementation is not authorized

## Product, Portable Contract, and Reference Adapter

| Layer | Owns | Must not own |
|---|---|---|
| OpenGraph product | EAP semantics, Router, WorkflowCase durability, horizon hosts, Changeset/ExecutionGrant authority, projection coverage, refusals, audit | LLM personas, Codex spawning, hook trust |
| Portable harness contract | Role duties, typed handoffs, readiness flow, adapter capability schema, degradation and recovery obligations | Gate transitions, storage internals, proprietary host syntax |
| Codex reference adapter | Installable plugin surface (`.codex-plugin/plugin.json`, skills, `.mcp.json`/MCP, optional hooks, profile templates) plus explicit verified provisioning to official agent locations | New EAP rules, silent profile overwrite, automatic agent discovery from plugin contents, canonical state in native messages |

Priority after the reference adapter is: Gemini, OpenCode, then Claude Code. These adapters must satisfy the same published schemas and conformance suite; their internal design is intentionally deferred.

**Binding Codex v1 decision — Executor cardinality:** the reference adapter permits one active Executor per Changeset. The portable contract still identifies every WorkOrder, Executor, grant, lease, and affected cell independently so later adapters can add mechanically proven parallelism without changing the authority model. Multi-Executor execution is outside this feature and must be refused or serialized; single execution is an adapter capability, not universal EAP law.

## Section 1 — Main Structure

| Element | Layer / Type | Invariants / Tech Rules | 4-line Snippet |
|---|---|---|---|
| WorkflowCase | Graph Core aggregate root | One tenant and target repository; monotonic journal position; terminal state immutable except audit annotations | `WorkflowCase { caseId, tenantId, repoRef; state, journalSeq, basedOnSeq }` |
| Negotiation | Graph Core aggregate | Readiness recommendation never changes Router state; all assumptions have owner and consequence | `Negotiation { seedRef, assumptions[]; unresolved[], recommendation? }` |
| ExecutionPlan | Portable contract | Full plan referenced by ChangeContract; contains cells, WorkOrders, tests, tools, rollback | `ExecutionPlan { affectedCells[]; workOrders[], changesetPlan; rollback }` |
| ChangesetAuthorization | MCP host aggregate | Every mapped file is covered before edit; grant cannot widen scope | `ChangesetAuthorization { csId, ownerId; scope[], grants[], version }` |
| Transformation | Graph Core aggregate | AuditAssessment and AuditDecision are distinct; accepted means medium only | `Transformation { workOrders[]; assessments[]; decisions[] }` |
| HorizonProjection | Graph Core model | Reproducible from query + base seq; omitted knowledge stays unknown | `HorizonProjection { projectionId; horizonId, basedOnSeq; query, coverage }` |
| WorkflowRouter | MCP application service | Applies statechart deterministically and idempotently; no semantic judgment | `WorkflowRouter.transition(caseId, command, expectedVersion): TransitionResult` |
| Portable Harness Package | Distribution contract | Public workflow and doctor skills; role contracts independent of host | `harness { skills[], roleContracts[]; schemas[], conformance }` |
| Codex Plugin Distribution | Plugin adapter | Loads manifest, skills, `.mcp.json`/MCP, optional hooks, and inert profile templates/resources; does not register custom agents | `codexPlugin { manifest; skills, mcpServers; hooks?, profileTemplates[] }` |
| Codex Agent Provisioning | Setup adapter | Materializes consented profiles in project `.codex/agents/` or explicitly selected user scope; conflict-safe and reversible | `provisioning { targetScope; plannedWrites[]; conflicts[], rollbackRef }` |

### Codex v1 Operational Flow

1. The installed plugin exposes the public `open-graph-workflow` and `open-graph-doctor` skills, MCP dependency/configuration, optional hooks, and inert agent-profile templates; installation alone does not make custom agents discoverable.
2. The workflow probes the four official agent profiles. Missing or conflicting profiles make readiness incomplete and create a doctor handoff before any mutation. The root can run the Doctor skill without a provisioned Doctor profile, avoiding a setup dependency cycle; when discovered, `open_graph_doctor` provides isolated read-only diagnosis.
3. Doctor/setup proposes project-scoped `.codex/agents/*.toml` by default, shows effects and rollback, obtains consent, refuses silent overwrite, materializes idempotently, and verifies Codex discovery. The root provisioning action performs approved writes; the Doctor agent stays read-only. User-scoped `~/.codex/agents/` requires an explicit operator choice.
4. Maître records intent and NegotiationSeed, then spawns the now-discoverable read-oriented `open_graph_guardian` custom agent. The root/Maître alone coordinates spawn, follow-up, wait, and completion; agents never depend on P2P messaging. Each round is persisted through MCP as typed mailbox/journal state before native delivery.
5. Guardião queries Graph v2 and returns structured deliberation. Maître records operator decisions and assembles ExecutionPlan + ChangeContract. Router alone verifies `CHANGE_READY`.
6. After readiness, Maître opens the Changeset, instantiates transformation, spawns `open_graph_intermediary`, and issues WorkOrder plus ExecutionGrant to `open_graph_executor`.
7. Executor uses a Focused Horizon Graph Projection, edits/tests within the grant, and records ArtifactBundle + PromotionProposal. Intermediador emits AuditAssessment; host applies AuditDecision.
8. `revise` creates a new mailbox round and attempt while preserving fencing. Replacement agents reattach by WorkflowCase and receive the current lease generation, journal cursor, projection or rebase obligation.
9. When all WorkOrders are accepted in transformation, PersistentDelta traverses the existing baseline gate. Only admission permits Changeset commit and WorkflowCase closure.

### Required Target MCP Surface

Codex mutation readiness requires the existing OpenGraph tools plus the following Graph v2 workflow tools. Their minimum fields, results, and refusals are normative in the [workflow protocol example](examples/codex/plugin/open-graph/skills/open-graph-workflow/references/protocol.md); an implementation must not rename them without updating schemas, examples, and conformance tests together.

| Tool | Architectural responsibility |
|---|---|
| `workflow.open`, `workflow.read` | Create/idempotently recover and hydrate the durable WorkflowCase. |
| `workflow.append` | Append typed mailbox/journal entries with optimistic cursor and idempotency. |
| `workflow.transition` | Ask the deterministic Router to apply a command against expected state; never accept an agent verdict as authority. |
| `workflow.reattach`, `workflow.rebase` | Recover participants, fence obsolete generations, reconcile repository effects, and revalidate stale bases. |
| `graph.project` | Materialize a horizon-scoped view with reproducible query, coverage, exclusions, and graph sequence. |
| `changeset.grant`, `changeset.revoke_grant` | Delegate and revoke bounded WorkOrder execution without transferring Changeset ownership. |

Current `session.register`, `graph.query`, `graph.impact`, `presence.*`, `changeset.*`, and `cognitive.*` remain available. Changeset authorization must allow a separately authenticated Executor to act only through its current grant while `extend`, `commit`, `abort`, and ownership stay with the Maître.

### Codex Hook Policy

| Hook use | Classification | Reason |
|---|---|---|
| PreToolUse advisory for mapped-file edit without current grant/Changeset | Optional reinforcement | Useful early feedback; authoritative admission must still reject an ungoverned diff. |
| SubagentStart/Stop journal correlation and lease cleanup signal | Optional automation | Improves observability and recovery; lifecycle truth remains in WorkflowCase. |
| SessionStart readiness hint and reattach discovery | Optional automation | Reduces friction but the workflow skill performs the authoritative probe. |
| Pre/PostCompact checkpoint hint | Optional automation | Helps persist decision-relevant state before compaction; correctness relies on already materialized journal entries. |
| Hook as `CHANGE_READY`, AuditDecision, persistent gate, or Changeset authority | Inadequate / prohibited | Hooks are not the Router or horizon host and cannot be the only boundary. |
| Mandatory trusted plugin hooks for base conformance | Inadequate / prohibited | A correct adapter must pass with hooks disabled; trust is an operator choice. |

**Mandatory hooks:** none in Codex v1. Canonical MCP journaling before a decision-relevant handoff is mandatory, but it is a workflow action, not a hook. Hooks may be mandatory only for an explicitly advertised optional capability such as “immediate local preflight warning,” never for Graph v2 invariants.

Raw filesystem writes are not completely mediated when hooks are disabled. The pre-edit Changeset rule is both a workflow precondition and an admission invariant: a raw unauthorized diff may physically exist, but MCP/GraphCI must classify it as ungoverned and refuse promotion/commit until explicit reconciliation. Skills prevent behavior, optional hooks reinforce supported tool calls, and MCP plus the persistent gate own authority.

### Codex Artifact Examples

These examples are stored under `docs/specs` and are intentionally inert. They define the expected implementation shape without being auto-discovered as an installed plugin or project agent.

| Artifact | Normative example |
|---|---|
| Plugin manifest and MCP declaration | [plugin.json](examples/codex/plugin/open-graph/.codex-plugin/plugin.json), [.mcp.json](examples/codex/plugin/open-graph/.mcp.json) |
| Maître workflow skill | [open-graph-workflow/SKILL.md](examples/codex/plugin/open-graph/skills/open-graph-workflow/SKILL.md) |
| Separate Doctor skill | [open-graph-doctor/SKILL.md](examples/codex/plugin/open-graph/skills/open-graph-doctor/SKILL.md) |
| Client-facing protocol/readiness references | [protocol.md](examples/codex/plugin/open-graph/skills/open-graph-workflow/references/protocol.md), [readiness.md](examples/codex/plugin/open-graph/skills/open-graph-doctor/references/readiness.md) |
| Guardião custom agent | [open-graph-guardian.toml](examples/codex/project/.codex/agents/open-graph-guardian.toml) |
| Intermediador custom agent | [open-graph-intermediary.toml](examples/codex/project/.codex/agents/open-graph-intermediary.toml) |
| Executor custom agent | [open-graph-executor.toml](examples/codex/project/.codex/agents/open-graph-executor.toml) |
| Doctor custom agent | [open-graph-doctor.toml](examples/codex/project/.codex/agents/open-graph-doctor.toml) |

The root Codex conversation is the Maître and therefore has no custom-agent file. The plugin ships the four agent definitions only as inert templates; explicit, consented provisioning places them in an official project or user agent directory. [Implementation Handoff](005-implementation-handoff.md) fixes source order, authority boundaries, sequencing, and definition of done.

## Section 2 — Value Objects / Types / Interfaces

| Name | Context / Layer | Validation & Typing Rules | 4-line Snippet |
|---|---|---|---|
| WorkflowCaseId | Graph Core | Non-empty opaque identifier, tenant scoped | `type WorkflowCaseId = Branded<string, 'WorkflowCaseId'>` |
| JournalCursor | Graph Core | Non-negative monotonic sequence within one case | `JournalCursor { caseId; seq: uint64 }` |
| MailboxEnvelope | Portable contract | Typed sender/recipient role, payload schema, causal refs, idempotency key | `MailboxEnvelope<T> { from, to; payload: T; causationRef, idempotencyKey }` |
| ExecutionGrant | Graph Core | Bound to csId, executor identity, WorkOrder, scope, expiry, and lease generation | `ExecutionGrant { grantId, csId; executorId, workOrderId; scope[], generation, expiresAt }` |
| LeaseGeneration | Graph Core | Positive monotonic integer; lower generation is fenced | `type LeaseGeneration = Branded<number, 'LeaseGeneration'>` |
| ProjectionDescriptor | Graph Core | Declares horizon, base seq, roots, depth/budget, coverage, exclusions | `ProjectionDescriptor { horizonId, basedOnSeq; roots[], limits; coverage, exclusions[] }` |
| CapabilityProfile | Portable contract | Versioned claims with demonstrated/absent/degraded state and evidence | `CapabilityProfile { adapterId, contractVersion; capabilities: CapabilityClaim[] }` |
| ReadinessReport | Portable contract | Objective checks only; remediation and restart requirement explicit | `ReadinessReport { caseRef?; checks[]; ready, restartRequired; remediation[] }` |
| AgentBinding | Host adaptation | Maps portable role to host artifact without changing role authority | `AgentBinding { role; artifactRef; isolation, permissions, deliveryMode }` |
| CodexHookPolicy | Codex adapter | Each hook states optional capability and authoritative fallback | `CodexHookPolicy { event; reinforcement; fallbackAuthority; required: false }` |

## Section 3 — Domain Services / Use Cases / Actions

| Operation / Hook | Responsibility | Coordinates / Subscriptions | 4-line Snippet |
|---|---|---|---|
| ProbeWorkflowReadiness | Detect Graph v2, tenant, repository, identity, MCP, and adapter readiness | Doctor, MCP resources, CapabilityProfile | `probe(caseHint): ReadinessReport` |
| InitiateNegotiation | Create governed negotiation from session context without authority inheritance | WorkflowCase, NegotiationSeed, horizon host | `initiate(seed): NegotiationRef` |
| RecordMailboxEntry | Persist decision-relevant handoff before or with native delivery | WorkflowCase, mailbox store, adapter receipt | `record(envelope, expectedCursor): JournalCursor` |
| VerifyChangeReady | Evaluate only the triple predicate and expected sequence | Negotiation, approvals, Router | `verify(caseId, expectedVersion): TransitionResult` |
| OpenGovernedChangeset | Open scope for all planned mapped cells before editing | ExecutionPlan, Changeset service | `open(caseId, changesetPlan): ChangesetRef` |
| IssueExecutionGrant | Delegate bounded execution without ownership transfer | Changeset, WorkOrder, agent registry | `grant(csId, workOrderId, executorId): ExecutionGrant` |
| BuildFocusedProjection | Produce governed task context with explicit coverage | graph query, horizon store, sequence | `project(descriptor): FocusedGraphView` |
| ApplyAuditDecision | Apply governed result using assessment reference and current attempt | Transformation, Router, budget ledger | `decide(assessmentRef, expectedVersion): AuditDecision` |
| ReattachWorkflowParticipant | Fence obsolete worker and resume from journal/projection state | WorkflowCase, lease service, adapter | `reattach(caseId, role, priorGeneration?): RecoveryBundle` |
| RebaseWorkflowCase | Recompute affected evidence/projections after persistent seq advance | graph query, contracts, Router | `rebase(caseId, targetSeq): RebaseResult` |
| ValidateAdapterConformance | Exercise portable capability claims without server flavor branches | Adapter kit, fixtures, logs | `validate(profile, fixtureSet): ConformanceReport` |
| ProvisionCodexAgentProfiles | Plan, consent, materialize, verify, and roll back official Codex agent profiles | Doctor, templates, target repository or chosen user scope | `provision(plan, consent): ProvisioningReport` |

## Section 4 — Events / Messages / Async Flows

| Event / Action Name | Trigger | Minimum Payload | Consumers |
|---|---|---|---|
| WorkflowCaseOpened | Intent accepted | `caseId, tenantId, repoRef, basedOnSeq` | Maître, Router |
| DoctorHandoffRequested | Readiness check fails objectively | `caseId, failedChecks, adapterId` | Doctor adapter |
| MailboxEntryRecorded | Governed handoff accepted | `caseId, journalSeq, envelopeRef` | Recipient role, audit |
| ChangeReadyRecommended | Guardião completes deliberation | `caseId, negotiationRef, recommendationRef` | Router, Maître |
| ChangeReadyVerified | Router triple predicate succeeds | `caseId, contractRef, transitionVersion` | Maître, transformation host |
| ExecutionGrantIssued | WorkOrder assigned to an Executor | `grantId, csId, workOrderId, executorId, generation` | Executor, gateway |
| HorizonProjectionCreated | Focused view materialized | `projectionId, horizonId, basedOnSeq, coverage` | Intermediador or Executor |
| LeaseGenerationAdvanced | Worker replaced or lease recovered | `caseId, role, generation, fencedAgentId?` | Gateway, adapter, audit |
| ArtifactBundleProposed | Executor completes an attempt | `workOrderId, attempt, bundleRef, proposalRef` | Intermediador, transformation host |
| AuditAssessmentRecorded | Intermediador submits judgment | `workOrderId, assessmentRef, reasonsRef` | Transformation host |
| AuditDecisionApplied | Host resolves assessment | `workOrderId, assessmentRef, outcome, obligations[]` | Router, Executor, Maître |
| WorkflowCaseRebased | Persistent seq changes relevant evidence | `caseId, oldSeq, newSeq, invalidatedRefs[]` | All active roles |
| WorkflowCaseClosed | Terminal transition succeeds | `caseId, outcome, excludedSummary, finalSeq?` | Operator, audit |

## Section 5 — Persistence / Repository / Data Access Interfaces

| Resource / Adapter | Methods / Actions | Return Types / Expected State |
|---|---|---|
| WorkflowCaseRepository | create, get, appendJournal, compareAndTransition, close | Versioned WorkflowCase; atomic cursor/state updates |
| MailboxRepository | enqueue, acknowledge, listSince | Ordered envelopes; stable cursor; idempotent enqueue |
| ExecutionGrantRepository | issue, resolveCurrent, revoke, advanceGeneration | Current grant or typed refusal; fenced old generations |
| HorizonProjectionRepository | create, get, invalidateBySeq | Reproducible view and explicit invalidation status |
| ChangesetPort | open, extend, authorizeGrant, commit, abort | Existing Changeset semantics plus scoped delegation |
| GraphV2QueryPort | query, impact, coverage, historySince | Three-valued impact and paginated governed evidence |
| HostAdapter | detectCapabilities, bindRole, deliver, awaitReceipt, recover | CapabilityProfile, DeliveryReceipt, RecoveryBundle |
| CodexAdapter | loadPlugin, planProfileProvisioning, verifyDiscovery, dispatchSubagent, optionalHookReceipt | Portable results; installation and profile provisioning remain distinct |
| ConformanceFixturePort | enumerateFixtures, execute, collectHostLog | Adapter-independent ConformanceReport |

## Section 6 — Ordered Development Tasks
```json
[
  {
    "id": "01",
    "title": "Define Portable Harness Schemas",
    "description": "Specify versioned role, mailbox, readiness, capability, and recovery contracts shared by every host adapter.",
    "scope": ["portable contract schemas", "schema validation tests", "contract version manifest"],
    "acceptance": ["All schemas reject missing provenance and identity fields", "Contracts contain no Codex-specific syntax"],
    "depends_on": null
  },
  {
    "id": "02",
    "title": "Model WorkflowCase Aggregate",
    "description": "Create the durable case lifecycle and monotonic journal invariants used across disposable agents.",
    "scope": ["WorkflowCase aggregate", "workflow transition types", "aggregate unit tests"],
    "acceptance": ["Invalid and duplicate transitions are refused deterministically", "Terminal cases cannot resume without a new case"],
    "depends_on": "01"
  },
  {
    "id": "03",
    "title": "Persist WorkflowCase Journal",
    "description": "Add atomic case storage and ordered typed mailbox entries with stable replay cursors.",
    "scope": ["WorkflowCaseRepository", "MailboxRepository", "SQLite migrations", "repository integration tests"],
    "acceptance": ["Concurrent appends produce one total order", "Idempotency keys prevent duplicate handoffs", "Replay from a cursor returns no gaps"],
    "depends_on": "02"
  },
  {
    "id": "04",
    "title": "Implement Deterministic Workflow Router",
    "description": "Apply Graph v2 workflow transitions and the CHANGE_READY triple predicate without semantic judgment.",
    "scope": ["WorkflowRouter service", "readiness predicate", "Router contract tests"],
    "acceptance": ["Hostile readiness recommendations cannot bypass any predicate", "Repeated commands are idempotent or explicitly refused"],
    "depends_on": "03"
  },
  {
    "id": "05",
    "title": "Add Focused Horizon Projections",
    "description": "Build reproducible transformation and microtask graph views with explicit coverage and sequence bases.",
    "scope": ["ProjectionDescriptor", "projection service", "projection repository", "projection tests"],
    "acceptance": ["Truncation is never reported as known-zero", "Sequence advance invalidates affected projections"],
    "depends_on": "04"
  },
  {
    "id": "06",
    "title": "Add ExecutionGrant Authorization",
    "description": "Delegate bounded use of a Maître-owned Changeset to a separately identified Executor.",
    "scope": ["ExecutionGrant model", "grant repository", "Changeset authorization service", "authorization tests"],
    "acceptance": ["Grant scope cannot exceed Changeset and WorkOrder intersection", "Executor cannot commit or transfer ownership", "Expired grants are refused"],
    "depends_on": "04"
  },
  {
    "id": "07",
    "title": "Implement Lease Fencing Recovery",
    "description": "Advance lease generations and reconstruct participant state after crash, replacement, or compaction.",
    "scope": ["lease generation service", "RecoveryBundle", "reattach use case", "recovery tests"],
    "acceptance": ["Superseded generations cannot mutate", "Reattach returns journal cursor and rebase obligations", "Duplicate effects are detected"],
    "depends_on": "06"
  },
  {
    "id": "08",
    "title": "Integrate Audit Decision Flow",
    "description": "Keep probabilistic AuditAssessment separate from host-owned AuditDecision across revise and accept loops.",
    "scope": ["Transformation aggregate", "audit application service", "audit integration tests"],
    "acceptance": ["Assessment alone changes no authority", "Accepted work remains confined to transformation", "Attempt exhaustion escalates and never promotes"],
    "depends_on": "07"
  },
  {
    "id": "09",
    "title": "Integrate Persistent Delta Closure",
    "description": "Route completed transformation output through the unchanged baseline persistent gate before Changeset commit.",
    "scope": ["PersistentDelta coordinator", "baseline gate adapter", "WorkflowCase closure", "end-to-end integration tests"],
    "acceptance": ["No audited-content fast path exists", "Stale base requires rebase or revalidation", "Commit occurs only after admission"],
    "depends_on": "08"
  },
  {
    "id": "10",
    "title": "Build Adapter Conformance Kit",
    "description": "Verify capability claims, target MCP discovery, degradation behavior, canonical mailbox state, and absence of host-specific server semantics.",
    "scope": ["adapter fixture suite", "CapabilityProfile validator", "target tool discovery assertions", "conformance report"],
    "acceptance": ["Adapters pass core scenarios with native messaging disabled", "Unsupported or missing target tools keep mutation readiness false", "Server behavior has no adapter-name branch"],
    "depends_on": "09"
  },
  {
    "id": "11",
    "title": "Package Codex Plugin Distribution",
    "description": "Package the public Maître workflow, separate doctor skill, MCP dependency, and inert profile templates from the normative examples without claiming agent registration.",
    "scope": [".codex-plugin/plugin.json and .mcp.json", "two skill directories and references", "four inert profile templates", "plugin validation tests"],
    "acceptance": ["Package validates against the Codex plugin and skill formats", "Objective readiness failure hands off to doctor while healthy flow does not", "No skill or template claims gate authority"],
    "depends_on": "10"
  },
  {
    "id": "12",
    "title": "Provision Codex Agent Profiles",
    "description": "Use doctor/setup to materialize four profile templates into an explicitly chosen official Codex agent scope with consent and rollback.",
    "scope": ["Codex profile templates", "profile provisioning service", "provisioning receipt", "provisioning tests"],
    "acceptance": ["Repeated identical provisioning is idempotent", "Conflicting user profiles are never overwritten silently", "Discovery and role isolation are verified before readiness"],
    "depends_on": "11"
  },
  {
    "id": "13",
    "title": "Implement Codex Dispatch Mapping",
    "description": "Map spawn, follow-up, wait, and recovery behavior to governed mailbox entries and WorkflowCase state.",
    "scope": ["Codex adapter dispatcher", "delivery receipt mapper", "recovery adapter", "adapter integration tests"],
    "acceptance": ["Governed handoff exists even when native delivery fails", "Late subagent results cannot overwrite a newer round"],
    "depends_on": "12"
  },
  {
    "id": "14",
    "title": "Add Optional Codex Hook Guardrails",
    "description": "Provide trusted optional hook automation for preflight warnings and lifecycle correlation without correctness dependence.",
    "scope": ["Codex hook policy", "optional hook scripts", "hook-disabled conformance tests"],
    "acceptance": ["Base conformance passes with hooks disabled", "Hook refusal never substitutes for MCP audit", "Hook output contains no sensitive fields"],
    "depends_on": "13"
  },
  {
    "id": "15",
    "title": "Publish Codex Reference Conformance",
    "description": "Run the complete reference flow and publish evidence separating product, portable contract, and Codex adapter behavior.",
    "scope": ["Codex conformance fixture", "workflow recovery fixture", "conformance evidence report"],
    "acceptance": ["Happy path and crash recovery pass", "Host logs prove agents never hosted gates", "Server contains no Codex flavor branch"],
    "depends_on": "14"
  },
  {
    "id": "16",
    "title": "Specify Subsequent Adapter Compatibility",
    "description": "Document compatibility gates for Gemini, OpenCode, and Claude Code without designing proprietary implementations.",
    "scope": ["adapter compatibility matrix", "degradation policy", "future adapter fixture manifest"],
    "acceptance": ["Priority order is Gemini, OpenCode, Claude Code", "Every adapter target maps to the same portable capabilities"],
    "depends_on": "15"
  }
]
```
