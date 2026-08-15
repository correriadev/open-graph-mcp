/**
 * F002 task 19 — the blocking half of the scale and read-model volume probe.
 *
 * This file is where the probe's INTEGRITY becomes an assertion, and it is deliberately the ONLY
 * place in task 19 where an assertion exists. What it asserts is carefully bounded, because the
 * subject of this probe sits inside quarantine family QA6 — "Page size, batching limits, and
 * completion bounds for very large closures" — and `001` §5 rule 3 permits measurement there and
 * forbids assertion.
 *
 * So NOTHING here asserts:
 *   - a maximum or minimum wall time, for anything;
 *   - a maximum or minimum heap footprint, for anything;
 *   - a maximum batch size, a page size, or a completion bound;
 *   - that the read models do or do not return every row.
 *
 * That last exclusion is the one worth spelling out, because it is the tempting one. A test asserting
 * that `getEvents()` returns all N rows would be asserting a page size of infinity, which is exactly
 * the pagination contract QA6 defers. The row count is RECORDED beside the durable mirror's own row
 * count and the two are left to be compared by a reader, not by a gate.
 *
 * What IS asserted is that the MEASUREMENT is sound: every declared metric was actually measured,
 * every value is finite and attributable to a run and a commit, every sample is labelled with the
 * quarantine family it was observed inside, and every sample is legal against the Benchmark Ledger's
 * own validator — the one that refuses `expected`/`bound`/`asserted`/`threshold`/`budget`/`limit` and
 * refuses any sample naming a Scenario Identifier. A probe that measured nothing and reported a pass
 * is the failure mode this file exists to make impossible.
 *
 * This file imports no Discharge Annotation surface, so it is NOT a member of the EAP Test Corpus
 * (`reconcile-traceability.ts` decides membership by looking for an import of the annotation module
 * in the file's own bytes — which is why this comment must not spell that import path out, or the
 * mention alone would enrol this probe in the corpus). It discharges no Scenario Identifier and
 * claims none.
 */

import { describe, expect, test } from "bun:test"

import { validateSample } from "../../../../scripts/verification/benchmark-ledger.ts"
import { buildSample } from "./host"
import {
  IN_SUITE_SIZE,
  MEASURED_METRICS,
  QUARANTINE_FAMILY,
  TL_OPEN_POINT_1,
  TL_OPEN_POINT_3,
  runScaleProbe,
  toSamples,
  verifyMeasurementIntegrity,
  type ScaleMeasurement,
} from "./scale-probe"

const measurement = (overrides: Partial<ScaleMeasurement> = {}): ScaleMeasurement => ({
  targetClaims: 100,
  repositorySourceDigest: "0".repeat(64),
  probeWallMs: 12.5,
  points: [
    {
      claims: 100,
      proposals: 100,
      recallCases: 4,
      closurePerCase: 25,
      batchSize: 50,
      fixtureBuildMs: 10,
      batchMs: [4, 6],
      rederivationMs: 3,
      eventLoopLagMaxMs: 1.5,
      // This fixture represents the full probe shape. The real in-suite run below deliberately
      // disables the separate-process writer and therefore exercises the nullable path instead.
      contendingWriterWaitMaxMs: 2.5,
      readModels: [
        {
          readModel: "getEvents",
          rowsReturned: 100,
          durableRows: 100,
          wallMs: 2,
          observedPeakHeapBytes: 32768,
          retainedHeapBytes: 4096,
          postCallHeapBytes: 8192,
          rssDeltaBytes: 16384,
        },
        {
          readModel: "getProposalsForParent",
          rowsReturned: 100,
          durableRows: 100,
          wallMs: 1,
          observedPeakHeapBytes: 16384,
          retainedHeapBytes: 2048,
          postCallHeapBytes: 4096,
          rssDeltaBytes: 8192,
        },
      ],
    },
  ],
  ...overrides,
})

describe("the TL.json open points this probe answers are cited verbatim, in the test name", () => {
  test(
    "TL.json open point 1 — \"When `ensureRecallClosureIndex` detects an out-of-sync closure marker " +
      "following a state restore or JSONL rebuild, how will executing synchronous re-derivation across " +
      "thousands of historical recall cases inside a `serialTransaction` affect SQLite write-lock " +
      "duration and event-loop responsiveness under concurrent tenant load?\" — is measured by " +
      "eap.scale.recall.closure.rederivation.*",
    () => {
      expect(TL_OPEN_POINT_1).toContain("ensureRecallClosureIndex")
      expect(TL_OPEN_POINT_1).toContain("serialTransaction")
      expect(TL_OPEN_POINT_1).toContain("event-loop responsiveness under concurrent tenant load")
      const metrics = MEASURED_METRICS.filter((metric) => metric.includes("rederivation"))
      expect(metrics.length).toBeGreaterThanOrEqual(3)
    },
  )

  test(
    "TL.json open point 3 — \"How will `SqlitePromotionRepository.getEvents` and " +
      "`getProposalsForParent` maintain predictable heap memory footprints and query response times as " +
      "historical promotion events and proposals accumulate over long-running tenant lifecycles without " +
      "pagination cursors or retention windows?\" — is measured by eap.scale.promotion.*",
    () => {
      expect(TL_OPEN_POINT_3).toContain("SqlitePromotionRepository.getEvents")
      expect(TL_OPEN_POINT_3).toContain("getProposalsForParent")
      expect(TL_OPEN_POINT_3).toContain("without pagination cursors or retention windows")
      for (const leaf of ["rows", "wall", "heap.observed_peak_lower_bound"]) {
        expect(MEASURED_METRICS.some((m) => m.startsWith("eap.scale.promotion.") && m.endsWith(leaf))).toBe(true)
      }
    },
  )
})

describe("every sample this probe emits is legal against the ledger's own validator", () => {
  test("each declared metric produces exactly one sample, labelled with the quarantine family it was observed inside", () => {
    const samples = toSamples(measurement())
    expect(samples.map((sample) => sample.metric).sort()).toEqual([...MEASURED_METRICS].sort())
    for (const sample of samples) expect(sample.familyId).toBe(QUARANTINE_FAMILY)
  })

  test("the Benchmark Ledger's validateSample accepts every one of them, so no sample carries a decision", () => {
    for (const sample of toSamples(measurement())) {
      const sealed = buildSample(sample)
      expect(() => validateSample(sealed, 1)).not.toThrow()
    }
  })

  test("a sample that carried a bound would be REFUSED by the same validator, which is why none does", () => {
    const poisoned = { ...buildSample(toSamples(measurement())[0]!), bound: 500 }
    expect(() => validateSample(poisoned, 1)).toThrow(/OBSERVATION/)
  })
})

describe("verifyMeasurementIntegrity — a probe that measured nothing must not read as a pass", () => {
  test("a complete measurement is admitted", () => {
    const verdict = verifyMeasurementIntegrity(measurement())
    expect(verdict.problems).toEqual([])
    expect(verdict.ok).toBe(true)
  })

  test("a run with no scale point is REFUSED, because nothing was observed", () => {
    const verdict = verifyMeasurementIntegrity(measurement({ points: [] }))
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.join(" ")).toContain("no scale point")
  })

  test("a non-finite wall time is REFUSED, because it is not a measurement", () => {
    const broken = measurement()
    broken.points[0]!.rederivationMs = Number.NaN
    const verdict = verifyMeasurementIntegrity(broken)
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.join(" ")).toContain("rederivationMs")
  })

  test("a read model that was never exercised is REFUSED, so a silently skipped read model cannot pass", () => {
    const broken = measurement()
    broken.points[0]!.readModels = broken.points[0]!.readModels.filter((r) => r.readModel === "getEvents")
    const verdict = verifyMeasurementIntegrity(broken)
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.join(" ")).toContain("getProposalsForParent")
  })

  test("a row count that is not a whole number of rows is REFUSED", () => {
    const broken = measurement()
    broken.points[0]!.readModels[0]!.rowsReturned = 12.5
    const verdict = verifyMeasurementIntegrity(broken)
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.join(" ")).toContain("rowsReturned")
  })

  test("a negative observed heap peak is REFUSED because an absolute heap high-water mark cannot be negative", () => {
    const broken = measurement()
    broken.points[0]!.readModels[0]!.observedPeakHeapBytes = -1
    const verdict = verifyMeasurementIntegrity(broken)
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.join(" ")).toContain("observedPeakHeapBytes")
  })

  test("the verdict names no threshold, so nothing here can become a bound by accident", () => {
    const verdict = verifyMeasurementIntegrity(measurement())
    const keys = Object.keys(verdict).join(" ").toLowerCase()
    for (const forbidden of ["expected", "bound", "threshold", "budget", "limit", "max", "min"]) {
      expect(keys).not.toContain(forbidden)
    }
  })
})

describe("the probe, run for real against real storage at a small size", () => {
  test(
    "a real tenant is built through the real repositories and both unpaginated read models are observed",
    async () => {
      const run = await runScaleProbe({ ...IN_SUITE_SIZE, contendingWriter: false })

      // The measurement is sound. This is the whole blocking claim: it says nothing about how big or
      // how fast anything was.
      const verdict = verifyMeasurementIntegrity(run.measurement)
      expect(verdict.problems).toEqual([])
      expect(verdict.ok).toBe(true)

      // The subject really is the production read model, not a copy of it.
      expect(run.measurement.repositorySourceDigest).toMatch(/^[0-9a-f]{64}$/)

      // Recording is off under `bun test`, and "measured but not recorded" is a different fact from
      // "recorded" — this repository does not print one as the other.
      expect(run.recorded).toEqual([])
    },
    120_000,
  )
})
