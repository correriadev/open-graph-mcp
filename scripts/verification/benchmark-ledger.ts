#!/usr/bin/env bun
/**
 * F002 task 16 — the Benchmark Ledger and its noise policy.
 *
 *   bun scripts/verification/benchmark-ledger.ts --check    -> load the committed ledger, verify the
 *                                                              chain and the append-only prefix, and
 *                                                              evaluate every declared band
 *   bun scripts/verification/benchmark-ledger.ts --json     -> the same verdict as JSON on stdout
 *   bun scripts/verification/benchmark-ledger.ts --fingerprint
 *                                                           -> print this runner's fingerprint and
 *                                                              the components it is computed from
 *   bun scripts/verification/benchmark-ledger.ts --derive-band <metric> [--because "…"]
 *                                                           -> append a band DERIVED from the samples
 *                                                              already recorded for this runner
 *
 * Samples are appended by `packages/mcp-server/test/probes/host.ts`, never by hand and never by this
 * file: there is no path here that writes a measured value. `--derive-band` writes no measurement
 * either — it computes median and MAD from observations that are already in the file, and the loader
 * recomputes both, so the band it writes is checkable by anyone who reads the samples it names.
 *
 * ── The problem this exists to solve ──────────────────────────────────────────────────────────
 * This repository's suite is measurably non-deterministic: seven consecutive full-suite runs at one
 * commit gave 1041/0, 1041/0, 1040/1 and then four clean — a known flake fires on roughly 1 run in
 * 3–4. The same seven runs disagreed on the suite's own `expect()` total (4349 vs 4360 at the SAME
 * commit). A performance number harvested from a runner like that, compared naively against a
 * previous number, produces a "regression" alert whose base rate is dominated by noise; and an alert
 * that is wrong most of the time is an alert that gets muted, after which nothing is measured at all.
 *
 * So the unit here is NOT a number. It is **an observation plus the runner that produced it**, and a
 * regression claim is only ever made about `k` consecutive observations from the SAME runner.
 *
 * ── The three structural rules (the acceptance criteria, as code) ─────────────────────────────
 *  1. **No fingerprint, no sample.** `validateSample` refuses a record with no `runnerFingerprint`,
 *     and refuses one whose fingerprint is not the digest of the `runner` components carried on the
 *     same line. A sample is therefore self-verifying: you cannot relabel an observation as having
 *     come from a different machine without the line ceasing to load.
 *  2. **Different fingerprints are never compared.** `verdictFor` partitions by
 *     `(metric, runnerFingerprint)` before it looks at anything. A band belongs to one partition; a
 *     sample from another partition is not "an out-of-band sample", it is not a member of the
 *     comparison at all — it neither counts toward a breach nor interrupts a run of them. A breach
 *     requires `k` consecutive samples of that partition outside the band, and `k` is recorded IN the
 *     band, so a reader sees the evidential standard next to the threshold it guards.
 *  3. **Append-only.** Two independent mechanisms, because each alone is defeatable:
 *       - a **hash chain**: every record carries `prev` (the chain value before it) and `sha256`
 *         (the chain value after it), so rewriting or deleting any past record makes every later
 *         record's `prev` disagree with what is recomputed. `parseLedger` refuses the file.
 *       - a **prefix reconciliation** against the previously committed version read out of git: the
 *         committed file must be a line-for-line prefix of the current one. This catches the one
 *         attack the chain does not — rewriting a past record and re-chaining everything after it,
 *         which produces a self-consistent file. `reconcileAppendOnly` is the pure function.
 *     Stated plainly, because a security property nobody wrote down is a security property nobody
 *     has: **git is the anchor.** A rewrite of the ledger's git history, force-pushed, defeats both.
 *     There is no in-repo defence against that and this file does not pretend to one.
 *
 * ── Why a band cannot be widened until the breach goes away ───────────────────────────────────
 * A band is not authored. It is DERIVED — `deriveBand` computes centre and spread from named sample
 * records, and `validateBand` recomputes both from those same records and refuses any disagreement.
 * The band's parameters (`k`, the MAD multiplier, the relative floor) are constants of THIS
 * executable; the band records a copy so a reviewer reads the rule beside the threshold, and editing
 * that copy does not loosen the gate, it stops the gate. Same discipline as tasks 04, 14 and 15: the
 * datum must not be able to redefine what it is a datum about.
 *
 * The only way to move a band is to append a NEW band record derived from NEW samples. The old band
 * stays in the file for ever, the supersession is visible in the diff, and a superseding band that is
 * wider than the one it replaces must carry `widenedBecause` — which `--check` then prints on every
 * subsequent run, for ever. Widening is possible; widening quietly is not.
 *
 * ── Measurement is never assertion (task 08's rule, honoured structurally) ────────────────────
 * `quarantine-gate.ts` already reads this file as one of its four violation sources. Its rule is that
 * inside QA6/QA7 an observation is evidence and a bound is a decision. This file enforces the same
 * rule one step earlier and one step harder:
 *   - a sample may never carry `expected`, `bound` or `asserted` — refused at load, for every metric,
 *     quarantined or not;
 *   - a sample may never contain a Scenario Identifier anywhere in its JSON — so a benchmark sample
 *     cannot discharge a Scenario, by construction rather than by convention;
 *   - **a metric any of whose samples names a quarantine family may not be banded at all.** A band is
 *     a bound. Banding a QA6 metric would be exactly the "measurement dressed up as an assertion"
 *     that task 08 exists to catch, so the ledger refuses to hold such a document.
 *
 * ── Growth, and why nothing prunes this file ──────────────────────────────────────────────────
 * `docs/verification/` is committed, so this ledger is committed. It is never pruned and never
 * rotated. A pruning rule is indistinguishable, at the point of use, from deleting an inconvenient
 * sample — and it would have to be reconciled with acceptance 3, which it cannot be. The cost of
 * refusing to prune is bounded and small: a sample line is ~600 bytes, so ten samples per CI run
 * every weekday for five years is roughly 8 MB of highly compressible text. If that ever stops being
 * affordable, the sanctioned discontinuity is a NEW ledger file whose genesis record carries the old
 * file's terminal chain value as its `prev` — which requires an ADR, leaves the old file in place,
 * and is therefore not a prune.
 */

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { arch, cpus, platform, totalmem } from "node:os"
import { dirname, join } from "node:path"

import { FAMILY_IDS, type QuarantineFamilyId } from "./quarantine"
import { repoRoot } from "./register-scenarios"

export const LEDGER_PATH = "docs/verification/benchmark-ledger.jsonl"
export const SCHEMA_VERSION = 1
export const GATE_NAME = "benchmark-ledger"

// ── The noise policy, as constants of this executable ─────────────────────────────────────────

/**
 * Consecutive same-fingerprint samples that must fall outside a band before a breach is claimed.
 *
 * **Three, justified against this repository's measured noise.** The known flake set fires on about
 * 1 run in 3–4 (p ≈ 0.29, measured over seven consecutive full-suite runs). Treating that as an upper
 * bound on the chance that any one probe sample lands outside its band — it is an upper bound, since
 * the flakes are teardown and connection races rather than timing dispersion, but a conservative k
 * must be justified against the worst noise the runner is known to produce — the false-breach rate is
 * p^k:
 *
 *      k = 1  ->  1 alert in 3.4 runs   — indistinguishable from the flake set; ignored within a day
 *      k = 2  ->  1 alert in 11 runs    — still routine on a suite that misbehaves 1 run in 3–4
 *      k = 3  ->  1 alert in 37 runs    — roughly one false alarm per month of nightly probes
 *      k = 4  ->  1 alert in 124 runs   — quieter, and three runs of latency before a real regression
 *
 * k = 3 is the smallest k whose worst-case false-breach rate under the repository's OWN measured
 * noise falls below ~3%. A k that a known-noisy suite trips routinely is a k that will be ignored,
 * and an ignored gate measures nothing — the failure mode task 15 named for `unmeasured` and task 08
 * named for "nothing was looked at". The price, stated rather than discovered: a genuine regression
 * is reported on the third consecutive run, not the first. This ledger optimises for a signal that is
 * believed over a signal that is fast.
 */
export const BREACH_K = 3

/**
 * Half-width in MADs. For a normal sample MAD ≈ 0.6745σ, so 5 MADs ≈ 3.4σ — about 1 sample in 1300
 * outside the band by chance. Timing distributions are right-skewed with a heavy upper tail, so that
 * nominal rate understates reality by a lot; the tail is what `k` is for. MAD rather than standard
 * deviation because a single flake-inflated observation moves a mean and a standard deviation and
 * moves a median and a MAD hardly at all — the estimator has to survive the noise it is estimating.
 */
export const BAND_MAD_MULTIPLIER = 5

/**
 * A floor on the half-width, as a fraction of the centre. A window of coarsely quantised values (five
 * boots that all round to 50 ms) has MAD 0, and a zero-width band would report a breach on the first
 * sample that differs by one millisecond. 10% is the smallest floor that comfortably covers observed
 * host-to-host jitter on an otherwise idle machine.
 */
export const BAND_RELATIVE_FLOOR = 0.1

/**
 * Samples required to derive a band. A MAD over three points is arithmetic rather than statistics.
 * Five is the point at which the median stops being decided by a single observation.
 */
export const MIN_BAND_WINDOW = 5

export const POLICY_TEXT =
  "OBSERVED, never authored. Every sample carries metric, value, unit, run id, commit and a runner " +
  "fingerprint; a sample missing the fingerprint is refused on append (ADR-0021: verification by " +
  "host log, never self-report). Samples of differing runner fingerprints are NEVER compared. A " +
  `breach requires ${BREACH_K} consecutive same-fingerprint samples outside the band, and k is ` +
  "recorded in the band. A band is derived from named samples and recomputed on load, so it cannot " +
  "be widened by hand; a superseding wider band must state why, and that statement is reprinted on " +
  "every check for ever. A band is a bound, so a metric measured inside a quarantined family (QA6, " +
  "QA7) may not be banded at all: an observation there is evidence and a bound is the decision the " +
  "quarantine defers. A sample may never carry expected/bound/asserted and may never name a " +
  "Scenario Identifier — a benchmark sample discharges nothing. The file is append-only: a hash " +
  "chain refuses a rewrite or a deletion, and a prefix reconciliation against the previously " +
  "committed version refuses a re-chained forgery. Nothing prunes this file."

// ── The runner fingerprint ────────────────────────────────────────────────────────────────────

export interface RunnerComponents {
  /** `process.platform`. A Windows teardown race and a Linux one are not the same measurement. */
  os: string
  /** `process.arch`. */
  arch: string
  /** `os.cpus()[0].model`, whitespace-collapsed. */
  cpuModel: string
  /** Core count as the runtime sees it — the single biggest lever on a concurrency probe. */
  cpuCount: number
  /** Total memory rounded to GiB. Rounded because the exact byte count wobbles under a hypervisor. */
  memGiB: number
  runtime: "bun"
  /** `Bun.version`. A runtime upgrade changes timings and must not be averaged across. */
  runtimeVersion: string
  /** `ci` or `local`. A shared hosted runner and an idle laptop are different populations. */
  environment: "ci" | "local"
  /** GitHub's `ImageOS` (e.g. `win22`), or empty. The hosted image changes under you; the name is stable. */
  ciImage: string
}

/** Declared in order, so the digest's input is a fact about this list and not about object literal order. */
export const FINGERPRINT_COMPONENTS = [
  "os",
  "arch",
  "cpuModel",
  "cpuCount",
  "memGiB",
  "runtime",
  "runtimeVersion",
  "environment",
  "ciImage",
] as const

/**
 * Deliberately NOT in the fingerprint. Each of these changes on nearly every run, and a fingerprint
 * that changes every run partitions the ledger into populations of one — at which point no two
 * samples are ever comparable, no band is ever evaluable, and the ledger is inert while looking
 * maximally rigorous. That is the failure mode this list exists to prevent.
 */
export const FINGERPRINT_EXCLUSIONS: readonly { field: string; why: string }[] = [
  { field: "pid", why: "Changes every process. Nothing about a pid changes a timing." },
  { field: "timestamp", why: "Changes every sample. It is recorded as `at`, and compared by nobody." },
  { field: "runId", why: "Changes every run by definition; it identifies the sample, not the runner." },
  { field: "commit", why: "The subject under measurement, not the instrument measuring it." },
  {
    field: "hostname",
    why:
      "Hosted CI runners get a fresh random hostname per job, so including it would make every CI " +
      "sample incomparable with every other. The information it would add locally — telling two " +
      "developer machines apart — is already carried by cpuModel, cpuCount and memGiB.",
  },
  {
    field: "osRelease",
    why:
      "A Windows or kernel patch bumps it, which would discard all prior history for a change that " +
      "usually moves nothing. Recorded on the sample as context instead, where a human can read it " +
      "when a step change needs explaining.",
  },
  {
    field: "cpuSpeed",
    why:
      "os.cpus()[].speed reports the CURRENT clock on several platforms, so it moves with thermal " +
      "and power state within a single run. cpuModel names the part, which is what is stable.",
  },
  {
    field: "freemem / loadavg",
    why: "Ambient conditions. They are precisely the noise the band is meant to absorb, not partition.",
  },
  { field: "cwd / branch", why: "Properties of the invocation, not of the machine that ran it." },
]

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

/** Deterministic JSON: keys sorted at every depth, so a digest depends on values and never on order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
}

export function fingerprintId(components: RunnerComponents): string {
  const payload: Record<string, unknown> = {}
  for (const field of FINGERPRINT_COMPONENTS) payload[field] = components[field]
  return `fp-${sha256(canonicalJson(payload)).slice(0, 16)}`
}

/** This machine, as the fingerprint sees it. Called by the probe harness, never by a human. */
export function detectRunner(): RunnerComponents {
  const cores = cpus()
  return {
    os: platform(),
    arch: arch(),
    cpuModel: (cores[0]?.model ?? "unknown").replace(/\s+/g, " ").trim(),
    cpuCount: cores.length,
    memGiB: Math.round(totalmem() / 1024 ** 3),
    runtime: "bun",
    runtimeVersion: typeof Bun === "undefined" ? "unknown" : Bun.version,
    environment: (process.env.CI ?? "").length > 0 ? "ci" : "local",
    ciImage: process.env.ImageOS ?? "",
  }
}

// ── Records ───────────────────────────────────────────────────────────────────────────────────

export interface Sealed {
  /** The chain value before this record. */
  prev: string
  /** The chain value after this record: sha256(prev + canonicalJson(record without sha256)). */
  sha256: string
}

export interface UnsealedPolicy {
  kind: "policy"
  schemaVersion: number
  seq: number
  policy: string
  k: number
  madMultiplier: number
  relativeFloor: number
  minBandWindow: number
  fingerprintComponents: readonly string[]
  fingerprintExclusions: readonly { field: string; why: string }[]
  at: string
}

export interface UnsealedSample {
  kind: "sample"
  seq?: number
  /** Dotted, stable, and the join key of every comparison. */
  metric: string
  value: number
  unit: string
  runId: string
  commit: string
  runnerFingerprint: string
  runner: RunnerComponents
  at: string
  /** How the value was reduced from raw observations, e.g. `median-of-15`. Free prose, never parsed. */
  aggregation?: string
  /** Raw observations behind `value`, when it is a reduction. */
  observations?: number
  /** Ambient context that is NOT in the fingerprint but helps explain a step change. */
  context?: Record<string, string | number>
  /** Set only when the observation sits inside a quarantined family. Then the metric may not be banded. */
  familyId?: QuarantineFamilyId
  testFile?: string
  testName?: string
  note?: string
}

export interface UnsealedBand {
  kind: "band"
  seq?: number
  metric: string
  runnerFingerprint: string
  k: number
  madMultiplier: number
  relativeFloor: number
  center: number
  spread: number
  lower: number
  upper: number
  derivedFrom: { sampleSeqs: number[] }
  at: string
  /** The seq of the band this one replaces, or null for the first band of a partition. */
  supersedes: number | null
  /** Required when this band is wider than the one it supersedes. Reprinted on every check, for ever. */
  widenedBecause: string | null
}

export type PolicyRecord = UnsealedPolicy & Sealed
export type SampleRecord = UnsealedSample & Sealed & { seq: number }
export type BandRecord = UnsealedBand & Sealed & { seq: number }
export type LedgerRecord = PolicyRecord | SampleRecord | BandRecord
export type UnsealedRecord = UnsealedPolicy | UnsealedSample | UnsealedBand

const GENESIS = sha256(`${GATE_NAME}:v${SCHEMA_VERSION}:genesis`)

export function policyRecord(at = "1970-01-01T00:00:00.000Z"): UnsealedPolicy {
  return {
    kind: "policy",
    schemaVersion: SCHEMA_VERSION,
    seq: 0,
    policy: POLICY_TEXT,
    k: BREACH_K,
    madMultiplier: BAND_MAD_MULTIPLIER,
    relativeFloor: BAND_RELATIVE_FLOOR,
    minBandWindow: MIN_BAND_WINDOW,
    fingerprintComponents: [...FINGERPRINT_COMPONENTS],
    fingerprintExclusions: FINGERPRINT_EXCLUSIONS,
    at,
  }
}

const fail = (message: string): never => {
  throw new Error(`${GATE_NAME}: ${message}`)
}

// ── Validation ────────────────────────────────────────────────────────────────────────────────

/** Any Scenario Identifier, anywhere in a sample. A benchmark sample discharges nothing, ever. */
const SCENARIO_IDENTIFIER = /EAP-[A-Z]+-\d{3}/

const DECISION_FIELDS = ["expected", "bound", "asserted", "threshold", "budget", "limit"] as const

export function validateSample(record: UnsealedSample, at: number): void {
  const where = `record ${at}`
  if (typeof record.metric !== "string" || record.metric.trim().length === 0) {
    fail(`${where} names no metric. A value whose subject is unstated is not an observation.`)
  }
  if (typeof record.value !== "number" || !Number.isFinite(record.value)) {
    fail(`${where} (${record.metric}) carries no finite value.`)
  }
  if (typeof record.unit !== "string" || record.unit.trim().length === 0) {
    fail(
      `${where} (${record.metric}) states no unit. "412" is not a measurement; "412 ms" is. A unit ` +
        "that lives only in a metric name drifts away from the numbers it governs.",
    )
  }
  if (typeof record.runId !== "string" || record.runId.trim().length === 0) {
    fail(`${where} (${record.metric}) carries no runId, so two samples of one run cannot be told from two runs.`)
  }
  if (typeof record.commit !== "string" || record.commit.trim().length === 0) {
    fail(`${where} (${record.metric}) names no commit, so the value describes no state of the code.`)
  }
  if (typeof record.runnerFingerprint !== "string" || record.runnerFingerprint.trim().length === 0) {
    fail(
      `${where} (${record.metric}) carries no runnerFingerprint. REJECTED — an unattributed timing is ` +
        "not a weak measurement, it is not a measurement: it cannot be compared with anything, " +
        "because nothing is known about what produced it.",
    )
  }
  if (record.runner === undefined || record.runner === null || typeof record.runner !== "object") {
    fail(
      `${where} (${record.metric}) carries a fingerprint but not the components it is a digest of, ` +
        "so the fingerprint is an opaque label that no reader can check or interpret.",
    )
  }
  const recomputed = fingerprintId(record.runner)
  if (recomputed !== record.runnerFingerprint) {
    fail(
      `${where} (${record.metric}) declares fingerprint ${record.runnerFingerprint} but its runner ` +
        `components do not hash to it (they hash to ${recomputed}). A sample cannot be relabelled as ` +
        "having come from a different machine.",
    )
  }
  const decided = DECISION_FIELDS.filter(
    (field) => (record as unknown as Record<string, unknown>)[field] !== undefined,
  )
  if (decided.length > 0) {
    fail(
      `${where} (${record.metric}) carries ${decided.join(", ")}. A ledger sample is an OBSERVATION. ` +
        "Stating an expected value or a bound on the same line turns it into an assertion, which is " +
        "the decision this ledger — and task 08's quarantine gate — exist to keep out of a probe.",
    )
  }
  const serialized = canonicalJson(record)
  const named = SCENARIO_IDENTIFIER.exec(serialized)
  if (named !== null) {
    fail(
      `${where} (${record.metric}) names ${named[0]}. A benchmark sample MUST NEVER discharge a ` +
        "Scenario Identifier: a number observed is not a property proven, and a Traceability Link " +
        "minted from a measurement would be evidence of nothing.",
    )
  }
  if (record.familyId !== undefined && !(FAMILY_IDS as readonly string[]).includes(record.familyId)) {
    fail(
      `${where} (${record.metric}) names quarantine family "${record.familyId}", which is outside the ` +
        `closed union ${FAMILY_IDS.join(" | ")}.`,
    )
  }
}

export function validateBand(record: UnsealedBand, before: readonly LedgerRecord[], at: number): void {
  const where = `record ${at}`
  if (typeof record.metric !== "string" || record.metric.trim().length === 0) fail(`${where} names no metric.`)
  if (typeof record.runnerFingerprint !== "string" || record.runnerFingerprint.trim().length === 0) {
    fail(`${where} (band ${record.metric}) names no runnerFingerprint. A band belongs to one runner or to none.`)
  }
  if (record.k !== BREACH_K) {
    fail(
      `${where} (band ${record.metric}) declares k=${String(record.k)} but this executable's policy k ` +
        `is ${BREACH_K}. k is a constant of the gate; the band records a copy so a reviewer reads the ` +
        "evidential standard beside the threshold. Editing that copy does not raise the bar for a " +
        "breach, it stops the gate.",
    )
  }
  if (record.madMultiplier !== BAND_MAD_MULTIPLIER || record.relativeFloor !== BAND_RELATIVE_FLOOR) {
    fail(
      `${where} (band ${record.metric}) declares band parameters this executable does not apply ` +
        `(multiplier ${String(record.madMultiplier)}, floor ${String(record.relativeFloor)}; policy is ` +
        `${BAND_MAD_MULTIPLIER} and ${BAND_RELATIVE_FLOOR}).`,
    )
  }

  const samples = before.filter((entry): entry is SampleRecord => entry.kind === "sample")
  const bySeq = new Map(samples.map((entry) => [entry.seq, entry]))
  const window: SampleRecord[] = []
  for (const seq of record.derivedFrom?.sampleSeqs ?? []) {
    const found = bySeq.get(seq)
    if (found === undefined) {
      fail(
        `${where} (band ${record.metric}) is derived from sample seq ${seq}, which is not a sample ` +
          "record preceding it. A band is derived from observations that exist, or it is authored.",
      )
    }
    if (found!.metric !== record.metric || found!.runnerFingerprint !== record.runnerFingerprint) {
      fail(
        `${where} (band ${record.metric}) is derived from sample seq ${seq}, which is ` +
          `${found!.metric} on ${found!.runnerFingerprint}. A band is derived from its OWN partition; ` +
          "samples of differing runner fingerprints are never compared, and never pooled either.",
      )
    }
    window.push(found!)
  }
  if (window.length < MIN_BAND_WINDOW) {
    fail(
      `${where} (band ${record.metric}) is derived from ${window.length} sample(s); the minimum ` +
        `window is ${MIN_BAND_WINDOW}. A spread estimated from fewer points is decided by whichever ` +
        "single observation happened to be noisiest.",
    )
  }
  if (window.some((entry) => entry.familyId !== undefined)) {
    fail(
      `${where} (band ${record.metric}) bands a metric observed inside quarantine family ` +
        `${window.find((entry) => entry.familyId !== undefined)!.familyId}. A BAND IS A BOUND. ` +
        "QA6 and QA7 admit measurement WITHOUT assertion: recording the observed value is evidence, " +
        "stating a bound for it is the decision the quarantine defers (001 §5 rule 3). Record the " +
        "observations and leave them unbanded.",
    )
  }

  const recomputed = bandFrom(window.map((entry) => entry.value))
  for (const field of ["center", "spread", "lower", "upper"] as const) {
    if (round6(record[field]) !== round6(recomputed[field])) {
      fail(
        `${where} (band ${record.metric}) declares ${field}=${String(record[field])} but the samples ` +
          `it names derive ${field}=${recomputed[field]}. A band is DERIVED, never authored: this is ` +
          "how a band gets widened until an inconvenient breach disappears, and it does not load. To " +
          "move a band, append a new one derived from new samples.",
      )
    }
  }

  const priorBands = before.filter(
    (entry): entry is BandRecord =>
      entry.kind === "band" &&
      entry.metric === record.metric &&
      entry.runnerFingerprint === record.runnerFingerprint,
  )
  const previous = priorBands[priorBands.length - 1] ?? null
  const expectedSupersedes = previous === null ? null : previous.seq
  if ((record.supersedes ?? null) !== expectedSupersedes) {
    fail(
      `${where} (band ${record.metric}) declares supersedes=${String(record.supersedes)}; the band it ` +
        `actually replaces is ${expectedSupersedes === null ? "none" : `seq ${expectedSupersedes}`}.`,
    )
  }
  if (previous !== null) {
    const widened = record.upper - record.lower > previous.upper - previous.lower
    if (widened && (record.widenedBecause ?? "").trim().length === 0) {
      fail(
        `${where} (band ${record.metric}) is WIDER than the band it supersedes ` +
          `(${previous.upper - previous.lower} -> ${record.upper - record.lower}) and states no ` +
          "reason. Widening a band is permitted; widening it quietly is the whole of the behaviour " +
          "this ledger exists to abolish. Set `widenedBecause`, and it will be reprinted on every " +
          "check from now on.",
      )
    }
  }
}

// ── Median, MAD, band ─────────────────────────────────────────────────────────────────────────

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6

export function median(values: readonly number[]): number {
  if (values.length === 0) fail("median of an empty window.")
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** Median absolute deviation from the median. Robust to a single flake-inflated observation. */
export function mad(values: readonly number[]): number {
  const centre = median(values)
  return median(values.map((value) => Math.abs(value - centre)))
}

export interface BandShape {
  center: number
  spread: number
  lower: number
  upper: number
}

/** The band a window of values implies. Pure, and the single definition both derivation and validation use. */
export function bandFrom(values: readonly number[]): BandShape {
  const center = median(values)
  const spread = mad(values)
  const halfWidth = Math.max(BAND_MAD_MULTIPLIER * spread, Math.abs(center) * BAND_RELATIVE_FLOOR)
  return {
    center: round6(center),
    spread: round6(spread),
    lower: round6(center - halfWidth),
    upper: round6(center + halfWidth),
  }
}

/**
 * Derives a band for one `(metric, fingerprint)` partition from every sample of that partition
 * already in `records`. Nothing here invents a number: the caller records observations first and
 * derives afterwards.
 */
export function deriveBand(
  records: readonly LedgerRecord[],
  metric: string,
  runnerFingerprint: string,
  options: { at?: string; widenedBecause?: string | null } = {},
): UnsealedBand {
  const window = records.filter(
    (entry): entry is SampleRecord =>
      entry.kind === "sample" && entry.metric === metric && entry.runnerFingerprint === runnerFingerprint,
  )
  if (window.length < MIN_BAND_WINDOW) {
    fail(
      `cannot derive a band for ${metric} on ${runnerFingerprint} from ${window.length} sample(s): ` +
        `the minimum window is ${MIN_BAND_WINDOW}.`,
    )
  }
  const priorBands = records.filter(
    (entry): entry is BandRecord =>
      entry.kind === "band" && entry.metric === metric && entry.runnerFingerprint === runnerFingerprint,
  )
  const previous = priorBands[priorBands.length - 1] ?? null
  return {
    kind: "band",
    metric,
    runnerFingerprint,
    k: BREACH_K,
    madMultiplier: BAND_MAD_MULTIPLIER,
    relativeFloor: BAND_RELATIVE_FLOOR,
    ...bandFrom(window.map((entry) => entry.value)),
    derivedFrom: { sampleSeqs: window.map((entry) => entry.seq) },
    at: options.at ?? new Date().toISOString(),
    supersedes: previous === null ? null : previous.seq,
    widenedBecause: options.widenedBecause ?? null,
  }
}

// ── The chain (acceptance 3) ──────────────────────────────────────────────────────────────────

/** sha256(prev + canonical(record without its own digest)). `prev` is inside the payload too. */
export function chainDigest(prev: string, record: Omit<LedgerRecord, "sha256">): string {
  return sha256(`${prev}${canonicalJson(record)}`)
}

/**
 * Seals a list of unsealed records into a chained ledger, validating each one against everything
 * that precedes it. This is the only constructor: a record that does not pass validation is never
 * given a chain value, so it can never enter a ledger that loads.
 */
export function sealAll(records: readonly UnsealedRecord[]): LedgerRecord[] {
  const sealed: LedgerRecord[] = []
  let prev = GENESIS
  for (const [index, raw] of records.entries()) {
    if (index === 0 && raw.kind !== "policy") {
      fail("the first record of a ledger is its policy record; this one is not.")
    }
    if (index > 0 && raw.kind === "policy") {
      fail(`record ${index} is a second policy record. The policy is declared once, at the genesis.`)
    }
    if (raw.kind === "sample") validateSample(raw, index)
    if (raw.kind === "band") validateBand(raw, sealed, index)
    const body = { ...raw, seq: index, prev } as Omit<LedgerRecord, "sha256">
    const digest = chainDigest(prev, body)
    sealed.push({ ...body, sha256: digest } as LedgerRecord)
    prev = digest
  }
  return sealed
}

export function serializeLedger(records: readonly LedgerRecord[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n"
}

/**
 * Parses and fully verifies a ledger: JSON, seq continuity, per-record validation, and the hash
 * chain. Every rejection names the line, because a broken chain is a claim about a specific edit.
 */
export function parseLedger(raw: string): LedgerRecord[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) {
    fail(
      `${LEDGER_PATH} is empty. An empty ledger is not a ledger with no regressions in it — it is a ` +
        "ledger that records nothing, and it must not read as a pass.",
    )
  }
  const records: LedgerRecord[] = []
  let prev = GENESIS
  for (const [index, line] of lines.entries()) {
    let parsed: LedgerRecord
    try {
      parsed = JSON.parse(line) as LedgerRecord
    } catch {
      fail(`line ${index + 1} is not valid JSON. The ledger is append-only; a malformed line means a writer was interrupted.`)
      continue
    }
    if (parsed.seq !== index) {
      fail(
        `line ${index + 1} declares seq ${String(parsed.seq)}. Sequence numbers are positions, so a ` +
          "gap means a past record was DELETED and a jump means one was inserted. Either way the file " +
          "is no longer append-only.",
      )
    }
    if (parsed.prev !== prev) {
      fail(
        `line ${index + 1} (seq ${parsed.seq}, kind ${parsed.kind}) declares prev ` +
          `${String(parsed.prev).slice(0, 16)} but the chain up to it computes ` +
          `${prev.slice(0, 16)}. A past record was rewritten or deleted. The ledger is append-only: ` +
          "correcting a sample means appending a new one, never editing the old.",
      )
    }
    if (index === 0 && parsed.kind !== "policy") fail("line 1 is not the policy record.")
    if (index > 0 && parsed.kind === "policy") fail(`line ${index + 1} is a second policy record.`)
    if (parsed.kind === "sample") validateSample(parsed, index)
    if (parsed.kind === "band") validateBand(parsed, records, index)

    const { sha256: declared, ...body } = parsed
    const recomputed = chainDigest(prev, body as Omit<LedgerRecord, "sha256">)
    if (declared !== recomputed) {
      fail(
        `line ${index + 1} (seq ${parsed.seq}) declares sha256 ${String(declared).slice(0, 16)} but ` +
          `its own content chains to ${recomputed.slice(0, 16)}. This record was edited in place.`,
      )
    }
    records.push(parsed)
    prev = recomputed
  }
  if (records[0]!.kind === "policy") {
    const head = records[0] as PolicyRecord
    if (head.schemaVersion !== SCHEMA_VERSION) {
      fail(`the ledger declares schemaVersion ${head.schemaVersion}; this build reads ${SCHEMA_VERSION}.`)
    }
    if (head.k !== BREACH_K || head.policy !== POLICY_TEXT) {
      fail(
        "the policy recorded at the genesis of the ledger disagrees with this executable's. The " +
          "policy is a constant of the gate; the ledger records a copy so a reader reads the rule " +
          "beside the numbers it governs. Editing that copy does not change the rule.",
      )
    }
  }
  return records
}

export interface AppendOnlyVerdict {
  ok: boolean
  reason: string
}

/**
 * The prefix rule, as a pure function over lines. This is the check the hash chain cannot make: a
 * rewritten-and-re-chained ledger is internally consistent, and only a copy of what was previously
 * committed reveals it.
 */
export function reconcileAppendOnly(prior: readonly string[], current: readonly string[]): AppendOnlyVerdict {
  const priorLines = prior.filter((line) => line.trim().length > 0)
  const currentLines = current.filter((line) => line.trim().length > 0)
  if (currentLines.length < priorLines.length) {
    return {
      ok: false,
      reason:
        `the previously committed ledger holds ${priorLines.length} record(s) and this one holds ` +
        `${currentLines.length}. Records were DELETED. The ledger is append-only.`,
    }
  }
  for (const [index, line] of priorLines.entries()) {
    if (currentLines[index] !== line) {
      return {
        ok: false,
        reason:
          `line ${index + 1} differs from the previously committed ledger. A past record was ` +
          "REWRITTEN. The hash chain does not catch this on its own — a rewrite followed by " +
          "re-chaining is internally consistent — which is why the committed version is compared " +
          "line for line. Append a correcting sample; never edit a recorded one.",
      }
    }
  }
  return {
    ok: true,
    reason:
      priorLines.length === currentLines.length
        ? `unchanged: ${priorLines.length} record(s), identical to the previously committed ledger.`
        : `append-only: ${currentLines.length - priorLines.length} record(s) appended after ${priorLines.length} unchanged.`,
  }
}

// ── Evaluation (acceptance 2) ─────────────────────────────────────────────────────────────────

export type MetricOutcome = "within-band" | "breach" | "insufficient-history" | "unbanded"

export interface MetricVerdict {
  metric: string
  runnerFingerprint: string
  outcome: MetricOutcome
  band: BandRecord | null
  k: number
  /** The samples the verdict was reached on: the last k of the partition, appended after the band. */
  window: SampleRecord[]
  /** How many post-band samples exist in this partition. */
  postBandSamples: number
  message: string
}

const outside = (band: BandRecord, sample: SampleRecord): boolean =>
  sample.value < band.lower || sample.value > band.upper

/**
 * The verdict for one `(metric, fingerprint)` partition.
 *
 * Only samples appended AFTER the band count. Evaluating a band against the very window it was
 * derived from is circular — the median of a window is inside its own band by construction — so a
 * freshly declared band reports `insufficient-history` until k genuinely new observations exist. That
 * is the honest state: the band has not yet been tested by anything.
 */
export function verdictFor(
  records: readonly LedgerRecord[],
  metric: string,
  runnerFingerprint: string,
): MetricVerdict {
  const partition = records.filter(
    (entry): entry is SampleRecord =>
      entry.kind === "sample" && entry.metric === metric && entry.runnerFingerprint === runnerFingerprint,
  )
  const bands = records.filter(
    (entry): entry is BandRecord =>
      entry.kind === "band" && entry.metric === metric && entry.runnerFingerprint === runnerFingerprint,
  )
  const band = bands[bands.length - 1] ?? null

  if (band === null) {
    return {
      metric,
      runnerFingerprint,
      outcome: "unbanded",
      band: null,
      k: BREACH_K,
      window: [],
      postBandSamples: partition.length,
      message:
        `${metric} on ${runnerFingerprint}: ${partition.length} observation(s) recorded, no band ` +
        "declared. This metric is OBSERVED and nothing about it is claimed — which is the correct " +
        "state for a metric inside a quarantined family, and a gap for any other.",
    }
  }

  const post = partition.filter((entry) => entry.seq > band.seq)
  if (post.length < band.k) {
    return {
      metric,
      runnerFingerprint,
      outcome: "insufficient-history",
      band,
      k: band.k,
      window: post,
      postBandSamples: post.length,
      message:
        `${metric} on ${runnerFingerprint}: a band is declared (seq ${band.seq}, ` +
        `[${band.lower}, ${band.upper}] ${post[0]?.unit ?? ""}) but only ${post.length} sample(s) ` +
        `have been recorded since, and a breach needs ${band.k}. THIS IS NOT A PASS. A band with no ` +
        "history behind it has not been tested by anything; reporting it green would mean this gate " +
        "went quiet exactly when it had least evidence. Record more observations, or withdraw the " +
        "band by not declaring one.",
    }
  }

  const window = post.slice(-band.k)
  const allOutside = window.every((entry) => outside(band, entry))
  if (allOutside) {
    return {
      metric,
      runnerFingerprint,
      outcome: "breach",
      band,
      k: band.k,
      window,
      postBandSamples: post.length,
      message:
        `${metric} on ${runnerFingerprint}: BREACH — ${band.k} consecutive samples from this runner ` +
        `fell outside [${band.lower}, ${band.upper}] ${window[0]!.unit}: ` +
        `${window.map((entry) => `${entry.value} (${entry.runId}, ${entry.commit.slice(0, 12)})`).join(", ")}. ` +
        `Centre ${band.center}, spread ${band.spread} (MAD). This is a signal to INVESTIGATE and it ` +
        "discharges no Scenario, proves no bound and settles no open question. Do not widen the band.",
    }
  }

  const recentOutside = window.filter((entry) => outside(band, entry)).length
  return {
    metric,
    runnerFingerprint,
    outcome: "within-band",
    band,
    k: band.k,
    window,
    postBandSamples: post.length,
    message:
      `${metric} on ${runnerFingerprint}: within band [${band.lower}, ${band.upper}] ` +
      `${window[0]!.unit} — last ${band.k} of ${post.length} post-band sample(s): ` +
      `${window.map((entry) => entry.value).join(", ")}` +
      (recentOutside === 0
        ? "."
        : ` (${recentOutside} outside, fewer than the ${band.k} consecutive a breach requires — this ` +
          "is what the runner's measured 1-in-3-to-4 flake rate looks like, and it is why k exists)."),
  }
}

export interface LedgerReport {
  gate: typeof GATE_NAME
  blocking: true
  outcome: "pass" | "breach" | "insufficient-history"
  records: number
  samples: number
  bands: number
  fingerprints: string[]
  verdicts: MetricVerdict[]
  /** Every superseding band that widened its predecessor, reprinted for ever. */
  wideningNotices: string[]
  message: string
}

/** Every `(metric, fingerprint)` partition present in the ledger, in first-seen order. */
export function partitions(records: readonly LedgerRecord[]): { metric: string; runnerFingerprint: string }[] {
  const seen = new Map<string, { metric: string; runnerFingerprint: string }>()
  for (const record of records) {
    if (record.kind !== "sample" && record.kind !== "band") continue
    const key = `${record.metric} :: ${record.runnerFingerprint}`
    if (!seen.has(key)) seen.set(key, { metric: record.metric, runnerFingerprint: record.runnerFingerprint })
  }
  return [...seen.values()]
}

export function evaluateLedger(records: readonly LedgerRecord[]): LedgerReport {
  const verdicts = partitions(records).map((key) => verdictFor(records, key.metric, key.runnerFingerprint))
  const samples = records.filter((entry) => entry.kind === "sample").length
  const bands = records.filter((entry) => entry.kind === "band") as BandRecord[]
  const fingerprints = [
    ...new Set(records.filter((e): e is SampleRecord => e.kind === "sample").map((e) => e.runnerFingerprint)),
  ]
  const wideningNotices = bands
    .filter((band) => (band.widenedBecause ?? "").trim().length > 0)
    .map(
      (band) =>
        `band seq ${band.seq} for ${band.metric} on ${band.runnerFingerprint} WIDENED the band it ` +
        `superseded (seq ${String(band.supersedes)}): ${band.widenedBecause}`,
    )

  const breached = verdicts.filter((verdict) => verdict.outcome === "breach")
  const thin = verdicts.filter((verdict) => verdict.outcome === "insufficient-history")
  const outcome: LedgerReport["outcome"] =
    breached.length > 0 ? "breach" : thin.length > 0 ? "insufficient-history" : "pass"

  const head =
    outcome === "breach"
      ? `${GATE_NAME}: BREACH (BLOCKING) — ${breached.length} banded metric(s) fell outside their band ` +
        `for ${BREACH_K} consecutive same-fingerprint samples.`
      : outcome === "insufficient-history"
        ? `${GATE_NAME}: FAIL (BLOCKING) — ${thin.length} declared band(s) have fewer than ${BREACH_K} ` +
          "samples behind them and could not be evaluated. Not measured is not unchanged."
        : `${GATE_NAME}: PASS — ${records.length} record(s), ${samples} sample(s), ${bands.length} ` +
          `band(s), ${fingerprints.length} runner fingerprint(s); the chain is intact and no band was ` +
          "breached."

  return {
    gate: GATE_NAME,
    blocking: true,
    outcome,
    records: records.length,
    samples,
    bands: bands.length,
    fingerprints,
    verdicts,
    wideningNotices,
    message: [head, ...verdicts.map((verdict) => `  ${verdict.message}`), ...wideningNotices.map((n) => `  NOTE: ${n}`)].join(
      "\n",
    ),
  }
}

export function exitCodeFor(report: LedgerReport): number {
  return report.outcome === "pass" ? 0 : 1
}

// ── Disk ──────────────────────────────────────────────────────────────────────────────────────

export function ledgerFile(root: string = repoRoot()): string {
  return join(root, ...LEDGER_PATH.split("/"))
}

/** Reads and fully verifies the committed ledger. Throws with a named line on any tampering. */
export function loadLedger(root: string = repoRoot()): LedgerRecord[] {
  const file = ledgerFile(root)
  if (!existsSync(file)) {
    fail(
      `${LEDGER_PATH} does not exist. A missing ledger is not a ledger with nothing in it: it means ` +
        "no observation has ever been recorded, which must not read as a pass.",
    )
  }
  return parseLedger(readFileSync(file, "utf8"))
}

/**
 * Appends records to the committed ledger, re-sealing from the existing chain head. The whole file
 * is re-verified before and after, so a probe cannot append onto a ledger that is already broken and
 * cannot leave one broken behind it.
 */
export function appendToLedger(records: readonly UnsealedRecord[], root: string = repoRoot()): LedgerRecord[] {
  const file = ledgerFile(root)
  const existing = existsSync(file) ? parseLedger(readFileSync(file, "utf8")) : []
  const unsealed: UnsealedRecord[] = [
    ...existing.map(({ prev: _p, sha256: _s, ...rest }) => rest as UnsealedRecord),
    ...(existing.length === 0 && records[0]?.kind !== "policy" ? [policyRecord(new Date().toISOString())] : []),
    ...records,
  ]
  const sealed = sealAll(unsealed)
  const appended = sealed.slice(existing.length)
  mkdirSync(dirname(file), { recursive: true })
  // One open-append-close of complete lines, exactly as the annotation sink does: concurrent probe
  // processes must never interleave or truncate a record.
  appendFileSync(file, serializeLedger(appended), { encoding: "utf8", flag: "a" })
  parseLedger(readFileSync(file, "utf8"))
  return appended
}

/** The previously committed ledger, read out of git. `null` when the file is new at that ref. */
export function priorLedgerLines(root: string, ref: string): string[] | null {
  try {
    const raw = execFileSync("git", ["show", `${ref}:${LEDGER_PATH}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return raw.split(/\r?\n/)
  } catch {
    return null
  }
}

export function headCommit(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  } catch {
    return process.env.GITHUB_SHA ?? "unknown"
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────────

function main(): number {
  const root = repoRoot()

  if (process.argv.includes("--fingerprint")) {
    const runner = detectRunner()
    console.log(`${fingerprintId(runner)}\n${JSON.stringify(runner, null, 2)}`)
    return 0
  }

  const deriveAt = process.argv.indexOf("--derive-band")
  if (deriveAt !== -1) {
    const metric = process.argv[deriveAt + 1]
    if (metric === undefined || metric.startsWith("--")) {
      console.error(`${GATE_NAME}: --derive-band requires a metric name.`)
      return 1
    }
    const becauseAt = process.argv.indexOf("--because")
    const because = becauseAt === -1 ? null : (process.argv[becauseAt + 1] ?? null)
    const fingerprint = fingerprintId(detectRunner())
    try {
      const existing = loadLedger(root)
      const band = deriveBand(existing, metric, fingerprint, { widenedBecause: because })
      const [appended] = appendToLedger([band], root)
      console.log(
        `${GATE_NAME}: appended band seq ${(appended as BandRecord).seq} for ${metric} on ` +
          `${fingerprint} — centre ${band.center}, spread ${band.spread} (MAD), band ` +
          `[${band.lower}, ${band.upper}], k=${band.k}, derived from sample seq(s) ` +
          `${band.derivedFrom.sampleSeqs.join(", ")}.`,
      )
      return 0
    } catch (error) {
      console.error(`${GATE_NAME}: FAIL — ${(error as Error).message}`)
      return 1
    }
  }

  let records: LedgerRecord[]
  try {
    records = loadLedger(root)
  } catch (error) {
    console.error(`${GATE_NAME}: FAIL (BLOCKING) — ${(error as Error).message}`)
    return 1
  }

  // The prefix rule, against the last committed version. Reported when git cannot supply one — a
  // check that silently skipped its own strongest test would be the failure this file is about.
  const current = readFileSync(ledgerFile(root), "utf8").split(/\r?\n/)
  const prior = priorLedgerLines(root, "HEAD")
  const appendOnly =
    prior === null
      ? {
          ok: true,
          reason:
            "no previously committed ledger at HEAD — this file is new in the working tree, so the " +
            "prefix rule has nothing to compare against yet and only the hash chain was checked.",
        }
      : reconcileAppendOnly(prior, current)

  const report = evaluateLedger(records)
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ...report, appendOnly }, null, 2))
    return appendOnly.ok ? exitCodeFor(report) : 1
  }

  const text = [
    `Benchmark Ledger — ${LEDGER_PATH}`,
    `  append-only  ${appendOnly.ok ? "OK" : "VIOLATED"} — ${appendOnly.reason}`,
    `  this runner  ${fingerprintId(detectRunner())}`,
    "",
    report.message,
  ].join("\n")

  if (!appendOnly.ok) {
    console.error(`${text}\n\n${GATE_NAME}: FAIL (BLOCKING) — ${appendOnly.reason}`)
    return 1
  }
  if (report.outcome === "pass") console.log(text)
  else console.error(text)
  return exitCodeFor(report)
}

if (import.meta.main) {
  process.exit(main())
}
