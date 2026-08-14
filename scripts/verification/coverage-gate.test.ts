/**
 * F002 task 15 — the Coverage Baseline Ratchet Gate.
 *
 * ── A WARNING TO ANYONE EDITING THIS FILE ─────────────────────────────────────────────────────
 * These tests run INSIDE `bun test`. `measureNow()` SPAWNS `bun test --coverage`. Calling it from
 * here would fork-bomb the suite. Every test below therefore exercises the PURE functions
 * (`evaluateRatchet`, `compareUnits`, `exitCodeFor`, `ratchetPolicyDigest`) over fixtures, plus the
 * real committed artefact read from disk. Nothing here runs a suite.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  GATE_NAME,
  RATCHET_POLICY,
  evaluateRatchet,
  exitCodeFor,
  ratchetPolicyDigest,
  renderReport,
  type RatchetReport,
} from "./coverage-gate"
import {
  BASELINE_PATH,
  loadCoverageBaseline,
  type CoverageMeasurement,
} from "./measure-coverage"
import { repoRoot } from "./register-scenarios"

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────

const ROOT = repoRoot()

/**
 * The committed figure, read THROUGH `loadCoverageBaseline` — never by parsing the JSON here.
 * Task 14 made that loader the only door into the number: a figure separated from its scope is not
 * a figure. Reading the file directly in this test file would defeat exactly what task 14 built.
 */
function committedBaseline(): CoverageMeasurement {
  return loadCoverageBaseline(readFileSync(join(ROOT, ...BASELINE_PATH.split("/")), "utf8"))
}

/** A deep copy of the committed figure, usable as a synthetic "measured" side. */
const clone = (m: CoverageMeasurement): CoverageMeasurement =>
  JSON.parse(JSON.stringify(m)) as CoverageMeasurement

/** Move one scope path's line counts, keeping the aggregate consistent with it. */
function shiftLines(m: CoverageMeasurement, scopePath: string, coveredDelta: number): CoverageMeasurement {
  const entry = m.byScopePath.find((row) => row.path === scopePath)!
  entry.lines.covered += coveredDelta
  entry.lines.pct = Math.round((entry.lines.covered / entry.lines.total) * 10000) / 100
  const file = m.files.find((row) => row.scopePath === scopePath)!
  file.lines.covered += coveredDelta
  m.totals.lines.covered += coveredDelta
  m.totals.lines.pct = Math.round((m.totals.lines.covered / m.totals.lines.total) * 10000) / 100
  return m
}

function shiftFunctions(m: CoverageMeasurement, scopePath: string, coveredDelta: number): CoverageMeasurement {
  const entry = m.byScopePath.find((row) => row.path === scopePath)!
  entry.functions.covered += coveredDelta
  entry.functions.pct = Math.round((entry.functions.covered / entry.functions.total) * 10000) / 100
  const file = m.files.find((row) => row.scopePath === scopePath)!
  file.functions.covered += coveredDelta
  m.totals.functions.covered += coveredDelta
  m.totals.functions.pct = Math.round((m.totals.functions.covered / m.totals.functions.total) * 10000) / 100
  return m
}

const evaluate = (over: Partial<Parameters<typeof evaluateRatchet>[0]> = {}): RatchetReport => {
  const baseline = committedBaseline()
  return evaluateRatchet({
    baseline,
    declaredPolicy: RATCHET_POLICY,
    measured: clone(baseline),
    unmeasuredReason: null,
    prior: null,
    priorRef: null,
    priorReason: "no prior figure in this fixture",
    ...over,
  })
}

const SCOPE = "packages/graph-core/src/eap"

// ── The policy lives in the baseline (acceptance: "the policy on what counts") ─────────────────

describe("the ratchet policy is declared, not implied", () => {
  test("the executable's policy states rounding, counts-vs-percentages, and the unmeasured rule", () => {
    expect(RATCHET_POLICY.gate).toBe(GATE_NAME)
    expect(RATCHET_POLICY.blocking).toBe(true)
    for (const key of ["workingTree", "history", "rounding", "countsVersusPercentages", "unmeasured"] as const) {
      expect(RATCHET_POLICY[key].length).toBeGreaterThan(80)
    }
    expect(RATCHET_POLICY.units).toEqual(["aggregate", "scope-path", "file"])
    expect(RATCHET_POLICY.metrics).toEqual(["lines", "functions"])
  })

  test("the committed baseline declares that same policy, digest and all", () => {
    const raw = JSON.parse(readFileSync(join(ROOT, ...BASELINE_PATH.split("/")), "utf8")) as {
      ratchet?: Record<string, unknown> & { sha256?: string }
    }
    expect(raw.ratchet).toBeDefined()
    expect(raw.ratchet!.sha256).toBe(ratchetPolicyDigest(RATCHET_POLICY))
  })

  test("a baseline whose declared policy disagrees with the executable is refused", () => {
    const report = evaluate({
      declaredPolicy: { ...RATCHET_POLICY, rounding: "percentages are compared to 2 decimal places" },
    })
    expect(report.outcome).toBe("policy-mismatch")
    expect(exitCodeFor(report)).toBe(1)
    expect(report.message).toContain("rounding")
  })

  test("a baseline that declares no policy at all is refused", () => {
    const report = evaluate({ declaredPolicy: null })
    expect(report.outcome).toBe("policy-mismatch")
    expect(exitCodeFor(report)).toBe(1)
  })
})

// ── Acceptance 1: a lowered figure fails, with baseline / measured / delta all reported ────────

describe("acceptance 1 — a lowered figure fails and reports baseline, measured and delta", () => {
  test("an unchanged figure passes", () => {
    const report = evaluate()
    expect(report.outcome).toBe("pass")
    expect(exitCodeFor(report)).toBe(0)
    expect(report.measured).toBe(true)
    expect(report.drift).toEqual([])
  })

  test("fewer covered LINES inside the scope fails", () => {
    const report = evaluate({ measured: shiftLines(clone(committedBaseline()), SCOPE, -7) })
    expect(report.outcome).toBe("regressed")
    expect(exitCodeFor(report)).toBe(1)
    const aggregate = report.drift.find((d) => d.level === "aggregate" && d.metric === "lines")!
    expect(aggregate.direction).toBe("regressed")
    expect(aggregate.baseline.covered).toBe(2994)
    expect(aggregate.measured!.covered).toBe(2987)
    expect(aggregate.deltaCovered).toBe(-7)
    expect(aggregate.deltaPct).toBeLessThan(0)
    // Reported at scope-path granularity too, so the rot is attributable.
    expect(report.drift.some((d) => d.level === "scope-path" && d.id === SCOPE)).toBe(true)
    expect(report.drift.some((d) => d.level === "file")).toBe(true)
  })

  test("fewer covered FUNCTIONS inside the scope fails", () => {
    const report = evaluate({ measured: shiftFunctions(clone(committedBaseline()), SCOPE, -2) })
    expect(report.outcome).toBe("regressed")
    const aggregate = report.drift.find((d) => d.level === "aggregate" && d.metric === "functions")!
    expect(aggregate.baseline.covered).toBe(223)
    expect(aggregate.measured!.covered).toBe(221)
    expect(aggregate.deltaCovered).toBe(-2)
  })

  test("the rendered report carries all three numbers for a human", () => {
    const report = evaluate({ measured: shiftLines(clone(committedBaseline()), SCOPE, -7) })
    const text = renderReport(report)
    expect(text).toContain("baseline")
    expect(text).toContain("measured")
    expect(text).toContain("delta")
    expect(text).toContain("2994")
    expect(text).toContain("2987")
  })
})

// ── Acceptance 2: raising the figure requires committing the new baseline in the same change ──

describe("acceptance 2 — an unrecorded improvement fails", () => {
  test("more covered lines than the committed figure fails until the baseline is recommitted", () => {
    const report = evaluate({ measured: shiftLines(clone(committedBaseline()), SCOPE, +9) })
    expect(report.outcome).toBe("unrecorded")
    expect(exitCodeFor(report)).toBe(1)
    const aggregate = report.drift.find((d) => d.level === "aggregate" && d.metric === "lines")!
    expect(aggregate.direction).toBe("improved")
    expect(aggregate.deltaCovered).toBe(9)
    expect(report.message).toContain(BASELINE_PATH)
    expect(report.message.toLowerCase()).toContain("same change")
  })

  test("a scoped file that appeared in the measurement but not in the baseline fails", () => {
    const measured = clone(committedBaseline())
    measured.files.push({
      path: "packages/graph-core/src/eap/brand-new.ts",
      scopePath: SCOPE,
      sha256: "0".repeat(64),
      lines: { covered: 5, total: 20 },
      functions: { covered: 1, total: 3 },
    })
    const report = evaluate({ measured })
    expect(exitCodeFor(report)).toBe(1)
    expect(report.drift.some((d) => d.direction === "appeared")).toBe(true)
  })

  test("a scoped file the baseline records but the run never measured fails", () => {
    const measured = clone(committedBaseline())
    measured.files = measured.files.filter((f) => f.path !== "packages/graph-core/src/eap/recall.ts")
    const report = evaluate({ measured })
    expect(exitCodeFor(report)).toBe(1)
    expect(report.drift.some((d) => d.direction === "vanished")).toBe(true)
  })

  test("moving the denominator — a different scope digest — fails rather than re-scoping", () => {
    const measured = clone(committedBaseline())
    measured.scope.sha256 = "f".repeat(64)
    const report = evaluate({ measured })
    expect(exitCodeFor(report)).toBe(1)
    expect(report.message).toContain("scope")
  })
})

// ── The single most important constraint: "not measured" is never "unchanged" ─────────────────

describe("not measured is distinguishable from measured-and-equal, and is never green", () => {
  test("a run that produced no figure fails, with the reason named", () => {
    const report = evaluate({
      measured: null,
      unmeasuredReason: "the instrumented suite exited 1; coverage of a red suite describes nothing",
    })
    expect(report.outcome).toBe("unmeasured")
    expect(exitCodeFor(report)).toBe(1)
    expect(report.measured).toBe(false)
    expect(report.unmeasuredReason).toContain("red suite")
  })

  test("an EMPTY drift list does not make an unmeasured run pass", () => {
    const unmeasured = evaluate({ measured: null, unmeasuredReason: "lcov.info was never produced" })
    const equal = evaluate()
    // Both have nothing to report. Exactly one of them is green.
    expect(unmeasured.drift).toEqual([])
    expect(equal.drift).toEqual([])
    expect(exitCodeFor(equal)).toBe(0)
    expect(exitCodeFor(unmeasured)).toBe(1)
    expect(unmeasured.outcome).not.toBe(equal.outcome)
    expect(unmeasured.message).not.toBe(equal.message)
    expect(unmeasured.message).toContain("nothing was measured")
  })

  test("an unmeasured run with no reason given is still a failure", () => {
    const report = evaluate({ measured: null, unmeasuredReason: null })
    expect(exitCodeFor(report)).toBe(1)
    expect(report.outcome).toBe("unmeasured")
  })
})

// ── The history ratchet: lowering the figure AND re-measuring must still fail ──────────────────

describe("monotonicity across commits — re-measuring a drop does not launder it", () => {
  const priorOf = (coveredDelta: number): CoverageMeasurement =>
    shiftLines(clone(committedBaseline()), SCOPE, coveredDelta)

  test("a committed figure below the previously committed one fails, even with a matching run", () => {
    // Prior had 9 more covered lines than what is committed now; the working tree agrees with the
    // committed figure exactly, so check A is clean. The ratchet still has to catch this.
    const report = evaluate({ prior: priorOf(+9), priorRef: "origin/main", priorReason: "merge-base" })
    expect(report.outcome).toBe("regressed")
    expect(exitCodeFor(report)).toBe(1)
    expect(report.drift).toEqual([])
    expect(report.regressions.length).toBeGreaterThan(0)
    const aggregate = report.regressions.find((r) => r.level === "aggregate" && r.metric === "lines")!
    expect(aggregate.priorPct).toBeGreaterThan(aggregate.currentPct)
  })

  test("a committed figure above the previously committed one passes", () => {
    const report = evaluate({ prior: priorOf(-9), priorRef: "origin/main", priorReason: "merge-base" })
    expect(report.outcome).toBe("pass")
    expect(report.regressions).toEqual([])
  })

  test("rounding never decides the verdict — a drop invisible at 2dp is still caught", () => {
    // The fixture must be a drop that a 2dp comparison CANNOT see, or it proves nothing about
    // rounding. Prior 2997/3260 = 91.9325%, current 2994/3257 = 91.9251%: the exact ratio falls, and
    // BOTH round to 91.93. A gate comparing the rounded `pct` fields would call this equal and pass.
    // (An earlier version of this test used 2994/3256, which rounds to 91.95 — visibly different at
    // 2dp, so a rounded-comparison gate caught it too and the test asserted nothing. That mutant
    // survived; this fixture kills it.)
    const prior = clone(committedBaseline())
    const current = committedBaseline()
    prior.totals.lines = { covered: 2997, total: 3260, pct: Math.round((2997 / 3260) * 10000) / 100 }
    prior.byScopePath = current.byScopePath
    expect(prior.totals.lines.pct).toBe(current.totals.lines.pct)
    expect(2994 * 3260).toBeLessThan(2997 * 3257)
    const report = evaluateRatchet({
      baseline: current,
      declaredPolicy: RATCHET_POLICY,
      measured: clone(current),
      unmeasuredReason: null,
      prior,
      priorRef: "origin/main",
      priorReason: "merge-base",
    })
    expect(report.outcome).toBe("regressed")
    expect(report.regressions.some((r) => r.level === "aggregate" && r.metric === "lines")).toBe(true)
  })

  test("a prior figure over a different scope is incomparable, and that is a failure", () => {
    const prior = clone(committedBaseline())
    prior.scope.sha256 = "a".repeat(64)
    const report = evaluate({ prior, priorRef: "origin/main", priorReason: "merge-base" })
    expect(exitCodeFor(report)).toBe(1)
    expect(report.message).toContain("incomparable")
  })

  test("no prior figure is reported as unavailable, with its reason, and does not itself fail", () => {
    const report = evaluate({
      prior: null,
      priorRef: null,
      priorReason: "docs/verification/coverage-baseline.json does not exist at the merge-base",
    })
    expect(report.priorFigure.available).toBe(false)
    expect(report.priorFigure.reason).toContain("merge-base")
    expect(report.outcome).toBe("pass")
    expect(renderReport(report)).toContain("no prior figure")
  })
})

// ── Precedence ────────────────────────────────────────────────────────────────────────────────

describe("outcome precedence", () => {
  test("a real regression outranks an unrecorded improvement in the reported outcome", () => {
    const measured = shiftLines(clone(committedBaseline()), SCOPE, +9)
    const prior = shiftLines(clone(committedBaseline()), SCOPE, +40)
    const report = evaluate({ measured, prior, priorRef: "origin/main", priorReason: "merge-base" })
    expect(report.outcome).toBe("regressed")
    expect(report.drift.length).toBeGreaterThan(0)
    expect(report.regressions.length).toBeGreaterThan(0)
  })

  test("an unmeasured run outranks everything except a broken policy", () => {
    const prior = shiftLines(clone(committedBaseline()), SCOPE, +40)
    const report = evaluate({ measured: null, unmeasuredReason: "spawn failed", prior, priorRef: "x", priorReason: "y" })
    expect(report.outcome).toBe("unmeasured")
  })
})
