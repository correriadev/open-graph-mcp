/**
 * F002 task 19 — the scale and read-model volume probe.
 *
 * Two of the three open points in `docs/specs/cognitive_line/TL.json` are questions about VOLUME, and
 * both have been answered so far by reading the SQL and reasoning about it. This probe replaces the
 * reasoning with numbers. It is quoted verbatim below and exported verbatim, so that the citation is
 * mechanically present in the derived artifacts rather than only in prose.
 *
 * OPEN POINT 1 (`TL_OPEN_POINT_1`):
 *
 *   "When `ensureRecallClosureIndex` detects an out-of-sync closure marker following a state restore
 *    or JSONL rebuild, how will executing synchronous re-derivation across thousands of historical
 *    recall cases inside a `serialTransaction` affect SQLite write-lock duration and event-loop
 *    responsiveness under concurrent tenant load?"
 *
 * OPEN POINT 3 (`TL_OPEN_POINT_3`):
 *
 *   "How will `SqlitePromotionRepository.getEvents` and `getProposalsForParent` maintain predictable
 *    heap memory footprints and query response times as historical promotion events and proposals
 *    accumulate over long-running tenant lifecycles without pagination cursors or retention windows?"
 *
 * ── This probe MEASURES. It decides nothing. ─────────────────────────────────────────────────
 * Both questions live inside quarantine family QA6 — "Page size, batching limits, and completion
 * bounds for very large closures" — whose own source clauses name TL open point 3 by name and whose
 * measurement policy reads: "A probe may build the volume fixture, observe row count, wall time, peak
 * heap, fixture-build time and closure re-derivation time, and append the observation to the
 * Benchmark Ledger with its runner fingerprint — that entry is evidence. A test asserting a maximum
 * batch size, page size or completion bound is a decision and is forbidden."
 *
 * So every sample this probe emits carries `familyId: "QA6"`, which has two consequences that are the
 * point rather than an accident:
 *   - the Benchmark Ledger REFUSES to band any metric whose samples name a quarantine family. A band
 *     is a bound, and a bound here is the decision the quarantine defers. These numbers can therefore
 *     never quietly become a threshold.
 *   - `quarantine-gate.ts`'s `classifyObservation` now runs over a REAL observation for the first
 *     time. Task 16 recorded that no sample had ever named a family, so that function was exercised
 *     only by unit tests. These are the first real ones.
 *
 * The label is claimed because it is true, not because it is convenient. Task 17 deliberately did NOT
 * label its write-lock timings QA6 on the grounds that QA6 is about batch and page bounds and not
 * about lock contention, and mislabelling to buy the may-not-be-banded exemption would have been "a
 * lie that bought a convenience". The same standard applies here and it points the other way: the
 * subject of `eap.scale.promotion.*` is literally the unpaginated read model that QA6's own second
 * source clause cites, and the subject of `eap.scale.recall.closure.rederivation.*` is literally the
 * completion bound of a re-derivation over a very large closure set. These are inside the family.
 *
 * ── Why the fixture is built through the real repositories, in batched transactions ───────────
 * The rows are written by `SqlitePromotionRepository.saveProposalWithEvent` and
 * `SqliteRecallRepository.createSync` — the production write paths, with real sequence allocation and
 * the real per-tenant append-only JSONL mirror. Only the TRANSACTION BOUNDARY is batched: the probe
 * wraps `BATCH_SIZE` repository calls in one outer `serialTransaction`, and `durableTransaction`
 * makes each inner one join that unit instead of opening its own.
 *
 * The honest trade-off, stated rather than discovered:
 *   - WHAT IS EXERCISED: the real SQL, the real row shapes, the real allocator, the real closure
 *     index maintenance, the real mirror append. A schema divergence or an index that does not exist
 *     shows up here exactly as it would in production.
 *   - WHAT IS NOT: the per-call transaction cost. Production admits ONE proposal per
 *     `serialTransaction`; this fixture admits `BATCH_SIZE` of them. It is therefore NOT a measurement
 *     of admission throughput and must never be read as one. It is a measurement of the read models
 *     and of the re-derivation, and the fixture is the means, not the subject.
 *   - WHY: at 100k proposals, one BEGIN IMMEDIATE per proposal is 100k serialised transactions.
 *     Task 17 measured ~96 such transactions at roughly 1–2 s on this reference machine, which
 *     extrapolates to something between fifteen minutes and an hour for the fixture alone. A probe
 *     that takes an hour is a probe nobody runs, and a probe nobody runs answers nothing. The
 *     per-batch wall time is recorded (`eap.scale.fixture.batch.wall.p50`) so the amortisation is
 *     visible in the ledger rather than hidden in this comment.
 *   - NOT CACHED. The fixture is rebuilt on every run into a fresh temporary directory and removed
 *     afterwards. A cached 100k-row state directory would be a committed binary artefact whose
 *     provenance nobody could check, and it would silently pin the schema of the day it was built.
 *
 * ── Where the concurrency half of open point 1 is genuinely answered, and where it is not ─────
 * Open point 1 asks about behaviour "under concurrent tenant load". A single-process probe cannot
 * answer that, so `--run` spawns ONE contending writer in a SEPARATE OS PROCESS, on its OWN SQLite
 * connection, writing durably as a DIFFERENT TENANT to the same database file, while the parent runs
 * the re-derivation. Its per-write wall time during the re-derivation window is recorded. That is a
 * real observation of cross-tenant blast radius: SQLite's write lock is per-database, not per-tenant.
 *
 * What is still NOT answered, plainly: ONE contending writer is not "load". Task 17's harness could
 * be composed with this one to put four or forty writers behind the re-derivation, and that has not
 * been done. The number recorded here is a floor on the disruption, not a characterisation of it.
 *
 * ── Peak heap, and how much it is worth ───────────────────────────────────────────────────────
 * Bun exposes no allocation-sampling profiler, so a true peak cannot be observed from inside the
 * process. `measureHeap` records three things around each read-model call and every one of them is a
 * LOWER BOUND on the peak:
 *   - `retainedHeapBytes`: heapUsed after a forced full GC with the result still referenced. What the
 *     caller is holding. The most trustworthy of the three, and the least interesting.
 *   - `postCallHeapBytes`: heapUsed immediately after the call, before any GC. Includes transient
 *     garbage that has not been collected — but a GC that ran DURING the call has already removed
 *     some, so this understates the peak too.
 *   - `rssDeltaBytes`: the OS's view. Independent of the runtime's accounting, and includes the
 *     SQLite page cache the query pulled in, so it will usually be the largest of the three.
 * Trust them for the SHAPE of the curve across sizes, which is what open point 3 asks about. Do not
 * trust any of them as an absolute figure, and do not call any of them "the peak".
 *
 * ── Where it runs ─────────────────────────────────────────────────────────────────────────────
 * At `IN_SUITE_SIZE` (a few hundred rows) it runs inside `bun test`, so a commit that breaks the probe
 * fails on that commit rather than whenever someone next remembers. At `FULL_SIZE` (100k) it does NOT:
 * a suite already measured at ~175 s in the CI-equivalent configuration must not grow a multi-minute
 * fixture. The full run is a separate invocation:
 *
 *   bun packages/mcp-server/test/probes/scale-probe.ts --run [--claims N] [--no-contending-writer]
 *   EAP_BENCHMARK_RECORD=1 bun …/scale-probe.ts --run     (also appends to the ledger)
 *   …/scale-probe.ts --contending-writer …                internal: the contending writer child
 *
 * Deciding when CI runs it is a CI-topology question, and task 20 owns CI topology.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Database } from "bun:sqlite"

import type { Candidate, ParentProposal, PromotionProposedEvent } from "@open-graph-mcp/graph-core/eap/promotion"
import type { RecallCase } from "@open-graph-mcp/graph-core/eap/recall"

import { openDb, serialTransaction, write } from "../../src/db"
import { SqlitePromotionRepository, SqliteRecallRepository } from "../../src/eap/eap-repositories"
import { ensureRecallClosureIndex } from "../../src/eap/recall-closure"
import { WRITER_ENV, assertSoleLedgerWriter } from "./concurrency-probe"
import { medianOf, recordSample, removeStateDir, spawnProbeProcess, waitForPath, type SampleInput } from "./host"

// ── The citations, verbatim ───────────────────────────────────────────────────────────────────

/** `docs/specs/cognitive_line/TL.json` open point 1, character for character. */
export const TL_OPEN_POINT_1 =
  "When `ensureRecallClosureIndex` detects an out-of-sync closure marker following a state restore or " +
  "JSONL rebuild, how will executing synchronous re-derivation across thousands of historical recall " +
  "cases inside a `serialTransaction` affect SQLite write-lock duration and event-loop responsiveness " +
  "under concurrent tenant load?"

/** `docs/specs/cognitive_line/TL.json` open point 3, character for character. */
export const TL_OPEN_POINT_3 =
  "How will `SqlitePromotionRepository.getEvents` and `getProposalsForParent` maintain predictable " +
  "heap memory footprints and query response times as historical promotion events and proposals " +
  "accumulate over long-running tenant lifecycles without pagination cursors or retention windows?"

/**
 * The family every sample of this probe is labelled with. See the header for why the label is claimed
 * and why claiming it falsely to buy the may-not-be-banded exemption would be worse than not claiming
 * it at all.
 */
export const QUARANTINE_FAMILY = "QA6" as const

// ── Metrics ───────────────────────────────────────────────────────────────────────────────────

export const METRIC_FIXTURE_BUILD = "eap.scale.fixture.build.wall"
export const METRIC_FIXTURE_BATCH = "eap.scale.fixture.batch.wall.p50"
export const METRIC_REDERIVATION = "eap.scale.recall.closure.rederivation.wall"
export const METRIC_REDERIVATION_EVENTLOOP = "eap.scale.recall.closure.rederivation.eventloop.blocked"
export const METRIC_REDERIVATION_CONTENDING =
  "eap.scale.recall.closure.rederivation.contending_tenant.write.wall.max"
export const METRIC_EVENTS_ROWS = "eap.scale.promotion.get_events.rows"
export const METRIC_EVENTS_WALL = "eap.scale.promotion.get_events.wall"
export const METRIC_EVENTS_HEAP = "eap.scale.promotion.get_events.heap.retained"
export const METRIC_PROPOSALS_ROWS = "eap.scale.promotion.get_proposals_for_parent.rows"
export const METRIC_PROPOSALS_WALL = "eap.scale.promotion.get_proposals_for_parent.wall"
export const METRIC_PROPOSALS_HEAP = "eap.scale.promotion.get_proposals_for_parent.heap.retained"

/** Every metric this probe can emit. `toSamples` produces at most one sample per entry. */
export const MEASURED_METRICS: readonly string[] = [
  METRIC_FIXTURE_BUILD,
  METRIC_FIXTURE_BATCH,
  METRIC_REDERIVATION,
  METRIC_REDERIVATION_EVENTLOOP,
  METRIC_REDERIVATION_CONTENDING,
  METRIC_EVENTS_ROWS,
  METRIC_EVENTS_WALL,
  METRIC_EVENTS_HEAP,
  METRIC_PROPOSALS_ROWS,
  METRIC_PROPOSALS_WALL,
  METRIC_PROPOSALS_HEAP,
]

// ── Sizing ────────────────────────────────────────────────────────────────────────────────────

export interface ScaleSize {
  /** Distinct claim identifiers in the tenant. Each is a proposal candidate and a closure member. */
  claims: number
  /** Claims per Recall Case closure. `recallCases = claims / closurePerCase`. */
  closurePerCase: number
  /** Repository calls per outer `serialTransaction`. See the header on what this does and does not measure. */
  batchSize: number
  /** Fractions of `claims` at which the read models and the re-derivation are observed. The curve. */
  checkpoints: readonly number[]
}

/**
 * The full run: 100 000 claims, as 2 000 Recall Cases of 50 closure members each (the shape QA measured
 * the original scanning gate against, and "thousands of historical recall cases" in open point 1's own
 * words), and 100 000 proposals with one promotion event each, ALL under one parent horizon — the
 * worst case for `getProposalsForParent`, which filters by parent.
 *
 * Four checkpoints, so what is reported is a CURVE and not one heroic point. A single measurement at
 * 100k answers "how big is it there" and cannot distinguish linear from quadratic, which is the part
 * of open point 3 that actually matters over a long-running tenant lifecycle.
 */
export const FULL_SIZE: ScaleSize = {
  claims: 100_000,
  closurePerCase: 50,
  batchSize: 2_000,
  checkpoints: [0.01, 0.1, 0.5, 1],
}

/**
 * The in-suite run. Small enough to be invisible against a suite already measured at ~175 s, large
 * enough that every code path the full run takes is executed: two checkpoints, more than one batch,
 * more than one Recall Case, and both read models. It measures the SAME things at a size that answers
 * nothing about scale — its job is to prove the probe works, not to characterise the system.
 */
export const IN_SUITE_SIZE: ScaleSize = {
  claims: 500,
  closurePerCase: 25,
  batchSize: 200,
  checkpoints: [0.4, 1],
}

const TENANT = "probe-scale-tenant"
/** The contending writer's tenant. DIFFERENT on purpose: SQLite's write lock is per DATABASE. */
const CONTENDING_TENANT = "probe-scale-other-tenant"
const PARENT_HORIZON = "probe-parent-horizon"
/** Interval of the event-loop ticker. Small enough that a blocked loop is visible immediately. */
const TICK_MS = 5

// ── The measurement ───────────────────────────────────────────────────────────────────────────

export type ReadModelId = "getEvents" | "getProposalsForParent"

export const READ_MODELS: readonly ReadModelId[] = ["getEvents", "getProposalsForParent"]

export interface ReadModelMeasurement {
  readModel: ReadModelId
  /** Rows the unpaginated read model returned. RECORDED. Nothing asserts what it should be. */
  rowsReturned: number
  /** Rows the tenant's durable JSONL mirror holds for the same table. Recorded beside it, for a reader. */
  durableRows: number
  wallMs: number
  /** heapUsed after a forced GC, result still referenced. A LOWER BOUND on peak. See the header. */
  retainedHeapBytes: number
  /** heapUsed immediately after the call, before any GC. Also a lower bound on peak. */
  postCallHeapBytes: number
  /** RSS delta across the call. The OS's independent witness. */
  rssDeltaBytes: number
}

export interface ScalePoint {
  claims: number
  proposals: number
  recallCases: number
  closurePerCase: number
  batchSize: number
  /** Cumulative wall time spent building the fixture up to this checkpoint. */
  fixtureBuildMs: number
  /** Per-batch wall times for the batches written since the previous checkpoint. */
  batchMs: number[]
  /** Wall time of `ensureRecallClosureIndex` over every case, from a deliberately emptied index. */
  rederivationMs: number
  /** Longest gap between event-loop ticks spanning the re-derivation, minus the tick interval. */
  eventLoopLagMaxMs: number
  /** Longest durable write by a DIFFERENT tenant in a separate process during the re-derivation. */
  contendingWriterWaitMaxMs: number | null
  readModels: ReadModelMeasurement[]
}

export interface ScaleMeasurement {
  targetClaims: number
  /** sha256 of the `eap-repositories.ts` this run actually observed. Half of the mutation witness. */
  repositorySourceDigest: string
  probeWallMs: number
  points: ScalePoint[]
}

// ── Integrity (the blocking half — and it bounds nothing) ─────────────────────────────────────

export interface IntegrityVerdict {
  ok: boolean
  /** Every reason the measurement is not usable evidence. Empty means it is. */
  problems: string[]
  observedMetrics: string[]
  message: string
}

const finite = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value)

/**
 * Refuses a measurement that is not usable EVIDENCE. Pure, so a broken probe fails in a unit test
 * rather than being mistaken for a broken read model.
 *
 * Read the list of refusals and note what is NOT among them: there is no comparison of any value to
 * any other value, and no constant to compare against exists in this file. A row count of 100 000 and
 * a row count of 3 pass identically; a wall time of 4 ms and a wall time of 40 s pass identically. The
 * only thing refused is a measurement that did not happen, could not have happened, or cannot be
 * attributed. QA6 permits exactly that much and no more.
 */
export function verifyMeasurementIntegrity(measurement: ScaleMeasurement): IntegrityVerdict {
  const problems: string[] = []

  if (measurement.points.length === 0) {
    problems.push(
      "the run produced no scale point at all. A probe that observed nothing must never read as a " +
        "pass — 'no problem found' and 'nothing was looked at' are different outcomes.",
    )
  }
  if (!/^[0-9a-f]{64}$/.test(measurement.repositorySourceDigest)) {
    problems.push(
      "no sha256 of the repository source under measurement was captured, so the numbers cannot be " +
        "attributed to a state of the code (ADR-0021).",
    )
  }
  if (!finite(measurement.probeWallMs) || measurement.probeWallMs < 0) {
    problems.push("probeWallMs is not a finite non-negative duration, so the probe's own cost is unknown.")
  }

  for (const [index, point] of measurement.points.entries()) {
    const at = `point ${index} (${point.claims} claims)`
    for (const field of ["fixtureBuildMs", "rederivationMs", "eventLoopLagMaxMs"] as const) {
      if (!finite(point[field]) || point[field] < 0) {
        problems.push(`${at}: ${field} is not a finite non-negative duration, so it is not a measurement.`)
      }
    }
    if (point.contendingWriterWaitMaxMs !== null && !finite(point.contendingWriterWaitMaxMs)) {
      problems.push(`${at}: contendingWriterWaitMaxMs is neither null (not attempted) nor a finite duration.`)
    }
    if (point.batchMs.length === 0 || point.batchMs.some((ms) => !finite(ms) || ms < 0)) {
      problems.push(`${at}: batchMs holds no observation, or one that is not a finite non-negative duration.`)
    }
    for (const readModel of READ_MODELS) {
      const observed = point.readModels.find((entry) => entry.readModel === readModel)
      if (observed === undefined) {
        problems.push(
          `${at}: read model ${readModel} was never exercised. A read model silently skipped is a ` +
            "question silently left unanswered.",
        )
        continue
      }
      for (const field of ["rowsReturned", "durableRows"] as const) {
        if (!Number.isInteger(observed[field]) || observed[field] < 0) {
          problems.push(`${at}: ${readModel}.${field} is not a whole non-negative number of rows.`)
        }
      }
      for (const field of ["wallMs", "retainedHeapBytes", "postCallHeapBytes", "rssDeltaBytes"] as const) {
        if (!finite(observed[field])) problems.push(`${at}: ${readModel}.${field} is not a finite number.`)
      }
    }
  }

  const observedMetrics = problems.length === 0 ? toSamples(measurement).map((sample) => sample.metric) : []
  return {
    ok: problems.length === 0,
    problems,
    observedMetrics,
    message:
      problems.length === 0
        ? `${measurement.points.length} scale point(s) up to ${measurement.targetClaims} claims; ` +
          `${observedMetrics.length} metric(s) observed, none of them bounded and none of them ` +
          "compared to anything. Evidence, not a verdict."
        : `NOT USABLE EVIDENCE — ${problems.join(" ")}`,
  }
}

// ── Samples ───────────────────────────────────────────────────────────────────────────────────

const round3 = (value: number): number => Math.round(value * 1000) / 1000

/**
 * Turns the LARGEST scale point into ledger samples. One sample per metric, every one labelled QA6.
 *
 * The smaller checkpoints are not separate samples — they would pollute the metric's own partition
 * with values taken at a different fixture size, and the ledger compares samples of one partition to
 * each other. They travel as `context` instead, where a reader can see the curve beside the point.
 */
export function toSamples(measurement: ScaleMeasurement): SampleInput[] {
  const point = measurement.points[measurement.points.length - 1]
  if (point === undefined) return []
  const byModel = (id: ReadModelId): ReadModelMeasurement | undefined =>
    point.readModels.find((entry) => entry.readModel === id)
  const events = byModel("getEvents")
  const proposals = byModel("getProposalsForParent")

  const curve = (pick: (p: ScalePoint) => number | null): string =>
    measurement.points.map((p) => `${p.claims}:${pick(p) === null ? "-" : round3(pick(p)!)}`).join(" ")

  const context: Record<string, string | number> = {
    claims: point.claims,
    proposals: point.proposals,
    recallCases: point.recallCases,
    closurePerCase: point.closurePerCase,
    batchSize: point.batchSize,
    closureMemberRows: point.recallCases * point.closurePerCase,
    curveRederivationMs: curve((p) => p.rederivationMs),
    curveGetEventsWallMs: curve((p) => p.readModels.find((r) => r.readModel === "getEvents")?.wallMs ?? null),
    curveGetEventsRetainedBytes: curve(
      (p) => p.readModels.find((r) => r.readModel === "getEvents")?.retainedHeapBytes ?? null,
    ),
    curveGetProposalsWallMs: curve(
      (p) => p.readModels.find((r) => r.readModel === "getProposalsForParent")?.wallMs ?? null,
    ),
    probeWallMs: round3(measurement.probeWallMs),
    repositoryDigest: measurement.repositorySourceDigest.slice(0, 16),
  }

  const OBSERVATION_ONLY =
    "Observed inside quarantine family QA6, which permits measurement and forbids assertion. This is " +
    "evidence. It states no maximum batch size, no page size and no completion bound, and the ledger " +
    "refuses to band it for exactly that reason."

  const samples: SampleInput[] = [
    {
      metric: METRIC_FIXTURE_BUILD,
      value: round3(point.fixtureBuildMs),
      unit: "ms",
      aggregation: "total",
      observations: 1,
      note:
        `Cumulative wall time to build a ${point.claims}-claim tenant through the production ` +
        "repositories (real SQL, real sequence allocation, real append-only JSONL mirror), with " +
        `${point.batchSize} repository calls per outer serialTransaction. NOT a measurement of ` +
        `admission throughput: production admits one proposal per transaction. ${OBSERVATION_ONLY}`,
    },
    {
      metric: METRIC_FIXTURE_BATCH,
      value: round3(medianOf(point.batchMs)),
      unit: "ms",
      aggregation: `median-of-${point.batchMs.length}`,
      observations: point.batchMs.length,
      note:
        `Median wall time of one batch of ${point.batchSize} durable repository writes near the ` +
        "largest fixture size — per-batch indexing cost as the tenant grows, since every write " +
        `maintains the indexes and the closure index alongside it. ${OBSERVATION_ONLY}`,
    },
    {
      metric: METRIC_REDERIVATION,
      value: round3(point.rederivationMs),
      unit: "ms",
      aggregation: "total",
      observations: 1,
      note:
        `Wall time of ensureRecallClosureIndex re-deriving the closure index for ${point.recallCases} ` +
        `historical recall cases (${point.recallCases * point.closurePerCase} member rows) from an ` +
        "emptied index inside one serialTransaction — the state a JSONL rebuild or a state restore " +
        `leaves behind. The SQLite write lock is held for this whole duration. ${OBSERVATION_ONLY}`,
    },
    {
      metric: METRIC_REDERIVATION_EVENTLOOP,
      value: round3(point.eventLoopLagMaxMs),
      unit: "ms",
      aggregation: `max-gap-over-${TICK_MS}ms-ticks`,
      observations: 1,
      note:
        "Longest gap between consecutive event-loop ticks spanning the re-derivation, minus the tick " +
        "interval. The re-derivation is synchronous, so this is how long the host serves no other " +
        `request at all. ${OBSERVATION_ONLY}`,
    },
    {
      metric: METRIC_EVENTS_ROWS,
      value: events?.rowsReturned ?? 0,
      unit: "rows",
      aggregation: "count",
      observations: 1,
      note:
        "Rows returned by SqlitePromotionRepository.getEvents in one unpaginated call. The tenant's " +
        `durable mirror holds ${events?.durableRows ?? 0} row(s) for the same table; the two are ` +
        "recorded side by side and compared by a reader, never by a gate — asserting that they match " +
        `would be asserting a page size of infinity, which is the decision QA6 defers. ${OBSERVATION_ONLY}`,
    },
    {
      metric: METRIC_EVENTS_WALL,
      value: round3(events?.wallMs ?? 0),
      unit: "ms",
      aggregation: "single-call",
      observations: 1,
      note:
        `Wall time of one unpaginated getEvents() over ${events?.rowsReturned ?? 0} rows, including ` +
        `JSON.parse of every stored payload. ${OBSERVATION_ONLY}`,
    },
    {
      metric: METRIC_EVENTS_HEAP,
      value: events?.retainedHeapBytes ?? 0,
      unit: "bytes",
      aggregation: "retained-after-forced-gc",
      observations: 1,
      note:
        "heapUsed delta across one unpaginated getEvents(), measured after a forced full GC with the " +
        "returned array still referenced. A LOWER BOUND on peak, not the peak: Bun exposes no " +
        `allocation-sampling profiler. RSS delta on the same call was ${events?.rssDeltaBytes ?? 0} ` +
        `bytes and pre-GC heapUsed delta ${events?.postCallHeapBytes ?? 0}. ${OBSERVATION_ONLY}`,
    },
    {
      metric: METRIC_PROPOSALS_ROWS,
      value: proposals?.rowsReturned ?? 0,
      unit: "rows",
      aggregation: "count",
      observations: 1,
      note:
        "Rows returned by SqlitePromotionRepository.getProposalsForParent for a single parent horizon " +
        `in one unpaginated call; the durable mirror holds ${proposals?.durableRows ?? 0} proposal ` +
        `row(s) for the tenant. ${OBSERVATION_ONLY}`,
    },
    {
      metric: METRIC_PROPOSALS_WALL,
      value: round3(proposals?.wallMs ?? 0),
      unit: "ms",
      aggregation: "single-call",
      observations: 1,
      note:
        `Wall time of one unpaginated getProposalsForParent() over ${proposals?.rowsReturned ?? 0} ` +
        "rows, including JSON.parse of every stored candidate array, served by " +
        `idx_proposals_tenant_parent. ${OBSERVATION_ONLY}`,
    },
    {
      metric: METRIC_PROPOSALS_HEAP,
      value: proposals?.retainedHeapBytes ?? 0,
      unit: "bytes",
      aggregation: "retained-after-forced-gc",
      observations: 1,
      note:
        "heapUsed delta across one unpaginated getProposalsForParent(), after a forced full GC with " +
        "the returned array still referenced. A lower bound on peak. RSS delta on the same call was " +
        `${proposals?.rssDeltaBytes ?? 0} bytes. ${OBSERVATION_ONLY}`,
    },
  ]

  if (point.contendingWriterWaitMaxMs !== null) {
    samples.splice(4, 0, {
      metric: METRIC_REDERIVATION_CONTENDING,
      value: round3(point.contendingWriterWaitMaxMs),
      unit: "ms",
      aggregation: "max-over-overlapping-writes",
      observations: 1,
      note:
        "Longest single durable write by a DIFFERENT tenant, in a SEPARATE OS process on its own " +
        "SQLite connection, whose window overlapped the re-derivation. SQLite's write lock is per " +
        "database, not per tenant, so this is cross-tenant blast radius. ONE contending writer is a " +
        `floor on the disruption under concurrent load, not a characterisation of it. ${OBSERVATION_ONLY}`,
    })
  }

  return samples.map((sample) => ({
    ...sample,
    familyId: QUARANTINE_FAMILY,
    testFile: "packages/mcp-server/test/probes/scale-probe.ts",
    testName: sample.metric.startsWith("eap.scale.promotion.") ? TL_OPEN_POINT_3 : TL_OPEN_POINT_1,
    context,
  }))
}

// ── Heap ──────────────────────────────────────────────────────────────────────────────────────

export interface HeapObservation<T> {
  value: T
  wallMs: number
  retainedHeapBytes: number
  postCallHeapBytes: number
  rssDeltaBytes: number
}

/**
 * Runs `body` and reports three independent, all-underestimating views of what it cost in memory.
 * See the header for why none of them is "the peak" and what they are good for anyway.
 */
export function measureHeap<T>(body: () => T): HeapObservation<T> {
  Bun.gc(true)
  const before = process.memoryUsage()
  const started = performance.now()
  const value = body()
  const wallMs = performance.now() - started
  const after = process.memoryUsage()
  Bun.gc(true)
  const settled = process.memoryUsage()
  // `value` is still referenced here, so `settled.heapUsed` includes it. Referenced again below so a
  // future edit cannot let the optimiser drop it before the measurement is taken.
  const retained = settled.heapUsed - before.heapUsed
  return {
    value,
    wallMs,
    retainedHeapBytes: retained,
    postCallHeapBytes: after.heapUsed - before.heapUsed,
    rssDeltaBytes: after.rss - before.rss,
  }
}

// ── The contending writer child ───────────────────────────────────────────────────────────────

interface ContendingWrite {
  /** Epoch milliseconds when the transaction began. Comparable across processes; ms resolution. */
  startedAtEpoch: number
  ms: number
}

interface ContendingReport {
  pid: number
  writes: ContendingWrite[]
  busyRetries: number
}

function argValue(flag: string): string | undefined {
  const at = process.argv.indexOf(flag)
  return at === -1 ? undefined : process.argv[at + 1]
}

function atomicWriteJson(target: string, value: unknown): void {
  const temporary = `${target}.tmp`
  writeFileSync(temporary, JSON.stringify(value), "utf8")
  renameSync(temporary, target)
}

const isBusy = (error: unknown): boolean =>
  /SQLITE_BUSY|database is locked|database table is locked/i.test(String((error as Error).message ?? error))

/**
 * Writes durably as a different tenant, on its own connection, until the parent drops a stop file.
 * It reports what each write COST it; the parent decides which of those writes overlapped the
 * re-derivation. The child is never told when the re-derivation runs, so it cannot flatter it.
 */
function runContendingWriter(): void {
  // Set FIRST: from here on any attempt to append to the Benchmark Ledger from this process is
  // refused. `appendToLedger` takes NO LOCK, so two concurrent appends seal against the same chain
  // head and leave a committed, append-only file that never loads again (task 17).
  process.env[WRITER_ENV] = "1"
  const stateDir = argValue("--state-dir")!
  const stopPath = argValue("--stop")!
  const readyPath = argValue("--ready")!
  const resultPath = argValue("--result")!

  const db: Database = openDb(join(stateDir, "state.sqlite"))
  const report: ContendingReport = { pid: process.pid, writes: [], busyRetries: 0 }
  atomicWriteJson(readyPath, { pid: process.pid })

  let index = 0
  while (!existsSync(stopPath)) {
    const startedAtEpoch = Date.now()
    const started = performance.now()
    try {
      serialTransaction(db, () => {
        write(db, stateDir, CONTENDING_TENANT, "contestations", {
          tenant_id: CONTENDING_TENANT,
          id: `contending-${index}`,
          seq: index + 1,
          target_claim_ids: JSON.stringify([]),
          severity: "low",
          evidence: JSON.stringify({ probe: "f002-task-19" }),
          status: "open",
          created_at: new Date().toISOString(),
        })
      })
      report.writes.push({ startedAtEpoch, ms: performance.now() - started })
    } catch (error) {
      if (isBusy(error)) report.busyRetries++
      else throw error
    }
    index++
    Bun.sleepSync(1)
  }
  db.close()
  atomicWriteJson(resultPath, report)
}

// ── The run ───────────────────────────────────────────────────────────────────────────────────

export interface ScaleProbeConfig extends Partial<ScaleSize> {
  /** Spawn the separate-process, different-tenant contending writer. Off inside `bun test`. */
  contendingWriter?: boolean
  stateDir?: string
  verbose?: boolean
}

export interface ScaleProbeRun {
  measurement: ScaleMeasurement
  verdict: IntegrityVerdict
  /** Ledger sample seqs actually appended. Empty when recording is off — NOT "nothing measured". */
  recorded: number[]
  stateDir: string
}

const REPOSITORY_SOURCE = join(import.meta.dir, "..", "..", "src", "eap", "eap-repositories.ts")

/**
 * sha256 of the repository source this run observed. One of TWO independent witnesses that a mutation
 * reached the code under probe — the other being the behavioural signature the measurement itself
 * carries (`rowsReturned`, which changes the moment the SQL does). A mutation that moves neither did
 * not reach the code under probe, and this feature's mutation rule says a check staying green under a
 * mutation proves nothing until that is shown.
 */
export function repositorySourceDigest(): string {
  return new Bun.CryptoHasher("sha256").update(readFileSync(REPOSITORY_SOURCE)).digest("hex")
}

/** Lines in the tenant's durable JSONL mirror for one table. The evidence, never a repository's opinion. */
function durableMirrorRows(stateDir: string, table: string): number {
  const file = join(stateDir, "tenants", TENANT, `${table}.jsonl`)
  if (!existsSync(file)) return 0
  return readFileSync(file, "utf8").split("\n").filter((line) => line.trim().length > 0).length
}

const candidateFor = (claim: number): Candidate => ({
  id: `claim-${claim}`,
  content: `probe claim ${claim} — a distilled candidate of representative length for the fixture.`,
})

function recallCaseFor(index: number, closurePerCase: number): RecallCase {
  const closure = Array.from({ length: closurePerCase }, (_u, k) => `claim-${index * closurePerCase + k}`)
  return {
    id: `recall-${index}`,
    notice: {
      recallId: `recall-${index}`,
      contestationId: `contestation-${index}`,
      targetClaimIds: [closure[0]!],
      severity: "moderate",
      contestationStatus: "admitted",
      initiatedAt: new Date().toISOString(),
    } as RecallCase["notice"],
    status: "completed",
    closure,
    processedClaimIds: new Set(closure),
    checkpoint: {
      recallId: `recall-${index}`,
      sequence: index + 1,
      processedClaimIds: closure,
      remainingClaimIds: [],
      lastProcessedClaimId: closure[closure.length - 1]!,
      suspendedCells: [],
      updatedAt: new Date().toISOString(),
    },
    degradedClaimStates: new Map(),
    degradationCounts: new Map(),
    suspendedCells: new Set(),
  }
}

export async function runScaleProbe(config: ScaleProbeConfig = {}): Promise<ScaleProbeRun> {
  const size: ScaleSize = {
    claims: config.claims ?? FULL_SIZE.claims,
    closurePerCase: config.closurePerCase ?? FULL_SIZE.closurePerCase,
    batchSize: config.batchSize ?? FULL_SIZE.batchSize,
    checkpoints: config.checkpoints ?? FULL_SIZE.checkpoints,
  }
  const verbose = config.verbose ?? false
  const wantContending = config.contendingWriter ?? false
  const stateDir = config.stateDir ?? mkdtempSync(join(tmpdir(), "eap-probe-scale-"))
  mkdirSync(stateDir, { recursive: true })
  const control = join(stateDir, "control")
  mkdirSync(control, { recursive: true })

  const probeStarted = performance.now()
  const db = openDb(join(stateDir, "state.sqlite"))
  const promotions = new SqlitePromotionRepository(db, stateDir, TENANT)
  const recalls = new SqliteRecallRepository(db, stateDir, TENANT)

  const points: ScalePoint[] = []
  const checkpointAt = new Set(
    size.checkpoints.map((fraction) => Math.max(1, Math.round(size.claims * fraction))),
  )
  const casesPerCheckpoint = (claims: number): number => Math.floor(claims / size.closurePerCase)

  let fixtureBuildMs = 0
  let batchMsSinceCheckpoint: number[] = []
  let writtenClaims = 0
  let writtenCases = 0

  try {
    for (const boundary of [...checkpointAt].sort((a, b) => a - b)) {
      // ── Build up to this checkpoint, one outer serialTransaction per batch ──────────────────
      while (writtenClaims < boundary) {
        const upto = Math.min(boundary, writtenClaims + size.batchSize)
        const from = writtenClaims
        const casesUpto = casesPerCheckpoint(upto)
        const started = performance.now()
        serialTransaction(db, () => {
          for (let claim = from; claim < upto; claim++) {
            const proposal: ParentProposal = {
              id: `proposal-${claim}`,
              parentId: PARENT_HORIZON,
              childId: `child-horizon-${claim % 97}`,
              candidates: [candidateFor(claim)],
              status: "proposed",
              basedOnSeq: claim,
              createdAt: new Date(1_700_000_000_000 + claim).toISOString(),
            }
            const event: PromotionProposedEvent = {
              promotionId: `promotion-${claim}`,
              childId: proposal.childId,
              parentId: proposal.parentId,
              basedOnSeq: proposal.basedOnSeq,
              distilled: proposal.candidates,
              timestamp: proposal.createdAt,
            }
            promotions.saveProposalWithEvent(proposal, event)
          }
          for (let index = writtenCases; index < casesUpto; index++) {
            recalls.createSync(recallCaseFor(index, size.closurePerCase))
          }
        })
        const batchMs = performance.now() - started
        fixtureBuildMs += batchMs
        batchMsSinceCheckpoint.push(batchMs)
        writtenClaims = upto
        writtenCases = casesUpto
        if (verbose) {
          console.log(
            `  built ${writtenClaims}/${size.claims} claims, ${writtenCases} recall case(s) ` +
              `(batch ${batchMs.toFixed(1)} ms)`,
          )
        }
      }

      // ── The closure re-derivation, with the event loop and a contending tenant watched ──────
      const contending = wantContending ? startContendingWriter(stateDir, control, points.length) : null
      if (contending !== null) await contending.ready

      const ticks: number[] = []
      let lastTick = performance.now()
      const timer = setInterval(() => {
        const now = performance.now()
        ticks.push(now - lastTick)
        lastTick = now
      }, TICK_MS)
      await Bun.sleep(TICK_MS * 6)
      ticks.length = 0
      lastTick = performance.now()

      // A rebuild or a restore leaves the derived index empty and the marker disagreeing, which is
      // precisely the state open point 1 names. Reproduced by emptying both, exactly as
      // `rebuildFromJsonl` does when it purges the tenant's tables.
      db.query("DELETE FROM recall_closure_members WHERE tenant_id = ?").run(TENANT)
      db.query("DELETE FROM recall_closure_index WHERE tenant_id = ?").run(TENANT)

      const rederivationStartedEpoch = Date.now()
      const rederivationStarted = performance.now()
      ensureRecallClosureIndex(db, TENANT)
      const rederivationMs = performance.now() - rederivationStarted
      const rederivationEndedEpoch = Date.now()

      await Bun.sleep(TICK_MS * 6)
      clearInterval(timer)
      const eventLoopLagMaxMs = Math.max(0, (ticks.length === 0 ? TICK_MS : Math.max(...ticks)) - TICK_MS)

      const contendingWriterWaitMaxMs =
        contending === null
          ? null
          : await contending.stopAndMeasure(rederivationStartedEpoch, rederivationEndedEpoch)

      // ── The two unpaginated read models ────────────────────────────────────────────────────
      const eventsObservation = measureHeap(() => promotions.getEvents())
      const proposalsObservation = measureHeap(() => promotions.getProposalsForParent(PARENT_HORIZON))
      const readModels: ReadModelMeasurement[] = [
        {
          readModel: "getEvents",
          rowsReturned: eventsObservation.value.length,
          durableRows: durableMirrorRows(stateDir, "promotion_events"),
          wallMs: eventsObservation.wallMs,
          retainedHeapBytes: eventsObservation.retainedHeapBytes,
          postCallHeapBytes: eventsObservation.postCallHeapBytes,
          rssDeltaBytes: eventsObservation.rssDeltaBytes,
        },
        {
          readModel: "getProposalsForParent",
          rowsReturned: proposalsObservation.value.length,
          durableRows: durableMirrorRows(stateDir, "proposals"),
          wallMs: proposalsObservation.wallMs,
          retainedHeapBytes: proposalsObservation.retainedHeapBytes,
          postCallHeapBytes: proposalsObservation.postCallHeapBytes,
          rssDeltaBytes: proposalsObservation.rssDeltaBytes,
        },
      ]

      points.push({
        claims: writtenClaims,
        proposals: writtenClaims,
        recallCases: writtenCases,
        closurePerCase: size.closurePerCase,
        batchSize: size.batchSize,
        fixtureBuildMs,
        batchMs: [...batchMsSinceCheckpoint],
        rederivationMs,
        eventLoopLagMaxMs,
        contendingWriterWaitMaxMs,
        readModels,
      })
      batchMsSinceCheckpoint = []

      if (verbose) {
        const [events, proposalsRead] = readModels
        console.log(
          `  @${writtenClaims} claims: rederivation ${rederivationMs.toFixed(1)} ms over ` +
            `${writtenCases} case(s), event loop blocked ${eventLoopLagMaxMs.toFixed(1)} ms` +
            (contendingWriterWaitMaxMs === null
              ? ""
              : `, contending tenant's slowest overlapping write ${contendingWriterWaitMaxMs.toFixed(1)} ms`),
        )
        console.log(
          `             getEvents -> ${events!.rowsReturned} rows in ${events!.wallMs.toFixed(1)} ms, ` +
            `retained ${(events!.retainedHeapBytes / 1024 / 1024).toFixed(2)} MiB, ` +
            `rss +${(events!.rssDeltaBytes / 1024 / 1024).toFixed(2)} MiB`,
        )
        console.log(
          `             getProposalsForParent -> ${proposalsRead!.rowsReturned} rows in ` +
            `${proposalsRead!.wallMs.toFixed(1)} ms, retained ` +
            `${(proposalsRead!.retainedHeapBytes / 1024 / 1024).toFixed(2)} MiB`,
        )
      }
    }
  } finally {
    db.close()
  }

  const measurement: ScaleMeasurement = {
    targetClaims: size.claims,
    repositorySourceDigest: repositorySourceDigest(),
    probeWallMs: performance.now() - probeStarted,
    points,
  }
  const verdict = verifyMeasurementIntegrity(measurement)

  const recorded: number[] = []
  if (verdict.ok) {
    // Serialised by construction: one process, one synchronous call each, in order. `appendToLedger`
    // takes NO LOCK, and the contending writer has already exited by here and could not have appended
    // anyway — `assertSoleLedgerWriter` refuses it structurally.
    assertSoleLedgerWriter()
    for (const sample of toSamples(measurement)) {
      const record = recordSample(sample)
      if (verbose) {
        console.log(
          `  ${sample.metric} = ${sample.value} ${sample.unit} [${QUARANTINE_FAMILY}] — ` +
            (record === null
              ? "measured, NOT recorded (EAP_BENCHMARK_RECORD unset)"
              : `recorded at seq ${record.seq}`),
        )
      }
      if (record !== null) recorded.push(record.seq)
    }
  }

  if (config.stateDir === undefined) removeStateDir(stateDir)
  return { measurement, verdict, recorded, stateDir }
}

interface ContendingHandle {
  ready: Promise<void>
  stopAndMeasure: (fromEpoch: number, toEpoch: number) => Promise<number | null>
}

function startContendingWriter(stateDir: string, control: string, index: number): ContendingHandle {
  const stopPath = join(control, `contending-stop-${index}`)
  const readyPath = join(control, `contending-ready-${index}.json`)
  const resultPath = join(control, `contending-result-${index}.json`)
  const logPath = join(control, `contending-${index}.log`)
  const child = spawnProbeProcess(
    [
      import.meta.path,
      "--contending-writer",
      "--state-dir",
      stateDir,
      "--stop",
      stopPath,
      "--ready",
      readyPath,
      "--result",
      resultPath,
    ],
    { logPath },
  )

  return {
    ready: (async () => {
      if (!(await waitForPath(readyPath, 60_000))) {
        child.kill()
        throw new Error(
          `scale probe: the contending writer (pid ${child.pid}) never signalled ready. Exit code ` +
            `${String(child.exitCode())}. Its output went to a file descriptor, never a pipe:\n` +
            (existsSync(logPath) ? readFileSync(logPath, "utf8").slice(-2000) : "(no log)"),
        )
      }
    })(),
    stopAndMeasure: async (fromEpoch: number, toEpoch: number) => {
      writeFileSync(stopPath, "stop", "utf8")
      await child.exited
      if (!existsSync(resultPath)) {
        throw new Error(
          `scale probe: the contending writer produced no result file. Exit code ` +
            `${String(child.exitCode())}. Log tail:\n` +
            (existsSync(logPath) ? readFileSync(logPath, "utf8").slice(-2000) : "(no log)"),
        )
      }
      const report = JSON.parse(readFileSync(resultPath, "utf8")) as ContendingReport
      // A write counts when its own window overlaps the re-derivation window. Epoch milliseconds on
      // both sides; the resolution is coarse, and a re-derivation measured in whole milliseconds is
      // exactly the case where that does not matter.
      const overlapping = report.writes.filter(
        (entry) => entry.startedAtEpoch + entry.ms >= fromEpoch && entry.startedAtEpoch <= toEpoch,
      )
      return overlapping.length === 0 ? null : Math.max(...overlapping.map((entry) => entry.ms))
    },
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  if (process.argv.includes("--contending-writer")) {
    runContendingWriter()
  } else if (process.argv.includes("--run")) {
    const claims = Number(argValue("--claims") ?? FULL_SIZE.claims)
    console.log("This probe MEASURES. It asserts no maximum batch size, no page size and no completion")
    console.log("bound, because quarantine family QA6 defers exactly those decisions.")
    console.log("")
    console.log(`TL.json open point 1: ${TL_OPEN_POINT_1}`)
    console.log(`TL.json open point 3: ${TL_OPEN_POINT_3}`)
    console.log("")
    const run = await runScaleProbe({
      claims,
      closurePerCase: Number(argValue("--closure-per-case") ?? FULL_SIZE.closurePerCase),
      batchSize: Number(argValue("--batch-size") ?? FULL_SIZE.batchSize),
      contendingWriter: !process.argv.includes("--no-contending-writer"),
      verbose: true,
    })
    console.log("")
    console.log(`Repository observed: sha256 ${run.measurement.repositorySourceDigest}`)
    console.log(`Probe wall clock: ${(run.measurement.probeWallMs / 1000).toFixed(1)} s`)
    console.log(run.verdict.ok ? `Measurement: ${run.verdict.message}` : `Measurement: ${run.verdict.message}`)
    process.exit(run.verdict.ok ? 0 : 1)
  } else {
    console.error(
      "scale and read-model volume probe. Usage:\n" +
        "  --run [--claims N] [--closure-per-case N] [--batch-size N] [--no-contending-writer]\n" +
        "  --contending-writer …   internal: the different-tenant writer child, spawned by --run",
    )
    process.exit(2)
  }
}
