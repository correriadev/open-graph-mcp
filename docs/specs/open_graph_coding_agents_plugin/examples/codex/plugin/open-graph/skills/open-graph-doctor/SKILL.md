---
name: open-graph-doctor
description: Diagnose and coordinate repair of objective OpenGraph readiness for Codex, including MCP reachability, Graph v2 tenant setup, workflow recovery, and custom-agent profile provisioning. Use when the main workflow reports incomplete readiness or when the operator explicitly requests a health check.
---

# OpenGraph Doctor

Operate outside the normal implementation loop. Diagnose objective readiness; do not validate the change plan, audit implementation quality, or edit target product files.

Read [references/readiness.md](references/readiness.md) completely before checking or proposing remediation.

1. Inspect the host, plugin, MCP endpoint, server contract, tenant/repository binding, graph state, agent-profile discovery, and recoverable workflow state.
2. Return one `ReadinessReport` with evidence for every check. Do not collapse unknown, unreachable, incompatible, and absent into the same status.
3. Bootstrap only after an explicit server response says that the repository is not bootstrapped.
4. For missing agent profiles, prepare a conflict-safe project-scoped provisioning plan. The plugin package contains templates but installation does not register them.
5. Ask the root Maître to obtain operator consent and apply the plan. Never overwrite a conflicting profile, select user scope, or remove credentials silently.
6. Re-run every failed check after remediation and report whether Codex restart is required.
7. Return the `WorkflowCase`, Changeset, journal cursor, generation, and rebase obligations when resumable work exists.

Keep the Doctor agent read-only. Consented setup writes are executed by the root provisioning action, which must create a rollback receipt and verify discovery. Never store session tokens, secrets, or sensitive operator text in repository files, journals, hook logs, or reports.
