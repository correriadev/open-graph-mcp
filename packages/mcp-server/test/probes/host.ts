/**
 * F002 task 16 — the shared probe host harness.
 *
 * Tasks 17 (multi-process concurrency), 18 (cancellation fault injection) and 19 (100k-claim scale
 * and read-model volume) are three probes that all need the same four things and must not each
 * reinvent them:
 *
 *   1. a REAL host, started the way production starts one;
 *   2. a timed measurement around it;
 *   3. a sample appended to the Benchmark Ledger with this runner's fingerprint;
 *   4. a teardown that does not manufacture the very Windows flake the probes exist to measure past.
 *
 * This file is not itself a probe and contains no assertion. It is deliberately NOT a `.test.ts`, so
 * `bun test` never executes it and it is outside the declared EAP Test Corpus — a harness that
 * appeared in the corpus would show up as an unclaimed test case in the Traceability Map for ever.
 *
 * ── The rule the three probes must not break ──────────────────────────────────────────────────
 * A probe RECORDS. It does not ASSERT. `recordSample` appends an observation; there is no function
 * here that compares a value to a threshold, and `benchmark-ledger.ts` refuses any sample carrying
 * `expected`, `bound` or `asserted`, or naming a Scenario Identifier. Probes 17–19 measure inside
 * QA6/QA7 territory, where `001` §5 rule 3 permits measurement and forbids assertion; a probe that
 * asserted a timing would silently decide the open question. The ledger makes that unrepresentable
 * rather than merely discouraged.
 *
 * ── Recording is opt-in, and that is a decision ───────────────────────────────────────────────
 * `recordSample` writes only when `EAP_BENCHMARK_RECORD` is set. Without it a probe still measures
 * and still returns its number; it simply does not append. Two reasons: the ledger is committed and
 * append-only, so an ordinary `bun test` on a developer laptop appending a line per run would fill a
 * tracked file with noise nobody asked for and dirty every working tree; and samples taken while a
 * machine is also compiling, running an IDE and serving a browser are drawn from a different
 * population than the one a band was derived from. Deciding WHEN to record is a CI-topology
 * question, and task 20 owns CI topology.
 *
 * ── Why the spawned host reports its URL through a FILE and never a pipe ──────────────────────
 * Task 14 measured this: piping a spawned Bun process's stdout makes the pre-existing Windows EBUSY
 * teardown race in `reconnect-after-restart.test.ts` fire reliably (2 failures in 2 piped runs,
 * 0 in 4 with a redirected fd). Pipe backpressure changes the timing of the thing being measured. So
 * `spawnProbeHost` gives the child a file descriptor for stdout and stderr, and the child publishes
 * its listening URL by writing a ready file, which the parent polls. No byte of the child's output
 * ever crosses a pipe.
 *
 * ── Teardown ─────────────────────────────────────────────────────────────────────────────────
 * `removeStateDir` retries on Windows sharing violations and, if the directory still will not go,
 * WARNS rather than throwing. A harness whose cleanup throws would inject the exact 1-in-3-to-4
 * failure the probes are trying to characterise, and every measurement taken through it would be a
 * measurement of the harness.
 */

import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { startServer, type RunningServer, type StartOptions } from "../../src/index"
import {
  appendToLedger,
  detectRunner,
  fingerprintId,
  headCommit,
  type SampleRecord,
  type UnsealedSample,
} from "../../../../scripts/verification/benchmark-ledger.ts"
import { repoRoot } from "../../../../scripts/verification/register-scenarios.ts"

/** Set to any non-empty value to make `recordSample` actually append. See the header. */
export const RECORD_ENV = "EAP_BENCHMARK_RECORD"

export function recordingEnabled(): boolean {
  return (process.env[RECORD_ENV] ?? "").trim().length > 0
}

// ── Timing ────────────────────────────────────────────────────────────────────────────────────

export interface Timed<T> {
  value: T
  /** Wall time in milliseconds, from `performance.now()` — monotonic, unaffected by clock changes. */
  ms: number
}

export async function timed<T>(body: () => T | Promise<T>): Promise<Timed<T>> {
  const started = performance.now()
  const value = await body()
  return { value, ms: performance.now() - started }
}

/**
 * The reduction a probe should use to turn many raw observations into ONE sample.
 *
 * A single timing on this repository's runners is not a stable quantity — the suite's own `expect()`
 * total is not run-stable (4349 vs 4360 at the same commit), so nothing measured in one shot is. A
 * median over an odd number of repetitions is robust to the one-in-three-or-four flake: it takes more
 * than half the repetitions going wrong to move it, where a mean moves on the first.
 */
export function medianOf(values: readonly number[]): number {
  if (values.length === 0) throw new Error("probe host: medianOf received no observations.")
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** Runs `body` `repetitions` times, discarding `warmup` leading runs, and returns every timing. */
export async function repeat(
  repetitions: number,
  body: (index: number) => void | Promise<void>,
  warmup = 0,
): Promise<number[]> {
  const observations: number[] = []
  for (let index = 0; index < repetitions + warmup; index++) {
    const { ms } = await timed(() => body(index))
    if (index >= warmup) observations.push(ms)
  }
  return observations
}

// ── Recording ─────────────────────────────────────────────────────────────────────────────────

/** One run id for this process. Identifies a run; it is deliberately NOT part of the fingerprint. */
let cachedRunId: string | null = null
export function probeRunId(): string {
  if (cachedRunId === null) {
    cachedRunId =
      process.env.GITHUB_RUN_ID !== undefined
        ? `gha-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`
        : `local-${Date.now().toString(36)}-${process.pid.toString(36)}`
  }
  return cachedRunId
}

export interface SampleInput {
  metric: string
  value: number
  unit: string
  /** How raw observations were reduced, e.g. `median-of-15`. Prose, never parsed. */
  aggregation?: string
  observations?: number
  /** Set ONLY when the observation genuinely sits inside that quarantined family's open question. */
  familyId?: UnsealedSample["familyId"]
  testFile?: string
  testName?: string
  note?: string
  /** Ambient facts that are NOT in the fingerprint but explain a step change to a later reader. */
  context?: Record<string, string | number>
}

/**
 * The sample a probe would append. Pure: it touches no file, so a probe can build one, log it, and
 * decide separately whether this run records.
 */
export function buildSample(input: SampleInput, root = repoRoot()): UnsealedSample {
  const runner = detectRunner()
  return {
    kind: "sample",
    metric: input.metric,
    value: input.value,
    unit: input.unit,
    runId: probeRunId(),
    commit: headCommit(root),
    runnerFingerprint: fingerprintId(runner),
    runner,
    at: new Date().toISOString(),
    ...(input.aggregation === undefined ? {} : { aggregation: input.aggregation }),
    ...(input.observations === undefined ? {} : { observations: input.observations }),
    ...(input.context === undefined ? {} : { context: input.context }),
    ...(input.familyId === undefined ? {} : { familyId: input.familyId }),
    ...(input.testFile === undefined ? {} : { testFile: input.testFile }),
    ...(input.testName === undefined ? {} : { testName: input.testName }),
    ...(input.note === undefined ? {} : { note: input.note }),
  }
}

/**
 * Appends one observation to the Benchmark Ledger, or returns `null` when recording is off.
 *
 * The return value distinguishes the two, so a probe can say "measured 412 ms, not recorded" — which
 * is a different fact from "recorded", and this repository does not print one as the other.
 */
export function recordSample(input: SampleInput, root = repoRoot()): SampleRecord | null {
  const sample = buildSample(input, root)
  if (!recordingEnabled()) return null
  const appended = appendToLedger([sample], root)
  // `appendToLedger` seeds the policy record when the ledger is empty, so the sample is the LAST
  // record appended, never the first. Returning `appended[0]` reported the policy record's seq.
  return appended[appended.length - 1] as SampleRecord
}

// ── An in-process host ────────────────────────────────────────────────────────────────────────

export interface ProbeHost {
  url: string
  server: RunningServer
  stateDir: string
  stop: () => void
}

/**
 * A real host in this process — the same `startServer` every other test and the production entry
 * point use. Preferred for probes 18 and 19, which need the host's internals (`server.state.db`)
 * to observe read-model volume without going through HTTP.
 */
export function startProbeHost(options: StartOptions = {}): ProbeHost {
  const stateDir = options.stateDir ?? mkdtempSync(join(tmpdir(), "eap-probe-"))
  const server = startServer({ ...options, stateDir })
  return {
    url: server.url,
    server,
    stateDir,
    stop: () => {
      try {
        server.stop()
      } finally {
        if (options.stateDir === undefined) removeStateDir(stateDir)
      }
    },
  }
}

/** Starts a host, runs `body`, and stops the host whatever `body` does. */
export async function withProbeHost<T>(
  options: StartOptions,
  body: (host: ProbeHost) => T | Promise<T>,
): Promise<T> {
  const host = startProbeHost(options)
  try {
    return await body(host)
  } finally {
    host.stop()
  }
}

/**
 * Windows holds SQLite file handles briefly after `close()`, so an immediate recursive delete raises
 * EBUSY/EPERM — the known teardown flake. Retried with a short backoff and, on final failure,
 * REPORTED rather than thrown: a harness that throws in cleanup injects the flake it exists to
 * measure around, and would make every probe's number a number about the harness.
 */
export function removeStateDir(dir: string, attempts = 5): boolean {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return true
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1))
    }
  }
  console.warn(
    `probe host: could not remove ${dir} after ${attempts} attempts (Windows sharing violation). ` +
      "Reported, not thrown — a cleanup failure is not a measurement failure, and throwing here " +
      "would manufacture the very teardown flake these probes exist to measure around.",
  )
  return false
}

// ── A host in a separate OS process ───────────────────────────────────────────────────────────

export interface SpawnedProbeHost {
  url: string
  pid: number
  /** The child's stdout+stderr, redirected to a file descriptor. NEVER a pipe. See the header. */
  logPath: string
  stateDir: string
  stop: () => Promise<void>
}

export interface SpawnOptions {
  repoPath?: string
  stateDir?: string
  /** Where the child's output is redirected. Defaults inside the state directory. */
  logPath?: string
  readyTimeoutMs?: number
}

const READY_FILE = "probe-host-ready.json"

export interface SpawnedProbeProcess {
  pid: number
  /** Resolves with the child's exit code. */
  exited: Promise<number>
  exitCode: () => number | null
  kill: () => void
}

/**
 * Spawns `bun <args>` with stdout AND stderr redirected to a FILE DESCRIPTOR, never a pipe.
 *
 * Extracted in task 17 because the multi-process concurrency probe needs the same discipline
 * `spawnProbeHost` needs and for the same measured reason (task 14: piping a spawned Bun process's
 * stdout makes the Windows EBUSY teardown race fire reliably — 2 failures in 2 piped runs, 0 in 4
 * with a redirected fd; pipe backpressure changes the timing of the thing being measured). Writing a
 * second, private spawn in the probe would have been the obvious way to reintroduce the pipe.
 * `spawnProbeHost` now goes through this too, so there is exactly one place that decides this.
 */
export function spawnProbeProcess(
  args: readonly string[],
  options: { logPath: string; cwd?: string },
): SpawnedProbeProcess {
  const fd = openSync(options.logPath, "w")
  let child: ReturnType<typeof Bun.spawn>
  try {
    child = Bun.spawn({
      cmd: ["bun", ...args],
      cwd: options.cwd ?? repoRoot(),
      stdout: fd,
      stderr: fd,
      stdin: "ignore",
    })
  } finally {
    closeSync(fd)
  }
  return {
    pid: child.pid,
    exited: child.exited,
    exitCode: () => child.exitCode,
    kill: () => child.kill(),
  }
}

/**
 * Polls for a path to appear. A file is how probe processes hand facts to their parent here — see the
 * header on why nothing crosses a pipe — so waiting for one is a shared need, not a probe's private
 * business. Returns `false` on timeout rather than throwing: the caller holds the context needed to
 * write a useful failure (which child, which log file), and this function does not.
 */
export async function waitForPath(target: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(target)) return true
    await Bun.sleep(10)
  }
  return existsSync(target)
}

/**
 * A real host in its OWN process — what task 17's multi-process concurrency probe needs, since two
 * hosts inside one Bun process share a heap, a GC and an event loop and would measure none of the
 * contention that matters.
 *
 * Handshake: the child writes `{url, pid}` to a ready file (temp file + rename, so the parent never
 * reads a half-written one) and the parent polls for it. Nothing crosses a pipe.
 */
export async function spawnProbeHost(options: SpawnOptions = {}): Promise<SpawnedProbeHost> {
  const stateDir = options.stateDir ?? mkdtempSync(join(tmpdir(), "eap-probe-child-"))
  mkdirSync(stateDir, { recursive: true })
  const readyPath = join(stateDir, READY_FILE)
  const logPath = options.logPath ?? join(stateDir, "probe-host.log")

  const child = spawnProbeProcess(
    [
      import.meta.path,
      "--serve",
      readyPath,
      "--state-dir",
      stateDir,
      ...(options.repoPath === undefined ? [] : ["--repo-path", options.repoPath]),
    ],
    { logPath },
  )

  const deadline = Date.now() + (options.readyTimeoutMs ?? 30_000)
  while (Date.now() < deadline) {
    if (existsSync(readyPath)) {
      const ready = JSON.parse(readFileSync(readyPath, "utf8")) as { url: string; pid: number }
      return {
        url: ready.url,
        pid: ready.pid,
        logPath,
        stateDir,
        stop: async () => {
          child.kill()
          await child.exited
          if (options.stateDir === undefined) removeStateDir(stateDir)
        },
      }
    }
    if (child.exitCode() !== null) {
      throw new Error(
        `probe host: the spawned host exited ${child.exitCode()} before publishing a URL. Its output ` +
          `was redirected to ${logPath} (a file descriptor, never a pipe):\n` +
          (existsSync(logPath) ? readFileSync(logPath, "utf8").slice(-2000) : "(no log written)"),
      )
    }
    await Bun.sleep(20)
  }
  child.kill()
  throw new Error(
    `probe host: the spawned host did not publish ${readyPath} within the ready timeout. Tail of ` +
      `${logPath}:\n${existsSync(logPath) ? readFileSync(logPath, "utf8").slice(-2000) : "(no log written)"}`,
  )
}

// ── Entry points ──────────────────────────────────────────────────────────────────────────────

function argValue(flag: string): string | undefined {
  const at = process.argv.indexOf(flag)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** The child half of `spawnProbeHost`. Publishes its URL and then does nothing but serve. */
function serveUntilKilled(readyPath: string): void {
  const server = startServer({
    stateDir: argValue("--state-dir"),
    repoPath: argValue("--repo-path"),
    watch: false,
  })
  const temporary = `${readyPath}.tmp`
  writeFileSync(temporary, JSON.stringify({ url: server.url, pid: process.pid }), "utf8")
  renameSync(temporary, readyPath)
  const shutdown = (): void => {
    server.stop()
    process.exit(0)
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}

/**
 * `bun packages/mcp-server/test/probes/host.ts --measure-boot` — the harness measuring ITSELF.
 *
 * Metric `probe.host.boot.wall`: the wall time to bring a real host up and take it down again,
 * reduced to the median of 15 repetitions after 3 discarded warmups. It is not a probe of the
 * Epistemic Authority Protocol and it settles nothing about one; it exists so that the ledger, the
 * fingerprint, the band and the k rule are exercised by a REAL measurement from a real host from the
 * day they land, rather than pinned only against fixtures — which is exactly the gap task 08 left
 * when it shipped a ledger reader before any ledger existed.
 */
async function measureBoot(): Promise<number> {
  const repetitions = Number(argValue("--repetitions") ?? 15)
  const warmups = Number(argValue("--warmups") ?? 3)
  const observations = await repeat(
    repetitions,
    () => {
      const host = startProbeHost({ watch: false })
      host.stop()
    },
    warmups,
  )
  const value = Math.round(medianOf(observations) * 1000) / 1000
  const sample = recordSample({
    metric: "probe.host.boot.wall",
    value,
    unit: "ms",
    aggregation: `median-of-${repetitions}`,
    observations: repetitions,
    note:
      "Wall time to start a real host through startServer() and stop it again, on a fresh temporary " +
      "state directory. An observation of the harness itself, recorded so the ledger holds real " +
      "measurements rather than fixtures. It asserts nothing.",
    context: { warmups, min: Math.round(Math.min(...observations) * 1000) / 1000, max: Math.round(Math.max(...observations) * 1000) / 1000 },
  })
  console.log(
    `probe.host.boot.wall = ${value} ms (median of ${repetitions}, ${warmups} warmups discarded; ` +
      `min ${Math.min(...observations).toFixed(2)}, max ${Math.max(...observations).toFixed(2)}) — ` +
      (sample === null ? `NOT recorded (${RECORD_ENV} unset)` : `recorded at seq ${sample.seq}`),
  )
  return 0
}

if (import.meta.main) {
  const readyPath = argValue("--serve")
  if (readyPath !== undefined) {
    serveUntilKilled(readyPath)
  } else if (process.argv.includes("--measure-boot")) {
    process.exit(await measureBoot())
  } else {
    console.error(
      "probe host: this file is a harness, not a probe. Usage:\n" +
        "  --measure-boot [--repetitions N] [--warmups N]   measure and (with " +
        `${RECORD_ENV} set) record\n` +
        "  --serve <ready-file>                             internal: the child half of spawnProbeHost",
    )
    process.exit(2)
  }
}
