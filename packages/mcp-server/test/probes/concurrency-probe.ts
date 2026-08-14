/**
 * F002 task 17 — the multi-process concurrency probe.
 *
 * The Sequence allocator's monotonicity has been argued STRUCTURALLY up to now: `allocateSequence` is
 * one `UPSERT … RETURNING` inside a `BEGIN IMMEDIATE` transaction, `eap_sequences` is deliberately
 * left out of the tables a JSONL rebuild purges, and the doc comments in `db.ts` explain why each of
 * those makes reuse impossible. An argument is not an observation. This probe converts the argument
 * into behaviour: real writers, in SEPARATE OS PROCESSES, on SEPARATE SQLite connections, contending
 * for one write lock on one database file, before and after a `rebuildFromJsonl`.
 *
 * ── What would refute the claim (stated BEFORE the run, and printed before anything is spawned) ──
 * See `FALSIFICATION_CRITERIA`. Naming the refutation first is the whole difference between a probe
 * and a demonstration: a probe that decides afterwards what would have counted as failure has only
 * ever been able to succeed.
 *
 * ── Measurement is never assertion (the heart of the task) ────────────────────────────────────
 * Two kinds of thing come out of this probe and they are kept apart by TYPE, not by discipline:
 *
 *   CORRECTNESS — `ConcurrencyObservation` -> `analyzeConcurrency` -> `ConcurrencyVerdict`.
 *     Deterministic, OS-independent, and ASSERTED in `concurrency-probe.test.ts`. Every field is a
 *     set of identifiers or Sequence numbers. `ConcurrencyObservation` has no timing field, so a
 *     verdict cannot be a function of a duration even by accident.
 *
 *   TIMING — `ConcurrencyTimings` -> `recordSample` -> the Benchmark Ledger. NEVER asserted. Write
 *     lock hold and writer starvation are properties of a machine under an unknown ambient load, and
 *     a bound on either would be a decision this repository has not taken (task 08: an observation is
 *     evidence, a bound is a decision). The ledger enforces the same rule one layer down — it refuses
 *     any sample carrying `expected`, `bound`, `asserted`, `threshold`, `budget` or `limit`, and any
 *     sample naming a Scenario Identifier.
 *
 * `ConcurrencyTimings` is never passed to `analyzeConcurrency`; `analyzeConcurrency` cannot accept it.
 *
 * ── Verification by the durable record, never self-report (ADR-0021) ──────────────────────────
 * The writers report which Sequences they believe they committed. That report is the CLAIM. The
 * evidence is the tenant's durable JSONL mirror — the file `db.ts` calls the truth and SQLite the
 * derived index — read by the parent after every writer has exited. A reused Sequence is caught in
 * the mirror, not in a writer's opinion of itself; the writers' claims are only ever used as the set
 * that the durable record must CONTAIN.
 *
 * ── Why the ledger append is single-threaded even though the probe is not ─────────────────────
 * `appendToLedger` takes no lock: it reads the whole chain, re-seals from the head, and appends. Two
 * processes doing that at once seal against the same head and produce a file that will never load
 * again. So: only the parent ever records, only after every child has exited, and a writer child that
 * somehow reached the recording path would be refused by `assertSoleLedgerWriter()`. The most
 * concurrent thing in this repository is therefore also the most strictly serialised thing at the
 * point where it writes to a committed file.
 *
 * ── Windows and Linux ─────────────────────────────────────────────────────────────────────────
 * The correctness half is meaningful on both and identical on both: it rests on SQLite transaction
 * semantics, not on the platform's file locking primitives (LockFileEx on Windows, POSIX advisory
 * locks elsewhere). The timing half is NOT comparable across the two, and nothing here tries to
 * compare it: the runner fingerprint includes `os`, so samples from Windows and Linux are in
 * different partitions of the ledger and are never pooled or compared by construction. There is
 * therefore no OS on which this probe is quietly the weaker check.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────────────────────
 *   bun packages/mcp-server/test/probes/concurrency-probe.ts --run [--writers N] [--writes N]
 *   EAP_BENCHMARK_RECORD=1 bun …/concurrency-probe.ts --run     (also appends to the ledger)
 *   …/concurrency-probe.ts --writer …                           internal: one writer child
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Database } from "bun:sqlite"

import { allocateSequence, openDb, rebuildFromJsonl, serialTransaction, write } from "../../src/db"
import { medianOf, recordSample, removeStateDir, spawnProbeProcess, waitForPath } from "./host"

// ── The falsification criterion ───────────────────────────────────────────────────────────────

/**
 * What would REFUTE the claim under probe. Declared here, printed before a single process is spawned,
 * and each item corresponds one-to-one with a field of `ConcurrencyVerdict` that the blocking test
 * asserts is empty.
 */
export const FALSIFICATION_CRITERIA: readonly string[] = [
  "REUSE — the same Sequence value appears on two rows of the tenant's durable JSONL mirror. The " +
    "allocator's whole purpose is that this cannot happen under concurrency; one occurrence refutes " +
    "the monotonicity claim outright.",
  "LOST WRITE — a Sequence a writer reported as committed is absent from the durable mirror. The " +
    "write was admitted and the durable record does not hold it, which refutes the claim that a " +
    "committed write survives.",
  "REGRESSION ACROSS REBUILD — a Sequence allocated after `rebuildFromJsonl` is at or below the " +
    "highest Sequence allocated before it. `eap_sequences` is deliberately excluded from the tables " +
    "a rebuild purges precisely so this cannot happen; one occurrence refutes that exclusion.",
  "GAP — the durable Sequences are not the contiguous range 1..n. A Sequence was consumed by a " +
    "transaction whose row is not durable, which is a lost write with the allocator itself as witness.",
  "DUPLICATE IDENTITY — one row identifier appears twice in the durable mirror, meaning a " +
    "transaction's mirror append survived a rollback that its SQLite half did not.",
]

// ── Sizing, and why ───────────────────────────────────────────────────────────────────────────

/**
 * Writers, and writes per writer, for the in-suite run.
 *
 * FOUR writers on a reference machine with 8 cores: enough that at every moment three processes are
 * queued behind the one holding the write lock — the condition the probe exists to create — without
 * oversubscribing the machine so far that the timings become a measurement of the scheduler. TWELVE
 * writes each is 48 serialised lock acquisitions per phase and 96 across the run; a single-digit
 * number of writes would leave the outcome decidable by one unlucky interleaving, and a four-figure
 * number would buy no additional interleaving class at ten times the wall cost.
 *
 * The four writer processes are spawned ONCE and live across both phases, waiting on a barrier while
 * the parent rebuilds. That is both cheaper (four spawns, not eight) and MORE faithful: a real host
 * does not reconnect after a rebuild, so phase B's writers hold connections that were already open
 * when the rebuild ran, which is the situation a production rebuild actually meets.
 */
export const IN_SUITE_WRITERS = 4
export const IN_SUITE_WRITES_PER_WRITER = 12

/**
 * The probe RUNS INSIDE `bun test`, at the size above, on every run.
 *
 * The cost is real and is stated rather than discovered: four `bun` process spawns plus 96 serialised
 * durable transactions, measured at roughly 1–2 s against a suite that already takes ~81 s (about
 * 2%). The alternative — a separate invocation nobody wires up — was rejected because a probe that
 * runs only when someone remembers is a probe that proves nothing about the commit that broke the
 * thing. What is NOT in the suite is the RECORDING: `recordSample` appends only when
 * `EAP_BENCHMARK_RECORD` is set, so an ordinary `bun test` measures, reports, and dirties no
 * committed file. Deciding when CI records is a CI-topology question, and task 20 owns that.
 */
export const RUNS_IN_SUITE = true

const SEQUENCE_NAME = "probe_concurrency"
/** A separate allocator name used only for the pre-barrier behavioural signature. Pollutes nothing. */
const SIGNATURE_SEQUENCE_NAME = "probe_allocator_signature"
const TABLE = "contestations"
const TENANT = "probe-tenant"

// ── The observation (correctness — asserted) ──────────────────────────────────────────────────

export interface AdmittedWrite {
  phase: "a" | "b"
  writer: number
  seq: number
  id: string
}

export interface DurableWrite {
  seq: number
  id: string
}

/**
 * Everything the correctness verdict is allowed to see. Note what is NOT here: no duration, no
 * timestamp, no rate. A timing cannot influence a blocking assertion because a timing cannot be
 * expressed in this type.
 */
export interface ConcurrencyObservation {
  writers: number
  /** The OS process ids of the writers, read back from what each child reported about itself. */
  writerPids: number[]
  parentPid: number
  /** One SQLite connection per writer process, plus the parent's rebuild connection. */
  connections: number
  /** The highest Sequence admitted before `rebuildFromJsonl` ran. */
  phaseAMaxSeq: number
  admitted: readonly AdmittedWrite[]
  /** Read from the tenant's durable JSONL mirror AFTER every writer process exited. The evidence. */
  durable: readonly DurableWrite[]
  /** sha256 of the `db.ts` each writer actually loaded. Proves a mutation reached the child. */
  allocatorDigests?: string[]
  /** Two consecutive allocations each writer took before the barrier. Proves the allocator advances. */
  allocatorSignatures?: number[][]
}

export interface ConcurrencyVerdict {
  ok: boolean
  reusedSequences: number[]
  duplicateIds: string[]
  lostWrites: DurableWrite[]
  nonAdvancingAfterRebuild: AdmittedWrite[]
  gaps: number[]
  checked: number
  message: string
}

/**
 * The whole blocking half, as a pure function over the durable record.
 *
 * Pure so that the refutation logic is testable without spawning anything, and so that a broken probe
 * fails in a unit test rather than being mistaken for a broken allocator.
 */
export function analyzeConcurrency(observation: ConcurrencyObservation): ConcurrencyVerdict {
  const seqCounts = new Map<number, number>()
  const idCounts = new Map<string, number>()
  for (const row of observation.durable) {
    seqCounts.set(row.seq, (seqCounts.get(row.seq) ?? 0) + 1)
    idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1)
  }
  const reusedSequences = [...seqCounts.entries()].filter(([, n]) => n > 1).map(([seq]) => seq).sort((a, b) => a - b)
  const duplicateIds = [...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id).sort()

  // Keyed by row IDENTITY, not by Sequence: when a Sequence has been reused, a Sequence-keyed lookup
  // collapses many rows onto one and reports every loser as a lost write, which would let one defect
  // (reuse) manufacture a second, false one (loss). A row is lost when its id is absent from the
  // durable mirror, or present carrying a different Sequence from the one its writer reported.
  const durableById = new Map(observation.durable.map((row) => [row.id, row.seq]))
  const lostWrites = observation.admitted
    .filter((entry) => durableById.get(entry.id) !== entry.seq)
    .map((entry) => ({ seq: entry.seq, id: entry.id }))

  const nonAdvancingAfterRebuild = observation.admitted.filter(
    (entry) => entry.phase === "b" && entry.seq <= observation.phaseAMaxSeq,
  )

  const observed = new Set(observation.durable.map((row) => row.seq))
  const highest = observation.durable.reduce((max, row) => Math.max(max, row.seq), 0)
  const gaps: number[] = []
  for (let seq = 1; seq <= highest; seq++) if (!observed.has(seq)) gaps.push(seq)

  const failures = [
    reusedSequences.length > 0 ? `${reusedSequences.length} REUSED Sequence(s): ${reusedSequences.join(", ")}` : null,
    duplicateIds.length > 0 ? `${duplicateIds.length} duplicate row identifier(s): ${duplicateIds.join(", ")}` : null,
    lostWrites.length > 0
      ? `${lostWrites.length} admitted write(s) absent from the durable mirror: ` +
        lostWrites.map((entry) => `${entry.id}#${entry.seq}`).join(", ")
      : null,
    nonAdvancingAfterRebuild.length > 0
      ? `${nonAdvancingAfterRebuild.length} post-rebuild Sequence(s) at or below the pre-rebuild ` +
        `maximum ${observation.phaseAMaxSeq}: ` +
        nonAdvancingAfterRebuild.map((entry) => `${entry.id}#${entry.seq}`).join(", ")
      : null,
    gaps.length > 0 ? `${gaps.length} gap(s) in the durable Sequence range: ${gaps.join(", ")}` : null,
  ].filter((line): line is string => line !== null)

  return {
    ok: failures.length === 0,
    reusedSequences,
    duplicateIds,
    lostWrites,
    nonAdvancingAfterRebuild,
    gaps,
    checked: observation.durable.length,
    message:
      failures.length === 0
        ? `${observation.durable.length} durable write(s) from ${observation.writers} writer process(es) ` +
          `on ${observation.connections} connection(s): no Sequence reuse, no lost admitted write, no ` +
          "regression across the rebuild. The monotonicity claim survived its stated refutations."
        : `REFUTED — ${failures.join("; ")}.`,
  }
}

// ── The timings (recorded, never asserted) ────────────────────────────────────────────────────

export interface ConcurrencyTimings {
  /** Per-transaction wall time, BEGIN IMMEDIATE to COMMIT, for every phase-B (post-rebuild) write. */
  postRebuildHolds: number[]
  /** The same, for phase A. Kept for context; the metric of record is post-rebuild. */
  preRebuildHolds: number[]
  /** Wall time of `rebuildFromJsonl` itself, in the parent, with every writer connection still open. */
  rebuildMs: number
  /** Per-writer wall time for the whole phase-B quota, indexed by writer. */
  postRebuildWriterWallMs: number[]
  /** SQLITE_BUSY retries, per writer, across both phases. */
  busyRetries: number[]
}

/**
 * Writer starvation, made concrete.
 *
 * Every writer performs an IDENTICAL quota of identical work, so any difference in how long a writer
 * takes to finish that quota is time it spent waiting behind another writer's lock, and nothing else.
 * The ratio of the slowest writer's phase-B wall time to the fastest writer's is therefore a direct
 * reading of how unevenly the write lock was handed out: 1.0 is perfect fairness, and a large value
 * means one writer was repeatedly overtaken.
 *
 * It is RECORDED and never asserted. What counts as "too unfair" is a decision about acceptable
 * service under contention that this repository has not taken, that depends on the platform's lock
 * handoff policy (which SQLite does not promise to be fair on any platform), and that would be
 * measured here on a machine whose ambient load is unknown. Recording it makes the question visible;
 * asserting it would answer the question with a number harvested from one laptop.
 */
export function starvationRatio(writerWallMs: readonly number[]): number {
  const positive = writerWallMs.filter((ms) => ms > 0)
  if (positive.length === 0) return 1
  return Math.max(...positive) / Math.min(...positive)
}

// ── The writer child ──────────────────────────────────────────────────────────────────────────

interface WriterReport {
  writer: number
  pid: number
  allocatorDigest: string
  allocatorSignature: number[]
  admitted: AdmittedWrite[]
  preRebuildHolds: number[]
  postRebuildHolds: number[]
  postRebuildWallMs: number
  busyRetries: number
  refusals: { id: string; error: string }[]
}

const isBusy = (error: unknown): boolean =>
  /SQLITE_BUSY|database is locked|database table is locked/i.test(String((error as Error).message ?? error))

function argValue(flag: string): string | undefined {
  const at = process.argv.indexOf(flag)
  return at === -1 ? undefined : process.argv[at + 1]
}

function atomicWriteJson(target: string, value: unknown): void {
  const temporary = `${target}.tmp`
  writeFileSync(temporary, JSON.stringify(value), "utf8")
  renameSync(temporary, target)
}

function waitForBarrier(barrier: string, timeoutMs = 120_000): void {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(barrier)) {
    if (Date.now() > deadline) throw new Error(`probe writer: barrier ${barrier} never appeared.`)
    Bun.sleepSync(2)
  }
}

/** One durable write, timed from BEGIN IMMEDIATE to COMMIT — the interval the write lock is held. */
function writeOnce(
  db: Database,
  stateDir: string,
  phase: "a" | "b",
  writer: number,
  index: number,
  report: WriterReport,
): void {
  const id = `${phase}-w${writer}-${index}`
  for (let attempt = 0; attempt < 8; attempt++) {
    let allocated = 0
    const started = performance.now()
    try {
      serialTransaction(db, () => {
        allocated = allocateSequence(db, TENANT, SEQUENCE_NAME)
        write(db, stateDir, TENANT, TABLE, {
          tenant_id: TENANT,
          id,
          seq: allocated,
          target_claim_ids: JSON.stringify([]),
          severity: "low",
          evidence: JSON.stringify({ probe: "f002-task-17" }),
          status: "open",
          created_at: new Date().toISOString(),
        })
      })
    } catch (error) {
      if (isBusy(error)) {
        report.busyRetries++
        Bun.sleepSync(3 * (attempt + 1))
        continue
      }
      report.refusals.push({ id, error: String((error as Error).message ?? error) })
      return
    }
    const held = performance.now() - started
    if (phase === "a") report.preRebuildHolds.push(held)
    else report.postRebuildHolds.push(held)
    report.admitted.push({ phase, writer, seq: allocated, id })
    return
  }
  report.refusals.push({ id, error: "SQLITE_BUSY after 8 attempts" })
}

function runWriterChild(): void {
  // Set FIRST, before this process can reach any code path at all: from here on, any attempt to
  // append to the Benchmark Ledger from inside a writer is refused by `assertSoleLedgerWriter`.
  process.env[WRITER_ENV] = "1"
  const stateDir = argValue("--state-dir")!
  const writer = Number(argValue("--writer-index"))
  const writes = Number(argValue("--writes"))
  const resultPath = argValue("--result")!
  const readyPath = argValue("--ready")!
  const barrierA = argValue("--barrier-a")!
  const barrierB = argValue("--barrier-b")!
  const donePath = argValue("--done-a")!

  // Each child opens its OWN connection, through the SAME call `startServer` makes
  // (`state.ts`: openDb(`${stateDir}/state.sqlite`)). One process, one connection, no sharing.
  const db = openDb(join(stateDir, "state.sqlite"))

  const report: WriterReport = {
    writer,
    pid: process.pid,
    // Two independent witnesses that this child loaded the allocator the parent thinks it did: the
    // bytes of `db.ts` on disk, and what the loaded implementation actually DOES when asked twice.
    // A mutation that changed neither did not reach the code under probe, and the mutation rule of
    // this feature says a check staying green under a mutation proves nothing until that is shown.
    allocatorDigest: new Bun.CryptoHasher("sha256")
      .update(readFileSync(join(import.meta.dir, "..", "..", "src", "db.ts")))
      .digest("hex"),
    allocatorSignature: [],
    admitted: [],
    preRebuildHolds: [],
    postRebuildHolds: [],
    postRebuildWallMs: 0,
    busyRetries: 0,
    refusals: [],
  }
  serialTransaction(db, () => {
    report.allocatorSignature.push(allocateSequence(db, `${TENANT}-signature-${writer}`, SIGNATURE_SEQUENCE_NAME))
    report.allocatorSignature.push(allocateSequence(db, `${TENANT}-signature-${writer}`, SIGNATURE_SEQUENCE_NAME))
  })

  atomicWriteJson(readyPath, { pid: process.pid })
  waitForBarrier(barrierA)
  for (let index = 0; index < writes; index++) writeOnce(db, stateDir, "a", writer, index, report)
  atomicWriteJson(donePath, { pid: process.pid })

  waitForBarrier(barrierB)
  const startedB = performance.now()
  for (let index = 0; index < writes; index++) writeOnce(db, stateDir, "b", writer, index, report)
  report.postRebuildWallMs = performance.now() - startedB

  db.close()
  atomicWriteJson(resultPath, report)
}

// ── The parent ────────────────────────────────────────────────────────────────────────────────

export interface ProbeConfig {
  writers?: number
  writesPerWriter?: number
  /** Supply to keep the state directory for inspection; otherwise a temporary one is made and removed. */
  stateDir?: string
  /** Set false to suppress the console narration when running inside the suite. */
  verbose?: boolean
}

export interface ProbeRun {
  observation: ConcurrencyObservation
  timings: ConcurrencyTimings
  verdict: ConcurrencyVerdict
  /** Ledger sample seqs actually appended. Empty when recording is off — which is not "nothing measured". */
  recorded: number[]
  refusals: { id: string; error: string }[]
}

/**
 * Refuses a ledger append from anywhere but the sole coordinating parent.
 *
 * `appendToLedger` takes no lock. This probe is the first concurrent thing in the repository to touch
 * the ledger, and two simultaneous appends would seal against the same chain head and leave a file
 * that never loads again. The env var is set on every spawned writer, so this is a structural refusal
 * rather than an intention.
 */
export const WRITER_ENV = "EAP_PROBE_CONCURRENCY_WRITER"

export function assertSoleLedgerWriter(): void {
  if ((process.env[WRITER_ENV] ?? "").length > 0) {
    throw new Error(
      "concurrency probe: a writer child attempted to append to the Benchmark Ledger. Refused — " +
        "appendToLedger takes NO LOCK, so two concurrent appends seal against the same chain head " +
        "and corrupt a committed, append-only file. Only the coordinating parent records, and only " +
        "after every writer has exited.",
    )
  }
}

/** Reads the tenant's durable JSONL mirror — the evidence. Never a writer's opinion of itself. */
export function readDurableMirror(stateDir: string): DurableWrite[] {
  const file = join(stateDir, "tenants", TENANT, `${TABLE}.jsonl`)
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const row = JSON.parse(line) as { id: string; seq: number }
      return { id: row.id, seq: Number(row.seq) }
    })
}

export async function runConcurrencyProbe(config: ProbeConfig = {}): Promise<ProbeRun> {
  const writers = config.writers ?? IN_SUITE_WRITERS
  const writesPerWriter = config.writesPerWriter ?? IN_SUITE_WRITES_PER_WRITER
  const verbose = config.verbose ?? false
  const stateDir = config.stateDir ?? mkdtempSync(join(tmpdir(), "eap-probe-conc-"))
  mkdirSync(stateDir, { recursive: true })
  const control = join(stateDir, "control")
  mkdirSync(control, { recursive: true })

  if (verbose) {
    console.log("Falsification criteria, stated before anything is spawned:")
    for (const criterion of FALSIFICATION_CRITERIA) console.log(`  - ${criterion}`)
    console.log("")
  }

  // The schema is created once, by the parent, before any writer exists. Four processes racing to
  // run CREATE TABLE IF NOT EXISTS would be measuring schema creation, not the allocator.
  openDb(join(stateDir, "state.sqlite")).close()

  const barrierA = join(control, "barrier-a")
  const barrierB = join(control, "barrier-b")
  const children = Array.from({ length: writers }, (_unused, writer) => {
    const result = join(control, `result-${writer}.json`)
    const ready = join(control, `ready-${writer}.json`)
    const doneA = join(control, `done-a-${writer}.json`)
    const process_ = spawnProbeProcess(
      [
        import.meta.path,
        "--writer",
        "--state-dir",
        stateDir,
        "--writer-index",
        String(writer),
        "--writes",
        String(writesPerWriter),
        "--result",
        result,
        "--ready",
        ready,
        "--barrier-a",
        barrierA,
        "--barrier-b",
        barrierB,
        "--done-a",
        doneA,
      ],
      { logPath: join(control, `writer-${writer}.log`) },
    )
    return { writer, result, ready, doneA, process: process_, log: join(control, `writer-${writer}.log`) }
  })

  const failIfDead = (child: (typeof children)[number], waiting: string): never => {
    throw new Error(
      `concurrency probe: writer ${child.writer} (pid ${child.process.pid}) never produced ${waiting}. ` +
        `Exit code ${String(child.process.exitCode())}. Its output went to a file descriptor, never a ` +
        `pipe:\n${existsSync(child.log) ? readFileSync(child.log, "utf8").slice(-2000) : "(no log)"}`,
    )
  }

  try {
    for (const child of children) {
      if (!(await waitForPath(child.ready, 60_000))) failIfDead(child, "its ready file")
    }
    // Every writer is parked on the barrier. Releasing them together is what makes this contention
    // rather than a queue: the write lock is contested from the first transaction, not the tenth.
    writeFileSync(barrierA, "go", "utf8")

    for (const child of children) {
      if (!(await waitForPath(child.doneA, 120_000))) failIfDead(child, "its phase-A completion file")
    }

    // The rebuild, on the PARENT's own connection, while all four writer connections are still open —
    // which is the situation a production rebuild actually meets, since a host does not reconnect.
    const rebuildDb = openDb(join(stateDir, "state.sqlite"))
    const rebuildStarted = performance.now()
    rebuildFromJsonl(rebuildDb, stateDir, TENANT)
    const rebuildMs = performance.now() - rebuildStarted
    rebuildDb.close()

    writeFileSync(barrierB, "go", "utf8")
    for (const child of children) {
      await child.process.exited
      if (!existsSync(child.result)) failIfDead(child, "its result file")
    }

    const reports = children.map((child) => JSON.parse(readFileSync(child.result, "utf8")) as WriterReport)
    const admitted = reports.flatMap((report) => report.admitted)
    const phaseAMaxSeq = admitted
      .filter((entry) => entry.phase === "a")
      .reduce((max, entry) => Math.max(max, entry.seq), 0)

    const observation: ConcurrencyObservation = {
      writers,
      writerPids: reports.map((report) => report.pid),
      parentPid: process.pid,
      connections: writers + 1,
      phaseAMaxSeq,
      admitted,
      durable: readDurableMirror(stateDir),
      allocatorDigests: reports.map((report) => report.allocatorDigest),
      allocatorSignatures: reports.map((report) => report.allocatorSignature),
    }
    const timings: ConcurrencyTimings = {
      postRebuildHolds: reports.flatMap((report) => report.postRebuildHolds),
      preRebuildHolds: reports.flatMap((report) => report.preRebuildHolds),
      rebuildMs,
      postRebuildWriterWallMs: reports.map((report) => report.postRebuildWallMs),
      busyRetries: reports.map((report) => report.busyRetries),
    }
    const verdict = analyzeConcurrency(observation)
    const refusals = reports.flatMap((report) => report.refusals)

    return { observation, timings, verdict, recorded: recordTimings(observation, timings, verbose), refusals }
  } finally {
    if (config.stateDir === undefined) removeStateDir(stateDir)
  }
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000

/**
 * Appends the TIMING observations, and only those, to the Benchmark Ledger. Nothing here compares a
 * number to anything; there is no threshold in this function and no band is declared for these
 * metrics (see DECISIONS.md — banding a contention timing taken on one shared developer machine would
 * be authoring a bound out of five samples of an unknown ambient load).
 */
function recordTimings(
  observation: ConcurrencyObservation,
  timings: ConcurrencyTimings,
  verbose: boolean,
): number[] {
  assertSoleLedgerWriter()
  const context = {
    writers: observation.writers,
    connections: observation.connections,
    writesPerWriter: timings.postRebuildHolds.length / Math.max(observation.writers, 1),
    busyRetries: timings.busyRetries.reduce((a, b) => a + b, 0),
    rebuildMs: round3(timings.rebuildMs),
    preRebuildHoldP50: round3(medianOf(timings.preRebuildHolds)),
  }
  const samples: { metric: string; value: number; unit: string; aggregation: string; observations: number; note: string }[] = [
    {
      metric: "eap.concurrency.write.lock.hold.post_rebuild.p50",
      value: round3(medianOf(timings.postRebuildHolds)),
      unit: "ms",
      aggregation: `median-of-${timings.postRebuildHolds.length}`,
      observations: timings.postRebuildHolds.length,
      note:
        "Median wall time from BEGIN IMMEDIATE to COMMIT of one durable write (SQLite row plus the " +
        "tenant JSONL mirror append, which happens inside the transaction), taken while N writer " +
        "processes on N separate connections contend for the one write lock, after a " +
        "rebuildFromJsonl. An observation. It asserts nothing and no bound is declared for it.",
    },
    {
      metric: "eap.concurrency.write.lock.hold.post_rebuild.max",
      value: round3(Math.max(...timings.postRebuildHolds)),
      unit: "ms",
      aggregation: `max-of-${timings.postRebuildHolds.length}`,
      observations: timings.postRebuildHolds.length,
      note:
        "The longest single write-lock hold observed after the rebuild. Recorded beside the median " +
        "because contention shows up in the tail, not the centre. An observation, not a bound.",
    },
    {
      metric: "eap.concurrency.writer.starvation.ratio",
      value: round3(starvationRatio(timings.postRebuildWriterWallMs)),
      unit: "ratio",
      aggregation: `max-over-min-of-${timings.postRebuildWriterWallMs.length}-writers`,
      observations: timings.postRebuildWriterWallMs.length,
      note:
        "Slowest writer's phase-B wall time divided by the fastest writer's, where every writer ran " +
        "an identical quota — so the whole difference is time spent waiting behind another writer's " +
        "lock. 1.0 is perfect fairness. SQLite promises no fairness on any platform and this " +
        "repository has taken no decision about acceptable service under contention, so this is " +
        "recorded and never asserted.",
    },
  ]

  const appended: number[] = []
  // Serialised by construction: one process, one synchronous call each, in order. See the header.
  for (const sample of samples) {
    const record = recordSample({ ...sample, context })
    if (verbose) {
      console.log(
        `  ${sample.metric} = ${sample.value} ${sample.unit} (${sample.aggregation}) — ` +
          (record === null ? "measured, NOT recorded (EAP_BENCHMARK_RECORD unset)" : `recorded at seq ${record.seq}`),
      )
    }
    if (record !== null) appended.push(record.seq)
  }
  return appended
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  if (process.argv.includes("--writer")) {
    runWriterChild()
  } else if (process.argv.includes("--run")) {
    const run = await runConcurrencyProbe({
      writers: Number(argValue("--writers") ?? IN_SUITE_WRITERS),
      writesPerWriter: Number(argValue("--writes") ?? IN_SUITE_WRITES_PER_WRITER),
      verbose: true,
    })
    console.log("")
    console.log(
      `Topology: ${run.observation.writers} writer process(es) (pids ${run.observation.writerPids.join(", ")}), ` +
        `${run.observation.connections} SQLite connection(s), parent pid ${run.observation.parentPid}.`,
    )
    console.log(run.verdict.ok ? `Verdict: SURVIVED — ${run.verdict.message}` : `Verdict: ${run.verdict.message}`)
    if (run.refusals.length > 0) {
      console.log(`Refused writes (not admitted, therefore not expected to be durable): ${run.refusals.length}`)
      for (const refusal of run.refusals.slice(0, 10)) console.log(`  ${refusal.id}: ${refusal.error}`)
    }
    process.exit(run.verdict.ok ? 0 : 1)
  } else {
    console.error(
      "concurrency probe. Usage:\n" +
        "  --run [--writers N] [--writes N]   run the probe and report (records only with " +
        "EAP_BENCHMARK_RECORD set)\n" +
        "  --writer …                          internal: one writer child, spawned by --run",
    )
    process.exit(2)
  }
}
