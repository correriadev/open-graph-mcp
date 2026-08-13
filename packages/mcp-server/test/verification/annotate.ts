/**
 * F002 task 05 — the Discharge Annotation Surface (`003` §Section 2 `DischargeAnnotation`,
 * §Section 5 `AnnotationSink`).
 *
 * A test case declares, **at run time and in code**, the Scenario Identifiers and Conformance Item
 * ids it discharges. One execution appends exactly one JSON line to the per-run
 * `.verification/annotations.jsonl` sink, which task 07 reads to materialise the Traceability Map.
 *
 * ── Why the annotation is data and not a title ────────────────────────────────────────────────
 * `003` §Section 2 is explicit: "Emitted by the test itself at runtime; carries Scenario
 * Identifiers, optional Conformance Item ids, and defect ids; **test titles are never parsed**".
 * A title is prose and drifts; a rename would silently move or destroy a Traceability Link with no
 * diff anyone reviews. Nothing in this file reads the test title for identifiers — the title is
 * carried through verbatim only as the human-readable name of the discharging case, which `004`
 * §1.5 requires of every link ("a link identifying only a suite or a file is rejected").
 *
 * ── Where the validation line sits, deliberately ──────────────────────────────────────────────
 * This surface refuses an identifier that the Scenario Register does not contain (`004` §3.2), and
 * refuses a *retired* entry — in both cases nothing is written, because the annotation names
 * something that is not a live Scenario.
 *
 * A `declared-untestable` identifier (`EAP-QUAR-001..007`, task 04) is a different case, and is
 * handled deliberately rather than by accident:
 *
 *   - It IS in the register, so "absent from the register" does not catch it, and letting it
 *     through unmarked would be exactly the silent pass this domain exists to prevent.
 *   - But blocking it here is **task 08's** job, not this surface's. `003` task 08 owns the
 *     quarantine gate, `004` §5 phrases it as "*when the gate evaluates the change*", and task 06's
 *     acceptance says such a test is "reported for task 08 rather than committed". A throw here
 *     would move the gate into the annotation surface, would fire during ordinary development
 *     rather than at the gate, and would make the very candidates task 08 is meant to discover
 *     unrunnable — so they would never be discovered at all.
 *
 * The line taken: the record carries `declaredUntestable` (derived from register *status*, so this
 * file never reimplements quarantine membership) and the process writes a named warning to stderr.
 * The annotation is therefore never silent, and task 08 has a mechanical input — the field — to
 * fail on. This file will not need to change when that gate lands.
 *
 * ── Cross-package reach (acceptance 3) ────────────────────────────────────────────────────────
 * The declared home of this helper is `packages/mcp-server/test/verification/annotate.ts`, but
 * `graph-core` and `client` suites must also annotate into the same sink. Two properties make that
 * work without a fourth package and without touching another task's scope:
 *
 *   1. The module is imported across packages by relative specifier —
 *      `../../mcp-server/test/verification/annotate` from any `packages/<pkg>/test/*.test.ts`.
 *      This is a single Bun workspace with one module graph; no build step is involved.
 *   2. The sink path is resolved from the **repository root**, derived from this module's own
 *      location, never from `process.cwd()`. `bun test` run inside `packages/graph-core` therefore
 *      appends to the same `<repo>/.verification/annotations.jsonl` as a root run.
 *
 * ── Concurrency ───────────────────────────────────────────────────────────────────────────────
 * `bun test` runs files in parallel and separate probe processes append too. Each record is written
 * with a single `appendFileSync` in `a` mode — one `open(O_APPEND)` / `write` / `close` of one
 * complete line — so the kernel positions every write at end-of-file. A read-modify-write, or a
 * truncating `writeFileSync`, would drop records from concurrent writers; neither is used here.
 */

import { test } from "bun:test"
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

import {
  REGISTER_PATH,
  loadScenarioRegister,
  repoRoot,
  type ScenarioRegister,
} from "../../../../scripts/verification/register-scenarios.ts"

/** Per-run sink, repo-relative. Git-ignored; `docs/verification/` is the committed counterpart. */
export const ANNOTATION_SINK_PATH = ".verification/annotations.jsonl"

/** Absolute override for a test or a CI shard that must not write into the real per-run sink. */
export const SINK_ENV_VAR = "VERIFICATION_ANNOTATIONS_FILE"

export type LinkKind = "asserts" | "covers-partially"

export interface DischargeAnnotation {
  /** Scenario Identifiers this case proves outright. */
  asserts?: readonly string[]
  /** Scenario Identifiers this case proves only in part. Never summed with `asserts` (`004` §1.5). */
  coversPartially?: readonly string[]
  /** Optional Conformance Item ids (`003` §Section 2). */
  items?: readonly string[]
  /** Optional defect ids, for a regression test that exists because of a named defect. */
  defects?: readonly string[]
}

export interface ScenarioLink {
  id: string
  kind: LinkKind
}

export interface AnnotationRecord {
  /** Repo-relative, forward slashes. */
  file: string
  /** The test case name, carried as data — never parsed for identifiers. */
  test: string
  scenarios: ScenarioLink[]
  items: string[]
  defects: string[]
  /**
   * The subset of `scenarios` whose register status is `declared-untestable`. Populated so task
   * 08's quarantine gate has a mechanical input; this surface itself does not block.
   */
  declaredUntestable: string[]
  /** Emitting process, so a concurrent run can be attributed. */
  pid: number
  emittedAt: string
}

const IDENTIFIER = /^EAP-[A-Z]+-\d{3}$/

export function repoRootDir(): string {
  return repoRoot()
}

/** The sink the repository always collects from, whatever the current working directory is. */
export function defaultAnnotationsFile(): string {
  return join(repoRootDir(), ...ANNOTATION_SINK_PATH.split("/"))
}

/** The sink this process writes to: the override when set, otherwise the repo-root default. */
export function annotationsFile(): string {
  const override = process.env[SINK_ENV_VAR]
  if (override !== undefined && override.trim().length > 0) return resolve(override)
  return defaultAnnotationsFile()
}

/** Repo-relative with forward slashes; a path outside the repository is kept as given. */
export function normalizeFile(file: string): string {
  const root = repoRootDir()
  const absolute = isAbsolute(file) ? file : resolve(root, file)
  const rel = relative(root, absolute)
  if (rel.length === 0 || rel.startsWith("..")) return file.replace(/\\/g, "/")
  return rel.replace(/\\/g, "/")
}

let cachedRegister: ScenarioRegister | null = null

/** The committed Scenario Register, loaded once per process. */
export function scenarioRegister(): ScenarioRegister {
  if (cachedRegister === null) {
    const raw = readFileSync(join(repoRootDir(), REGISTER_PATH), "utf8")
    // `derivation`: this is a read of committed state that may legitimately carry `evidenced`
    // entries written by task 09. Nothing here writes the register.
    cachedRegister = loadScenarioRegister(raw, { writer: "derivation" })
  }
  return cachedRegister
}

function where(file: string, testName: string): string {
  return `${file} :: ${testName}`
}

/**
 * Validates one annotation against a register and returns the record that would be appended.
 * Pure — it touches no file — so the refusal paths are testable without a sink.
 */
export function buildRecord(
  file: string,
  testName: string,
  annotation: DischargeAnnotation,
  register: ScenarioRegister,
): AnnotationRecord {
  const normalizedFile = normalizeFile(file)
  const name = testName.trim()
  if (name.length === 0) {
    throw new Error(
      `discharge annotation: ${normalizedFile} emitted an annotation with an empty test name. A ` +
        "Traceability Link carries file plus test name; a link identifying only a file is rejected.",
    )
  }

  const asserts = annotation.asserts ?? []
  const partial = annotation.coversPartially ?? []
  const items = [...(annotation.items ?? [])]
  const defects = [...(annotation.defects ?? [])]

  if (asserts.length === 0 && partial.length === 0 && items.length === 0) {
    throw new Error(
      `discharge annotation: ${where(normalizedFile, name)} names no identifier. An annotation ` +
        "that discharges nothing is not an annotation — omit it and the case is reported as " +
        "unclaimed instead.",
    )
  }

  const byId = new Map(register.scenarios.map((entry) => [entry.id, entry]))
  const scenarios: ScenarioLink[] = []
  const seen = new Set<string>()
  const declaredUntestable: string[] = []

  const link = (id: string, kind: LinkKind): void => {
    if (!IDENTIFIER.test(id)) {
      throw new Error(
        `discharge annotation: "${id}" at ${where(normalizedFile, name)} is not a Scenario ` +
          "Identifier of the form EAP-<AREA>-<NNN>.",
      )
    }
    if (seen.has(id)) {
      throw new Error(
        `discharge annotation: ${id} is declared twice by ${where(normalizedFile, name)}. One ` +
          "execution discharges an identifier once, under exactly one kind.",
      )
    }
    const entry = byId.get(id)
    if (entry === undefined) {
      throw new Error(
        `discharge annotation: ${id} at ${where(normalizedFile, name)} is absent from ` +
          `${REGISTER_PATH}. An annotation may only name a registered Scenario — register it ` +
          "first, or the link would point at nothing.",
      )
    }
    if (entry.retired === true) {
      throw new Error(
        `discharge annotation: ${id} at ${where(normalizedFile, name)} is retired in ` +
          `${REGISTER_PATH}. A retired Scenario can be discharged by nothing.`,
      )
    }
    if (entry.status === "declared-untestable") declaredUntestable.push(id)
    seen.add(id)
    scenarios.push({ id, kind })
  }

  for (const id of asserts) link(id, "asserts")
  for (const id of partial) link(id, "covers-partially")

  for (const item of items) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(
        `discharge annotation: ${where(normalizedFile, name)} carries an empty Conformance Item id.`,
      )
    }
  }
  for (const defect of defects) {
    if (typeof defect !== "string" || defect.trim().length === 0) {
      throw new Error(`discharge annotation: ${where(normalizedFile, name)} carries an empty defect id.`)
    }
  }

  return {
    file: normalizedFile,
    test: name,
    scenarios,
    items,
    defects,
    declaredUntestable,
    pid: process.pid,
    emittedAt: new Date().toISOString(),
  }
}

/**
 * Validates the annotation and appends exactly one record to the sink. Throws — writing nothing —
 * when the annotation names an unregistered or retired identifier, so a bad annotation fails the
 * run at the point of emission with the offending id, file and test name named (`004` §3.2).
 */
export function emitAnnotation(
  file: string,
  testName: string,
  annotation: DischargeAnnotation,
): AnnotationRecord {
  const record = buildRecord(file, testName, annotation, scenarioRegister())

  if (record.declaredUntestable.length > 0) {
    // Reported, not blocked: see the header. Task 08's gate consumes `declaredUntestable`.
    console.warn(
      `discharge annotation: ${where(record.file, record.test)} discharges ` +
        `${record.declaredUntestable.join(", ")}, which the Scenario Register records as ` +
        "declared-untestable (Ambiguity Quarantine). The record is emitted and flagged for the " +
        "quarantine gate; it must not be committed as evidence.",
    )
  }

  const sink = annotationsFile()
  mkdirSync(dirname(sink), { recursive: true })
  // One open-append-close of one complete line: concurrent writers never lose or interleave records.
  appendFileSync(sink, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" })
  return record
}

/**
 * One stack frame's file path, or `null` when the line names no file.
 *
 * The column is OPTIONAL, and that is the whole point of this regex. Bun emits a *module
 * top-level* frame as `    at <file>:<line>` — no parentheses, no function name, and no column —
 * which is exactly the shape produced by `annotatedTest(...)` called at the top level of a test
 * file, i.e. the only shape this surface actually sees in practice. A `:\d+:\d+` pattern misses it
 * and the record silently records `unknown` as its file, which would make every Traceability Link
 * in the map point at nothing. Both shapes are pinned by test.
 */
const FRAME = /\(?((?:[A-Za-z]:[\\/]|\/)[^()]*?\.[cm]?[jt]sx?):\d+(?::\d+)?\)?\s*$/

/**
 * The first frame of `stack` that is not this module. Exported as a pure function of the stack
 * text so the frame shapes can be pinned by test without depending on how a given Bun build
 * happens to format a live stack.
 *
 * Used only to locate the *file* — never to derive an identifier, and never to read a test name.
 */
export function callerFileFromStack(stack: string): string {
  for (const line of stack.split("\n").slice(1)) {
    const match = FRAME.exec(line.trim())
    if (match && !match[1]!.endsWith("annotate.ts")) return match[1]!
  }
  return "unknown"
}

/** The caller's file, read off the live stack one frame above `annotatedTest`. */
function callerFile(): string {
  return callerFileFromStack(new Error().stack ?? "")
}

/**
 * Registers a `bun:test` case and emits its Discharge Annotation once per execution.
 *
 * Preferred over a bare `emitAnnotation` inside a `test()` body: the name reaching the runner and
 * the name recorded in the link are the *same value*, so a rename cannot leave a Traceability Link
 * pointing at a test case name that no longer exists. The annotation is still declared in code as
 * data — the title is never parsed, it is merely reused as the case's name.
 *
 * The record is emitted at the start of the execution, before the body runs, so a failing case is
 * still recorded; whether a link counts as evidence is decided against the Suite Verdict later, not
 * by whether the record exists.
 */
export function annotatedTest(
  name: string,
  annotation: DischargeAnnotation,
  body: () => void | Promise<void>,
): void {
  const file = callerFile()
  test(name, async () => {
    emitAnnotation(file, name, annotation)
    await body()
  })
}

/** Parses a sink. A corrupt line is named by its line number rather than silently dropped. */
export function collectAnnotations(raw: string): AnnotationRecord[] {
  const records: AnnotationRecord[] = []
  const lines = raw.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (line.length === 0) continue
    try {
      records.push(JSON.parse(line) as AnnotationRecord)
    } catch {
      throw new Error(
        `discharge annotation: ${ANNOTATION_SINK_PATH} line ${index + 1} is not valid JSON. The ` +
          "sink is append-only; a malformed line means a writer was interrupted mid-record.",
      )
    }
  }
  return records
}
