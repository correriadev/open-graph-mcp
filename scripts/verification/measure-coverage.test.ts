import { describe, expect, test } from "bun:test"

import {
  BASELINE_PATH,
  COVERAGE_SCOPE,
  SCOPE_SHA256_FIELDS,
  buildMeasurement,
  canonicalScopeDigest,
  integrityDigest,
  loadCoverageBaseline,
  normalizeCoveragePath,
  parseLcov,
  renderReport,
  scopeEntryFor,
  type Counted,
  type CoverageMeasurement,
  type LcovRecord,
} from "./measure-coverage"

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────
//
// Everything here is a fixture. The real figure is produced by the instrumented run and by nothing
// else (ADR-0021); a test that asserted a percentage would be a second, hand-authored source of the
// number and would make the baseline forgeable through the test file.

const LCOV = [
  "TN:",
  "SF:packages\\graph-core\\src\\eap\\budget.ts",
  "FNF:5",
  "FNH:4",
  "DA:7,86",
  "LF:28",
  "LH:27",
  "end_of_record",
  "TN:",
  "SF:packages/client/src/eap.ts",
  "FNF:6",
  "FNH:6",
  "LF:100",
  "LH:50",
  "end_of_record",
  "TN:",
  "SF:packages/mcp-server/src/http.ts",
  "FNF:3",
  "FNH:1",
  "LF:40",
  "LH:10",
  "end_of_record",
  "",
].join("\n")

const scopeFiles = ["packages/graph-core/src/eap/budget.ts", "packages/client/src/eap.ts"]

const digests: Record<string, string> = {
  "packages/graph-core/src/eap/budget.ts": "a".repeat(64),
  "packages/client/src/eap.ts": "b".repeat(64),
}

const measure = (overrides: Partial<Parameters<typeof buildMeasurement>[0]> = {}): CoverageMeasurement =>
  buildMeasurement({
    records: parseLcov(LCOV),
    scopeFiles,
    sourceDigests: digests,
    timing: { uninstrumentedMs: 80993, instrumentedMs: 82523, measured: true },
    run: {
      command: "bun test --coverage --coverage-reporter=lcov",
      commit: "0".repeat(40),
      tests: { total: 995, passed: 994, failed: 0, skipped: 1 },
    },
    ...overrides,
  })

const serialized = (measurement: CoverageMeasurement): string => JSON.stringify(measurement, null, 2)

// ── lcov parsing ──────────────────────────────────────────────────────────────────────────────

describe("parseLcov", () => {
  test("reads line and function figures per file", () => {
    const records = parseLcov(LCOV)
    expect(records).toHaveLength(3)
    const budget = records.find((r) => r.path === "packages/graph-core/src/eap/budget.ts") as LcovRecord
    expect(budget.lines).toEqual({ covered: 27, total: 28 })
    expect(budget.functions).toEqual({ covered: 4, total: 5 })
  })

  test("normalises Windows separators so a scope path matches on either platform", () => {
    expect(normalizeCoveragePath("packages\\graph-core\\src\\eap\\budget.ts")).toBe(
      "packages/graph-core/src/eap/budget.ts",
    )
  })

  test("refuses an lcov record that carries no LF/LH, rather than counting it as zero", () => {
    expect(() => parseLcov("TN:\nSF:packages/client/src/eap.ts\nFNF:1\nFNH:1\nend_of_record\n")).toThrow(
      /line figures/i,
    )
  })
})

// ── Scope ─────────────────────────────────────────────────────────────────────────────────────

describe("the declared scope", () => {
  test("enumerates the five EAP surfaces the task binds it to", () => {
    expect(COVERAGE_SCOPE.map((entry) => entry.path)).toEqual([
      "packages/client/src/eap.ts",
      "packages/graph-core/src/eap",
      "packages/mcp-server/src/eap",
      "packages/mcp-server/src/gates.ts",
      "packages/mcp-server/src/tools/eap.ts",
    ])
  })

  test("attributes a file to the scope path that declares it, and nothing else to any", () => {
    expect(scopeEntryFor("packages/graph-core/src/eap/budget.ts")?.path).toBe("packages/graph-core/src/eap")
    expect(scopeEntryFor("packages/mcp-server/src/gates.ts")?.path).toBe("packages/mcp-server/src/gates.ts")
    // Prefix-adjacent, deliberately: `src/eap.ts` is not inside `src/eap`.
    expect(scopeEntryFor("packages/mcp-server/src/eap.ts")).toBeNull()
    expect(scopeEntryFor("packages/mcp-server/src/http.ts")).toBeNull()
  })
})

// ── The measurement ───────────────────────────────────────────────────────────────────────────

describe("buildMeasurement", () => {
  test("aggregates only the declared scope, discarding out-of-scope instrumented files", () => {
    const m = measure()
    expect(m.files.map((f) => f.path)).toEqual(scopeFiles.slice().sort())
    expect(m.totals.lines).toEqual({ covered: 77, total: 128, pct: 60.16 })
    expect(m.totals.functions).toEqual({ covered: 10, total: 11, pct: 90.91 })
  })

  test("reports a per-scope-path roll-up as well as the aggregate, so a delta is actionable", () => {
    const rolled = measure().byScopePath
    expect(rolled.map((entry) => entry.path)).toEqual(COVERAGE_SCOPE.map((entry) => entry.path))
    const core = rolled.find((entry) => entry.path === "packages/graph-core/src/eap")!
    expect(core.lines).toEqual({ covered: 27, total: 28, pct: 96.43 })
    expect(core.files).toBe(1)
  })

  test("every file figure names the scope path it was attributed to", () => {
    for (const file of measure().files) expect(file.scopePath.length).toBeGreaterThan(0)
  })

  test("a scoped file that no test ever loaded is named, never quietly dropped", () => {
    const m = measure({ scopeFiles: [...scopeFiles, "packages/graph-core/src/eap/ghost.ts"] })
    expect(m.neverLoaded).toEqual(["packages/graph-core/src/eap/ghost.ts"])
    // It drags nothing down arithmetically because Bun reports no denominator for it — which is
    // exactly why it has to be named instead of being invisible inside a percentage.
    expect(m.totals.lines.total).toBe(128)
    expect(m.scope.filesInScope).toBe(3)
    expect(m.scope.filesInstrumented).toBe(2)
  })

  test("records the instrumented cost against the uninstrumented run", () => {
    const timing = measure().timing
    expect(timing.deltaMs).toBe(1530)
    expect(timing.measured).toBe(true)
    expect(timing.instrumentedMs).toBeGreaterThan(timing.uninstrumentedMs)
  })

  test("pins the sha256 of every measured source file, so a figure cannot outlive its code silently", () => {
    for (const file of measure().files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ── Acceptance 2: a figure without its scope is rejected, structurally ────────────────────────

describe("loadCoverageBaseline rejects a figure that is not usable", () => {
  const baseline = (): Record<string, unknown> => JSON.parse(serialized(measure())) as Record<string, unknown>

  const reject = (mutate: (doc: Record<string, unknown>) => void, pattern: RegExp): void => {
    const doc = baseline()
    mutate(doc)
    expect(() => loadCoverageBaseline(JSON.stringify(doc))).toThrow(pattern)
  }

  test("the unmutated baseline loads", () => {
    expect(loadCoverageBaseline(serialized(measure())).totals.lines.pct).toBeGreaterThan(0)
  })

  test("a baseline with no scope at all is rejected", () => {
    reject((doc) => delete doc.scope, /scope/i)
  })

  test("a baseline whose scope path list is empty is rejected", () => {
    reject((doc) => {
      ;(doc.scope as { paths: unknown[] }).paths = []
    }, /scope/i)
  })

  test("a baseline whose scope path list is absent is rejected", () => {
    reject((doc) => {
      delete (doc.scope as Record<string, unknown>).paths
    }, /scope/i)
  })

  test("a scope path list that disagrees with its own digest is rejected", () => {
    reject((doc) => {
      const scope = doc.scope as { paths: { path: string }[] }
      scope.paths = scope.paths.filter((entry) => entry.path !== "packages/mcp-server/src/tools/eap.ts")
    }, /scope/i)
  })

  test("a file figure with no scope attribution is rejected", () => {
    reject((doc) => {
      delete (doc.files as Record<string, unknown>[])[0]!.scopePath
    }, /scopePath|scope/i)
  })

  test("a hand-edited percentage is rejected: the figure is digest-pinned to the run that produced it", () => {
    reject((doc) => {
      ;(doc.totals as { lines: { pct: number } }).lines.pct = 99.9
    }, /integrity|tamper|digest/i)
  })

  test("an exclusion without a justification is rejected", () => {
    reject((doc) => {
      ;(doc.scope as { exclusions: unknown[] }).exclusions = [{ path: "packages/graph-core/src/eap/types.ts" }]
    }, /reason|justif/i)
  })

  test("a hand-edited per-file figure is rejected — the aggregate is not the only pinned number", () => {
    reject((doc) => {
      const files = doc.files as { lines: Counted }[]
      const partial = files.find((file) => file.lines.covered < file.lines.total)!
      partial.lines.covered = partial.lines.total
    }, /integrity/i)
  })

  test("a quietly cheapened instrumentation cost is rejected", () => {
    reject((doc) => {
      ;(doc.timing as { deltaMs: number }).deltaMs = 1
    }, /integrity/i)
  })

  test("an edited never-loaded inventory is rejected", () => {
    reject((doc) => {
      ;(doc.neverLoaded as string[]).push("packages/graph-core/src/eap/ghost.ts")
    }, /integrity/i)
  })

  test("an unknown schema version is not reinterpreted", () => {
    reject((doc) => {
      doc.schemaVersion = 99
    }, /schemaVersion/i)
  })

  test("the scope digest covers exactly the fields a reader needs to use the figure", () => {
    expect(SCOPE_SHA256_FIELDS).toEqual(["paths", "exclusions"])
    const m = measure()
    expect(m.scope.sha256).toBe(canonicalScopeDigest(m.scope))
    expect(m.integrity.sha256).toBe(integrityDigest(m))
  })
})

// ── Reporting ─────────────────────────────────────────────────────────────────────────────────

describe("renderReport", () => {
  test("prints the scope beside the figure, never the figure alone", () => {
    const text = renderReport(measure())
    expect(text).toContain("packages/graph-core/src/eap")
    expect(text).toContain("packages/mcp-server/src/tools/eap.ts")
    expect(text).toMatch(/lines/i)
    expect(text).toMatch(/functions/i)
    expect(text).toContain(BASELINE_PATH)
  })
})
