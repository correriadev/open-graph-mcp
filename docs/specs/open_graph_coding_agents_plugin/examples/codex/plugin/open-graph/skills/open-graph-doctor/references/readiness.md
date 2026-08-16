# Codex readiness checks

Run all checks and preserve their individual evidence. `ready` is true only when every mandatory check passes.

| Check | Mandatory evidence | Failure behavior |
|---|---|---|
| Codex adapter | Adapter id/version and supported portable contract version | Report `INCOMPATIBLE`; no mutation. |
| Plugin package | Manifest, both skills, and MCP declaration load successfully | Report missing/invalid component. |
| MCP transport | Reachable endpoint and successful tool discovery | Distinguish unreachable from incompatible. |
| Target workflow tools | Every tool listed in the workflow protocol is advertised | Report `SERVER_UPGRADE_REQUIRED`; no mutation. |
| Session identity | Registered agent identity bound to one tenant without exposing token | Re-register ephemerally or report authentication failure. |
| Repository binding | Canonical repository identity and tenant match | Refuse cross-tenant or ambiguous binding. |
| Graph v2 | Published graph id, policy version, current sequence, and coverage metadata | Bootstrap only on explicit `NOT_BOOTSTRAPPED`; otherwise rebuild/reconcile as a stated action. |
| Agent profiles | Guardian, Intermediary, Executor, and Doctor are discovered from official project/user locations | Produce provisioning plan; plugin templates alone do not pass. |
| Recovery | Open WorkflowCases, owned Changesets, grants, generations, and unadmitted diffs are reconciled | Require reattach/rebase/abort decision before new case. |

## ReadinessReport

Return: `adapterId`, `contractVersion`, `tenantId`, `repoRef`, `graphId`, `graphSeq`, `checks[]`, `ready`, `restartRequired`, `remediation[]`, `recoveryRefs[]`, and `redactions[]`. Each check contains `id`, `status`, `evidenceRefs`, and a typed failure code. Allowed statuses are `PASS`, `ABSENT`, `UNREACHABLE`, `INCOMPATIBLE`, `CONFLICT`, and `UNKNOWN`.

## Profile provisioning

Default to the repository's `.codex/agents/` directory. Compare exact content first, classify matches as idempotent, and classify differing existing files as conflicts. The root Maître presents planned writes, effects, rollback location, and restart requirement to the operator. Only explicit consent authorizes materialization. User-scoped installation is never inferred.

After writing, verify Codex discovery in a fresh or reload-capable session. If discovery cannot be verified, keep readiness false and preserve the rollback receipt.
