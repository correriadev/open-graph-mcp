#!/usr/bin/env bun
/**
 * F002 task 14 — Instrument Coverage and Record the First Figure.
 *
 *   bun scripts/verification/measure-coverage.ts            -> run instrumented, write the baseline
 *   bun scripts/verification/measure-coverage.ts --with-uninstrumented
 *                                                          -> also time a plain run, so the cost of
 *                                                             instrumentation is measured and not
 *                                                             asserted
 *   bun scripts/verification/measure-coverage.ts --check    -> load and validate the committed
 *                                                             baseline; never re-runs the suite
 *
 * ── Why this file exists ──────────────────────────────────────────────────────────────────────
 * This repository has never produced a coverage figure. The reason to be careful about the first
 * one is that a bare percentage is the single most quotable and least meaningful number a codebase
 * emits: "87%" answers nothing unless you also know *of what*. A figure whose denominator is
 * unstated can be moved arbitrarily by moving the denominator, which is precisely the marker-chasing
 * this domain exists to abolish — and it moves silently, because nothing in a percentage records
 * what was measured.
 *
 * So the unit this file deals in is not a percentage. It is a **figure plus its scope**, and the two
 * are inseparable *structurally*, not by convention:
 *
 *  1. `loadCoverageBaseline` REJECTS a baseline that carries no `scope.paths`, or an empty one, or a
 *     per-file figure that names no `scopePath`. There is no code path that reads a number out of
 *     this file without also reading what it is a number about — you cannot quote the percentage
 *     without loading the document, and the document does not load without its scope.
 *  2. `scope.sha256` pins the scope declaration itself. Quietly deleting a path from the recorded
 *     list — the cheapest way to make a figure look better — makes the recorded digest disagree with
 *     the list it describes, and the loader refuses it.
 *  3. `integrity.sha256` pins the whole measurement payload. A human who edits `60.16` to `95.0`
 *     produces a document that no longer hashes to what the instrumented run produced. ADR-0021:
 *     verification by host log, never self-report. The "host log" here is Bun's own lcov output; a
 *     hand-written figure is a self-report and is refused as one.
 *
 * ── What is deliberately NOT done ─────────────────────────────────────────────────────────────
 *  - **No exclusions.** `scope.exclusions` exists, is empty, and every entry it could hold must
 *    carry a `reason` (enforced by the loader). Excluding a poorly covered file is how a scope gets
 *    drawn around the well-tested parts; if it is ever needed, it is enumerated and justified inside
 *    the artefact that publishes the figure, where a reviewer reads it next to the number it flatters.
 *  - **No ratchet.** Task 15 owns the monotonic gate and `.github/workflows/ci.yml`. `--check` here
 *    validates the document's integrity and reports staleness; it does not compare figures and does
 *    not fail on a number moving. The seam left for the ratchet is `loadCoverageBaseline` plus the
 *    per-file rows, which carry enough detail for a delta a human can act on.
 *  - **No coverage in the default `bun test` path.** `bunfig.toml` configures the reporter and the
 *    output directory, but does not turn coverage on: instrumentation is opt-in via `--coverage`, so
 *    no developer pays for it on every local run. Measured cost is recorded in `timing`.
 */

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { repoRoot } from "./register-scenarios"

export const BASELINE_PATH = "docs/verification/coverage-baseline.json"
export const SCHEMA_VERSION = 1

/** Where `bunfig.toml` points `--coverage`. Inside `.verification/`, which `.gitignore` covers. */
export const COVERAGE_DIR = ".verification/coverage"
export const LCOV_PATH = `${COVERAGE_DIR}/lcov.info`

export type ScopeKind = "directory" | "file"

export interface ScopeEntry {
  path: string
  kind: ScopeKind
  /** Why this surface is in scope. Read by a human deciding whether the figure describes anything. */
  reason: string
}

/**
 * The Epistemic Authority Protocol surface, enumerated. This list is the denominator of every figure
 * this script produces and it lives HERE — in the executable — rather than only in the baseline,
 * because the baseline is a datum and the datum must not be able to redefine what it is a datum
 * about. The baseline records a copy plus its digest; disagreement between the two is a rejection,
 * not a silent re-scoping.
 *
 * Sorted by path, and compared as such, so the order cannot carry meaning nobody declared.
 */
export const COVERAGE_SCOPE: readonly ScopeEntry[] = [
  {
    path: "packages/client/src/eap.ts",
    kind: "file",
    reason: "The client-side EAP surface — the L0/L1 role of ADR-0007's conformance split.",
  },
  {
    path: "packages/graph-core/src/eap",
    kind: "directory",
    reason: "The protocol core: lifecycle, horizon, recall, promotion, budget, capabilities, refusals.",
  },
  {
    path: "packages/mcp-server/src/eap",
    kind: "directory",
    reason: "Host-side EAP services, stores and workers — the L2/L3 host role.",
  },
  {
    path: "packages/mcp-server/src/gates.ts",
    kind: "file",
    reason: "The refusal gates every EAP tool call passes through.",
  },
  {
    path: "packages/mcp-server/src/tools/eap.ts",
    kind: "file",
    reason: "The MCP tool surface through which every EAP operation is actually invoked.",
  },
]

/** The fields `scope.sha256` covers. Named so the test can pin the digest's meaning, not just its value. */
export const SCOPE_SHA256_FIELDS = ["paths", "exclusions"] as const

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

// ── lcov ──────────────────────────────────────────────────────────────────────────────────────

export interface Counted {
  covered: number
  total: number
}

export interface LcovRecord {
  path: string
  lines: Counted
  functions: Counted
}

/** lcov `SF:` paths arrive with the host's separators. Repo-relative POSIX is the only key used. */
export function normalizeCoveragePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "")
}

/**
 * Bun's own lcov output, read as the record of what ran. `LF`/`LH` are line totals and hits; `FNF`/
 * `FNH` the same for functions.
 *
 * A record with no `LF`/`LH` is a hard error rather than a zero: "the run measured nothing here" and
 * "the run covered nothing here" are different facts, and silently reporting the first as the second
 * would put a fabricated denominator into a figure whose whole purpose is to state its denominator.
 */
export function parseLcov(text: string): LcovRecord[] {
  const records: LcovRecord[] = []
  let path: string | null = null
  let lf: number | null = null
  let lh: number | null = null
  let fnf = 0
  let fnh = 0

  const flush = (): void => {
    if (path === null) return
    if (lf === null || lh === null) {
      throw new Error(
        `measure-coverage: the lcov record for ${path} carries no line figures (LF/LH). A missing ` +
          "denominator is not a zero: a file the run did not measure and a file the run found " +
          "uncovered are different facts and this parser will not report one as the other.",
      )
    }
    records.push({ path, lines: { covered: lh, total: lf }, functions: { covered: fnh, total: fnf } })
    path = null
    lf = null
    lh = null
    fnf = 0
    fnh = 0
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith("SF:")) {
      flush()
      path = normalizeCoveragePath(line.slice(3))
    } else if (line.startsWith("LF:")) lf = Number(line.slice(3))
    else if (line.startsWith("LH:")) lh = Number(line.slice(3))
    else if (line.startsWith("FNF:")) fnf = Number(line.slice(4))
    else if (line.startsWith("FNH:")) fnh = Number(line.slice(4))
    else if (line === "end_of_record") flush()
  }
  flush()
  return records
}

// ── Scope attribution ─────────────────────────────────────────────────────────────────────────

/**
 * The scope entry a measured file belongs to, or `null` for anything outside the declared surface.
 * Directory membership is tested with a trailing separator: `src/eap.ts` is NOT inside `src/eap`,
 * and a prefix match would have silently annexed it.
 */
export function scopeEntryFor(
  path: string,
  scope: readonly ScopeEntry[] = COVERAGE_SCOPE,
): ScopeEntry | null {
  const normalized = normalizeCoveragePath(path)
  for (const entry of scope) {
    if (entry.kind === "file" && normalized === entry.path) return entry
    if (entry.kind === "directory" && normalized.startsWith(`${entry.path}/`)) return entry
  }
  return null
}

/** Every `.ts` file the declared scope contains, on disk. Test files are not source under measure. */
export function enumerateScopeFiles(
  root: string,
  scope: readonly ScopeEntry[] = COVERAGE_SCOPE,
): string[] {
  const found: string[] = []
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(root, ...relative.split("/")), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (entry.name.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(entry.name)) found.push(child)
    }
  }
  for (const entry of scope) {
    if (entry.kind === "file") found.push(entry.path)
    else walk(entry.path)
  }
  return found.sort()
}

// ── The measurement ───────────────────────────────────────────────────────────────────────────

export interface Percented extends Counted {
  pct: number
}

export interface FileFigure {
  path: string
  /** The declared scope path this figure is attributed to. Never absent — see `loadCoverageBaseline`. */
  scopePath: string
  sha256: string
  lines: Counted
  functions: Counted
}

export interface ScopePathFigure {
  path: string
  kind: ScopeKind
  files: number
  lines: Percented
  functions: Percented
}

export interface ScopeExclusion {
  path: string
  reason: string
}

export interface RecordedScope {
  paths: ScopeEntry[]
  exclusions: ScopeExclusion[]
  sha256: string
  filesInScope: number
  filesInstrumented: number
}

export interface Timing {
  uninstrumentedMs: number | null
  instrumentedMs: number
  deltaMs: number | null
  deltaPct: number | null
  /** False when no plain run was timed in the same invocation — then `uninstrumentedMs` is null. */
  measured: boolean
}

export interface RunIdentity {
  command: string
  commit: string
  tests: { total: number; passed: number; failed: number; skipped: number }
}

export interface CoverageMeasurement {
  schemaVersion: number
  policy: string
  generatedBy: string
  scope: RecordedScope
  run: RunIdentity
  timing: Timing
  totals: { lines: Percented; functions: Percented }
  byScopePath: ScopePathFigure[]
  files: FileFigure[]
  /** In scope, on disk, and loaded by no test in the measured run. Named, never dropped. */
  neverLoaded: string[]
  integrity: { algorithm: "sha256"; covers: string[]; sha256: string }
}

const pct = (covered: number, total: number): number =>
  total === 0 ? 0 : Math.round((covered / total) * 10000) / 100

const percented = (counted: Counted): Percented => ({ ...counted, pct: pct(counted.covered, counted.total) })

export const POLICY =
  "MEASURED, never authored. Produced by `scripts/verification/measure-coverage.ts` from Bun's own " +
  "lcov output for one instrumented run (ADR-0021: verification by host log, never self-report). " +
  "The figure is meaningless without `scope`, so the loader refuses a baseline that carries no " +
  "scope path list, no per-file scope attribution, or an exclusion with no justification; " +
  "`scope.sha256` pins the scope declaration and `integrity.sha256` pins the figures, so a " +
  "hand-edited percentage does not load. Exclusions are empty on purpose: a scope drawn around the " +
  "well-tested parts is worse than no figure at all."

export function canonicalScopeDigest(scope: RecordedScope): string {
  return sha256(
    JSON.stringify({
      paths: [...scope.paths]
        .map((entry) => ({ path: entry.path, kind: entry.kind, reason: entry.reason }))
        .sort((a, b) => a.path.localeCompare(b.path)),
      exclusions: [...scope.exclusions]
        .map((entry) => ({ path: entry.path, reason: entry.reason }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    }),
  )
}

/**
 * The digest over everything a reader could be tempted to improve by hand. `run` and `timing` are
 * included: a figure re-attributed to a different run, or a cost quietly halved, is the same lie as
 * an edited percentage.
 */
export const INTEGRITY_COVERS = ["scope", "run", "timing", "totals", "byScopePath", "files", "neverLoaded"] as const

export function integrityDigest(measurement: CoverageMeasurement): string {
  const payload: Record<string, unknown> = {}
  for (const field of INTEGRITY_COVERS) payload[field] = measurement[field]
  return sha256(JSON.stringify(payload))
}

export interface MeasurementInput {
  records: readonly LcovRecord[]
  scopeFiles: readonly string[]
  sourceDigests: Readonly<Record<string, string>>
  timing: { uninstrumentedMs: number | null; instrumentedMs: number; measured: boolean }
  run: RunIdentity
  scope?: readonly ScopeEntry[]
  exclusions?: readonly ScopeExclusion[]
}

/**
 * Pure. The lcov records of one run in, a scoped figure out. Every out-of-scope instrumented file is
 * discarded here (the suite instruments the whole repo; only the declared surface is reported), and
 * every in-scope file the run never loaded is carried in `neverLoaded` — Bun emits no denominator
 * for a module nothing imported, so it cannot be folded into the ratio, and naming it is the only
 * honest alternative to it vanishing.
 */
export function buildMeasurement(input: MeasurementInput): CoverageMeasurement {
  const scope = input.scope ?? COVERAGE_SCOPE
  const exclusions = [...(input.exclusions ?? [])]
  const excluded = new Set(exclusions.map((entry) => entry.path))
  const inScope = [...input.scopeFiles].filter((path) => !excluded.has(path)).sort()

  const byPath = new Map(input.records.map((record) => [record.path, record]))
  const files: FileFigure[] = []
  const neverLoaded: string[] = []

  for (const path of inScope) {
    const record = byPath.get(path)
    if (record === undefined) {
      neverLoaded.push(path)
      continue
    }
    const entry = scopeEntryFor(path, scope)
    if (entry === null) continue
    files.push({
      path,
      scopePath: entry.path,
      sha256: input.sourceDigests[path] ?? "",
      lines: record.lines,
      functions: record.functions,
    })
  }

  const sum = (rows: readonly FileFigure[], key: "lines" | "functions"): Percented =>
    percented(
      rows.reduce<Counted>(
        (accumulator, file) => ({
          covered: accumulator.covered + file[key].covered,
          total: accumulator.total + file[key].total,
        }),
        { covered: 0, total: 0 },
      ),
    )

  const byScopePath: ScopePathFigure[] = [...scope]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => {
      const rows = files.filter((file) => file.scopePath === entry.path)
      return {
        path: entry.path,
        kind: entry.kind,
        files: rows.length,
        lines: sum(rows, "lines"),
        functions: sum(rows, "functions"),
      }
    })

  const deltaMs =
    input.timing.uninstrumentedMs === null ? null : input.timing.instrumentedMs - input.timing.uninstrumentedMs

  const recordedScope: RecordedScope = {
    paths: [...scope].map((entry) => ({ ...entry })).sort((a, b) => a.path.localeCompare(b.path)),
    exclusions: exclusions.sort((a, b) => a.path.localeCompare(b.path)),
    sha256: "",
    filesInScope: inScope.length,
    filesInstrumented: files.length,
  }
  recordedScope.sha256 = canonicalScopeDigest(recordedScope)

  const measurement: CoverageMeasurement = {
    schemaVersion: SCHEMA_VERSION,
    policy: POLICY,
    generatedBy: "scripts/verification/measure-coverage.ts",
    scope: recordedScope,
    run: input.run,
    timing: {
      uninstrumentedMs: input.timing.uninstrumentedMs,
      instrumentedMs: input.timing.instrumentedMs,
      deltaMs,
      deltaPct:
        deltaMs === null || input.timing.uninstrumentedMs === null || input.timing.uninstrumentedMs === 0
          ? null
          : Math.round((deltaMs / input.timing.uninstrumentedMs) * 10000) / 100,
      measured: input.timing.measured,
    },
    totals: { lines: sum(files, "lines"), functions: sum(files, "functions") },
    byScopePath,
    files,
    neverLoaded: neverLoaded.sort(),
    integrity: { algorithm: "sha256", covers: [...INTEGRITY_COVERS], sha256: "" },
  }
  measurement.integrity.sha256 = integrityDigest(measurement)
  return measurement
}

// ── The loader — acceptance 2 ─────────────────────────────────────────────────────────────────

const fail = (message: string): never => {
  throw new Error(`measure-coverage: ${message}`)
}

/**
 * The only door into a recorded figure. Every rejection below exists so that a number cannot be
 * read out of this file separated from what it measures, or edited into looking better.
 */
export function loadCoverageBaseline(raw: string): CoverageMeasurement {
  const parsed = JSON.parse(raw) as Partial<CoverageMeasurement>

  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    fail(
      `${BASELINE_PATH} declares schemaVersion ${String(parsed.schemaVersion)} but this build reads ` +
        `version ${SCHEMA_VERSION}. A figure of an unknown shape is not silently reinterpreted.`,
    )
  }

  const scope = parsed.scope
  if (scope === undefined || scope === null || typeof scope !== "object") {
    fail(
      "the baseline carries no `scope`. A coverage percentage without its scope is not a weak " +
        "figure, it is not a figure: it states no denominator, so nothing can be concluded from it " +
        "and nothing can contradict it. REJECTED.",
    )
  }
  if (!Array.isArray(scope!.paths) || scope!.paths.length === 0) {
    fail(
      "the baseline's `scope.paths` is missing or empty, so the recorded figure names no measured " +
        "surface. REJECTED — the scope is not metadata about the number, it is half of the number.",
    )
  }
  for (const [index, entry] of scope!.paths.entries()) {
    if (typeof entry?.path !== "string" || entry.path.length === 0) {
      fail(`scope.paths[${index}] names no path.`)
    }
    if (entry.kind !== "directory" && entry.kind !== "file") {
      fail(`scope.paths[${index}] (${entry.path}) declares no kind (\`directory\` or \`file\`).`)
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
      fail(`scope.paths[${index}] (${entry.path}) carries no reason for being in scope.`)
    }
  }

  if (!Array.isArray(scope!.exclusions)) {
    fail("the baseline's `scope.exclusions` is missing. An empty list is a claim; an absent one is not.")
  }
  for (const [index, entry] of scope!.exclusions.entries()) {
    if (typeof entry?.path !== "string" || entry.path.length === 0) {
      fail(`scope.exclusions[${index}] names no path.`)
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
      fail(
        `scope.exclusions[${index}] (${entry.path}) carries no reason. An unjustified exclusion is ` +
          "how a scope gets quietly drawn around the well-tested parts; the justification is " +
          "required in the artefact that publishes the figure it flatters.",
      )
    }
  }

  if (!Array.isArray(parsed.files)) fail("the baseline carries no `files` array.")
  for (const [index, file] of parsed.files!.entries()) {
    if (typeof file?.scopePath !== "string" || file.scopePath.length === 0) {
      fail(
        `files[${index}] (${file?.path ?? "unnamed"}) carries no \`scopePath\`. A per-file figure ` +
          "attributed to no declared scope path cannot be rolled up or contested. REJECTED.",
      )
    }
    if (!scope!.paths.some((entry) => entry.path === file.scopePath)) {
      fail(
        `files[${index}] (${file.path}) is attributed to scope path \`${file.scopePath}\`, which the ` +
          "recorded scope does not declare.",
      )
    }
  }

  if (scope!.sha256 !== canonicalScopeDigest(scope as RecordedScope)) {
    fail(
      "the recorded `scope.sha256` does not match the scope declaration it sits beside. The scope " +
        "list was edited after the figure was produced — which is the cheapest way to make a " +
        "coverage number look better — so the figure is REJECTED rather than re-scoped.",
    )
  }

  const measurement = parsed as CoverageMeasurement
  if (measurement.integrity?.sha256 !== integrityDigest(measurement)) {
    fail(
      "the recorded figures do not match `integrity.sha256`. This baseline is produced by an " +
        "instrumented run and by nothing else (ADR-0021); a hand-edited figure is a self-report and " +
        "is refused as one. Re-measure with `bun scripts/verification/measure-coverage.ts`.",
    )
  }
  return measurement
}

// ── Reporting ─────────────────────────────────────────────────────────────────────────────────

const pad = (text: string, width: number): string => text.padEnd(width)

const figure = (value: Percented): string =>
  `${String(value.covered).padStart(5)}/${pad(String(value.total), 5)} ${String(value.pct.toFixed(2)).padStart(6)}%`

/** The figure is never printed without the scope that gives it a denominator. */
export function renderReport(measurement: CoverageMeasurement): string {
  const lines: string[] = [
    "EAP coverage — measured, never authored",
    `  baseline    ${BASELINE_PATH}`,
    `  run         ${measurement.run.command}`,
    `  commit      ${measurement.run.commit}`,
    `  tests       ${measurement.run.tests.passed} passed / ${measurement.run.tests.failed} failed / ` +
      `${measurement.run.tests.skipped} skipped of ${measurement.run.tests.total}`,
    `  scope       ${measurement.scope.filesInstrumented} of ${measurement.scope.filesInScope} scoped ` +
      `file(s) instrumented, sha256 ${measurement.scope.sha256.slice(0, 12)}`,
    "",
    `  ${pad("scope path", 40)} files  ${pad("lines", 20)} functions`,
  ]
  for (const entry of measurement.byScopePath) {
    lines.push(
      `  ${pad(entry.path, 40)} ${String(entry.files).padStart(5)}  ${figure(entry.lines)}  ${figure(entry.functions)}`,
    )
  }
  lines.push(
    "",
    `  ${pad("AGGREGATE (declared scope only)", 40)} ${String(measurement.files.length).padStart(5)}  ` +
      `${figure(measurement.totals.lines)}  ${figure(measurement.totals.functions)}`,
    "",
    "  timing",
    `    uninstrumented ${measurement.timing.uninstrumentedMs ?? "not measured in this invocation"} ms`,
    `    instrumented   ${measurement.timing.instrumentedMs} ms`,
    `    delta          ${measurement.timing.deltaMs ?? "n/a"} ms` +
      (measurement.timing.deltaPct === null ? "" : ` (${measurement.timing.deltaPct}%)`),
  )

  lines.push("", "  files in scope that no test loaded (0% by construction, named rather than dropped):")
  if (measurement.neverLoaded.length === 0) lines.push("    (none)")
  for (const path of measurement.neverLoaded) lines.push(`    ${path}`)

  lines.push("", "  declared exclusions:")
  if (measurement.scope.exclusions.length === 0) {
    lines.push("    (none — nothing is excluded from this figure)")
  }
  for (const entry of measurement.scope.exclusions) lines.push(`    ${entry.path} — ${entry.reason}`)

  return lines.join("\n")
}

// ── Running the instrumented suite ────────────────────────────────────────────────────────────

export interface SuiteResult {
  elapsedMs: number
  exitCode: number
  output: string
}

/**
 * The suite's output goes to a file descriptor, not a pipe. This is not a style choice: piping ~1000
 * tests' console output through the parent adds enough backpressure to the runner to make the
 * pre-existing Windows EBUSY teardown race in `reconnect-after-restart.test.ts` fire reliably rather
 * than rarely — a measurement harness that changes the timing of the thing it measures is measuring
 * itself. A redirected fd reproduces exactly how `bun test > file` behaves at the shell.
 */
function runSuite(root: string, coverage: boolean, logPath: string): SuiteResult {
  const cmd = coverage
    ? ["test", "--coverage", "--coverage-reporter=lcov", `--coverage-dir=${COVERAGE_DIR}`]
    : ["test"]
  const fd = openSync(logPath, "w")
  try {
    const started = Date.now()
    const result = Bun.spawnSync({ cmd: ["bun", ...cmd], cwd: root, stdout: fd, stderr: fd })
    const elapsedMs = Date.now() - started
    return { elapsedMs, exitCode: result.exitCode, output: readFileSync(logPath, "utf8") }
  } finally {
    closeSync(fd)
  }
}

const TALLY = /Ran (\d+) tests? across \d+ files?/
const COUNT = (label: string, output: string): number =>
  Number(new RegExp(`^\\s*(\\d+) ${label}$`, "m").exec(output)?.[1] ?? 0)

export function parseSuiteTally(output: string): RunIdentity["tests"] {
  const total = Number(TALLY.exec(output)?.[1] ?? 0)
  if (total === 0) {
    throw new Error(
      "measure-coverage: the instrumented run reported no test tally, so the figure would describe " +
        "a run nobody can characterise. Nothing was written.",
    )
  }
  return {
    total,
    passed: COUNT("pass", output),
    failed: COUNT("fail", output),
    skipped: COUNT("todo", output) + COUNT("skip", output),
  }
}

function headCommit(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  } catch {
    return process.env.GITHUB_SHA ?? "unknown"
  }
}

function main(): number {
  const root = repoRoot()
  const check = process.argv.includes("--check")
  const baselineFile = join(root, ...BASELINE_PATH.split("/"))

  if (check) {
    if (!existsSync(baselineFile)) {
      console.error(`measure-coverage: FAIL — ${BASELINE_PATH} does not exist.`)
      return 1
    }
    let baseline: CoverageMeasurement
    try {
      baseline = loadCoverageBaseline(readFileSync(baselineFile, "utf8"))
    } catch (error) {
      console.error(`measure-coverage: FAIL — ${(error as Error).message}`)
      return 1
    }
    console.log(renderReport(baseline))

    // Inventory drift is a hard failure: a scoped file that appeared or vanished means the recorded
    // figure's denominator is not the surface on disk any more.
    const onDisk = enumerateScopeFiles(root)
    const recorded = new Set([...baseline.files.map((file) => file.path), ...baseline.neverLoaded])
    const appeared = onDisk.filter((path) => !recorded.has(path))
    const vanished = [...recorded].filter((path) => !onDisk.includes(path))
    if (appeared.length > 0 || vanished.length > 0) {
      console.error(
        `measure-coverage: FAIL — the declared scope on disk no longer matches the measured ` +
          `inventory (${appeared.length} appeared, ${vanished.length} vanished): ` +
          [...appeared.map((p) => `+${p}`), ...vanished.map((p) => `-${p}`)].join(", ") +
          ". Re-measure so the figure names the surface that exists.",
      )
      return 1
    }

    // Staleness is REPORTED, not failed. Task 15 owns the blocking policy; a gate that failed on
    // every source edit until someone re-ran an 82s instrumented suite would be switched off within
    // a week, and a switched-off gate measures nothing.
    const stale = baseline.files.filter(
      (file) => sha256(readFileSync(join(root, ...file.path.split("/")), "utf8")) !== file.sha256,
    )
    if (stale.length > 0) {
      console.warn(
        `\nmeasure-coverage: NOTE — ${stale.length} scoped file(s) changed since this figure was ` +
          `measured: ${stale.map((file) => file.path).join(", ")}. The figure is stale, not wrong; ` +
          "re-measure before quoting it.",
      )
    }
    console.log(
      `\nmeasure-coverage: PASS — figure loads with its scope intact (${baseline.scope.paths.length} ` +
        `declared path(s), ${baseline.scope.exclusions.length} exclusion(s)).`,
    )
    return 0
  }

  mkdirSync(join(root, ".verification"), { recursive: true })
  const withPlain = process.argv.includes("--with-uninstrumented")
  let uninstrumentedMs: number | null = null
  if (withPlain) {
    console.log("measure-coverage: timing an uninstrumented run …")
    const plain = runSuite(root, false, join(root, ".verification", "coverage-run-uninstrumented.log"))
    if (plain.exitCode !== 0) {
      console.error("measure-coverage: the uninstrumented run failed; a figure from a red suite is not measured.")
      console.error(plain.output.slice(-4000))
      return 1
    }
    uninstrumentedMs = plain.elapsedMs
    console.log(`  uninstrumented: ${uninstrumentedMs} ms`)
  }

  console.log("measure-coverage: running the instrumented suite …")
  const instrumented = runSuite(root, true, join(root, ".verification", "coverage-run-instrumented.log"))
  if (instrumented.exitCode !== 0) {
    console.error(
      "measure-coverage: the instrumented run failed. Coverage of a red suite describes nothing; " +
        "nothing was written.",
    )
    console.error(instrumented.output.slice(-4000))
    return 1
  }
  console.log(`  instrumented:   ${instrumented.elapsedMs} ms`)

  const lcovFile = join(root, ...LCOV_PATH.split("/"))
  if (!existsSync(lcovFile)) {
    console.error(
      `measure-coverage: the run produced no ${LCOV_PATH}. The figure comes from the runner's own ` +
        "output and is never reconstructed from anything else (ADR-0021).",
    )
    return 1
  }

  const scopeFiles = enumerateScopeFiles(root)
  const sourceDigests: Record<string, string> = {}
  for (const path of scopeFiles) {
    sourceDigests[path] = sha256(readFileSync(join(root, ...path.split("/")), "utf8"))
  }

  const measurement = buildMeasurement({
    records: parseLcov(readFileSync(lcovFile, "utf8")),
    scopeFiles,
    sourceDigests,
    timing: { uninstrumentedMs, instrumentedMs: instrumented.elapsedMs, measured: uninstrumentedMs !== null },
    run: {
      command: `bun test --coverage --coverage-reporter=lcov --coverage-dir=${COVERAGE_DIR}`,
      commit: headCommit(root),
      tests: parseSuiteTally(instrumented.output),
    },
  })

  writeFileSync(baselineFile, `${JSON.stringify(measurement, null, 2)}\n`, "utf8")
  console.log("")
  console.log(renderReport(measurement))
  console.log(`\nmeasure-coverage: wrote ${BASELINE_PATH}.`)
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
