# Rework Log — Cognitive Line Test Automation

## RETRY #1 — 2026-08-15

Phase C rejected the feature with Tech Lead score 0.58 and Adversarial QA score 0.35. The retry must close these four HIGH findings and preserve the previously accepted behavior:

1. **Unconditional typecheck gate:** the CI topology introduced a condition that conflicts with the repository invariant requiring the typecheck gate to remain unconditional; the focused current suite reports three deterministic failures.
2. **Append-only flake history:** `flake-ledger --check` defines prior-prefix reconciliation but does not invoke it against a prior revision, allowing deletion or rewriting of historical records to pass integrity checks.
3. **Mandatory-gate policy ownership:** `publish-verdict` accepts caller-provided `blocking: false` for a mandatory gate, allowing a failed mandatory gate to be downgraded to advisory while the suite verdict passes.
4. **Evidence on runner failure:** process-spawn exceptions escape before verdict publication, so a crashing gate runner leaves no failed-run verdict or associated evidence artifact.

Required validation includes direct regression tests for each bypass/failure mode, the current focused suite, and the relevant reconciliation, ledger, CI-topology, and verdict-publication gates.
