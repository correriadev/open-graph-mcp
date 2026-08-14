/**
 * F002 task 16 — tests for the Benchmark Ledger and its noise policy.
 *
 * Every acceptance criterion is driven here through the same exported functions the executable and
 * the probe harness use. Nothing in this file re-implements the chain, the band, or the fingerprint:
 * a test that reimplemented them could agree with itself while disagreeing with the artefact.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  BAND_MAD_MULTIPLIER,
  BAND_RELATIVE_FLOOR,
  BREACH_K,
  FINGERPRINT_COMPONENTS,
  FINGERPRINT_EXCLUSIONS,
  LEDGER_PATH,
  MIN_BAND_WINDOW,
  POLICY_TEXT,
  SCHEMA_VERSION,
  canonicalJson,
  deriveBand,
  detectRunner,
  evaluateLedger,
  exitCodeFor,
  fingerprintId,
  mad,
  median,
  parseLedger,
  policyRecord,
  reconcileAppendOnly,
  sealAll,
  serializeLedger,
  verdictFor,
  type BandRecord,
  type RunnerComponents,
  type SampleRecord,
  type UnsealedBand,
  type UnsealedSample,
} from "./benchmark-ledger"
import { detectQuarantineViolations } from "./quarantine-gate"
import { QUARANTINE_PATH, loadQuarantine } from "./quarantine"
import { repoRoot } from "./register-scenarios"

// ── Fixtures built through the real constructors ──────────────────────────────────────────────

const RUNNER_A: RunnerComponents = {
  os: "win32",
  arch: "x64",
  cpuModel: "Test CPU A",
  cpuCount: 8,
  memGiB: 16,
  runtime: "bun",
  runtimeVersion: "1.3.14",
  environment: "local",
  ciImage: "",
}

const RUNNER_B: RunnerComponents = { ...RUNNER_A, cpuCount: 4, cpuModel: "Test CPU B" }

const FP_A = fingerprintId(RUNNER_A)
const FP_B = fingerprintId(RUNNER_B)

function sample(value: number, runner: RunnerComponents = RUNNER_A, extra: Partial<UnsealedSample> = {}): UnsealedSample {
  return {
    kind: "sample",
    metric: "probe.demo.wall",
    value,
    unit: "ms",
    runId: `run-${value}`,
    commit: "0".repeat(40),
    runnerFingerprint: fingerprintId(runner),
    runner,
    at: "2026-08-14T00:00:00.000Z",
    ...extra,
  }
}

/** A ledger of a policy record followed by the given unsealed records, sealed into a chain. */
const ledgerOf = (...records: (UnsealedSample | UnsealedBand)[]) => sealAll([policyRecord(), ...records])

// ── The runner fingerprint (acceptance 1) ─────────────────────────────────────────────────────

describe("runner fingerprint", () => {
  test("is stable across two detections in the same environment", () => {
    expect(fingerprintId(detectRunner())).toBe(fingerprintId(detectRunner()))
  })

  test("carries nothing that changes every run — no pid, no timestamp, no hostname", () => {
    const detected = detectRunner()
    const keys = Object.keys(detected).sort()
    expect(keys).toEqual([...FINGERPRINT_COMPONENTS].sort())
    const serialized = canonicalJson(detected)
    expect(serialized).not.toContain(String(process.pid))
    for (const excluded of FINGERPRINT_EXCLUSIONS) {
      expect(keys).not.toContain(excluded.field)
      expect(excluded.why.length).toBeGreaterThan(0)
    }
  })

  test("changes when a component that changes a timing changes", () => {
    expect(fingerprintId({ ...RUNNER_A, cpuCount: 16 })).not.toBe(FP_A)
    expect(fingerprintId({ ...RUNNER_A, runtimeVersion: "1.3.15" })).not.toBe(FP_A)
    expect(fingerprintId({ ...RUNNER_A, environment: "ci" })).not.toBe(FP_A)
  })
})

// ── Sample validation (acceptance 1) ──────────────────────────────────────────────────────────

describe("sample validation", () => {
  test("a sample missing its runner fingerprint is rejected on append", () => {
    const { runnerFingerprint: _drop, ...withoutFingerprint } = sample(10)
    expect(() => sealAll([policyRecord(), withoutFingerprint as UnsealedSample])).toThrow(/runnerFingerprint/)
  })

  test("a sample whose fingerprint does not hash its own runner components is rejected", () => {
    expect(() => ledgerOf(sample(10, RUNNER_A, { runnerFingerprint: FP_B }))).toThrow(/do not hash to it/)
  })

  test.each(["metric", "value", "unit", "runId", "commit", "runner"] as const)(
    "a sample missing %s is rejected",
    (field) => {
      const record = { ...sample(10) } as Record<string, unknown>
      delete record[field]
      expect(() => sealAll([policyRecord(), record as unknown as UnsealedSample])).toThrow()
    },
  )

  test.each(["expected", "bound", "asserted"] as const)(
    "a sample carrying %s is rejected — that is an assertion, not an observation",
    (field) => {
      expect(() => ledgerOf(sample(10, RUNNER_A, { [field]: 5 } as Partial<UnsealedSample>))).toThrow(
        /observation|assertion/i,
      )
    },
  )

  test("a sample naming a Scenario Identifier is rejected — a benchmark never discharges a Scenario", () => {
    expect(() => ledgerOf(sample(10, RUNNER_A, { note: "covers EAP-QUAR-006" } as Partial<UnsealedSample>))).toThrow(
      /Scenario Identifier/,
    )
  })

  test("a sample may name a quarantine family, and only one of the seven", () => {
    expect(() => ledgerOf(sample(10, RUNNER_A, { familyId: "QA6" } as Partial<UnsealedSample>))).not.toThrow()
    expect(() => ledgerOf(sample(10, RUNNER_A, { familyId: "QA9" } as Partial<UnsealedSample>))).toThrow(/QA9/)
  })
})

// ── The band (acceptance 2) ───────────────────────────────────────────────────────────────────

describe("band derivation", () => {
  const window = [100, 104, 96, 102, 98]

  test("median and MAD are the centre and the spread", () => {
    expect(median(window)).toBe(100)
    expect(mad(window)).toBe(2)
  })

  test("a derived band records k, and k is the policy's k", () => {
    const samples = window.map((value) => sample(value))
    const records = ledgerOf(...samples)
    const band = deriveBand(records, "probe.demo.wall", FP_A)
    expect(band.k).toBe(BREACH_K)
    expect(band.madMultiplier).toBe(BAND_MAD_MULTIPLIER)
    expect(band.relativeFloor).toBe(BAND_RELATIVE_FLOOR)
    expect(band.derivedFrom.sampleSeqs.length).toBe(window.length)
  })

  test("the half-width is max(m*MAD, floor*centre), so a zero-MAD window is not a zero-width band", () => {
    const flat = ledgerOf(...[50, 50, 50, 50, 50].map((value) => sample(value)))
    const band = deriveBand(flat, "probe.demo.wall", FP_A)
    expect(band.spread).toBe(0)
    expect(band.upper).toBe(50 + 50 * BAND_RELATIVE_FLOOR)
    expect(band.lower).toBe(50 - 50 * BAND_RELATIVE_FLOOR)
  })

  test("a band derived from fewer than the minimum window is refused", () => {
    const few = ledgerOf(...window.slice(0, MIN_BAND_WINDOW - 1).map((value) => sample(value)))
    expect(() => deriveBand(few, "probe.demo.wall", FP_A)).toThrow(/window/)
  })

  test("a hand-widened band does not load", () => {
    const samples = window.map((value) => sample(value))
    const records = ledgerOf(...samples)
    const band = deriveBand(records, "probe.demo.wall", FP_A)
    const honest = sealAll([policyRecord(), ...samples, band])
    expect(() => parseLedger(serializeLedger(honest))).not.toThrow()

    const widened: UnsealedBand = { ...band, upper: band.upper * 4, lower: band.lower / 4 }
    expect(() => sealAll([policyRecord(), ...samples, widened])).toThrow(/recomputed|derive/i)
  })

  test("a band declaring a k other than the policy's is refused", () => {
    const samples = window.map((value) => sample(value))
    const band = deriveBand(ledgerOf(...samples), "probe.demo.wall", FP_A)
    expect(() => sealAll([policyRecord(), ...samples, { ...band, k: BREACH_K + 2 }])).toThrow(/k/)
  })

  test("a metric measured inside a quarantined family may not be banded at all", () => {
    const samples = window.map((value) => sample(value, RUNNER_A, { familyId: "QA6" } as Partial<UnsealedSample>))
    const band = deriveBand(ledgerOf(...samples), "probe.demo.wall", FP_A)
    expect(() => sealAll([policyRecord(), ...samples, band])).toThrow(/QA6|quarantin/i)
  })
})

// ── The breach rule (acceptance 2) ────────────────────────────────────────────────────────────

describe("breach evaluation", () => {
  const window = [100, 104, 96, 102, 98]

  /** A ledger with a band over `window`, then the given post-band values on the given runners. */
  function withPostBand(after: readonly { value: number; runner?: RunnerComponents }[]) {
    const base = window.map((value) => sample(value))
    const band = deriveBand(ledgerOf(...base), "probe.demo.wall", FP_A)
    return sealAll([
      policyRecord(),
      ...base,
      band,
      ...after.map((entry) => sample(entry.value, entry.runner ?? RUNNER_A)),
    ])
  }

  test("k-1 consecutive out-of-band samples is not a breach", () => {
    const out = Array.from({ length: BREACH_K - 1 }, () => ({ value: 500 }))
    const records = withPostBand([...out, { value: 100 }, ...out])
    expect(verdictFor(records, "probe.demo.wall", FP_A).outcome).not.toBe("breach")
  })

  test("k consecutive out-of-band samples on one fingerprint is a breach", () => {
    const records = withPostBand(Array.from({ length: BREACH_K }, () => ({ value: 500 })))
    const verdict = verdictFor(records, "probe.demo.wall", FP_A)
    expect(verdict.outcome).toBe("breach")
    expect(verdict.k).toBe(BREACH_K)
    expect(verdict.window.length).toBe(BREACH_K)
  })

  test("samples of a different fingerprint neither count toward a breach nor break the run", () => {
    // Two out-of-band samples on A, one out-of-band on B, one more on A. Under a fingerprint-blind
    // reading that is three consecutive out-of-band samples; under this policy it is two on A.
    const records = withPostBand([
      { value: 500 },
      { value: 500 },
      { value: 500, runner: RUNNER_B },
      { value: 500 },
    ])
    const onA = verdictFor(records, "probe.demo.wall", FP_A)
    expect(onA.outcome).toBe("breach")
    expect(onA.window.every((entry) => entry.runnerFingerprint === FP_A)).toBe(true)

    // And an interleaved B sample cannot itself be evaluated: B has no band.
    expect(verdictFor(records, "probe.demo.wall", FP_B).outcome).toBe("unbanded")
  })

  test("fewer than k post-band samples is insufficient history, and is not a pass", () => {
    const records = withPostBand([{ value: 100 }])
    const verdict = verdictFor(records, "probe.demo.wall", FP_A)
    expect(verdict.outcome).toBe("insufficient-history")
    const report = evaluateLedger(records)
    expect(report.outcome).not.toBe("pass")
    expect(exitCodeFor(report)).toBe(1)
  })

  test("zero post-band samples is insufficient history, never a silent pass", () => {
    const records = withPostBand([])
    expect(verdictFor(records, "probe.demo.wall", FP_A).outcome).toBe("insufficient-history")
    expect(exitCodeFor(evaluateLedger(records))).toBe(1)
  })

  test("a metric with samples and no band is reported as unbanded, and does not fail the gate", () => {
    const records = ledgerOf(...window.map((value) => sample(value)))
    expect(verdictFor(records, "probe.demo.wall", FP_A).outcome).toBe("unbanded")
    expect(evaluateLedger(records).outcome).toBe("pass")
  })

  test("k in-band samples after a breach clears it — a band is a signal, not a latch", () => {
    const records = withPostBand([
      ...Array.from({ length: BREACH_K }, () => ({ value: 500 })),
      ...Array.from({ length: BREACH_K }, () => ({ value: 100 })),
    ])
    expect(verdictFor(records, "probe.demo.wall", FP_A).outcome).toBe("within-band")
  })
})

// ── Append-only (acceptance 3) ────────────────────────────────────────────────────────────────

describe("append-only reconciliation", () => {
  const built = () => ledgerOf(...[100, 104, 96, 102, 98].map((value) => sample(value)))

  test("an untouched ledger parses", () => {
    expect(parseLedger(serializeLedger(built())).length).toBe(6)
  })

  test("rewriting a past sample breaks the chain at that record", () => {
    const lines = serializeLedger(built()).trimEnd().split("\n")
    const mutated = JSON.parse(lines[2]!) as SampleRecord
    mutated.value = 1
    lines[2] = JSON.stringify(mutated)
    expect(() => parseLedger(`${lines.join("\n")}\n`)).toThrow(/chain|rewritten|append-only/i)
  })

  test("deleting a past sample breaks the chain", () => {
    const lines = serializeLedger(built()).trimEnd().split("\n")
    lines.splice(3, 1)
    expect(() => parseLedger(`${lines.join("\n")}\n`)).toThrow(/chain|seq|append-only/i)
  })

  test("re-chaining a rewritten ledger defeats the chain, and the prefix check catches it", () => {
    const prior = serializeLedger(built()).trimEnd().split("\n")
    const tampered = built()
    ;(tampered[2] as SampleRecord).value = 1
    const rechained = sealAll(tampered.map(({ prev: _p, sha256: _s, ...rest }) => rest as UnsealedSample))
    const current = serializeLedger(rechained).trimEnd().split("\n")

    // The self-consistent forgery parses cleanly — stated, not hidden.
    expect(() => parseLedger(`${current.join("\n")}\n`)).not.toThrow()

    const verdict = reconcileAppendOnly(prior, current)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/line 3/)
  })

  test("appending is the only permitted edit", () => {
    const prior = serializeLedger(built()).trimEnd().split("\n")
    expect(reconcileAppendOnly(prior, [...prior, "{}"]).ok).toBe(true)
    expect(reconcileAppendOnly(prior, prior.slice(0, -1)).ok).toBe(false)
    expect(reconcileAppendOnly(prior, prior).ok).toBe(true)
  })
})

// ── Compatibility with task 08's quarantine gate ──────────────────────────────────────────────

describe("quarantine gate interoperability", () => {
  const quarantine = loadQuarantine(readFileSync(join(repoRoot(), QUARANTINE_PATH), "utf8"))

  /** Exactly what `quarantine-gate.ts` reads out of a ledger line. */
  const asObservation = (record: SampleRecord) => JSON.parse(JSON.stringify(record))

  test("a QA6 observation produced by this ledger is a permitted measurement", () => {
    const records = ledgerOf(sample(10, RUNNER_A, { familyId: "QA6" } as Partial<UnsealedSample>))
    const report = detectQuarantineViolations({
      quarantine,
      observations: records.filter((r): r is SampleRecord => r.kind === "sample").map(asObservation),
    })
    expect(report.outcome).toBe("pass")
    expect(report.permittedMeasurements.map((m) => m.familyId)).toEqual(["QA6"])
  })

  test("the committed ledger is readable by the quarantine gate's own reader", () => {
    const raw = readFileSync(join(repoRoot(), ...LEDGER_PATH.split("/")), "utf8")
    for (const line of raw.split(/\r?\n/)) {
      if (line.trim().length === 0) continue
      expect(() => JSON.parse(line)).not.toThrow()
    }
    const report = detectQuarantineViolations({
      quarantine,
      observations: parseLedger(raw)
        .filter((r): r is SampleRecord => r.kind === "sample" && r.familyId !== undefined)
        .map(asObservation),
    })
    expect(report.outcome).toBe("pass")
  })
})

// ── The committed artefact ────────────────────────────────────────────────────────────────────

describe("the committed ledger", () => {
  const raw = () => readFileSync(join(repoRoot(), ...LEDGER_PATH.split("/")), "utf8")

  test("loads, and its first record declares the policy this executable applies", () => {
    const records = parseLedger(raw())
    const head = records[0]!
    expect(head.kind).toBe("policy")
    expect((head as { schemaVersion: number }).schemaVersion).toBe(SCHEMA_VERSION)
    expect((head as { policy: string }).policy).toBe(POLICY_TEXT)
    expect((head as { k: number }).k).toBe(BREACH_K)
  })

  test("holds real measurements, and every one carries a fingerprint", () => {
    const samples = parseLedger(raw()).filter((r): r is SampleRecord => r.kind === "sample")
    expect(samples.length).toBeGreaterThan(0)
    for (const entry of samples) {
      expect(entry.runnerFingerprint).toMatch(/^fp-[0-9a-f]{16}$/)
      expect(Number.isFinite(entry.value)).toBe(true)
      expect(entry.commit).not.toBe("")
    }
  })

  test("evaluates without a breach and without an unevaluated band", () => {
    const report = evaluateLedger(parseLedger(raw()))
    expect(report.outcome).toBe("pass")
    expect(exitCodeFor(report)).toBe(0)
  })

  test("declares at least one band, so the k rule is exercised and not merely described", () => {
    const bands = parseLedger(raw()).filter((r): r is BandRecord => r.kind === "band")
    expect(bands.length).toBeGreaterThan(0)
    for (const band of bands) expect(band.k).toBe(BREACH_K)
  })
})
