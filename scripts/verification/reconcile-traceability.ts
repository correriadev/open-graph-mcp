#!/usr/bin/env bun
/**
 * F002 task 07 — Build the Bidirectional Traceability Map.
 *
 * `TraceabilityMapStore` (`003` §Section 5) over `docs/verification/traceability-map.json`, plus
 * `ReconcileTraceability` (`003` §Section 4), which computes Traceability Gaps in both directions.
 *
 *   bun scripts/verification/reconcile-traceability.ts           -> regenerate the committed map
 *   bun scripts/verification/reconcile-traceability.ts --check   -> fail if the committed map has
 *                                                                  drifted from a regeneration
 *
 * ── What this file owns, and what it deliberately does not ────────────────────────────────────
 * `003` §Section 1 makes the Traceability Map the *derived aggregate* that holds gap truth in both
 * directions: "a Scenario with no test case **and** a test case asserting behaviour no Scenario
 * describes are both Traceability Gaps". So gaps live here, in `gaps.unlinkedScenarios` and
 * `gaps.unclaimedTests`, and nowhere else. `docs/verification/scenario-register.json` is the
 * identity store and is not touched by this script — it holds no gap field, and its serializer
 * would drop one anyway.
 *
 * Task 06 wrote `docs/verification/annotation-coverage.json` as a stopgap gap ledger because the
 * register rejected extra fields. **This map supersedes that file for gap truth.** That file has
 * been re-headed to say so and keeps only what this map does not derive (the per-scenario prose
 * explaining *why* a gap or a partial link is what it is, the reviewed quarantine candidates, and
 * the out-of-scope classification). Exactly one artefact — this one — is authoritative for *which*
 * scenarios and test cases are gaps.
 *
 * Statuses are not written here at all — not even echoed. `evidenced` is task 09's alone, and a
 * derived file that repeats a status invites a reader to treat the copy as the source. The map
 * reports `coverage` in its own vocabulary (`asserts` / `covers-partially-only` / `none`) and the
 * register keeps `status`.
 *
 * ── The two inputs, and why the second one is not optional ────────────────────────────────────
 * The scenario direction needs only the register plus the annotation sink. The **test** direction
 * needs something the sink cannot provide: an inventory of test cases that executed and emitted
 * *nothing*. A silent test case is invisible to a sink written by test cases.
 *
 * That inventory is the runner's own JUnit report — evidence from the runner, per ADR-0021, rather
 * than a hand-kept list or a regex over source that would drift the moment a test is generated in a
 * loop. It is therefore a required input: with no report, this script refuses to run rather than
 * emitting an empty `unclaimedTests` list, which would read as "no unclaimed tests" and would be a
 * lie of exactly the kind this domain exists to prevent.
 *
 *   bun test --reporter=junit --reporter-outfile=.verification/junit.xml
 *
 * Both inputs live under the git-ignored `.verification/`, so **CI must run the suite before
 * checking this map**. See the `pendingCiGates` entry in this task's TDD output.
 *
 * ── Byte-stability over sink freshness (the dedupe) ───────────────────────────────────────────
 * `.verification/annotations.jsonl` accumulates across runs: nothing truncates it, and truncating
 * mid-run would race the parallel appends of concurrent test processes. Running the suite twice
 * must not move the map by one byte, so the sink is **deduplicated on read** — the map is a pure
 * function of (register + *distinct* annotation records + executed test inventory). `pid` and
 * `emittedAt` are per-execution noise and take no part in identity.
 *
 * The cost of never truncating is that the sink can hold a record for a test case that has since
 * been renamed or deleted. Such a record is dropped from the links and reported under
 * `staleAnnotationRecords`, so the map still describes the corpus as it is *now* while the stale
 * record stays visible. The one thing that is not tolerated is the same test case claiming one
 * scenario under two different kinds: that is a *changed* annotation read together with its own
 * predecessor, and the run fails naming the remedy rather than committing both links.
 */

import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"

import {
  loadQuarantine,
  QUARANTINE_PATH,
  type QuarantineDocument,
  type QuarantineFamilyId,
} from "./quarantine"
import {
  loadScenarioRegister,
  REGISTER_PATH,
  repoRoot,
  type ScenarioRegister,
} from "./register-scenarios"

export const MAP_PATH = "docs/verification/traceability-map.json"
export const ANNOTATION_SINK_PATH = ".verification/annotations.jsonl"
export const JUNIT_REPORT_PATH = ".verification/junit.xml"

export const LINK_KINDS = ["asserts", "covers-partially"] as const
export type LinkKind = (typeof LINK_KINDS)[number]

const isLinkKind = (value: string): value is LinkKind =>
  (LINK_KINDS as readonly string[]).includes(value)

const IDENTIFIER = /^EAP-[A-Z]+-\d{3}$/

/** `003` §Section 2 — `TraceabilityLink`. Never a suite, never a file alone. */
export interface TraceabilityLink {
  scenario: string
  testFile: string
  testName: string
  kind: LinkKind
}

/** The subset of `AnnotationRecord` (task 05) this reconciler reads. */
export interface AnnotationRecordLike {
  file: string
  test: string
  scenarios: { id: string; kind: LinkKind }[]
  items: string[]
  defects: string[]
  declaredUntestable: string[]
  pid: number
  emittedAt: string
}

export interface ExecutedTestCase {
  file: string
  test: string
}

export type Coverage = "asserts" | "covers-partially-only" | "none"

export interface ScenarioCoverage {
  id: string
  assertsLinks: number
  coversPartiallyLinks: number
  coverage: Coverage
}

export interface UnlinkedScenarioGap {
  id: string
  area: string
  heading: string
}

export interface TestCaseRef {
  testFile: string
  testName: string
}

export interface QuarantineViolation extends TestCaseRef {
  scenario: string
  familyId: QuarantineFamilyId
  kind: LinkKind
}

export interface TraceabilityMap {
  version: number
  policy: string
  generator: string
  inputs: {
    register: { path: string; sha256: string; liveProposedScenarios: number }
    quarantine: { path: string; declaredUntestableScenarios: number }
    annotationSink: { path: string; distinctRecords: number }
    executedTests: { path: string; corpusTestCases: number }
  }
  corpus: {
    policy: string
    files: string[]
    fileCount: number
    testCaseCount: number
    annotatedTestCaseCount: number
    undeclaredCandidates: string[]
  }
  counts: {
    scenariosWithAssertsLink: number
    scenariosCoveredPartiallyOnly: number
    unlinkedScenarios: number
    unclaimedTests: number
    links: { asserts: number; coversPartially: number; total: number }
  }
  links: TraceabilityLink[]
  scenarios: ScenarioCoverage[]
  gaps: {
    unlinkedScenarios: UnlinkedScenarioGap[]
    unclaimedTests: TestCaseRef[]
  }
  quarantineViolations: QuarantineViolation[]
  staleAnnotationRecords: TestCaseRef[]
  recordsOutsideDeclaredCorpus: TestCaseRef[]
}

export interface ReconcileInput {
  register: ScenarioRegister
  quarantine: QuarantineDocument
  records: readonly AnnotationRecordLike[]
  executed: readonly ExecutedTestCase[]
  corpusFiles: readonly string[]
  registerSha256: string
}

// ── The declared EAP Test Corpus ──────────────────────────────────────────────────────────────

const CORPUS_POLICY =
  "The EAP Test Corpus is every `*.test.ts` under `packages/*/test/` that imports the Discharge " +
  "Annotation surface (`packages/mcp-server/test/verification/annotate.ts`). Membership is " +
  "therefore declared in code by the test file itself rather than kept in a hand-maintained list " +
  "that would drift. `packages/*/test/verification/**` is excluded: those files test the " +
  "verification machinery, not EAP behaviour, and annotate only into an overridden sink. A file " +
  "whose name suggests EAP coverage but which imports no annotation surface is reported under " +
  "`undeclaredCandidates` rather than silently ignored."

const ANNOTATE_IMPORT = "verification/annotate"

/** Files named as if they carried EAP behaviour. Used only to report a *candidate*, never to include. */
const CANDIDATE_NAME = /(^|\/)(eap-|f001-)/

function testFilesUnder(root: string): string[] {
  const found: string[] = []
  const packages = join(root, "packages")
  if (!existsSync(packages)) return found

  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        if (name === "node_modules") continue
        walk(full)
        continue
      }
      if (name.endsWith(".test.ts")) found.push(relative(root, full).replace(/\\/g, "/"))
    }
  }

  for (const pkg of readdirSync(packages).sort()) {
    const dir = join(packages, pkg, "test")
    if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir)
  }
  return found
}

/** The corpus, discovered from the source tree. Sorted, so the committed map is order-stable. */
export function discoverCorpusFiles(root: string): string[] {
  return testFilesUnder(root).filter((file) => {
    if (/\/test\/verification\//.test(file)) return false
    return readFileSync(join(root, file), "utf8").includes(ANNOTATE_IMPORT)
  })
}

/** EAP-looking test files that declare no annotation surface. Reported, never included. */
export function undeclaredCorpusCandidates(root: string, corpus: readonly string[]): string[] {
  const declared = new Set(corpus)
  return testFilesUnder(root).filter(
    (file) => !declared.has(file) && !/\/test\/verification\//.test(file) && CANDIDATE_NAME.test(file),
  )
}

// ── The executed-test inventory (the runner's JUnit report) ───────────────────────────────────

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&amp;": "&",
}

/**
 * One level of XML attribute unescaping — deliberately one, not to a fixpoint. A test case named
 * `a &gt; b` in source is escaped once by the runner; decoding twice would silently rewrite its
 * name and the link would no longer match the annotation record, which carries the name verbatim.
 * `&amp;` is decoded last so `&amp;lt;` cannot be mistaken for `<`.
 */
export function decodeXmlAttribute(value: string): string {
  return value.replace(/&(lt|gt|quot|apos|amp);/g, (entity) => ENTITIES[entity]!)
}

/** Repo-relative, forward slashes. A path the repository does not hold is refused, not guessed. */
export function normalizeExecutedFile(file: string, root: string = repoRoot()): string {
  const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "")
  if (existsSync(join(root, normalized))) return normalized
  throw new Error(
    `reconcile-traceability: the runner reported test file "${file}", which does not resolve ` +
      "against the repository root. Produce the JUnit report from a repository-root " +
      "`bun test --reporter=junit --reporter-outfile=" +
      `${JUNIT_REPORT_PATH}\` run; a per-package run reports package-relative paths that cannot ` +
      "be attributed to a package after the fact.",
  )
}

const TESTCASE = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g
const ATTRIBUTE = (name: string): RegExp => new RegExp(`\\b${name}="([^"]*)"`)

/**
 * Every test case the runner actually executed, by file and name. A skipped or `todo` case is
 * omitted: it ran nothing, so it can annotate nothing, and reporting it as unclaimed would invent
 * a Traceability Gap out of a case that was never asked to prove anything.
 */
export function parseJUnitTestCases(xml: string, root: string = repoRoot()): ExecutedTestCase[] {
  const cases: ExecutedTestCase[] = []
  for (const match of xml.matchAll(TESTCASE)) {
    const attributes = match[1]!
    const body = match[3] ?? ""
    if (/<skipped\b/.test(body)) continue

    const name = ATTRIBUTE("name").exec(attributes)?.[1]
    const file = ATTRIBUTE("file").exec(attributes)?.[1]
    if (name === undefined || file === undefined) {
      throw new Error(
        `reconcile-traceability: a <testcase> in the JUnit report carries no ${
          name === undefined ? "name" : "file"
        } attribute, so the test case it names cannot be identified by file plus test name.`,
      )
    }
    cases.push({
      file: normalizeExecutedFile(decodeXmlAttribute(file), root),
      test: decodeXmlAttribute(name),
    })
  }
  return cases
}

// ── Annotation records -> links ───────────────────────────────────────────────────────────────

const recordIdentity = (record: AnnotationRecordLike): string =>
  JSON.stringify([
    record.file,
    record.test,
    record.scenarios.map((s) => [s.id, s.kind]),
    record.items,
    record.defects,
  ])

/**
 * The distinct records of an accumulating sink. `pid` and `emittedAt` are per-execution noise and
 * are excluded from identity, so N runs of an unchanged suite deduplicate to one record each.
 */
export function distinctAnnotationRecords(
  records: readonly AnnotationRecordLike[],
): AnnotationRecordLike[] {
  const seen = new Set<string>()
  const distinct: AnnotationRecordLike[] = []
  for (const record of records) {
    const key = recordIdentity(record)
    if (seen.has(key)) continue
    seen.add(key)
    distinct.push(record)
  }
  return distinct
}

const where = (file: string, test: string): string => `${file} :: ${test}`

export const compareLinks = (a: TraceabilityLink, b: TraceabilityLink): number =>
  a.scenario.localeCompare(b.scenario) ||
  a.testFile.localeCompare(b.testFile) ||
  a.testName.localeCompare(b.testName) ||
  a.kind.localeCompare(b.kind)

/**
 * Materialises `LinkScenarioToTestCase` (`003` §Section 4) from runtime annotations. Refuses a kind
 * outside the closed union, a malformed identifier, and a test case claiming one scenario under two
 * kinds — the last being a sink that has outlived an edited annotation.
 */
export function buildLinks(records: readonly AnnotationRecordLike[]): TraceabilityLink[] {
  const byKey = new Map<string, TraceabilityLink>()

  for (const record of distinctAnnotationRecords(records)) {
    for (const scenario of record.scenarios) {
      if (!IDENTIFIER.test(scenario.id)) {
        throw new Error(
          `reconcile-traceability: "${scenario.id}" at ${where(record.file, record.test)} is not a ` +
            "Scenario Identifier of the form EAP-<AREA>-<NNN>. No link was materialised.",
        )
      }
      if (!isLinkKind(scenario.kind)) {
        throw new Error(
          `reconcile-traceability: ${scenario.id} at ${where(record.file, record.test)} carries ` +
            `kind "${scenario.kind}", outside the closed union ${LINK_KINDS.join(" | ")} of 003 ` +
            "§Section 2. The link is rejected and the offending annotation is named.",
        )
      }
      const key = `${scenario.id} ${record.file} ${record.test}`
      const existing = byKey.get(key)
      if (existing !== undefined && existing.kind !== scenario.kind) {
        throw new Error(
          `reconcile-traceability: ${scenario.id} is claimed by ${where(record.file, record.test)} ` +
            `as both "${existing.kind}" and "${scenario.kind}". One execution discharges an ` +
            "identifier under exactly one kind, so this is a stale annotation sink read together " +
            `with an edited annotation. Delete ${ANNOTATION_SINK_PATH}, re-run the suite, and ` +
            "regenerate.",
        )
      }
      byKey.set(key, {
        scenario: scenario.id,
        testFile: record.file,
        testName: record.test,
        kind: scenario.kind,
      })
    }
  }

  return [...byKey.values()].sort(compareLinks)
}

// ── ReconcileTraceability ─────────────────────────────────────────────────────────────────────

const MAP_POLICY =
  "Bidirectional Traceability Map (F002 task 07). DERIVED — generated by " +
  "scripts/verification/reconcile-traceability.ts from docs/verification/scenario-register.json, " +
  "the deduplicated annotation sink, and the runner's executed-test inventory. Never hand-edited: " +
  "an edit here is overwritten by the next regeneration and reported by `--check`. This file is " +
  "the single authority for Traceability Gap truth in both directions — a proposed Scenario that " +
  "no test case discharges (`gaps.unlinkedScenarios`) and an executed corpus test case that " +
  "discharges no Scenario (`gaps.unclaimedTests`), in two separate lists that are never summed. " +
  "An `asserts` link and a `covers-partially` link are counted separately and never merged, " +
  "because `covers-partially` alone can never promote a Scenario to `evidenced` (003 §Section 2). " +
  "No Scenario status is written here; the register owns status and only the derivation service " +
  "of task 09 may write `evidenced`."

const caseRefOrder = (a: TestCaseRef, b: TestCaseRef): number =>
  a.testFile.localeCompare(b.testFile) || a.testName.localeCompare(b.testName)

export function reconcile(input: ReconcileInput): TraceabilityMap {
  const { register, quarantine, executed, registerSha256 } = input
  const corpusFiles = [...input.corpusFiles].sort()
  const corpus = new Set(corpusFiles)

  const byId = new Map(register.scenarios.map((entry) => [entry.id, entry]))
  const quarantineFamilyOf = new Map<string, QuarantineFamilyId>()
  for (const family of quarantine.families) {
    for (const member of family.members) quarantineFamilyOf.set(member, family.id)
  }

  const distinct = distinctAnnotationRecords(input.records)
  const inCorpus = distinct.filter((record) => corpus.has(record.file))
  const outside = distinct
    .filter((record) => !corpus.has(record.file))
    .map((record) => ({ testFile: record.file, testName: record.test }))

  const executedInCorpus = executed.filter((testCase) => corpus.has(testCase.file))
  const executedKeys = new Set(executedInCorpus.map((c) => `${c.file} ${c.test}`))

  const links: TraceabilityLink[] = []
  const quarantineViolations: QuarantineViolation[] = []
  const stale: TestCaseRef[] = []

  for (const link of buildLinks(inCorpus)) {
    const entry = byId.get(link.scenario)
    if (entry === undefined) {
      throw new Error(
        `reconcile-traceability: ${link.scenario} at ${where(link.testFile, link.testName)} is ` +
          `absent from ${REGISTER_PATH}. A Traceability Link may only name a registered Scenario.`,
      )
    }
    if (entry.retired === true) {
      throw new Error(
        `reconcile-traceability: ${link.scenario} at ${where(link.testFile, link.testName)} is ` +
          `retired in ${REGISTER_PATH}. A retired Scenario can be discharged by nothing; the ` +
          `annotation or the sink is stale. Delete ${ANNOTATION_SINK_PATH} and re-run the suite.`,
      )
    }

    const family = quarantineFamilyOf.get(link.scenario)
    if (family !== undefined || entry.status === "declared-untestable") {
      // Never committed: a Traceability Link into a quarantined family is a Quarantine Violation
      // by construction (001 §5 rule 2). Reported here; task 08's gate fails the build on it.
      quarantineViolations.push({
        scenario: link.scenario,
        familyId: family ?? ("QA?" as QuarantineFamilyId),
        testFile: link.testFile,
        testName: link.testName,
        kind: link.kind,
      })
      continue
    }

    if (!executedKeys.has(`${link.testFile} ${link.testName}`)) {
      stale.push({ testFile: link.testFile, testName: link.testName })
      continue
    }

    links.push(link)
  }

  const live = register.scenarios.filter(
    (entry) => entry.retired !== true && entry.status === "proposed",
  )

  const scenarios: ScenarioCoverage[] = live
    .map((entry) => {
      const mine = links.filter((link) => link.scenario === entry.id)
      const assertsLinks = mine.filter((link) => link.kind === "asserts").length
      const coversPartiallyLinks = mine.length - assertsLinks
      const coverage: Coverage =
        assertsLinks > 0 ? "asserts" : coversPartiallyLinks > 0 ? "covers-partially-only" : "none"
      return { id: entry.id, assertsLinks, coversPartiallyLinks, coverage }
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  const unlinkedScenarios: UnlinkedScenarioGap[] = live
    .filter((entry) => !links.some((link) => link.scenario === entry.id))
    .map((entry) => ({ id: entry.id, area: entry.area, heading: entry.heading }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const annotatedKeys = new Set(
    inCorpus
      .map((record) => `${record.file} ${record.test}`)
      .filter((key) => executedKeys.has(key)),
  )
  const unclaimedTests: TestCaseRef[] = [
    ...new Map(
      executedInCorpus
        .filter((testCase) => !annotatedKeys.has(`${testCase.file} ${testCase.test}`))
        .map((testCase) => [
          `${testCase.file} ${testCase.test}`,
          { testFile: testCase.file, testName: testCase.test },
        ]),
    ).values(),
  ].sort(caseRefOrder)

  const declaredUntestable = register.scenarios.filter(
    (entry) => entry.retired !== true && entry.status === "declared-untestable",
  ).length

  const uniqueExecuted = new Set(executedInCorpus.map((c) => `${c.file} ${c.test}`)).size

  return {
    version: 1,
    policy: MAP_POLICY,
    generator: "scripts/verification/reconcile-traceability.ts",
    inputs: {
      register: {
        path: REGISTER_PATH,
        sha256: registerSha256,
        liveProposedScenarios: live.length,
      },
      quarantine: { path: QUARANTINE_PATH, declaredUntestableScenarios: declaredUntestable },
      annotationSink: { path: ANNOTATION_SINK_PATH, distinctRecords: distinct.length },
      executedTests: { path: JUNIT_REPORT_PATH, corpusTestCases: uniqueExecuted },
    },
    corpus: {
      policy: CORPUS_POLICY,
      files: corpusFiles,
      fileCount: corpusFiles.length,
      testCaseCount: uniqueExecuted,
      annotatedTestCaseCount: annotatedKeys.size,
      undeclaredCandidates: [],
    },
    counts: {
      scenariosWithAssertsLink: scenarios.filter((s) => s.coverage === "asserts").length,
      scenariosCoveredPartiallyOnly: scenarios.filter((s) => s.coverage === "covers-partially-only")
        .length,
      unlinkedScenarios: unlinkedScenarios.length,
      unclaimedTests: unclaimedTests.length,
      links: {
        asserts: links.filter((link) => link.kind === "asserts").length,
        coversPartially: links.filter((link) => link.kind === "covers-partially").length,
        total: links.length,
      },
    },
    links,
    scenarios,
    gaps: { unlinkedScenarios, unclaimedTests },
    quarantineViolations: quarantineViolations.sort(
      (a, b) => a.scenario.localeCompare(b.scenario) || caseRefOrder(a, b),
    ),
    staleAnnotationRecords: stale.sort(caseRefOrder),
    recordsOutsideDeclaredCorpus: outside.sort(caseRefOrder),
  }
}

// ── Store: serialize / load / diff ────────────────────────────────────────────────────────────

/** Fixed key order, two-space indent, trailing newline — so any diff is real drift. */
export function serializeMap(map: TraceabilityMap): string {
  const shaped = {
    version: map.version,
    policy: map.policy,
    generator: map.generator,
    inputs: {
      register: {
        path: map.inputs.register.path,
        sha256: map.inputs.register.sha256,
        liveProposedScenarios: map.inputs.register.liveProposedScenarios,
      },
      quarantine: {
        path: map.inputs.quarantine.path,
        declaredUntestableScenarios: map.inputs.quarantine.declaredUntestableScenarios,
      },
      annotationSink: {
        path: map.inputs.annotationSink.path,
        distinctRecords: map.inputs.annotationSink.distinctRecords,
      },
      executedTests: {
        path: map.inputs.executedTests.path,
        corpusTestCases: map.inputs.executedTests.corpusTestCases,
      },
    },
    corpus: {
      policy: map.corpus.policy,
      files: map.corpus.files,
      fileCount: map.corpus.fileCount,
      testCaseCount: map.corpus.testCaseCount,
      annotatedTestCaseCount: map.corpus.annotatedTestCaseCount,
      undeclaredCandidates: map.corpus.undeclaredCandidates,
    },
    counts: {
      scenariosWithAssertsLink: map.counts.scenariosWithAssertsLink,
      scenariosCoveredPartiallyOnly: map.counts.scenariosCoveredPartiallyOnly,
      unlinkedScenarios: map.counts.unlinkedScenarios,
      unclaimedTests: map.counts.unclaimedTests,
      links: {
        asserts: map.counts.links.asserts,
        coversPartially: map.counts.links.coversPartially,
        total: map.counts.links.total,
      },
    },
    links: map.links.map((link) => ({
      scenario: link.scenario,
      testFile: link.testFile,
      testName: link.testName,
      kind: link.kind,
    })),
    scenarios: map.scenarios.map((scenario) => ({
      id: scenario.id,
      assertsLinks: scenario.assertsLinks,
      coversPartiallyLinks: scenario.coversPartiallyLinks,
      coverage: scenario.coverage,
    })),
    gaps: {
      unlinkedScenarios: map.gaps.unlinkedScenarios.map((gap) => ({
        id: gap.id,
        area: gap.area,
        heading: gap.heading,
      })),
      unclaimedTests: map.gaps.unclaimedTests.map((ref) => ({
        testFile: ref.testFile,
        testName: ref.testName,
      })),
    },
    quarantineViolations: map.quarantineViolations.map((violation) => ({
      scenario: violation.scenario,
      familyId: violation.familyId,
      testFile: violation.testFile,
      testName: violation.testName,
      kind: violation.kind,
    })),
    staleAnnotationRecords: map.staleAnnotationRecords.map((ref) => ({
      testFile: ref.testFile,
      testName: ref.testName,
    })),
    recordsOutsideDeclaredCorpus: map.recordsOutsideDeclaredCorpus.map((ref) => ({
      testFile: ref.testFile,
      testName: ref.testName,
    })),
  }
  return `${JSON.stringify(shaped, null, 2)}\n`
}

/**
 * Validates a committed map. Every refusal names what is wrong: a map that no longer identifies its
 * asserting test case by file plus test name is not a weaker map, it is not a Traceability Map.
 */
export function loadTraceabilityMap(raw: string): TraceabilityMap {
  const parsed = JSON.parse(raw) as TraceabilityMap
  if (!Array.isArray(parsed?.links)) {
    throw new Error("reconcile-traceability: map has no `links` array.")
  }
  if (!Array.isArray(parsed?.scenarios)) {
    throw new Error("reconcile-traceability: map has no `scenarios` array.")
  }
  if (!Array.isArray(parsed?.gaps?.unlinkedScenarios) || !Array.isArray(parsed?.gaps?.unclaimedTests)) {
    throw new Error(
      "reconcile-traceability: map does not hold both gap directions. `gaps.unlinkedScenarios` " +
        "and `gaps.unclaimedTests` are separate lists and neither is optional.",
    )
  }

  for (const link of parsed.links) {
    if (typeof link?.scenario !== "string" || !IDENTIFIER.test(link.scenario)) {
      throw new Error(
        `reconcile-traceability: link scenario "${link?.scenario}" is not an EAP-<AREA>-<NNN> ` +
          "Scenario Identifier.",
      )
    }
    if (typeof link.testFile !== "string" || link.testFile.trim().length === 0) {
      throw new Error(
        `reconcile-traceability: the link for ${link.scenario} names no test file. A link ` +
          "identifies the asserting test case by file plus test name.",
      )
    }
    if (typeof link.testName !== "string" || link.testName.trim().length === 0) {
      throw new Error(
        `reconcile-traceability: the link for ${link.scenario} in ${link.testFile} names no test ` +
          "name. A link identifying only a suite or a file is rejected (004 §1.1).",
      )
    }
    if (typeof link.kind !== "string" || !isLinkKind(link.kind)) {
      throw new Error(
        `reconcile-traceability: the link ${link.scenario} -> ${where(link.testFile, link.testName)} ` +
          `carries kind "${link.kind}", outside the closed union ${LINK_KINDS.join(" | ")}.`,
      )
    }
  }
  return parsed
}

export interface DriftReport {
  drifted: boolean
  addedLinks: TraceabilityLink[]
  removedLinks: TraceabilityLink[]
  openedScenarioGaps: string[]
  closedScenarioGaps: string[]
  addedUnclaimedTests: TestCaseRef[]
  removedUnclaimedTests: TestCaseRef[]
  /** Scenarios holding fewer links than before — 004 §1.3, "lose no link when the corpus is renamed". */
  lostScenarioLinks: { id: string; before: number; after: number }[]
}

const linkKey = (link: TraceabilityLink): string =>
  `${link.scenario} ${link.testFile} ${link.testName} ${link.kind}`
const refKey = (ref: TestCaseRef): string => `${ref.testFile} ${ref.testName}`

export function diffMaps(committed: TraceabilityMap, regenerated: TraceabilityMap): DriftReport {
  const before = new Map(committed.links.map((link) => [linkKey(link), link]))
  const after = new Map(regenerated.links.map((link) => [linkKey(link), link]))

  const addedLinks = [...after.values()].filter((link) => !before.has(linkKey(link)))
  const removedLinks = [...before.values()].filter((link) => !after.has(linkKey(link)))

  const beforeGaps = new Set(committed.gaps.unlinkedScenarios.map((gap) => gap.id))
  const afterGaps = new Set(regenerated.gaps.unlinkedScenarios.map((gap) => gap.id))
  const openedScenarioGaps = [...afterGaps].filter((id) => !beforeGaps.has(id)).sort()
  const closedScenarioGaps = [...beforeGaps].filter((id) => !afterGaps.has(id)).sort()

  const beforeUnclaimed = new Map(committed.gaps.unclaimedTests.map((ref) => [refKey(ref), ref]))
  const afterUnclaimed = new Map(regenerated.gaps.unclaimedTests.map((ref) => [refKey(ref), ref]))
  const addedUnclaimedTests = [...afterUnclaimed.values()].filter((r) => !beforeUnclaimed.has(refKey(r)))
  const removedUnclaimedTests = [...beforeUnclaimed.values()].filter((r) => !afterUnclaimed.has(refKey(r)))

  const countOf = (map: TraceabilityMap): Map<string, number> => {
    const counts = new Map<string, number>()
    for (const link of map.links) counts.set(link.scenario, (counts.get(link.scenario) ?? 0) + 1)
    return counts
  }
  const beforeCounts = countOf(committed)
  const afterCounts = countOf(regenerated)
  const lostScenarioLinks = [...beforeCounts.entries()]
    .filter(([id, count]) => (afterCounts.get(id) ?? 0) < count)
    .map(([id, count]) => ({ id, before: count, after: afterCounts.get(id) ?? 0 }))
    .sort((a, b) => a.id.localeCompare(b.id))

  return {
    drifted:
      addedLinks.length > 0 ||
      removedLinks.length > 0 ||
      openedScenarioGaps.length > 0 ||
      closedScenarioGaps.length > 0 ||
      addedUnclaimedTests.length > 0 ||
      removedUnclaimedTests.length > 0,
    addedLinks,
    removedLinks,
    openedScenarioGaps,
    closedScenarioGaps,
    addedUnclaimedTests,
    removedUnclaimedTests,
    lostScenarioLinks,
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

/** Reads a required per-run input, refusing to proceed rather than reporting an empty result. */
function requireInput(path: string, root: string, how: string): string {
  const full = join(root, path)
  if (!existsSync(full)) {
    throw new Error(
      `reconcile-traceability: ${path} is missing. The Traceability Map is derived from a real ` +
        `Suite Run, so this input is required, not optional — an absent ${path} would be ` +
        `reported as "nothing to link" and read as evidence of coverage. Produce it with:\n  ${how}`,
    )
  }
  return readFileSync(full, "utf8")
}

function collectRecords(raw: string): AnnotationRecordLike[] {
  const records: AnnotationRecordLike[] = []
  const lines = raw.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (line.length === 0) continue
    try {
      records.push(JSON.parse(line) as AnnotationRecordLike)
    } catch {
      throw new Error(
        `reconcile-traceability: ${ANNOTATION_SINK_PATH} line ${index + 1} is not valid JSON. The ` +
          "sink is append-only; a malformed line means a writer was interrupted mid-record.",
      )
    }
  }
  return records
}

export function regenerateFromDisk(root: string): TraceabilityMap {
  const registerRaw = readFileSync(join(root, REGISTER_PATH), "utf8")
  const register = loadScenarioRegister(registerRaw, { writer: "derivation" })
  const quarantine = loadQuarantine(readFileSync(join(root, QUARANTINE_PATH), "utf8"))

  const sink = requireInput(
    ANNOTATION_SINK_PATH,
    root,
    "bun test --reporter=junit --reporter-outfile=" + JUNIT_REPORT_PATH,
  )
  const junit = requireInput(
    JUNIT_REPORT_PATH,
    root,
    "bun test --reporter=junit --reporter-outfile=" + JUNIT_REPORT_PATH,
  )

  const corpusFiles = discoverCorpusFiles(root)
  const map = reconcile({
    register,
    quarantine,
    records: collectRecords(sink),
    executed: parseJUnitTestCases(junit, root),
    corpusFiles,
    registerSha256: sha256(registerRaw),
  })
  map.corpus.undeclaredCandidates = undeclaredCorpusCandidates(root, corpusFiles)
  return map
}

function main(): number {
  const root = repoRoot()
  const check = process.argv.includes("--check")
  const mapFile = join(root, MAP_PATH)

  const regenerated = regenerateFromDisk(root)
  const next = serializeMap(regenerated)
  const committed = existsSync(mapFile) ? readFileSync(mapFile, "utf8") : null

  const summary =
    `${regenerated.counts.links.total} link(s) ` +
    `(${regenerated.counts.links.asserts} asserts, ` +
    `${regenerated.counts.links.coversPartially} covers-partially), ` +
    `${regenerated.counts.unlinkedScenarios} unlinked scenario(s), ` +
    `${regenerated.counts.unclaimedTests} unclaimed test case(s)`

  if (check) {
    if (committed === next) {
      console.log(`traceability map: PASS — byte-identical; ${summary}.`)
      return 0
    }
    if (committed !== null) {
      const drift = diffMaps(loadTraceabilityMap(committed), regenerated)
      console.error(
        `traceability map: FAIL — ${MAP_PATH} has drifted. ` +
          `+${drift.addedLinks.length} link(s), -${drift.removedLinks.length} link(s), ` +
          `${drift.openedScenarioGaps.length} newly unlinked scenario(s) ` +
          `(${drift.openedScenarioGaps.join(", ") || "none"}), ` +
          `${drift.addedUnclaimedTests.length} newly unclaimed test case(s).`,
      )
      if (drift.lostScenarioLinks.length > 0) {
        console.error(
          "traceability map: scenarios that LOST links — " +
            drift.lostScenarioLinks.map((l) => `${l.id} ${l.before}->${l.after}`).join(", "),
        )
      }
    } else {
      console.error(`traceability map: FAIL — ${MAP_PATH} does not exist.`)
    }
    console.error(
      "Run `bun test --reporter=junit --reporter-outfile=.verification/junit.xml` then " +
        "`bun scripts/verification/reconcile-traceability.ts` and commit the result.",
    )
    return 1
  }

  writeFileSync(mapFile, next, "utf8")
  console.log(`traceability map: wrote ${MAP_PATH} — ${summary}.`)
  if (regenerated.quarantineViolations.length > 0) {
    console.warn(
      `traceability map: ${regenerated.quarantineViolations.length} binding(s) into a quarantined ` +
        "family were REPORTED and NOT committed as links — task 08's gate fails the build on them.",
    )
  }
  if (regenerated.staleAnnotationRecords.length > 0) {
    console.warn(
      `traceability map: ${regenerated.staleAnnotationRecords.length} annotation record(s) name a ` +
        `test case that did not execute. Delete ${ANNOTATION_SINK_PATH} and re-run the suite if ` +
        "these are the residue of a rename.",
    )
  }
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
