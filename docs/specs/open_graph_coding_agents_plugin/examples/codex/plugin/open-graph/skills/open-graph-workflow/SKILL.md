---
name: open-graph-workflow
description: Govern repository changes through OpenGraph from intent and plan validation to bounded execution, audit, persistent admission, and crash recovery. Use for implementation, refactoring, fixes, migrations, or any task that may modify a graph-mapped repository.
---

# OpenGraph Workflow

Act as the Maître in the root Codex conversation. Coordinate the other roles, but never replace the Router, Guardião, Intermediador, or Executor.

Read [references/protocol.md](references/protocol.md) completely before the first governed action in a session.

## Establish readiness

1. Register or recover the OpenGraph session without persisting credentials in repository files or workflow records.
2. Look for an existing `WorkflowCase`, owned Changeset, journal cursor, and recovery obligation before creating anything.
3. Verify Graph v2, tenant/repository binding, the four Codex agent profiles, and the required target MCP tools.
4. Invoke the separate `open-graph-doctor` skill when an objective check fails. Do not mutate source files while readiness is incomplete.
5. Bootstrap only when the server explicitly reports that this repository has no graph. Never infer absence from an empty or truncated query.

## Negotiate the change

1. Open or resume one `WorkflowCase` and initiate its negotiation horizon.
2. Record intent, constraints, exclusions, evidence gaps, and a `NegotiationSeed` before native subagent delivery.
3. Dispatch `open_graph_guardian` with case, horizon, round, projection, and journal references.
4. Persist the returned `GuardianAssessment`. Route unresolved policy or risk choices to the operator and record each decision.
5. Produce the complete `ExecutionPlan` and `ChangeContract`, including nodes, WorkOrders, tests, tools, rollback, and explicit unknowns.
6. Request `VERIFY_CHANGE_READY`. Treat the Guardião result as evidence only; only the Router can change state.

## Execute and audit

1. After `CHANGE_READY`, open the full Changeset before any mapped-file edit.
2. Create the transformation horizon and its focused projection.
3. Dispatch `open_graph_intermediary` with the admitted contract and transformation references.
4. Create one bounded `WorkOrder`, issue one current `ExecutionGrant`, and dispatch `open_graph_executor` with those references. Codex v1 permits one active Executor per Changeset.
5. Persist every decision-relevant handoff before native delivery. Native messages are transport receipts, never canonical workflow state.
6. Relay the Executor's `ArtifactBundle` and `PromotionProposal` to the Intermediador. Persist its `AuditAssessment`; request the host-owned `AuditDecision`.
7. For `revise`, append a new attempt and relay typed obligations through the Maître. Do not create peer-to-peer authority.

## Admit or recover

1. Form `PersistentDelta` only after all current WorkOrders are accepted in transformation.
2. Run the baseline admission gate. Commit the Changeset only after persistent admission; otherwise rebase, revise, escalate, or abort explicitly.
3. On crash, disconnect, compaction, or replacement, call reattach. Resume from the returned journal cursor, generation, repository reconciliation, and rebase obligations.
4. Refuse effects from stale lease generations, stale graph bases, expired grants, out-of-scope files, or unknown coverage.

Never call `authority.flip`, silently widen a Changeset, treat an agent recommendation as a gate, log a session token, or claim that raw filesystem access is fully prevented. The authoritative boundary is admission: ungoverned diffs must be detected and refused even when hooks are disabled.
