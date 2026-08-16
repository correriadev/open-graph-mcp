# Implementation Handoff — OpenGraph Coding Agents Plugin

**Status:** specification package complete for implementation handoff; no product or plugin runtime code is contained here.  
**Reference adapter:** Codex first; Gemini, OpenCode, then Claude Code.  
**Binding v1 profile:** one active Executor per Changeset, hooks disabled, project-scoped agent provisioning by default.

## 1. Source order and change control

The implementer must read these sources in order:

1. `docs/PRD/PRD.md` and the Graph v2 Working Paper for product invariants and four-horizon semantics.
2. `001-problem-space.md` for the problem, risks, exclusions, and success criteria.
3. `002-context-map.md` for product/portable/adapter boundaries and role relationships.
4. `003-open-graph-mcp-tactical-design.md` for aggregates, services, events, repositories, ordered tasks, and target MCP surface.
5. `004-open-graph-mcp-test-scenarios.md` for executable behavior and traceability.
6. This handoff and `examples/codex/` for exact Codex artifact shapes and operator-facing workflow behavior.

If sources conflict, product invariants win over adapter convenience; Tactical Design wins over examples; examples win over an implementation guess. Any intentional contract change must update 003, 004, this handoff, and every affected example in the same Changeset.

## 2. Deliverables

| Deliverable | Required implementation outcome | Specification evidence |
|---|---|---|
| Portable contracts | Versioned schemas for roles, artifacts, mailbox, readiness, capabilities, recovery, grants, and refusals | 003 Sections 1–4; workflow protocol example |
| Durable workflow | Atomic WorkflowCase journal, deterministic Router, typed mailbox, reattach/rebase, and fencing | 003 tasks 02–09; 004 unit/integration/recovery scenarios |
| Graph context | Reproducible negotiation, transformation, and microtask projections with coverage and `STALE_BASE` behavior | 003 `HorizonProjection`; target `graph.project` |
| Delegated execution | WorkOrder/ExecutionGrant authorization without Changeset ownership transfer | 003 `ChangesetAuthorization`; Executor example |
| MCP API | Every target operation in Section 4 below, discoverable and covered by contract tests | workflow protocol `Target MCP surface` |
| Codex distribution | Valid plugin manifest, two skills, MCP declaration, and inert profile templates | `examples/codex/plugin/` |
| Codex provisioning | Consent-driven, conflict-safe, idempotent provisioning and discovery verification for four profiles | 003 task 12; `examples/codex/project/.codex/agents/` |
| Conformance | Hooks-off happy path, refusals, security, recovery, and artifact-shape tests | 004 plus 003 tasks 10 and 15 |
| Future adapters | Compatibility matrix only; no Gemini/OpenCode/Claude implementation in this feature | 003 task 16 |

## 3. Example inventory

The examples are intentionally stored under `docs/specs/` and are not auto-discoverable runtime artifacts.

| Artifact | Example | Purpose |
|---|---|---|
| Plugin manifest | `examples/codex/plugin/open-graph/.codex-plugin/plugin.json` | Valid package identity and component references. |
| MCP declaration | `examples/codex/plugin/open-graph/.mcp.json` | Local reference transport; deployment may override the URL without changing protocol semantics. |
| Main skill | `examples/codex/plugin/open-graph/skills/open-graph-workflow/SKILL.md` | Maître procedure from readiness through closure/recovery. |
| Doctor skill | `examples/codex/plugin/open-graph/skills/open-graph-doctor/SKILL.md` | Objective diagnosis and consented setup handoff. |
| Workflow reference | `examples/codex/plugin/open-graph/skills/open-graph-workflow/references/protocol.md` | Roles, artifacts, target tools, recovery, and enforcement. |
| Doctor reference | `examples/codex/plugin/open-graph/skills/open-graph-doctor/references/readiness.md` | Checks, statuses, report, and provisioning policy. |
| Guardião profile | `examples/codex/project/.codex/agents/open-graph-guardian.toml` | Read-only plan validation. |
| Intermediador profile | `examples/codex/project/.codex/agents/open-graph-intermediary.toml` | Read-only implementation audit. |
| Executor profile | `examples/codex/project/.codex/agents/open-graph-executor.toml` | Grant-bounded workspace write. |
| Doctor profile | `examples/codex/project/.codex/agents/open-graph-doctor.toml` | Read-only readiness diagnosis. |

The plugin must ship the profile contents as inert templates/resources. Installation does not register custom agents. Provisioning copies an operator-approved version to project `.codex/agents/` by default or to user scope only after an explicit choice.

## 4. Binding target MCP contract

This feature adds `workflow.open`, `workflow.read`, `workflow.append`, `workflow.transition`, `workflow.reattach`, `workflow.rebase`, `graph.project`, `changeset.grant`, and `changeset.revoke_grant`. Minimum request/result fields and refusal behavior are defined in the workflow protocol example and are normative.

Existing `session.register`, `graph.query`, `graph.impact`, `presence.*`, `changeset.*`, and `cognitive.*` remain available. The implementation must extend Changeset authorization so an Executor identity holding a current grant can claim/edit only its intersection of WorkOrder and Changeset scope. It must not inherit ownership or permission to extend, commit, abort, or transfer authority.

Until all target tools appear in MCP discovery at the supported contract version, Doctor reports `SERVER_UPGRADE_REQUIRED` and the workflow remains read-only. Examples must not be made runnable by faking missing workflow state in prompts.

## 5. Authority and enforcement matrix

| Boundary | Prevents or decides | Cannot guarantee |
|---|---|---|
| Workflow/Doctor skills | Correct ordering, role separation, setup checks, refusal before known unauthorized edits | Enforcement against a disobedient model or arbitrary host write |
| Codex sandbox/profile | Read-only Guardião/Intermediador/Doctor; workspace access for Executor | OpenGraph grant authority or semantic correctness |
| Optional hooks | Early warnings or blocking for supported host tool calls | Complete filesystem mediation, Router transitions, or recovery truth |
| MCP Router/Changeset | Workflow state, grants, fencing, graph mutations, persistent admission, commit authorization | Physical prevention of every raw filesystem write |
| GraphCI/persistent gate | Detects ungoverned diffs and blocks their admission | Erasing an already-created local diff |

Therefore “mapped file requires Changeset before edit” is a procedural precondition and an authoritative admission invariant. With hooks disabled, an unauthorized raw edit may physically exist, but it must never be reported as admitted, promoted, or committed through OpenGraph. Recovery must classify and reconcile it explicitly.

## 6. Fixed decisions for Codex v1

- The root conversation is the Maître; there is no Maître custom-agent profile.
- The Maître is the only role that talks to the operator, owns the Changeset lifecycle, and coordinates native subagents.
- Native Codex messages are delivery only. Canonical state is appended to the MCP journal before a decision-relevant delivery and after a returned artifact.
- The Guardião validates the plan but cannot apply `CHANGE_READY`.
- The Intermediador audits implementation but cannot apply `AuditDecision`.
- The Executor is the only workspace-writing custom agent and requires a current WorkOrder plus ExecutionGrant.
- Doctor is a separate skill and read-only agent. The root provisioning action performs approved setup writes.
- The Doctor skill can run in the root session when the Doctor profile itself is absent. A discovered `open_graph_doctor` profile adds isolated diagnosis but is not a prerequisite for repairing profile discovery.
- Codex v1 supports one active Executor per Changeset. The schema retains WorkOrder/executor identifiers so later safe parallelism does not require an authority-model rewrite.
- Base conformance runs with hooks disabled. Optional hooks may be added later without becoming canonical authority.
- Session credentials remain ephemeral in the adapter/client. They never enter WorkflowCase, mailbox, repository files, examples, logs, or hook payloads.
- Missing isolation, profiles, tools, tenant binding, coverage, or recovery reconciliation means read-only/doctor mode, not a best-effort mutation fallback.

## 7. Resolution of Problem Space questions

| Question | Binding resolution |
|---|---|
| Governed handoff proof | A typed `workflow.append` succeeds before native delivery; Router commands reference admitted journal positions and causal artifact refs. |
| Grant vs ownership | Grants are server-resolved, tenant/case/Changeset/WorkOrder/Executor scoped, expiring, revocable, and generation-fenced. Executor never receives owner operations. |
| Shared Changeset composability | Codex v1 permits one active Executor, eliminating concurrent WorkOrder composition. Later parallelism requires a separate policy and commutativity/conflict proof. |
| Projection completeness | Purpose, roots, base sequence, limits, exclusions, visited counts, truncation, and coverage are persisted; insufficient coverage is `unknown`. |
| One-million-node bound | Projection/impact requests are budgeted and cursor-paginated; mailbox pages use the existing default 100/max 500 convention. Add a one-million-node synthetic benchmark, but do not invent a latency SLO: correctness/truncation is blocking and timing remains recorded evidence until an ADR sets a threshold. |
| Stable replay | Cursors bind case, sequence boundary, query parameters, tenant, graph id, and horizon; concurrent later appends do not alter the page's historical order. |
| Sensitive fields | Persist schema allowlists and references/digests, not raw secrets. Reject/redact session tokens, authorization headers, cookies, secret-valued environment variables, credential-like command output, and unnecessary raw operator text. |
| Forgery and cross-tenant defense | Resolve grants and capabilities from server repositories, authenticate actor/tenant, compare current generation/base, reject client-authored authority objects, and require conformance evidence for capability claims. |
| Crash after edit | Reattach advances generation, inspects the actual diff, compares WorkOrder/grant evidence, and reconciles before retry; no blind replay. |
| Persistent sequence advance | Mark affected projections/artifacts stale and require `workflow.rebase` or explicit revalidation before audit/admission. |
| Delayed native result | Round causal refs plus journal cursor/idempotency prevent an older completion from replacing a newer round; retain it only for audit. |
| No duplicated EAP rules | Run identical portable fixtures through Codex and a synthetic adapter and assert equal server decisions with no adapter-name branches. |
| Hook/MCP disagreement | An MCP refusal always blocks authority. A stricter hook may stop a local call and emit `HOOK_GUARDRAIL_BLOCKED`, but changes no canonical state; operator policy may disable/reconfigure it. |
| Portable vs Codex syntax | `AgentBinding` and `CapabilityProfile` are the anti-corruption layer; `.codex/agents`, plugin paths, and native spawn statuses remain adapter-only. |

## 8. Existing repository extension map

| Concern | Start from | Expected change direction |
|---|---|---|
| EAP types/lifecycle/refusals | `packages/graph-core/src/eap/types.ts`, `lifecycle.ts`, `horizon.ts`, `promotion.ts`, `refusals.ts` | Add portable workflow artifacts and refusal codes without putting Codex syntax in graph-core. |
| Graph v2 projection/impact | `packages/graph-core/src/project.ts`, `impact.ts`, `relationship-types.ts`; existing graph-core tests | Add purpose-scoped projection descriptors/coverage while preserving typed relationships, graph id, policy version, horizon, and cursor rules. |
| MCP services and persistence | `packages/mcp-server/src/eap/services.ts`, `eap-repositories.ts`, `horizon-store.ts`, `stored-state.ts`, `db.ts` | Add WorkflowCase/mailbox/grant repositories, migrations, atomic transitions, and restart recovery. |
| Tool implementations | `packages/mcp-server/src/tools/eap.ts`, `changeset.ts`, `graph-impact.ts` | Implement the nine target tools as thin validated adapters over services; do not embed workflow semantics in transport. |
| Tool discovery/dispatch | `packages/mcp-server/src/transport.ts` | Register exact schemas/names and delegate to tool modules; extend transport-contract tests. |
| Identity/tenant/fencing | `packages/mcp-server/src/tokens.ts`, `state.ts`, `affinity.ts`, `cell.ts` | Resolve actor and tenant server-side and reject stale/cross-tenant effects. |
| Changeset authorization | `packages/mcp-server/src/tools/changeset.ts`, related authorization/scope/commit tests | Add grant-aware Executor claim/edit paths while keeping owner-only lifecycle operations. |
| Client contract | `packages/client/src/eap.ts`, `rpc.ts`, exports and conformance tests | Publish typed wrappers for target tools and portable artifacts without host-specific branching. |
| Credential mediation | `packages/stdio-proxy/src/cli.ts`, `credentials.ts` | Reuse or extend ephemeral credential injection if selected; never persist tokens in workflow artifacts. Direct HTTP remains a supported example transport. |
| Codex distribution | Create a dedicated package from `examples/codex/plugin/open-graph/`; inspect `packages/claude-plugin/` only as packaging precedent | Preserve the example contract; do not copy the older Claude workflow or its authority assumptions. |
| Verification | `packages/graph-core/test/`, `packages/mcp-server/test/`, `packages/client/test/`, `scripts/verification/` | Implement every 004 scenario, repository-owned format validation, conformance evidence, and the scale/recovery probes. |

Repository verification starts with focused RED/GREEN tests, then `bun run typecheck`, `bun test` for affected packages/scenarios, and finally `bun run verify`. Add repository-owned plugin/skill/TOML validation so CI does not depend on files under a developer profile. Add a named one-million-node workflow projection probe and record its evidence through the existing verification/benchmark mechanisms before claiming scale behavior.

## 9. Ordered implementation dependency

1. Implement tasks 01–10 from Tactical Design as product/portable capability, including schemas and MCP discovery.
2. Validate all server-side unit, persistence, concurrency, authorization, recovery, and conformance fixtures without a Codex dependency.
3. Implement tasks 11–12: package the plugin and build profile provisioning from the exact examples.
4. Implement tasks 13–14: Maître/Guardião, then transformation/Executor behavior.
5. Implement task 15 end-to-end with hooks disabled, including crash/compaction/reattach and ungoverned-diff refusal.
6. Implement task 16 only as a compatibility matrix and future fixture manifest.

Do not start the Codex mutation flow before product tools and conformance fixtures are green. Do not implement Gemini, OpenCode, Claude Code, multi-Executor execution, mandatory hooks, or an MCP-owned LLM agent in this feature.

## 10. Definition of done

The feature is complete only when:

- every 004 scenario is automated or explicitly mapped to a deterministic host conformance fixture;
- MCP discovery exposes the complete target surface with versioned schemas;
- all four profiles parse, are provisioned conflict-safely, and are discovery-verified;
- both skills pass skill validation and contain no hidden authority or prompt-only state;
- the full Codex flow passes with hooks disabled and one active Executor;
- forced crashes at every journal/effect boundary recover without duplicate admitted effects;
- the one-million-node benchmark proves bounded pagination/coverage semantics and records timing without claiming an unapproved SLO;
- stale generation, stale base, cross-tenant, out-of-scope, and ungoverned-diff attempts are refused with auditable codes;
- credentials and sensitive operator data are absent from persisted artifacts and logs;
- docs, examples, schemas, tool discovery, and conformance tests agree byte-for-contract on names and required fields.

## 11. Non-blocking implementation choices

Module layout, SQL table names, internal event serialization, concrete Codex dispatch wrapper, and deployment URL are implementation choices as long as they preserve the contracts above. The implementer may split tasks into smaller TDD increments, but must preserve the dependency order and acceptance criteria.
