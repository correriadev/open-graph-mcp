# Test Scenarios — open-graph-mcp

**Domain:** `open_graph_coding_agents_plugin`  
**Project:** open-graph-mcp  
**Framework:** Bun Test for unit/integration/contracts; adapter conformance fixtures for host workflows  
**Date:** 2026-08-16

Every scenario cites its source element or operation in `003-open-graph-mcp-tactical-design.md`.

## Section 1 — Unit Tests

### 1.1 Aggregates and Aggregate Roots

#### Should create WorkflowCase when tenant, repository, sequence, and intent are valid

**Trace:** Section 1 `WorkflowCase`; Section 3 `ProbeWorkflowReadiness`.  
**Given:** a ready Graph v2 tenant, target repository, current `basedOnSeq`, and recorded operator intent  
**When:** Maître opens a WorkflowCase  
**Then:** the case starts with one tenant, one repository, a monotonic journal cursor, and no authority outside session

#### Should reject WorkflowCase transition when expected version is stale

**Trace:** Section 1 `WorkflowCase`; Section 3 `VerifyChangeReady`.  
**Given:** a WorkflowCase whose state version advanced after a caller read it  
**When:** the caller requests a transition using the old version  
**Then:** the Router returns a typed stale-version refusal and appends no transition

#### Should keep closed WorkflowCase terminal when a participant reattaches

**Trace:** Section 1 `WorkflowCase`; Section 3 `ReattachWorkflowParticipant`.  
**Given:** a WorkflowCase closed with its excluded_summary  
**When:** a replacement Executor requests reattachment  
**Then:** reattachment is refused and no lease generation is issued

#### Should reject Change Readiness when any assumption lacks owner or consequence

**Trace:** Section 1 `Negotiation`; Section 3 `VerifyChangeReady`.  
**Given:** a Guardião recommendation containing an assumption without owner or consequence  
**When:** the Router evaluates `CHANGE_READY`  
**Then:** the WorkflowCase remains negotiating with a predicate-specific refusal

#### Should reject Change Readiness when unresolved evidence lacks scoped OperatorApproval

**Trace:** Section 1 `Negotiation`; Section 3 `VerifyChangeReady`.  
**Given:** a negotiation with one unresolved item and no valid approval  
**When:** a hostile Guardião recommends readiness  
**Then:** the Router refuses the transition regardless of the recommendation

#### Should admit AuditDecision accepted only into Transformation

**Trace:** Section 1 `Transformation`; Section 3 `ApplyAuditDecision`.  
**Given:** a current WorkOrder proposal and referenced positive AuditAssessment  
**When:** the transformation host applies `AuditDecision(accepted)`  
**Then:** the proposal is admitted in transformation and persistent authority remains unchanged

#### Should escalate Transformation when attempt budget is exhausted

**Trace:** Section 1 `Transformation`; Section 3 `ApplyAuditDecision`.  
**Given:** a WorkOrder at its configured final attempt  
**When:** the host applies `AuditDecision(revise)`  
**Then:** the WorkflowCase enters governed escalation and no PersistentDelta is formed

### 1.2 Value Objects and Contracts

#### Should reject ExecutionGrant when granted scope exceeds Changeset scope

**Trace:** Section 2 `ExecutionGrant`; Section 3 `IssueExecutionGrant`.  
**Given:** a Changeset covering cells A and B and a WorkOrder requesting cell C  
**When:** Maître requests an ExecutionGrant containing A and C  
**Then:** authorization is refused without widening the Changeset

#### Should reject ExecutionGrant when Executor identity differs from the named grantee

**Trace:** Section 2 `ExecutionGrant`; Section 3 `IssueExecutionGrant`.  
**Given:** a valid grant for Executor E1  
**When:** Executor E2 attempts a mapped-file effect using that grant  
**Then:** the gateway returns an authorization refusal and records the attempted identity

#### Should fence obsolete Lease Generation when replacement Executor attaches

**Trace:** Section 2 `LeaseGeneration`; Section 3 `ReattachWorkflowParticipant`.  
**Given:** Executor E1 holds generation 4  
**When:** recovery issues generation 5 to Executor E2  
**Then:** every later mutation from generation 4 is refused

#### Should preserve unknown coverage when Focused Horizon Graph Projection is truncated

**Trace:** Section 2 `ProjectionDescriptor`; Section 3 `BuildFocusedProjection`.  
**Given:** a projection budget that stops traversal before all reachable nodes are evaluated  
**When:** the projection coverage is computed  
**Then:** omitted impact is `unknown` and never `known-zero`

#### Should consider duplicate Mailbox Envelope idempotent when key and payload match

**Trace:** Section 2 `MailboxEnvelope`; Section 3 `RecordMailboxEntry`.  
**Given:** one admitted envelope with a stable idempotency key  
**When:** Maître retries the same envelope after uncertain delivery  
**Then:** the journal returns the original cursor and adds no duplicate handoff

#### Should reject Mailbox Envelope when causal reference is missing

**Trace:** Section 2 `MailboxEnvelope`; Section 3 `RecordMailboxEntry`.  
**Given:** a decision-relevant Guardião response without a NegotiationSeed or prior-round reference  
**When:** Maître records the response  
**Then:** schema validation rejects it before native delivery influences workflow state

#### Should report Codex hooks as optional and fallback authority as MCP

**Trace:** Section 2 `CodexHookPolicy`; Codex Hook Policy table.  
**Given:** a Codex HookPolicy for PreToolUse, SubagentStop, or PreCompact  
**When:** the policy is validated  
**Then:** `required` is false and `fallbackAuthority` identifies MCP/Router behavior

#### Should validate every Codex custom-agent example against the official profile shape

**Trace:** Codex Artifact Examples; Section 2 `AgentBinding`.  
**Given:** the Guardião, Intermediador, Executor, and Doctor TOML examples  
**When:** the Codex profile validator loads them  
**Then:** each has `name`, `description`, and `developer_instructions`, the three non-writing roles are read-only, and only Executor requests workspace write

#### Should validate both Codex skill examples and their referenced files

**Trace:** Codex Artifact Examples; Section 1 `Portable Harness Package`.  
**Given:** the `open-graph-workflow` and `open-graph-doctor` example directories  
**When:** Codex skill validation and local-link validation run  
**Then:** both frontmatters are valid, every referenced file exists, and neither skill claims Router or gate authority

### 1.3 Domain Services

#### Should request Doctor Handoff when objective readiness fails

**Trace:** Section 3 `ProbeWorkflowReadiness`.  
**Given:** MCP is reachable but Graph v2 tenant identity is incompatible  
**When:** the workflow probes readiness  
**Then:** it records DoctorHandoffRequested and does not begin negotiation

#### Should keep mutation readiness false when the target MCP surface is incomplete

**Trace:** Required Target MCP Surface; Section 3 `ProbeWorkflowReadiness`.  
**Given:** MCP is reachable but one of `workflow.open`, `workflow.read`, `workflow.append`, `workflow.transition`, `workflow.reattach`, `workflow.rebase`, `graph.project`, `changeset.grant`, or `changeset.revoke_grant` is absent or incompatible  
**When:** Doctor compares tool discovery with the supported contract version  
**Then:** it reports `SERVER_UPGRADE_REQUIRED`, dispatches no implementation role, and creates no prompt-only substitute for durable state

#### Should avoid Doctor Handoff when objective readiness succeeds

**Trace:** Section 3 `ProbeWorkflowReadiness`.  
**Given:** MCP, identity, tenant, repository, Graph v2, and adapter profile are healthy  
**When:** the workflow probes readiness  
**Then:** it proceeds to intent recording without invoking doctor

#### Should keep readiness incomplete when plugin is installed without Codex agent profiles

**Trace:** Codex v1 Operational Flow steps 1–3; Section 3 `ProvisionCodexAgentProfiles`.  
**Given:** the plugin skills, MCP configuration, and optional hooks are installed but no official Codex agent profile exists  
**When:** the workflow probes readiness  
**Then:** it records a doctor handoff, opens no Changeset, dispatches no implementation role, and performs no source mutation

#### Should provision identical Codex agent profiles idempotently

**Trace:** Section 3 `ProvisionCodexAgentProfiles`; Section 5 `CodexAdapter`.  
**Given:** the operator consented to project-scoped profiles and identical files already exist in `.codex/agents/`  
**When:** doctor repeats provisioning  
**Then:** no file content changes, the receipt reports existing matches, and discovery is verified

#### Should refuse silent overwrite of conflicting Codex agent profile

**Trace:** Section 3 `ProvisionCodexAgentProfiles`; Section 5 `CodexAdapter`.  
**Given:** a user-authored project profile conflicts with the supplied Guardião template  
**When:** doctor plans provisioning  
**Then:** readiness stays incomplete until the operator explicitly resolves the conflict, and a rollback-safe plan records no overwrite

#### Should reject adapter conformance when capability lacks evidence

**Trace:** Section 3 `ValidateAdapterConformance`.  
**Given:** an adapter declares isolated agents but supplies no exercised fixture or host-log evidence  
**When:** conformance validates its CapabilityProfile  
**Then:** the capability is rejected rather than assumed

### 1.4 Domain Events

#### Should keep AuditAssessment immutable after AuditDecision references it

**Trace:** Section 4 `AuditAssessmentRecorded`, `AuditDecisionApplied`.  
**Given:** a recorded AuditAssessment referenced by an applied AuditDecision  
**When:** any participant attempts to mutate its reasons  
**Then:** mutation is refused and the original assessment remains auditable

#### Should include fenced identity in Lease Generation Advanced when replacing an active worker

**Trace:** Section 4 `LeaseGenerationAdvanced`.  
**Given:** an active Executor is replaced during recovery  
**When:** lease generation advances  
**Then:** the event contains case, role, new generation, and fenced agent identity

## Section 2 — Integration Tests

### 2.1 Repositories

#### Should append concurrent Mailbox Entries in one total order

**Trace:** Section 5 `WorkflowCaseRepository`, `MailboxRepository`.  
**Given:** Maître records an operator decision while Guardião completion arrives  
**When:** both append against the same journal cursor  
**Then:** one append wins, the other retries explicitly, and replay has no gap or overwrite

#### Should rollback WorkflowCase transition when journal append fails

**Trace:** Section 5 `WorkflowCaseRepository`.  
**Given:** a valid Router transition and an injected SQLite failure during its audit append  
**When:** compare-and-transition runs  
**Then:** neither state nor cursor changes

#### Should invalidate affected Horizon Projections when persistent sequence advances

**Trace:** Section 5 `HorizonProjectionRepository`; Section 3 `RebaseWorkflowCase`.  
**Given:** transformation and microtask projections based on sequence 4102  
**When:** relevant persistent evidence advances to 4103  
**Then:** affected projections are marked stale and remain readable for audit

#### Should keep projection and impact results bounded on a one-million-node fixture

**Trace:** Section 1 `HorizonProjection`; Section 3 `BuildFocusedProjection`; Section 5 `GraphV2QueryPort`.  
**Given:** a deterministic graph fixture containing one million nodes and impact wider than one response page  
**When:** a horizon projection and impact traversal run with declared budgets and stable cursors  
**Then:** every page stays within its limit, truncation remains `unknown` rather than `known-zero`, replay has no gaps/duplicates, and timing is recorded without asserting an unapproved latency SLO

#### Should retain current ExecutionGrant across native messaging outage

**Trace:** Section 5 `ExecutionGrantRepository`, `HostAdapter`.  
**Given:** a grant is committed before Codex subagent delivery  
**When:** native delivery fails  
**Then:** the grant and mailbox entry remain canonical and recovery may redeliver idempotently

#### Should authorize delegated claim only for the current Executor grant

**Trace:** Required Target MCP Surface; Section 5 `ChangesetPort`; Section 3 `IssueExecutionGrant`.  
**Given:** Maître owns a Changeset and Executor E1 holds its current bounded grant  
**When:** E1 claims a covered WorkOrder cell and then attempts `extend`, `commit`, or `abort`  
**Then:** the covered claim is authorized while every owner-only operation is refused without ownership transfer

### 2.2 Use Cases

#### Should execute Maître to Guardião round without peer-to-peer dependency

**Trace:** Codex v1 Operational Flow steps 4–5; Section 3 `RecordMailboxEntry`.  
**Given:** Codex root acts as Maître and a Guardião custom agent is available  
**When:** Maître spawns, follows up, waits, and receives the result  
**Then:** each canonical handoff is recorded through MCP and no agent-to-agent P2P channel is required

#### Should recover crash before Executor edits without repository effects

**Trace:** Section 3 `ReattachWorkflowParticipant`; Section 4 `LeaseGenerationAdvanced`.  
**Given:** Executor E1 crashes after receiving a WorkOrder but before its first edit  
**When:** E2 reattaches with a new generation  
**Then:** E2 resumes from the mailbox and projection while the repository remains unchanged

#### Should recover crash after edit but before evidence by reconciling repository state

**Trace:** Section 3 `ReattachWorkflowParticipant`; Section 3 `RebaseWorkflowCase`.  
**Given:** E1 edited an authorized file and crashed before ArtifactBundle evidence  
**When:** E2 reattaches  
**Then:** recovery detects the existing diff, fences E1, requires evidence reconciliation, and does not repeat the edit blindly

#### Should recover crash after evidence without duplicating ArtifactBundle

**Trace:** Section 3 `RecordMailboxEntry`; Section 3 `ReattachWorkflowParticipant`.  
**Given:** ArtifactBundle and PromotionProposal were journaled before E1 crashed  
**When:** E2 reattaches and native delivery is replayed  
**Then:** idempotency returns the existing proposal and transformation evaluates it once

#### Should require rebase when STALE_BASE arises before PersistentDelta admission

**Trace:** Section 3 `RebaseWorkflowCase`; Section 3 `ApplyAuditDecision`.  
**Given:** all WorkOrders were accepted on sequence 4102 and persistent state is now 4103  
**When:** transformation proposes PersistentDelta  
**Then:** promotion is refused until affected evidence, contracts, and projections are rebased or explicitly revalidated

#### Should require Changeset extension before editing newly discovered mapped cell

**Trace:** Section 3 `OpenGovernedChangeset`; Section 3 `IssueExecutionGrant`.  
**Given:** Executor discovers mapped cell C outside its grant and Changeset  
**When:** it attempts to edit C  
**Then:** the effect is refused and a governed scope-change request is recorded

#### Should refuse admission of raw ungoverned diff when hooks are disabled

**Trace:** Codex Hook Policy enforcement paragraph; Section 1 `ChangesetAuthorization`.  
**Given:** a mapped file was physically changed without a covering Changeset and ExecutionGrant while optional hooks were disabled  
**When:** the workflow reconciles the repository or requests persistent admission  
**Then:** the diff is classified ungoverned, no promotion or commit is admitted, and recovery requires explicit reconciliation

#### Should keep AuditAssessment separate from host AuditDecision

**Trace:** Section 3 `ApplyAuditDecision`; Section 4 audit events.  
**Given:** Intermediador records a positive assessment  
**When:** the host has not applied a decision  
**Then:** WorkflowCase state and transformation authority do not advance

#### Should pass Codex adapter conformance with hooks disabled

**Trace:** Codex Hook Policy; Section 3 `ValidateAdapterConformance`.  
**Given:** SessionStart, PreToolUse, PostToolUse, compact, and subagent hooks are disabled  
**When:** the Codex reference workflow executes its conformance fixture  
**Then:** Router, MCP journal, grants, refusals, audit, and recovery remain correct

#### Should refuse unsafe multi-Executor mode in the Codex v1 profile

**Trace:** Binding Codex v1 decision — Executor cardinality; Section 2 `CapabilityProfile`.  
**Given:** the Codex profile declares conservative single-active-Executor operation  
**When:** Maître requests two simultaneous Executor grants for one Changeset  
**Then:** the adapter refuses or serializes according to declared capability without calling single execution an EAP invariant

### 2.3 External Integrations

#### Should protect portable contracts from malformed Codex delivery response

**Trace:** Section 5 `CodexAdapter`, `HostAdapter`.  
**Given:** Codex native delivery returns an unknown status or omits its recipient identity  
**When:** the adapter translates the response  
**Then:** it returns a typed delivery failure while canonical MCP state remains intact

#### Should classify unavailable host isolation as degraded capability

**Trace:** Section 2 `CapabilityProfile`; Section 3 `ValidateAdapterConformance`.  
**Given:** a future Gemini, OpenCode, or Claude Code adapter cannot demonstrate role isolation  
**When:** its profile is validated  
**Then:** isolation is marked degraded or absent and mutation behavior follows the portable degradation policy

#### Should keep OpenGraph server free of adapter flavor branches

**Trace:** Product, Portable Contract, and Reference Adapter table; Section 3 `ValidateAdapterConformance`.  
**Given:** Codex and a synthetic second adapter run the same fixture  
**When:** host logs and server behavior are compared  
**Then:** identical portable inputs yield identical governed decisions without adapter-name conditionals

## Section 3 — Functional Tests

### 3.1 Happy Path Flows

#### Should complete governed Codex change when all horizons admit their inputs

**Trace:** Codex v1 Operational Flow steps 1–9; Sections 3–5.  
**Given:** an installed Codex plugin, four explicitly provisioned and discovery-verified project agent profiles, healthy MCP/Graph v2 tenant, and one authorized WorkOrder  
**When:** Maître negotiates with Guardião, Router verifies readiness, Maître opens Changeset, Executor edits/tests, Intermediador assesses, hosts decide, and PersistentDelta reaches the baseline gate  
**Then:** the Changeset commits only after persistent admission, sequence advances, and WorkflowCase closes with audit and excluded_summary

#### Should execute the published examples without hidden prompt-only state

**Trace:** Codex Artifact Examples; Required Target MCP Surface; Codex v1 Operational Flow.  
**Given:** the example plugin is packaged, four example profiles are explicitly provisioned, and the complete target MCP surface is available  
**When:** the hooks-off reference fixture executes one governed change  
**Then:** all authority-relevant state can be reconstructed from MCP artifacts and repository evidence without relying on private chat memory

#### Should resume governed Codex change after main session compaction

**Trace:** Codex Hook Policy; Section 3 `ReattachWorkflowParticipant`.  
**Given:** all decision-relevant state is in MCP and the Maître context is compacted  
**When:** Maître resumes using WorkflowCase id and journal cursor  
**Then:** it reconstructs current state without treating compacted text or hook output as canonical memory

#### Should revise Executor work through root-coordinated follow-up

**Trace:** Codex v1 Operational Flow step 8; Section 3 `ApplyAuditDecision`.  
**Given:** Intermediador assessment causes `AuditDecision(revise)` with budget remaining  
**When:** root/Maître records the new round and follows up with Executor  
**Then:** Executor receives typed reasons, current grant/generation, and produces a new attempt without P2P dependency

### 3.2 Alternative and Error Flows

#### Should refuse direct persistent promotion from Microtask

**Trace:** Section 1 `Transformation`; Section 3 `ApplyAuditDecision`.  
**Given:** an Executor has a valid ArtifactBundle  
**When:** it attempts to submit directly to the persistent horizon  
**Then:** the host returns `HORIZON_SKIP` and persistent state remains unchanged

#### Should refuse mapped-file edit when Changeset is absent even with no contention

**Trace:** Section 1 `ChangesetAuthorization`; Section 3 `OpenGovernedChangeset`.  
**Given:** no other participant is present and the target file is graph-mapped  
**When:** Executor attempts the edit without an open Changeset and grant  
**Then:** the effect is refused and absence of locks does not weaken the invariant

#### Should abort safely when doctor requires Codex restart

**Trace:** Section 2 `ReadinessReport`; Section 3 `ProbeWorkflowReadiness`.  
**Given:** doctor remediation updates MCP configuration and reports restart required  
**When:** the active Codex session cannot reload the dependency safely  
**Then:** the case records the remediation, performs no mutation, and instructs restart plus explicit resume

#### Should ignore late Guardião result from superseded negotiation round

**Trace:** Section 2 `MailboxEnvelope`; Section 3 `RecordMailboxEntry`.  
**Given:** negotiation round 8 superseded round 7  
**When:** native delivery returns the delayed round-7 result  
**Then:** the causal reference prevents it from replacing round 8 while preserving it in audit

### 3.3 Security Scenarios

#### Should reject prompt-injected Guardião attempt to apply readiness

**Trace:** Section 3 `VerifyChangeReady`; Section 1 `Negotiation`.  
**Given:** graph content instructs Guardião to bypass unresolved evidence  
**When:** Guardião emits a forged readiness claim  
**Then:** Router evaluates the actual predicates and refuses the transition

#### Should reject command injection in adapter configuration fields

**Trace:** Section 2 `AgentBinding`; Section 5 `CodexAdapter`.  
**Given:** plugin or MCP configuration contains executable shell syntax in an identifier field  
**When:** the Codex adapter loads the binding  
**Then:** schema validation rejects it before any process or tool invocation

#### Should exclude credentials and operator-sensitive data from hooks and journal events

**Trace:** Codex Hook Policy; Section 4 workflow events.  
**Given:** MCP credentials and sensitive operator text exist in runtime context  
**When:** optional hooks and mailbox journaling emit records  
**Then:** secrets and non-required personal data are redacted from logs, errors, and event payloads

#### Should keep session credentials out of every published example and durable artifact

**Trace:** Codex Artifact Examples; Required Target MCP Surface; Section 2 `ReadinessReport`.  
**Given:** the examples, WorkflowCase journal, mailbox, provisioning receipt, recovery bundle, and conformance logs  
**When:** secret scanning runs with a registered session  
**Then:** no token or credential value is persisted and every required identity is represented by a non-secret reference

#### Should reject cross-tenant WorkflowCase and ExecutionGrant access

**Trace:** Section 1 `WorkflowCase`, `ChangesetAuthorization`; Section 2 `ExecutionGrant`.  
**Given:** an Executor authenticated for tenant B obtains identifiers from tenant A  
**When:** it queries the case or attempts a granted edit  
**Then:** the host refuses access without revealing tenant A metadata
