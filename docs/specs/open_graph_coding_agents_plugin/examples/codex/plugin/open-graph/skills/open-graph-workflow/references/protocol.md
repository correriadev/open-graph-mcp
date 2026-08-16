# Portable workflow protocol

This reference is normative for the Codex v1 example. It names the target MCP surface that the feature must implement. Existing OpenGraph tools remain available, but the workflow must not advertise mutation readiness until every required target tool is discoverable.

## Roles and horizons

| Role | Horizon | Authority |
|---|---|---|
| Maître | Session | Owns operator interaction, plan composition, Changeset lifecycle, dispatch, and final requests to the Router. |
| Guardião | Negotiation | Produces evidence-backed `GuardianAssessment`; never applies readiness or edits files. |
| Intermediador | Transformation | Produces `AuditAssessment`; never applies `AuditDecision` or edits files. |
| Executor | Microtask | Edits and tests only inside a current WorkOrder plus ExecutionGrant. |
| Router / host | Persistent boundary | Applies deterministic transitions, admission, fencing, and refusals. It is not an LLM role. |

The immediate DAG is negotiation → transformation, microtask → transformation, and transformation → persistent. `CONTEST` is an operation, not a graph edge. Session initiates negotiation and coordinates delivery but does not transfer authority.

## Target MCP surface

The names and minimum fields below are binding for Codex v1. Renaming requires simultaneous changes to Tactical Design, examples, schemas, and conformance tests.

| Tool | Minimum request | Required result or refusal |
|---|---|---|
| `workflow.open` | `token, repoRef, intent, basedOnSeq, adapterId, idempotencyKey` | `WorkflowCase` or typed tenant/version/idempotency refusal. |
| `workflow.read` | `token, caseId, sinceJournalSeq?` | Current case, journal page, open references, and next cursor. |
| `workflow.append` | `token, caseId, expectedJournalSeq, envelope` | Stable journal cursor; duplicate key with equal payload returns the original cursor. |
| `workflow.transition` | `token, caseId, expectedVersion, command, inputRefs` | Router-verified transition or predicate-specific refusal. |
| `workflow.reattach` | `token, caseId, role, agentId, priorGeneration?` | `RecoveryBundle` with current generation, cursor, projections, repository reconciliation, and rebase obligations. |
| `workflow.rebase` | `token, caseId, targetSeq, evidenceRefs` | Revalidated/invalidated references and new base, or `STALE_BASE`. |
| `graph.project` | `token, horizonId, basedOnSeq, roots, limits, purpose` | Projection id, coverage, exclusions, truncation, and reproducibility descriptor. |
| `changeset.grant` | `token, caseId, csId, workOrderId, executorId, scope, expiresAt, leaseGeneration` | Current `ExecutionGrant` bounded by the WorkOrder/Changeset intersection. |
| `changeset.revoke_grant` | `token, grantId, reason, expectedGeneration` | Revocation receipt and fenced generation. |

The adapter also uses current `session.register`, `graph.query`, `graph.impact`, `presence.*`, `changeset.open`, `changeset.extend`, `changeset.list_mine`, `changeset.commit`, `changeset.abort`, and `cognitive.*` tools. The target implementation must update delegated claim/edit authorization so the named Executor can act through a valid grant while Changeset ownership and commit/abort remain with the Maître.

## Canonical artifacts

Every artifact is tenant, repository, case, horizon, graph-base, actor, schema-version, and causal-reference scoped where applicable.

- `NegotiationSeed`: intent, constraints, exclusions, requested evidence, operator policy.
- `GuardianAssessment`: supported facts, unknowns, conflicts, assumptions with owner/consequence, recommendation, evidence refs.
- `ExecutionPlan`: affected cells/files, ordered WorkOrders, test/verification commands, tools, budgets, rollback, excluded scope.
- `ChangeContract`: immutable reference to the admitted ExecutionPlan and approvals.
- `WorkOrder`: bounded goal, allowed cells/files, required tests, completion evidence, attempt budget.
- `ExecutionGrant`: case, Changeset, WorkOrder, Executor identity, exact scope, expiry, lease generation.
- `ArtifactBundle`: diff identity, changed files/cells, commands, results, residual risks, repository base.
- `PromotionProposal`: ArtifactBundle reference and requested microtask → transformation promotion.
- `AuditAssessment`: evidence-based accept/revise/escalate recommendation; it carries no gate authority.
- `AuditDecision`: host-owned outcome tied to the current assessment and attempt.
- `PersistentDelta`: accepted transformation output submitted to the existing persistent admission gate.

## Delivery and recovery

Append a `MailboxEnvelope` before every decision-relevant native dispatch. It contains `fromRole`, `toRole`, typed `payloadRef`, `causationRefs`, `idempotencyKey`, and the expected journal cursor. After native completion, append the returned artifact before using it in a transition.

On recovery, trust the `WorkflowCase` and repository state, not chat memory. A replacement advances lease generation and fences the previous worker. Reconcile existing diffs before repeating work. Rebase whenever the persistent graph sequence advanced or the projection reports stale coverage.

## Enforcement boundary

Skills provide preventative behavior and optional hooks may block supported host calls early. Neither can make arbitrary filesystem access impossible. MCP authorizes workflow transitions, graph mutations, grants, and Changeset closure. GraphCI/persistent admission must block ungoverned diffs. A raw unauthorized edit is therefore an unadmitted effect that must be detected, reconciled, and refused at admission.
