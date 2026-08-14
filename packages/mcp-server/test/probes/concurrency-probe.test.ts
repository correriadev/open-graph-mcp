/**
 * F002 task 17 — the blocking half of the multi-process concurrency probe.
 *
 * This file is where the probe's DETERMINISTIC observations become assertions, and it is deliberately
 * the ONLY place in task 17 where an assertion exists. `concurrency-probe.ts` measures; this file
 * decides. The split is the point of the task, so it is worth being explicit about how it is enforced
 * rather than merely intended:
 *
 *   - `analyzeConcurrency` takes a `ConcurrencyObservation`, whose type has NO timing field at all.
 *     A timing cannot reach the analyser, so no verdict can be a function of one. That is a type-level
 *     wall, not a convention.
 *   - the timings live on a separate `ConcurrencyTimings` value, returned beside the observation, and
 *     the only thing this repository does with them is hand them to `recordSample`, which appends to
 *     the Benchmark Ledger — a file whose loader REFUSES any sample carrying `expected`, `bound`,
 *     `asserted`, `threshold`, `budget` or `limit`.
 *   - the test below asserts that the verdict object carries no timing key, so a later edit that
 *     smuggles a duration into the verdict fails here rather than quietly creating a timing gate.
 *
 * This file imports no Discharge Annotation surface, so it is NOT a member of the EAP Test Corpus
 * (`reconcile-traceability.ts` decides membership by looking for an import of the annotation module
 * in the file's own bytes — which is why this comment must not spell that import path out, or the
 * mention alone would enrol this probe in the corpus). It discharges no Scenario Identifier and
 * claims none: a probe observes
 * an implementation, and the EAP Scenarios are claims about a specification.
 */

import { describe, expect, test } from "bun:test"

import {
  FALSIFICATION_CRITERIA,
  IN_SUITE_WRITERS,
  IN_SUITE_WRITES_PER_WRITER,
  WRITER_ENV,
  analyzeConcurrency,
  assertSoleLedgerWriter,
  runConcurrencyProbe,
  starvationRatio,
  type ConcurrencyObservation,
} from "./concurrency-probe"

const clean = (overrides: Partial<ConcurrencyObservation> = {}): ConcurrencyObservation => ({
  writers: 2,
  writerPids: [101, 102],
  parentPid: 1,
  connections: 3,
  phaseAMaxSeq: 2,
  admitted: [
    { phase: "a", writer: 0, seq: 1, id: "a-w0-0" },
    { phase: "a", writer: 1, seq: 2, id: "a-w1-0" },
    { phase: "b", writer: 0, seq: 3, id: "b-w0-0" },
    { phase: "b", writer: 1, seq: 4, id: "b-w1-0" },
  ],
  durable: [
    { seq: 1, id: "a-w0-0" },
    { seq: 2, id: "a-w1-0" },
    { seq: 3, id: "b-w0-0" },
    { seq: 4, id: "b-w1-0" },
  ],
  ...overrides,
})

describe("the falsification criterion is stated, not implied", () => {
  test("the probe declares in code what observation would refute the monotonicity claim", () => {
    expect(FALSIFICATION_CRITERIA.length).toBeGreaterThanOrEqual(3)
    const text = FALSIFICATION_CRITERIA.join(" ").toLowerCase()
    expect(text).toContain("reus")
    expect(text).toContain("lost")
  })
})

describe("analyzeConcurrency — the deterministic, blocking half", () => {
  test("a clean multi-process run is admitted", () => {
    const verdict = analyzeConcurrency(clean())
    expect(verdict.ok).toBe(true)
    expect(verdict.reusedSequences).toEqual([])
    expect(verdict.lostWrites).toEqual([])
    expect(verdict.nonAdvancingAfterRebuild).toEqual([])
    expect(verdict.gaps).toEqual([])
    expect(verdict.duplicateIds).toEqual([])
    expect(verdict.checked).toBe(4)
  })

  test("a Sequence observed twice in the durable record REFUTES monotonicity", () => {
    const verdict = analyzeConcurrency(
      clean({
        admitted: [
          { phase: "a", writer: 0, seq: 1, id: "a-w0-0" },
          { phase: "a", writer: 1, seq: 1, id: "a-w1-0" },
        ],
        durable: [
          { seq: 1, id: "a-w0-0" },
          { seq: 1, id: "a-w1-0" },
        ],
        phaseAMaxSeq: 1,
      }),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.reusedSequences).toEqual([1])
    expect(verdict.message).toContain("1")
  })

  test("an admitted write missing from the durable record REFUTES durability", () => {
    const verdict = analyzeConcurrency(
      clean({ durable: [{ seq: 1, id: "a-w0-0" }, { seq: 2, id: "a-w1-0" }, { seq: 3, id: "b-w0-0" }] }),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.lostWrites).toEqual([{ seq: 4, id: "b-w1-0" }])
  })

  test("a post-rebuild Sequence at or below the pre-rebuild maximum REFUTES the allocator's survival", () => {
    const verdict = analyzeConcurrency(
      clean({
        admitted: [
          { phase: "a", writer: 0, seq: 1, id: "a-w0-0" },
          { phase: "a", writer: 1, seq: 2, id: "a-w1-0" },
          { phase: "b", writer: 0, seq: 1, id: "b-w0-0" },
          { phase: "b", writer: 1, seq: 2, id: "b-w1-0" },
        ],
        durable: [
          { seq: 1, id: "a-w0-0" },
          { seq: 2, id: "a-w1-0" },
          { seq: 1, id: "b-w0-0" },
          { seq: 2, id: "b-w1-0" },
        ],
      }),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.nonAdvancingAfterRebuild.map((entry) => entry.seq).sort()).toEqual([1, 2])
  })

  test("a gap in the durable Sequence range is reported, because a consumed-but-absent Sequence is a lost write with the allocator as its witness", () => {
    const verdict = analyzeConcurrency(
      clean({
        admitted: [
          { phase: "a", writer: 0, seq: 1, id: "a-w0-0" },
          { phase: "b", writer: 0, seq: 3, id: "b-w0-0" },
        ],
        durable: [
          { seq: 1, id: "a-w0-0" },
          { seq: 3, id: "b-w0-0" },
        ],
        phaseAMaxSeq: 1,
      }),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.gaps).toEqual([2])
  })

  test("the verdict carries no timing, so no assertion here can ever be a function of one", () => {
    const verdict = analyzeConcurrency(clean())
    const keys = Object.keys(verdict).join(" ").toLowerCase()
    for (const forbidden of ["ms", "duration", "elapsed", "wall", "hold", "latency", "starvation"]) {
      expect(keys).not.toContain(forbidden)
    }
  })
})

describe("the ledger append is serialised even though the probe is not", () => {
  test("a writer child is REFUSED the ledger, because appendToLedger takes no lock", () => {
    const prior = process.env[WRITER_ENV]
    try {
      process.env[WRITER_ENV] = "1"
      expect(() => assertSoleLedgerWriter()).toThrow(/NO LOCK/)
      delete process.env[WRITER_ENV]
      expect(() => assertSoleLedgerWriter()).not.toThrow()
    } finally {
      if (prior === undefined) delete process.env[WRITER_ENV]
      else process.env[WRITER_ENV] = prior
    }
  })
})

describe("starvation is a ratio of equal quotas, so it is waiting time and nothing else", () => {
  test("equal writers report perfect fairness; an overtaken writer reports its factor", () => {
    expect(starvationRatio([10, 10, 10, 10])).toBe(1)
    expect(starvationRatio([10, 50])).toBe(5)
    expect(starvationRatio([])).toBe(1)
  })
})

describe("the probe, run for real across separate OS processes", () => {
  test(
    "concurrent writers on separate connections never reuse a Sequence and never lose an admitted write",
    async () => {
      const run = await runConcurrencyProbe({
        writers: IN_SUITE_WRITERS,
        writesPerWriter: IN_SUITE_WRITES_PER_WRITER,
      })

      // Topology first: an assertion about concurrency made by one process about itself is not an
      // observation of concurrency. ADR-0021 — verification by the durable record, never self-report.
      expect(run.observation.writers).toBe(IN_SUITE_WRITERS)
      expect(new Set(run.observation.writerPids).size).toBe(IN_SUITE_WRITERS)
      expect(run.observation.writerPids).not.toContain(process.pid)
      expect(run.observation.connections).toBe(IN_SUITE_WRITERS + 1)

      // The correctness observations. BLOCKING.
      const verdict = analyzeConcurrency(run.observation)
      expect(verdict.reusedSequences).toEqual([])
      expect(verdict.duplicateIds).toEqual([])
      expect(verdict.lostWrites).toEqual([])
      expect(verdict.nonAdvancingAfterRebuild).toEqual([])
      expect(verdict.gaps).toEqual([])
      expect(verdict.ok).toBe(true)
      expect(verdict.checked).toBe(IN_SUITE_WRITERS * IN_SUITE_WRITES_PER_WRITER * 2)

      // Every writer really did load the same allocator, and that allocator really does advance.
      const digests = run.observation.allocatorDigests ?? []
      const signatures = run.observation.allocatorSignatures ?? []
      expect(digests.length).toBe(IN_SUITE_WRITERS)
      expect(new Set(digests).size).toBe(1)
      expect(signatures.length).toBe(IN_SUITE_WRITERS)
      for (const signature of signatures) {
        expect(signature[1]).toBe(signature[0]! + 1)
      }

      // The timings exist and are NOT asserted on. Recorded to the Benchmark Ledger only, and only
      // when EAP_BENCHMARK_RECORD is set — which `bun test` does not set.
      expect(run.timings.postRebuildHolds.length).toBeGreaterThan(0)
      expect(run.recorded).toEqual([])
    },
    180_000,
  )
})
