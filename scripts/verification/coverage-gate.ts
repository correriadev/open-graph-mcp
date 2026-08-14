#!/usr/bin/env bun
/**
 * F002 task 15 — the Coverage Baseline Ratchet Gate.
 *
 *   bun scripts/verification/coverage-gate.ts                -> run instrumented, evaluate, exit 1 on any violation
 *   bun scripts/verification/coverage-gate.ts --from-lcov P  -> evaluate against an lcov file already on disk
 *   bun scripts/verification/coverage-gate.ts --json         -> the same verdict as JSON on stdout
 *   bun scripts/verification/coverage-gate.ts --restate-policy
 *                                                           -> write this executable's ratchet policy into the
 *                                                              baseline. Writes NO figure and cannot change one.
 *
 * ── What this gate is for ─────────────────────────────────────────────────────────────────────
 * Task 14 recorded one figure. A recorded figure that nothing enforces is a number in a file: it
 * ages out silently, and the first person to notice is whoever eventually reads it and finds it
 * describes a repository that no longer exists. This gate turns it into a ratchet.
 *
 * ── TWO checks, because one of them alone is trivially defeated ───────────────────────────────
 * A. **Working-tree consistency.** A fresh instrumented run must reproduce the committed figure
 *    EXACTLY, at aggregate, scope-path and per-file granularity, for lines and functions alike.
 *      - measured worse  -> `regressed`  (acceptance 1: a drop fails, with baseline/measured/delta)
 *      - measured better -> `unrecorded` (acceptance 2: a rise fails until the new baseline is
 *                                         committed IN THE SAME CHANGE, so it cannot drift silently)
 *
 * B. **Monotonicity across commits.** Check A alone is defeated in one command: lower the coverage,
 *    re-run `measure-coverage.ts`, commit the worse figure, and A is green because the run agrees
 *    with the file. So the committed figure is ALSO compared against the previously committed one
 *    (the merge-base version, read out of git), and the ratio may not fall. Between them, the only
 *    way to a green build is to not lower coverage.
 *
 * ── The judgement calls, made here and recorded in the baseline ───────────────────────────────
 *  - **Granularity.** Check A ratchets aggregate AND every declared scope path AND every file.
 *    Aggregate-only would let `graph-core` rot while `mcp-server` improves and the total stays
 *    flat — precisely the drift this gate exists to prevent. Check B ratchets aggregate and scope
 *    path only: those two sets are fixed by `COVERAGE_SCOPE` in the executable, whereas the file
 *    set legitimately changes when a file is added or deleted, and a history ratchet over a moving
 *    set would fail on every legitimate refactor.
 *  - **Tolerance: none, and no epsilon is needed.** Check A compares INTEGER counts, so rounding
 *    cannot enter it. Check B compares ratios as exact rationals by cross-multiplication
 *    (`Cnow * Tprior >= Cprior * Tnow`), never the rounded 2dp `pct`. The percentages in this
 *    repository's artefacts are for humans; they never decide a build. That is why there is no
 *    epsilon band to argue about, and why a drop hidden by rounding is still caught.
 *  - **Counts or percentages?** Both, at different jobs. A is on counts because "the same run
 *    happened twice" is a statement about counts. B is on the ratio because a count ratchet would
 *    fail on any change that adds a single uncovered line, which is intolerable and would get the
 *    gate switched off — and a switched-off gate measures nothing. The consequence, stated rather
 *    than discovered: **deleting a poorly covered file raises the ratio and B permits it.** That is
 *    deliberate. It is not laundering, because A forces the new baseline to be committed in the same
 *    change, and the deletion is then visible in the diff as a row disappearing from `files[]` —
 *    which is a reviewable fact, unlike a percentage that merely went up.
 *  - **Where it runs.** CI only, as its own job. The gate needs a full instrumented run (~82 s;
 *    instrumentation itself costs +1501 ms / +1.85%, task 14's measurement). Paying 1.85% for a
 *    figure nobody can quietly move is obviously worth it; paying 82 s on every local `bun run
 *    verify` is not, and `package.json` is out of this task's scope in any case. The new CI job runs
 *    in PARALLEL with `test`, so the cost lands off the existing critical path.
 *
 * ── "Not measured" is never "unchanged" ───────────────────────────────────────────────────────
 * `measure-coverage.ts` refuses to produce a figure from a red suite. A gate that treated a missing
 * figure as an unchanged one would therefore stop measuring the day the suite first went flaky, and
 * report PASS forever after. So `RatchetOutcome` carries `unmeasured` as a first-class verdict with
 * its own exit code 1 and its own message, and `drift.length === 0` is NOT the pass condition
 * anywhere in this file — `outcome === "pass"` is. Same defect class as task 08's "no violations
 * found" versus "nothing was looked at".
 *
 * ── The policy is declared in the baseline but LIVES here ─────────────────────────────────────
 * `RATCHET_POLICY` is a constant of this executable. The baseline records a copy plus its digest,
 * and the gate refuses to run when the two disagree. Task 14's reason applies unchanged: the datum
 * must not be able to redefine what it is a datum about. Editing `ratchet.mode` in the JSON to
 * something laxer does not make the gate laxer; it makes the gate fail.
 */

import { execFileSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  BASELINE_PATH,
  COVERAGE_DIR,
  LCOV_PATH,
  buildMeasurement,
  enumerateScopeFiles,
  loadCoverageBaseline,
  parseLcov,
  parseSuiteTally,
  sha256,
  type Counted,
  type CoverageMeasurement,
} from "./measure-coverage"
import { repoRoot } from "./register-scenarios"

export const GATE_NAME = "coverage"

// ── The policy ────────────────────────────────────────────────────────────────────────────────

export type UnitLevel = "aggregate" | "scope-path" | "file"
export type Metric = "lines" | "functions"

export interface RatchetPolicy {
  version: number
  gate: typeof GATE_NAME
  /** `003` D-table: this gate blocks. Stated as data so a reader reads policy rather than guesses. */
  blocking: true
  units: readonly UnitLevel[]
  metrics: readonly Metric[]
  workingTree: string
  history: string
  rounding: string
  countsVersusPercentages: string
  unmeasured: string
}

export const RATCHET_POLICY: RatchetPolicy = {
  version: 1,
  gate: GATE_NAME,
  blocking: true,
  units: ["aggregate", "scope-path", "file"],
  metrics: ["lines", "functions"],
  workingTree:
    "A fresh instrumented run must reproduce this figure EXACTLY — integer covered/total counts, " +
    "for lines and for functions, at the aggregate, at every declared scope path, and per file. A " +
    "measured figure below the recorded one is a regression and fails. A measured figure ABOVE the " +
    "recorded one also fails, until the new figure is committed into this file in the same change: " +
    "an improvement nobody recorded is indistinguishable from a ratchet drifting on its own.",
  history:
    "The committed figure is additionally compared against the previously committed one, read out " +
    "of git at the merge-base. The ratio may not fall, at the aggregate or at any declared scope " +
    "path. Without this, lowering coverage and re-running the measurement would produce a run that " +
    "agrees with the file and a build that is green. Per-file history is NOT ratcheted: files are " +
    "legitimately added and deleted, and a history ratchet over a moving set fails on every honest " +
    "refactor. A prior figure whose scope digest differs is INCOMPARABLE and fails as such, because " +
    "moving the denominator is the cheapest way to make a figure look better.",
  rounding:
    "NONE OF THE PERCENTAGES IN THIS DOCUMENT DECIDE A BUILD. The `pct` fields are rounded to two " +
    "decimal places for humans. The working-tree check compares integer counts, so rounding cannot " +
    "enter it; the history check compares ratios as exact rationals by cross-multiplication " +
    "(covered_now * total_prior >= covered_prior * total_now), so a fall too small to show at two " +
    "decimal places is caught all the same. There is therefore no tolerance band and no epsilon: " +
    "there is nothing for one to absorb.",
  countsVersusPercentages:
    "Counts ratchet against the working tree; the ratio ratchets across history. A count ratchet " +
    "across history would fail on any change adding a single uncovered line, and a gate that " +
    "expensive is switched off within a week. The known consequence, stated rather than discovered: " +
    "deleting a poorly covered file raises the ratio and the history check permits it. That is not " +
    "laundering — the working-tree check forces the new baseline into the same commit, so the " +
    "deletion appears in the diff as a row leaving `files[]`, which is a reviewable fact.",
  unmeasured:
    "A run that produced no figure is NOT a figure that did not change. `measure-coverage.ts` " +
    "refuses to write a figure from a red suite, so a gate treating a missing measurement as an " +
    "unchanged one would silently stop measuring the first time the suite went flaky and report " +
    "PASS for ever after. `unmeasured` is a distinct verdict with exit code 1 and its own message. " +
    "There is no flag, environment variable or condition in the gate that makes it green.",
}

/** The fields `ratchet.sha256` covers — named so a test can pin the digest's meaning, not its value. */
export const POLICY_SHA256_FIELDS = [
  "version",
  "gate",
  "blocking",
  "units",
  "metrics",
  "workingTree",
  "history",
  "rounding",
  "countsVersusPercentages",
  "unmeasured",
] as const

export function ratchetPolicyDigest(policy: RatchetPolicy): string {
  const payload: Record<string, unknown> = {}
  for (const field of POLICY_SHA256_FIELDS) payload[field] = policy[field]
  return sha256(JSON.stringify(payload))
}

/** The `ratchet` block as it is written into the baseline: the policy plus its digest. */
export interface DeclaredPolicy extends RatchetPolicy {
  sha256: string
}

export function declaredPolicyBlock(policy: RatchetPolicy = RATCHET_POLICY): DeclaredPolicy {
  return { ...policy, sha256: ratchetPolicyDigest(policy) }
}

// ── Units under comparison ────────────────────────────────────────────────────────────────────

export type Direction = "equal" | "improved" | "regressed" | "appeared" | "vanished"

export interface Drift {
  level: UnitLevel
  id: string
  metric: Metric
  baseline: Counted
  /** `null` when the unit is absent from the measurement entirely. */
  measured: Counted | null
  baselinePct: number
  measuredPct: number | null
  deltaCovered: number | null
  deltaTotal: number | null
  deltaPct: number | null
  direction: Direction
  message: string
}

export interface Regression {
  level: Exclude<UnitLevel, "file">
  id: string
  metric: Metric
  prior: Counted
  current: Counted
  priorPct: number
  currentPct: number
  deltaPct: number
  message: string
}

export type RatchetOutcome =
  | "pass"
  | "regressed"
  | "unrecorded"
  | "unmeasured"
  | "policy-mismatch"
  | "baseline-invalid"

export interface RatchetReport {
  gate: typeof GATE_NAME
  blocking: true
  outcome: RatchetOutcome
  /** False whenever no figure was produced. Never conflated with "nothing drifted". */
  measured: boolean
  unmeasuredReason: string | null
  priorFigure: { available: boolean; ref: string | null; reason: string }
  drift: Drift[]
  regressions: Regression[]
  message: string
}

const ZERO: Counted = { covered: 0, total: 0 }

const pct = (counted: Counted): number =>
  counted.total === 0 ? 0 : Math.round((counted.covered / counted.total) * 10000) / 100

/**
 * Exact rational comparison. `a` is at least as good as `b` iff `a.covered/a.total >= b.covered/b.total`,
 * evaluated by cross-multiplication so the rounded percentage never enters the decision. A unit with
 * no denominator is treated as satisfying any prior: there is nothing there to have got worse.
 */
export function atLeastAsGood(a: Counted, b: Counted): boolean {
  if (b.total === 0) return true
  if (a.total === 0) return b.covered === 0
  return a.covered * b.total >= b.covered * a.total
}

function classify(baseline: Counted, measured: Counted): Direction {
  if (measured.covered === baseline.covered && measured.total === baseline.total) return "equal"
  const uncoveredRose = measured.total - measured.covered > baseline.total - baseline.covered
  return uncoveredRose || !atLeastAsGood(measured, baseline) ? "regressed" : "improved"
}

function drift(level: UnitLevel, id: string, metric: Metric, baseline: Counted, measured: Counted | null): Drift | null {
  if (measured === null) {
    return {
      level,
      id,
      metric,
      baseline,
      measured: null,
      baselinePct: pct(baseline),
      measuredPct: null,
      deltaCovered: null,
      deltaTotal: null,
      deltaPct: null,
      direction: "vanished",
      message:
        `${level} ${id} (${metric}): the committed figure records ${baseline.covered}/${baseline.total} ` +
        "but the run measured this unit not at all. A unit that stopped being measured is not a unit " +
        "at 100%; re-measure and commit the figure that describes the surface which exists.",
    }
  }
  const direction = classify(baseline, measured)
  if (direction === "equal") return null
  return {
    level,
    id,
    metric,
    baseline,
    measured,
    baselinePct: pct(baseline),
    measuredPct: pct(measured),
    deltaCovered: measured.covered - baseline.covered,
    deltaTotal: measured.total - baseline.total,
    deltaPct: Math.round((pct(measured) - pct(baseline)) * 100) / 100,
    direction,
    message:
      `${level} ${id} (${metric}): baseline ${baseline.covered}/${baseline.total} (${pct(baseline).toFixed(2)}%), ` +
      `measured ${measured.covered}/${measured.total} (${pct(measured).toFixed(2)}%), ` +
      `delta ${measured.covered - baseline.covered >= 0 ? "+" : ""}${measured.covered - baseline.covered} covered / ` +
      `${measured.total - baseline.total >= 0 ? "+" : ""}${measured.total - baseline.total} total ` +
      `(${(pct(measured) - pct(baseline)).toFixed(2)} pp) — ${direction}.`,
  }
}

/** Check A. Every unit of the committed figure against the same unit of a fresh run. */
export function compareUnits(baseline: CoverageMeasurement, measured: CoverageMeasurement): Drift[] {
  const found: Drift[] = []
  const push = (candidate: Drift | null): void => {
    if (candidate !== null) found.push(candidate)
  }

  for (const metric of RATCHET_POLICY.metrics) {
    push(drift("aggregate", "AGGREGATE", metric, baseline.totals[metric], measured.totals[metric]))
  }

  const measuredScopePaths = new Map(measured.byScopePath.map((row) => [row.path, row]))
  for (const row of baseline.byScopePath) {
    const other = measuredScopePaths.get(row.path)
    for (const metric of RATCHET_POLICY.metrics) {
      push(drift("scope-path", row.path, metric, row[metric], other === undefined ? null : other[metric]))
    }
    measuredScopePaths.delete(row.path)
  }
  for (const row of measuredScopePaths.values()) {
    for (const metric of RATCHET_POLICY.metrics) {
      found.push(appeared("scope-path", row.path, metric, row[metric]))
    }
  }

  const measuredFiles = new Map(measured.files.map((row) => [row.path, row]))
  for (const row of baseline.files) {
    const other = measuredFiles.get(row.path)
    for (const metric of RATCHET_POLICY.metrics) {
      push(drift("file", row.path, metric, row[metric], other === undefined ? null : other[metric]))
    }
    measuredFiles.delete(row.path)
  }
  for (const row of measuredFiles.values()) {
    for (const metric of RATCHET_POLICY.metrics) {
      found.push(appeared("file", row.path, metric, row[metric]))
    }
  }

  return found
}

function appeared(level: UnitLevel, id: string, metric: Metric, measured: Counted): Drift {
  return {
    level,
    id,
    metric,
    baseline: ZERO,
    measured,
    baselinePct: 0,
    measuredPct: pct(measured),
    deltaCovered: measured.covered,
    deltaTotal: measured.total,
    deltaPct: pct(measured),
    direction: "appeared",
    message:
      `${level} ${id} (${metric}): measured ${measured.covered}/${measured.total} ` +
      `(${pct(measured).toFixed(2)}%) but the committed figure does not record this unit at all. A ` +
      "surface that entered the declared scope without entering the recorded figure is measured by " +
      "nothing; re-measure and commit the result in this change.",
  }
}

/** Check B. The committed figure against the previously committed one. */
export function compareHistory(prior: CoverageMeasurement, current: CoverageMeasurement): Regression[] {
  const found: Regression[] = []
  const record = (level: Regression["level"], id: string, metric: Metric, a: Counted, b: Counted): void => {
    if (atLeastAsGood(b, a)) return
    found.push({
      level,
      id,
      metric,
      prior: a,
      current: b,
      priorPct: pct(a),
      currentPct: pct(b),
      deltaPct: Math.round((pct(b) - pct(a)) * 100) / 100,
      message:
        `${level} ${id} (${metric}): the previously committed figure was ${a.covered}/${a.total} ` +
        `(${pct(a).toFixed(2)}%), this one is ${b.covered}/${b.total} (${pct(b).toFixed(2)}%). ` +
        "The ratchet does not turn backwards. Re-measuring a drop records it; it does not permit it.",
    })
  }

  for (const metric of RATCHET_POLICY.metrics) {
    record("aggregate", "AGGREGATE", metric, prior.totals[metric], current.totals[metric])
  }
  const priorPaths = new Map(prior.byScopePath.map((row) => [row.path, row]))
  for (const row of current.byScopePath) {
    const before = priorPaths.get(row.path)
    if (before === undefined) continue
    for (const metric of RATCHET_POLICY.metrics) record("scope-path", row.path, metric, before[metric], row[metric])
  }
  return found
}

// ── The verdict ───────────────────────────────────────────────────────────────────────────────

export interface RatchetInput {
  baseline: CoverageMeasurement
  /** The `ratchet` block read off the baseline, or `null` when it declares none. */
  declaredPolicy: RatchetPolicy | null
  /** `null` means NO FIGURE WAS PRODUCED. It never means "unchanged". */
  measured: CoverageMeasurement | null
  unmeasuredReason: string | null
  prior: CoverageMeasurement | null
  priorRef: string | null
  priorReason: string
}

export function evaluateRatchet(input: RatchetInput): RatchetReport {
  const priorFigure = {
    available: input.prior !== null,
    ref: input.priorRef,
    reason: input.priorReason,
  }
  const base = {
    gate: GATE_NAME as typeof GATE_NAME,
    blocking: true as const,
    measured: input.measured !== null,
    unmeasuredReason: input.unmeasuredReason,
    priorFigure,
  }

  // 1. Policy. Checked first: every verdict below is only as meaningful as the rules it applied.
  if (input.declaredPolicy === null) {
    return {
      ...base,
      outcome: "policy-mismatch",
      drift: [],
      regressions: [],
      message:
        `${GATE_NAME} gate: FAIL (BLOCKING) — ${BASELINE_PATH} declares no \`ratchet\` policy, so the ` +
        "figure states no rule about what counts as a change to it. Restate it with " +
        "`bun scripts/verification/coverage-gate.ts --restate-policy`; that command writes the " +
        "policy and cannot write a figure.",
    }
  }
  const expected = ratchetPolicyDigest(RATCHET_POLICY)
  const declared = ratchetPolicyDigest(input.declaredPolicy)
  if (declared !== expected) {
    const differing = POLICY_SHA256_FIELDS.filter(
      (field) => JSON.stringify(input.declaredPolicy![field]) !== JSON.stringify(RATCHET_POLICY[field]),
    )
    return {
      ...base,
      outcome: "policy-mismatch",
      drift: [],
      regressions: [],
      message:
        `${GATE_NAME} gate: FAIL (BLOCKING) — the ratchet policy declared in ${BASELINE_PATH} ` +
        `disagrees with this executable's on: ${differing.join(", ")}. The policy is a constant of ` +
        "the gate; the baseline records a copy so a reviewer reads the rule next to the number it " +
        "governs. Editing that copy does not loosen the gate — it stops the gate.",
    }
  }

  const regressions =
    input.prior === null
      ? []
      : input.prior.scope.sha256 !== input.baseline.scope.sha256
        ? null
        : compareHistory(input.prior, input.baseline)

  if (regressions === null) {
    return {
      ...base,
      outcome: "regressed",
      drift: [],
      regressions: [],
      message:
        `${GATE_NAME} gate: FAIL (BLOCKING) — the previously committed figure (${input.priorRef ?? "prior"}) ` +
        "was measured over a different declared scope, so the two are incomparable and no ratchet " +
        "can be applied between them. Moving the denominator is the cheapest way to make a coverage " +
        "figure look better, so an incomparable pair is refused rather than assumed benign.",
    }
  }

  // 2. Not measured. Ranked above every figure comparison, because there is no figure to compare.
  if (input.measured === null) {
    return {
      ...base,
      outcome: "unmeasured",
      drift: [],
      regressions,
      message:
        `${GATE_NAME} gate: FAIL (BLOCKING) — nothing was measured, so nothing was checked. ` +
        `Reason: ${input.unmeasuredReason ?? "none given by the caller."}\n` +
        "  This is NOT a pass. `measure-coverage.ts` refuses to produce a figure from a red suite, " +
        "so a missing measurement means the suite failed, the run was interrupted, or no lcov was " +
        "written — never that coverage is unchanged. A gate that read those as the same fact would " +
        "have stopped measuring the first time the suite went flaky and reported PASS ever after. " +
        "Fix or re-run the suite; there is no flag here that makes this green.",
    }
  }

  if (input.measured.scope.sha256 !== input.baseline.scope.sha256) {
    return {
      ...base,
      outcome: "unrecorded",
      drift: [],
      regressions,
      message:
        `${GATE_NAME} gate: FAIL (BLOCKING) — the run measured a different declared scope than ` +
        `${BASELINE_PATH} records (measured ${input.measured.scope.sha256.slice(0, 12)}, baseline ` +
        `${input.baseline.scope.sha256.slice(0, 12)}). The scope is half of the figure: a number over ` +
        "a denominator nobody committed cannot be ratcheted against one over a denominator somebody " +
        "did. Re-measure and commit the scope with the figure.",
    }
  }

  const drifts = compareUnits(input.baseline, input.measured)
  const worse = drifts.filter((entry) => entry.direction === "regressed" || entry.direction === "vanished")
  const better = drifts.filter((entry) => entry.direction === "improved" || entry.direction === "appeared")

  const lines = (entries: readonly { message: string }[]): string =>
    entries.map((entry) => `    ${entry.message}`).join("\n")

  if (regressions.length > 0) {
    return {
      ...base,
      outcome: "regressed",
      drift: drifts,
      regressions,
      message:
        `${GATE_NAME} gate: FAIL (BLOCKING) — ${regressions.length} unit(s) are covered LESS than at ` +
        `the previously committed figure (${input.priorRef ?? "prior"}):\n${lines(regressions)}\n` +
        (drifts.length === 0
          ? "  The working tree agrees with the committed figure exactly, which is precisely why this " +
            "check exists: lowering coverage and re-measuring produces a run that matches the file.\n"
          : `  Additionally, ${drifts.length} unit(s) drift from the committed figure:\n${lines(drifts)}\n`),
    }
  }

  if (worse.length > 0) {
    return {
      ...base,
      outcome: "regressed",
      drift: drifts,
      regressions,
      message:
        `${GATE_NAME} gate: FAIL (BLOCKING) — ${worse.length} unit(s) measured BELOW the figure ` +
        `committed in ${BASELINE_PATH}:\n${lines(worse)}\n` +
        (better.length === 0 ? "" : `  Improvements in the same run:\n${lines(better)}\n`) +
        "  Coverage inside the declared scope went down. Add the tests, or delete the code — the one " +
        "thing that does not resolve this is editing the baseline, which the digests in that file " +
        "refuse and which this gate would then read as an unrecorded change anyway.",
    }
  }

  if (better.length > 0) {
    return {
      ...base,
      outcome: "unrecorded",
      drift: drifts,
      regressions,
      message:
        `${GATE_NAME} gate: FAIL (BLOCKING) — ${better.length} unit(s) measured ABOVE the figure ` +
        `committed in ${BASELINE_PATH}:\n${lines(better)}\n` +
        "  This is good news and it is still a failure. Raising the figure requires committing the " +
        `new baseline in the same change: run \`bun scripts/verification/measure-coverage.ts\` and ` +
        `commit ${BASELINE_PATH} alongside the code, then \`--restate-policy\` to carry the ratchet ` +
        "policy across. Otherwise the recorded figure and the real one drift apart silently, which " +
        "is the failure this gate exists to prevent — in the direction nobody watches.",
    }
  }

  return {
    ...base,
    outcome: "pass",
    drift: [],
    regressions,
    message:
      `${GATE_NAME} gate: PASS — an instrumented run reproduced the committed figure exactly ` +
      `(${input.baseline.totals.lines.covered}/${input.baseline.totals.lines.total} lines, ` +
      `${input.baseline.totals.functions.covered}/${input.baseline.totals.functions.total} functions ` +
      `over ${input.baseline.scope.paths.length} declared scope path(s), ` +
      `${input.baseline.files.length} file(s)), and the figure is at or above the previously ` +
      `committed one (${input.prior === null ? "no prior figure available" : (input.priorRef ?? "prior")}).`,
  }
}

export function exitCodeFor(report: RatchetReport): number {
  return report.outcome === "pass" ? 0 : 1
}

// ── Reporting ─────────────────────────────────────────────────────────────────────────────────

export function renderReport(report: RatchetReport): string {
  const out: string[] = [
    `EAP coverage ratchet — ${report.outcome.toUpperCase()} (blocking: ${report.blocking})`,
    `  baseline      ${BASELINE_PATH}`,
    `  measured      ${report.measured ? "yes — one instrumented run" : `NO — ${report.unmeasuredReason ?? "reason not given"}`}`,
    `  prior figure  ${report.priorFigure.available ? (report.priorFigure.ref ?? "available") : `no prior figure — ${report.priorFigure.reason}`}`,
    "",
  ]
  if (report.drift.length > 0) {
    out.push("  working tree vs committed figure — baseline / measured / delta:")
    for (const entry of report.drift) out.push(`    ${entry.message}`)
    out.push("")
  }
  if (report.regressions.length > 0) {
    out.push("  committed figure vs previously committed figure:")
    for (const entry of report.regressions) out.push(`    ${entry.message}`)
    out.push("")
  }
  out.push(report.message)
  return out.join("\n")
}

// ── Measuring, without ever writing a figure ──────────────────────────────────────────────────

export interface MeasureResult {
  measurement: CoverageMeasurement | null
  reason: string | null
}

/**
 * Runs the instrumented suite and builds a figure from Bun's own lcov output, exactly as
 * `measure-coverage.ts` does — and writes NOTHING. The gate must never be able to update the
 * artefact it is checking; that is the whole of acceptance 2.
 *
 * The suite's output goes to a FILE DESCRIPTOR, never a pipe. Task 14 measured this:
 * `reconnect-after-restart.test.ts` failed 2 of 2 spawned runs with `stdout: "pipe"` and 0 of 4 with
 * a redirected fd — pipe backpressure loses a SQLite handle-release race on Windows. A harness that
 * changes the timing of the thing it measures is measuring itself.
 */
export function measureNow(root: string, fromLcov: string | null): MeasureResult {
  let lcovFile: string
  if (fromLcov === null) {
    mkdirSync(join(root, ".verification"), { recursive: true })
    const logPath = join(root, ".verification", "coverage-gate-run.log")
    const fd = openSync(logPath, "w")
    let exitCode: number
    let output: string
    try {
      const result = Bun.spawnSync({
        cmd: ["bun", "test", "--coverage", "--coverage-reporter=lcov", `--coverage-dir=${COVERAGE_DIR}`],
        cwd: root,
        stdout: fd,
        stderr: fd,
      })
      exitCode = result.exitCode
    } finally {
      closeSync(fd)
    }
    output = readFileSync(logPath, "utf8")
    if (exitCode !== 0) {
      return {
        measurement: null,
        reason:
          `the instrumented suite exited ${exitCode}. Coverage of a red suite describes nothing, so ` +
          `no figure was produced. Tail of ${logPath}:\n${output.slice(-2000)}`,
      }
    }
    try {
      parseSuiteTally(output)
    } catch (error) {
      return { measurement: null, reason: (error as Error).message }
    }
    lcovFile = join(root, ...LCOV_PATH.split("/"))
    if (!existsSync(lcovFile)) {
      return {
        measurement: null,
        reason: `the run produced no ${LCOV_PATH}; the figure comes from the runner's own output and is never reconstructed from anything else (ADR-0021).`,
      }
    }
    return { measurement: figureFrom(root, lcovFile, output), reason: null }
  }

  // `resolve`, not `join`: an absolute path must stay the path the caller named. Joining it onto the
  // repo root produced a path that never exists, and the gate then reported "nothing was measured" —
  // correctly blocking, but for the wrong reason, which is its own kind of lie.
  lcovFile = resolve(root, fromLcov)
  if (!existsSync(lcovFile)) {
    return { measurement: null, reason: `--from-lcov ${fromLcov} does not exist, so nothing was measured.` }
  }
  return { measurement: figureFrom(root, lcovFile, null), reason: null }
}

function figureFrom(root: string, lcovFile: string, output: string | null): CoverageMeasurement {
  const scopeFiles = enumerateScopeFiles(root)
  const sourceDigests: Record<string, string> = {}
  for (const path of scopeFiles) {
    sourceDigests[path] = sha256(readFileSync(join(root, ...path.split("/")), "utf8"))
  }
  return buildMeasurement({
    records: parseLcov(readFileSync(lcovFile, "utf8")),
    scopeFiles,
    sourceDigests,
    // Timing and run identity take no part in any comparison this gate makes; they are recorded by
    // `measure-coverage.ts` when a figure is COMMITTED, and this function commits nothing.
    timing: { uninstrumentedMs: null, instrumentedMs: 0, measured: false },
    run: {
      command: `bun test --coverage --coverage-reporter=lcov --coverage-dir=${COVERAGE_DIR}`,
      commit: headCommit(root),
      tests:
        output === null
          ? { total: 0, passed: 0, failed: 0, skipped: 0 }
          : parseSuiteTally(output),
    },
  })
}

function headCommit(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  } catch {
    return process.env.GITHUB_SHA ?? "unknown"
  }
}

// ── The previously committed figure, read out of git ──────────────────────────────────────────

export interface PriorFigure {
  measurement: CoverageMeasurement | null
  ref: string | null
  reason: string
}

function git(root: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", [...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  } catch {
    return null
  }
}

/**
 * The version of the baseline at the point this change branched from. Candidates in order of
 * preference; the first that both resolves and carries the file wins. A prior that does not exist is
 * reported as absent WITH ITS REASON — never silently skipped, because "there was nothing to compare
 * against" and "the comparison passed" are different facts and this repository refuses to print one
 * as the other.
 */
export function readPriorFigure(root: string): PriorFigure {
  const base = process.env.GITHUB_BASE_REF
  const candidates = [
    ...(base === undefined || base.length === 0 ? [] : [`origin/${base}`, base]),
    "origin/main",
    "main",
  ]
  const tried: string[] = []
  for (const candidate of candidates) {
    const mergeBase = git(root, ["merge-base", candidate, "HEAD"])?.trim()
    if (mergeBase === undefined || mergeBase.length === 0) {
      tried.push(`${candidate} (no merge-base; a shallow clone cannot see one — set fetch-depth: 0)`)
      continue
    }
    const raw = git(root, ["show", `${mergeBase}:${BASELINE_PATH}`])
    if (raw === null) {
      tried.push(`${candidate}@${mergeBase.slice(0, 12)} (no ${BASELINE_PATH} at that commit)`)
      continue
    }
    try {
      return {
        measurement: loadCoverageBaseline(raw),
        ref: `${candidate}@${mergeBase.slice(0, 12)}`,
        reason: `merge-base with ${candidate}`,
      }
    } catch (error) {
      // A prior figure that does not load is not a missing one: it was tampered with, or the schema
      // moved. Reported rather than swallowed.
      tried.push(`${candidate}@${mergeBase.slice(0, 12)} (does not load: ${(error as Error).message})`)
    }
  }
  return {
    measurement: null,
    ref: null,
    reason: `no prior figure could be read. Tried: ${tried.join("; ") || "no candidate refs"}.`,
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────────

function restatePolicy(root: string): number {
  const file = join(root, ...BASELINE_PATH.split("/"))
  const raw = readFileSync(file, "utf8")
  // Refuse to touch a baseline that does not load: this command may not be a way to make a broken
  // figure look maintained.
  loadCoverageBaseline(raw)
  const parsed = JSON.parse(raw) as Record<string, unknown>
  parsed.ratchet = declaredPolicyBlock()
  writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
  // Re-read through the loader: the figures must be untouched by what we just did.
  loadCoverageBaseline(readFileSync(file, "utf8"))
  console.log(
    `${GATE_NAME} gate: wrote the ratchet policy into ${BASELINE_PATH} (digest ` +
      `${ratchetPolicyDigest(RATCHET_POLICY).slice(0, 12)}). No figure was written; ` +
      "`integrity.sha256` still validates.",
  )
  return 0
}

function main(): number {
  const root = repoRoot()
  if (process.argv.includes("--restate-policy")) return restatePolicy(root)

  const baselineFile = join(root, ...BASELINE_PATH.split("/"))
  if (!existsSync(baselineFile)) {
    console.error(
      `${GATE_NAME} gate: FAIL (BLOCKING) — ${BASELINE_PATH} does not exist. There is no figure to ` +
        "ratchet, which is a failure and not a pass.",
    )
    return 1
  }
  let baseline: CoverageMeasurement
  let declaredPolicy: RatchetPolicy | null
  try {
    const raw = readFileSync(baselineFile, "utf8")
    baseline = loadCoverageBaseline(raw)
    declaredPolicy = ((JSON.parse(raw) as { ratchet?: RatchetPolicy }).ratchet ?? null) as RatchetPolicy | null
  } catch (error) {
    console.error(
      `${GATE_NAME} gate: FAIL (BLOCKING) — the committed figure does not load: ${(error as Error).message}`,
    )
    return 1
  }

  const at = process.argv.indexOf("--from-lcov")
  const fromLcov = at === -1 ? null : (process.argv[at + 1] ?? null)
  if (at !== -1 && fromLcov === null) {
    console.error(`${GATE_NAME} gate: --from-lcov requires a path.`)
    return 1
  }

  const prior = readPriorFigure(root)
  const measured = measureNow(root, fromLcov)
  const report = evaluateRatchet({
    baseline,
    declaredPolicy,
    measured: measured.measurement,
    unmeasuredReason: measured.reason,
    prior: prior.measurement,
    priorRef: prior.ref,
    priorReason: prior.reason,
  })

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2))
    return exitCodeFor(report)
  }
  const text = renderReport(report)
  if (report.outcome === "pass") console.log(text)
  else console.error(text)
  return exitCodeFor(report)
}

if (import.meta.main) {
  process.exit(main())
}
