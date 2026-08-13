#!/usr/bin/env bun
/**
 * F002 task 08 — the Quarantine Violation Gate.
 *
 * `DetectQuarantineViolation` (`003` §Section 4, Snippet H): fails the build whenever any test case
 * discharges a Scenario inside one of the seven Quarantined Ambiguity families QA1–QA7.
 *
 *   bun scripts/verification/quarantine-gate.ts        -> evaluate; exit 1 on any violation
 *   bun scripts/verification/quarantine-gate.ts --json -> the same verdict as JSON on stdout
 *
 * ── Why this gate exists, and why its *message* is half of it ─────────────────────────────────
 * This project's method is that a deferred architectural question stays explicitly undecided. A
 * *passing* test inside one of those questions is not evidence — it is a silent decision, made by
 * whoever wrote the assertion and recorded nowhere. Every other gate in this repository fails
 * because something is wrong. This one fails because something is *undecided*, and those two are
 * repaired in opposite directions:
 *
 *   - A developer who reads "test failed" edits the test until it goes green. Here, editing the
 *     test until it goes green IS picking an outcome inside the open question — the exact act the
 *     quarantine exists to prevent. A generic failure message would therefore *cause* the harm.
 *   - So `explainViolation` says, in as many words, that the test is not broken, that the behaviour
 *     is undecided, what the open question is, why a passing test would settle it, and that the
 *     only remedy is a merged ADR amendment naming the family. It deliberately carries none of the
 *     vocabulary of an assertion failure ("expected … to be", "Received:").
 *
 * ── Quarantine membership is task 04's, not this file's ───────────────────────────────────────
 * Every family, member, lifting condition and measurement policy is read through
 * `./quarantine`'s loader. This file re-derives none of it: a gate that reimplemented membership
 * could disagree with the store it is meant to enforce, and the disagreement would show up as a
 * silent pass.
 *
 * ── The four sources, and the ordering consequence (deliberate) ───────────────────────────────
 * Task 07 records that the Traceability Map derives from git-ignored per-run artefacts under
 * `.verification/`, so a gate that consumed only the live sink would need the suite to have run
 * first, in the same job, with `--reporter=junit`. **This gate does not take that dependency.** Its
 * two always-available sources need no run at all:
 *
 *   1. `corpus-source`   — a static scan of the declared EAP Test Corpus for a quarantined
 *                          Scenario Identifier written in *code* (comments are stripped first, so
 *                          the many "deliberately NOT linked to EAP-QUAR-002" notes task 06 left
 *                          behind do not trip it). This catches a violation on a fresh clone, and
 *                          catches it even in a test that is skipped, filtered out, or never runs.
 *   2. `traceability-map` — the committed `docs/verification/traceability-map.json`: both its
 *                          `quarantineViolations` list and, as a defence against a hand edit, its
 *                          `links`.
 *
 * and two strengthen the verdict when a run happens to be present:
 *
 *   3. `annotation-sink` — `.verification/annotations.jsonl`, the records task 05 emits with their
 *                          `declaredUntestable` field already populated from register status.
 *   4. `benchmark-ledger` — observations recorded inside QA6/QA7 under measurement-without-assertion.
 *
 * The consequence, stated so it is a decision and not an accident: **this gate may be placed
 * anywhere in CI, before or after the suite.** Running it after the suite is strictly stronger (the
 * sink is then live), never weaker. What it will NOT do is report a pass having consulted nothing:
 * with every source absent it fails, because "no violations found" and "nothing was looked at" must
 * never be the same output.
 *
 * ── Measurement without assertion (`001` §5 rule 3) ────────────────────────────────────────────
 * QA6 and QA7 alone admit measurement. A Benchmark Ledger entry recording an observed cost or
 * timing is evidence; the same entry carrying an expected value, a bound, or an assertion flag is a
 * decision, and fails. QA1–QA5 admit no measurement at all. That distinction is read from each
 * family's own `measurement` policy in the store, never hardcoded here.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  QUARANTINE_PATH,
  assertQuarantineConsistentWithRegister,
  loadQuarantine,
  type QuarantineDocument,
  type QuarantineFamily,
  type QuarantineFamilyId,
} from "./quarantine"
import {
  ANNOTATION_SINK_PATH,
  MAP_PATH,
  discoverCorpusFiles,
  loadTraceabilityMap,
  type AnnotationRecordLike,
  type LinkKind,
  type TraceabilityMap,
} from "./reconcile-traceability"
import { REGISTER_PATH, loadScenarioRegister, repoRoot } from "./register-scenarios"

export const GATE_NAME = "quarantine"

/** `docs/verification/benchmark-ledger.jsonl` — task 16's store; this gate only ever reads it. */
export const BENCHMARK_LEDGER_PATH = "docs/verification/benchmark-ledger.jsonl"

/**
 * The first line of every violation report. It is shouted, and it says the two things a reader
 * must not get backwards, before any file path or diff distracts them.
 */
export const UNDECIDED_BANNER =
  "QUARANTINE VIOLATION — THE BEHAVIOUR IS UNDECIDED, THE TEST IS NOT BROKEN"

export type ViolationSource =
  | "annotation-sink"
  | "traceability-map"
  | "corpus-source"
  | "benchmark-ledger"

/** A link kind, or `measurement` for a Benchmark Ledger observation that crossed into assertion. */
export type ViolationKind = LinkKind | "measurement"

export interface GateViolation {
  familyId: QuarantineFamilyId
  /** The quarantined Scenario Identifier, or `null` for an observation naming only its family. */
  scenario: string | null
  testFile: string
  testName: string
  kind: ViolationKind
  source: ViolationSource
  /** Source-specific detail: the metric, the offending field, the source line. */
  detail: string | null
}

export interface PermittedMeasurement {
  familyId: QuarantineFamilyId
  metric: string
  runId: string
  testFile: string | null
  testName: string | null
}

/** `003` §Section 2 `MeasurementSample`, plus the fields whose presence turns it into a decision. */
export interface MeasurementObservation {
  familyId: QuarantineFamilyId
  metric: string
  value: number
  unit?: string
  runId: string
  commit: string
  runnerFingerprint: string
  at?: string
  testFile?: string
  testName?: string
  /** An expected outcome. Its presence is the decision. */
  expected?: unknown
  /** A bound on the observed value. Its presence is the decision. */
  bound?: unknown
  /** An explicit "this sample was asserted" flag. Its presence is the decision. */
  asserted?: unknown
}

/** One quarantined identifier found in corpus source code, outside any comment. */
export interface CorpusMention {
  scenario: string
  testFile: string
  testName: string
  line: number
}

export interface GateInput {
  quarantine: QuarantineDocument
  /** `null` means the source was unavailable; `[]` means it was read and was empty. */
  records?: readonly AnnotationRecordLike[] | null
  map?: TraceabilityMap | null
  corpusMentions?: readonly CorpusMention[] | null
  observations?: readonly MeasurementObservation[] | null
}

export interface QuarantineGateReport {
  gate: typeof GATE_NAME
  /** `003` D-table: this gate blocks. Stated as data so the Quality Gate reads policy, not guesses. */
  blocking: true
  outcome: "pass" | "fail"
  familiesCovered: QuarantineFamilyId[]
  sourcesConsulted: ViolationSource[]
  violations: GateViolation[]
  permittedMeasurements: PermittedMeasurement[]
  message: string
}

// ── Membership, read from the store ───────────────────────────────────────────────────────────

/** Every Scenario Identifier any family declares untestable. */
export function quarantinedMembers(doc: QuarantineDocument): Set<string> {
  return new Set(doc.families.flatMap((family) => family.members))
}

function familyIndex(doc: QuarantineDocument): Map<string, QuarantineFamily> {
  const index = new Map<string, QuarantineFamily>()
  for (const family of doc.families) {
    for (const member of family.members) index.set(member, family)
  }
  return index
}

// ── The message (acceptance 2) ────────────────────────────────────────────────────────────────

/**
 * The whole point of the gate. Read it as the developer who just saw CI go red: it must be
 * impossible to conclude that the assertion needs adjusting.
 */
export function explainViolation(violation: GateViolation, family: QuarantineFamily): string {
  const lines = [
    `${UNDECIDED_BANNER}`,
    `  family        : ${family.id}${violation.scenario === null ? "" : ` (${violation.scenario})`}`,
    `  test file     : ${violation.testFile}`,
    `  test name     : ${violation.testName}`,
    `  discharged as : ${violation.kind}`,
    `  observed in   : ${violation.source}`,
  ]
  if (violation.detail !== null) lines.push(`  detail        : ${violation.detail}`)
  lines.push(
    "",
    `  The open question: ${family.question}`,
    `  Why a passing test would settle it: ${family.whyAPassingTestWouldDecideIt}`,
    "",
    "  This test case is not broken and its assertion is not wrong. The architecture has not",
    "  decided what the right outcome here IS. Whatever value this case pins, it pins by fiat, and",
    "  the decision is recorded nowhere anyone reviews.",
    "",
    "  DO NOT change the assertion, the expected value, or the code under test to clear this gate:",
    "  every one of those picks an outcome inside the open question, which is precisely the failure",
    "  this gate exists to make impossible. Remove the binding instead, or leave the case",
    "  unannotated with a comment naming the family.",
    "",
    `  The only remedy that settles it: ${family.liftingAdr}`,
    `  Lifting condition: ${family.liftingCondition}`,
  )
  if (family.measurement.mayMeasure) {
    lines.push(
      "",
      `  ${family.id} admits measurement without assertion: ${family.measurement.note ?? ""}`,
    )
  }
  return lines.join("\n")
}

const violationOrder = (a: GateViolation, b: GateViolation): number =>
  a.familyId.localeCompare(b.familyId) ||
  a.testFile.localeCompare(b.testFile) ||
  a.testName.localeCompare(b.testName) ||
  a.source.localeCompare(b.source)

const dedupeKey = (violation: GateViolation): string =>
  [violation.familyId, violation.scenario, violation.testFile, violation.testName, violation.source].join(
    " :: ",
  )

// ── Measurement without assertion ─────────────────────────────────────────────────────────────

const DECISION_FIELDS = ["expected", "bound", "asserted"] as const

/**
 * `001` §5 rule 3. A family that admits no measurement is violated by the observation itself; a
 * family that admits measurement is violated only when the sample carries an expected value, a
 * bound, or an assertion flag — at which point the observation has stopped being evidence and has
 * become the decision.
 */
export function classifyObservation(
  family: QuarantineFamily,
  observation: MeasurementObservation,
): { permitted: boolean; reason: string } {
  if (!family.measurement.mayMeasure) {
    return {
      permitted: false,
      reason:
        `${family.id} admits no measurement at all: an observation recorded inside it already ` +
        `presumes the shape of an answer. Metric "${observation.metric}".`,
    }
  }
  const decided = DECISION_FIELDS.filter(
    (field) => observation[field] !== undefined && observation[field] !== null,
  )
  if (decided.length > 0) {
    return {
      permitted: false,
      reason:
        `metric "${observation.metric}" carries ${decided.join(", ")}. ${family.id} admits ` +
        "measurement WITHOUT assertion: recording the observed value is evidence, stating an " +
        "expected value or a bound for it is the decision the quarantine defers.",
    }
  }
  return {
    permitted: true,
    reason: `${family.id} measurement recorded without assertion — permitted, and it is evidence.`,
  }
}

// ── The static corpus scan ────────────────────────────────────────────────────────────────────

/**
 * Blanks comments while preserving every byte offset and newline, so line numbers and the
 * backwards search for an enclosing test name still work on the result. String and template
 * literals are honoured — a `"// ..."` inside a string is not a comment, and a quarantined id
 * inside a string IS the thing being looked for.
 */
export function stripComments(source: string): string {
  const out = source.split("")
  let index = 0
  const blank = (from: number, to: number): void => {
    for (let cursor = from; cursor < to; cursor++) {
      if (out[cursor] !== "\n") out[cursor] = " "
    }
  }
  while (index < source.length) {
    const char = source[index]!
    const next = source[index + 1]
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index)
      blank(index, end === -1 ? source.length : end)
      index = end === -1 ? source.length : end
      continue
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2)
      const stop = end === -1 ? source.length : end + 2
      blank(index, stop)
      index = stop
      continue
    }
    if (char === '"' || char === "'" || char === "`") {
      index++
      while (index < source.length) {
        const inner = source[index]!
        if (inner === "\\") {
          index += 2
          continue
        }
        if (inner === char) break
        index++
      }
      index++
      continue
    }
    index++
  }
  return out.join("")
}

/**
 * A test-case (or `describe`) declaration and its name. `\s*` spans newlines deliberately: the
 * corpus's prevailing shape is `annotatedTest(` on one line, the name on the next and the
 * annotation on the third, and a same-line-only search walks past all three to report whatever
 * case came *before* — naming an innocent test case in a message whose entire purpose is to name
 * the guilty one.
 */
const TEST_DECLARATION = /(?:annotatedTest|describe|test|it)(?:\.\w+)?\s*\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g

interface Declaration {
  line: number
  name: string
}

/** Every test-case declaration in a stripped source, with the 0-based line each one opens on. */
function declarations(stripped: string): Declaration[] {
  const found: Declaration[] = []
  TEST_DECLARATION.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TEST_DECLARATION.exec(stripped)) !== null) {
    const line = stripped.slice(0, match.index).split("\n").length - 1
    found.push({ line, name: match[2]! })
  }
  return found
}

/** The nearest declaration at or above `line`, or a positional fallback naming the line itself. */
function enclosingTestName(found: readonly Declaration[], line: number): string {
  let name: string | null = null
  for (const declaration of found) {
    if (declaration.line > line) break
    name = declaration.name
  }
  return name ?? `<no enclosing test case — line ${line + 1}>`
}

/**
 * Quarantined Scenario Identifiers written in the *code* of one corpus file. Comments are stripped
 * first: task 06 left explanatory notes naming the families in exactly the files this scans, and
 * flagging those would make the gate cry wolf about the reasoning that kept the corpus clean.
 */
export function findQuarantineMentions(
  testFile: string,
  source: string,
  members: ReadonlySet<string>,
): CorpusMention[] {
  const stripped = stripComments(source)
  const lines = stripped.split(/\r?\n/)
  const found = declarations(stripped)
  const mentions: CorpusMention[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    for (const member of members) {
      if (!line.includes(member)) continue
      mentions.push({
        scenario: member,
        testFile,
        testName: enclosingTestName(found, index),
        line: index + 1,
      })
    }
  }
  return mentions.sort((a, b) => a.line - b.line || a.scenario.localeCompare(b.scenario))
}

/** The declared EAP Test Corpus (task 07's definition, reused), scanned on disk. */
export function scanCorpus(root: string, members: ReadonlySet<string>): CorpusMention[] {
  const mentions: CorpusMention[] = []
  for (const file of discoverCorpusFiles(root)) {
    const absolute = join(root, ...file.split("/"))
    if (!existsSync(absolute)) continue
    mentions.push(...findQuarantineMentions(file, readFileSync(absolute, "utf8"), members))
  }
  return mentions
}

// ── The gate ──────────────────────────────────────────────────────────────────────────────────

export function detectQuarantineViolations(input: GateInput): QuarantineGateReport {
  const doc = input.quarantine
  const members = quarantinedMembers(doc)
  const byMember = familyIndex(doc)
  const byFamilyId = new Map(doc.families.map((family) => [family.id, family]))

  const sourcesConsulted: ViolationSource[] = []
  const violations: GateViolation[] = []
  const permitted: PermittedMeasurement[] = []

  const add = (violation: GateViolation): void => {
    violations.push(violation)
  }

  if (input.records != null) {
    sourcesConsulted.push("annotation-sink")
    for (const record of input.records) {
      // `declaredUntestable` is task 05's derived field; the scenario list is checked too, so a
      // hand-written or older record without that field is caught all the same.
      const named = new Set([
        ...record.declaredUntestable.filter((id) => members.has(id)),
        ...record.scenarios.filter((link) => members.has(link.id)).map((link) => link.id),
      ])
      for (const scenario of named) {
        const link = record.scenarios.find((candidate) => candidate.id === scenario)
        add({
          familyId: byMember.get(scenario)!.id,
          scenario,
          testFile: record.file,
          testName: record.test,
          kind: link?.kind ?? "asserts",
          source: "annotation-sink",
          detail: `annotation record emitted into ${ANNOTATION_SINK_PATH}`,
        })
      }
    }
  }

  if (input.map != null) {
    sourcesConsulted.push("traceability-map")
    for (const reported of input.map.quarantineViolations) {
      const family = byFamilyId.get(reported.familyId) ?? byMember.get(reported.scenario)
      if (family === undefined) {
        // Task 07 writes a `QA?` placeholder when a declared-untestable Scenario belongs to no
        // family. Skipping it would be a silent pass in the one artefact that already knows a rule
        // was broken, so it is raised rather than dropped.
        throw new Error(
          `quarantine gate: ${MAP_PATH} reports a violation for ${reported.scenario} at ` +
            `${reported.testFile} :: ${reported.testName} under family "${reported.familyId}", ` +
            `which no family in ${QUARANTINE_PATH} claims. Either the Scenario is ` +
            "declared-untestable without a family — which 001 §5 rule 1 forbids — or the two " +
            "stores have diverged. Neither may be resolved by ignoring the report.",
        )
      }
      add({
        familyId: family.id,
        scenario: reported.scenario,
        testFile: reported.testFile,
        testName: reported.testName,
        kind: reported.kind,
        source: "traceability-map",
        detail: `reported by ${MAP_PATH} and refused as a link`,
      })
    }
    // A link into a quarantined family cannot be produced by the reconciler — which is exactly why
    // one appearing here would mean the committed map was edited by hand.
    for (const link of input.map.links) {
      const family = byMember.get(link.scenario)
      if (family === undefined) continue
      add({
        familyId: family.id,
        scenario: link.scenario,
        testFile: link.testFile,
        testName: link.testName,
        kind: link.kind,
        source: "traceability-map",
        detail:
          `committed as a LINK in ${MAP_PATH}. The reconciler never emits one; this map was ` +
          "edited by hand.",
      })
    }
  }

  if (input.corpusMentions != null) {
    sourcesConsulted.push("corpus-source")
    for (const mention of input.corpusMentions) {
      const family = byMember.get(mention.scenario)
      if (family === undefined) continue
      add({
        familyId: family.id,
        scenario: mention.scenario,
        testFile: mention.testFile,
        testName: mention.testName,
        kind: "asserts",
        source: "corpus-source",
        detail: `${mention.testFile}:${mention.line} names it in code, outside any comment`,
      })
    }
  }

  if (input.observations != null) {
    sourcesConsulted.push("benchmark-ledger")
    for (const observation of input.observations) {
      const family = byFamilyId.get(observation.familyId)
      if (family === undefined) {
        // `readObservations` already filters out samples that name no family, so reaching here
        // means a sample named one that does not exist. Ignoring it would let a typo — or a
        // deliberate misspelling — carry an assertion into a quarantined subject unchecked.
        throw new Error(
          `quarantine gate: a Benchmark Ledger observation of metric "${observation.metric}" ` +
            `names family "${observation.familyId}", which is outside the closed union of ` +
            `${QUARANTINE_PATH}. A sample may name a real family or none at all.`,
        )
      }
      const verdict = classifyObservation(family, observation)
      if (verdict.permitted) {
        permitted.push({
          familyId: family.id,
          metric: observation.metric,
          runId: observation.runId,
          testFile: observation.testFile ?? null,
          testName: observation.testName ?? null,
        })
        continue
      }
      add({
        familyId: family.id,
        scenario: null,
        testFile: observation.testFile ?? BENCHMARK_LEDGER_PATH,
        testName: observation.testName ?? `measurement ${observation.metric}`,
        kind: "measurement",
        source: "benchmark-ledger",
        detail: verdict.reason,
      })
    }
  }

  const deduped = [...new Map(violations.map((v) => [dedupeKey(v), v])).values()].sort(violationOrder)
  const familiesCovered = doc.families.map((family) => family.id)

  if (sourcesConsulted.length === 0) {
    return {
      gate: GATE_NAME,
      blocking: true,
      outcome: "fail",
      familiesCovered,
      sourcesConsulted,
      violations: [],
      permittedMeasurements: [],
      message:
        "quarantine gate: FAIL — no evidence source was available, so nothing was checked. " +
        `"No violations found" and "nothing was looked at" must never be the same output. ` +
        `Expected at least one of: the declared corpus source, ${MAP_PATH}, ` +
        `${ANNOTATION_SINK_PATH}, ${BENCHMARK_LEDGER_PATH}.`,
    }
  }

  const measured =
    permitted.length === 0
      ? ""
      : `\nquarantine gate: ${permitted.length} permitted measurement(s) recorded without ` +
        `assertion — ${permitted.map((m) => `${m.familyId}/${m.metric}`).join(", ")}.`

  if (deduped.length === 0) {
    return {
      gate: GATE_NAME,
      blocking: true,
      outcome: "pass",
      familiesCovered,
      sourcesConsulted,
      violations: [],
      permittedMeasurements: permitted,
      message:
        `quarantine gate: PASS — ${familiesCovered.length} families ` +
        `(${familiesCovered.join(", ")}) checked against ${sourcesConsulted.join(", ")}; ` +
        `no test case discharges a quarantined Scenario.${measured}`,
    }
  }

  const bodies = deduped.map((violation) =>
    explainViolation(violation, byFamilyId.get(violation.familyId)!),
  )
  const families = [...new Set(deduped.map((violation) => violation.familyId))].sort()

  return {
    gate: GATE_NAME,
    blocking: true,
    outcome: "fail",
    familiesCovered,
    sourcesConsulted,
    violations: deduped,
    permittedMeasurements: permitted,
    message:
      `quarantine gate: FAIL (BLOCKING) — ${deduped.length} Quarantine Violation(s) in ` +
      `${families.join(", ")}. Read the entries below before touching anything: this is not a ` +
      `test failure.\n\n${bodies.join("\n\n")}${measured}`,
  }
}

// ── Reading the sources from disk ─────────────────────────────────────────────────────────────

function readRecords(root: string): AnnotationRecordLike[] | null {
  const sink = join(root, ...ANNOTATION_SINK_PATH.split("/"))
  if (!existsSync(sink)) return null
  const records: AnnotationRecordLike[] = []
  const lines = readFileSync(sink, "utf8").split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (line.length === 0) continue
    try {
      const parsed = JSON.parse(line) as AnnotationRecordLike
      records.push({ ...parsed, declaredUntestable: parsed.declaredUntestable ?? [] })
    } catch {
      throw new Error(
        `quarantine gate: ${ANNOTATION_SINK_PATH} line ${index + 1} is not valid JSON. The sink ` +
          "is append-only; a malformed line means a writer was interrupted mid-record.",
      )
    }
  }
  return records
}

function readObservations(root: string): MeasurementObservation[] | null {
  const ledger = join(root, ...BENCHMARK_LEDGER_PATH.split("/"))
  if (!existsSync(ledger)) return null
  const observations: MeasurementObservation[] = []
  for (const line of readFileSync(ledger, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const parsed = JSON.parse(trimmed) as MeasurementObservation
    // Only samples that name a family are this gate's business; the rest are ordinary metrics.
    if (typeof parsed.familyId === "string") observations.push(parsed)
  }
  return observations
}

/** Evaluates the gate over the repository at `root`. Reads only; writes nothing, anywhere. */
export function runGate(root: string): QuarantineGateReport {
  const doc = loadQuarantine(readFileSync(join(root, QUARANTINE_PATH), "utf8"))

  // Task 04's cross-check, run here too: a member that drifted out of `declared-untestable` would
  // make the annotation surface stop flagging it and this gate would go quiet for that family.
  const register = loadScenarioRegister(readFileSync(join(root, REGISTER_PATH), "utf8"), {
    writer: "derivation",
  })
  assertQuarantineConsistentWithRegister(doc, register)

  const mapFile = join(root, ...MAP_PATH.split("/"))
  const map = existsSync(mapFile) ? loadTraceabilityMap(readFileSync(mapFile, "utf8")) : null

  return detectQuarantineViolations({
    quarantine: doc,
    records: readRecords(root),
    map,
    corpusMentions: scanCorpus(root, quarantinedMembers(doc)),
    observations: readObservations(root),
  })
}

function main(): number {
  const report = runGate(repoRoot())
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2))
    return report.outcome === "pass" ? 0 : 1
  }
  if (report.outcome === "pass") {
    console.log(report.message)
    return 0
  }
  console.error(report.message)
  return 1
}

if (import.meta.main) {
  process.exit(main())
}
