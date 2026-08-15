#!/usr/bin/env bun
/**
 * F002 task 09 — Derive Scenario Status From Evidence.
 *
 * `PromoteScenarioStatus` (`003` §Section 4): publishes the `[E]`→`[B]` transition as
 * `docs/verification/scenario-status.md`, computed from an `asserts` Traceability Link plus a
 * *passing* execution of that link's test case in the evaluated Suite Run.
 *
 *   bun scripts/verification/derive-status.ts           -> derive and publish the report
 *   bun scripts/verification/derive-status.ts --check   -> fail if the published promotion set is
 *                                                          not what a derivation reproduces
 *
 * ── Why this file exists ──────────────────────────────────────────────────────────────────────
 * `001` §4 SQ4: the `[E]`/`[B]` markers of the predecessor spec are hand-maintained and were stale
 * by roughly seventy scenarios. The invariant this task establishes is that **a marker can never be
 * more optimistic than the evidence** — mechanically, not by discipline. `003` §1: status is
 * "derived, never authored"; `001` §3: "hand-editing the marker is falsification".
 *
 * So status is *computed* here and nowhere else, and the computation reads only two things a human
 * cannot forge in passing: the committed Traceability Map (itself generated, byte-stable, and
 * `--check`ed by task 07) and the runner's own JUnit report for the run being evaluated.
 *
 * ── "Passed in the same run" — the part that is not free ──────────────────────────────────────
 * The annotation sink records that a test case *executed* and what it *claims*; it records nothing
 * about whether the case passed. A test that annotates `asserts` and then fails its expectations
 * still leaves a record behind, and promoting on the record alone would publish precisely the
 * optimistic marker this domain exists to abolish.
 *
 * The verdict therefore comes from the runner, per ADR-0021 — the JUnit report task 07 already
 * requires as its executed-test inventory, read here for one attribute more: whether each
 * `<testcase>` carries a `<failure>`, an `<error>`, or a `<skipped>` child.
 *
 *   bun test --reporter=junit --reporter-outfile=.verification/junit.xml
 *
 * `bun run verify` does **not** pass those flags today, and `package.json` and `.github/workflows/
 * ci.yml` are outside this task's scope. That wiring is recorded as a `pendingCiGates` entry for
 * task 20. Until it lands, this script refuses to run rather than deriving from an absent
 * inventory: "no passing execution found" and "no run was looked at" must never be the same output.
 *
 * ── What this file is NOT allowed to do ───────────────────────────────────────────────────────
 * It does not write `docs/verification/scenario-register.json`. The register is the identity store;
 * `evidenced` lives in *this* report, beside it. It does not relax, bypass, or duplicate
 * `loadScenarioRegister`'s hand-authored-`evidenced` guard — it loads through that guard's one
 * legitimate door, `{ writer: "derivation" }`, and then *ignores* any `evidenced` it finds there:
 * an authored one has no evidence behind it and is reverted to `proposed` and named under
 * `unsupportedAuthoredEvidenced`, which is what makes the falsification attempt visible in the
 * regeneration diff instead of invisible in a committed file.
 *
 * `docs/specs/cognitive_line/**` is a read-only input. This script reads the frozen `004` for one
 * purpose only — to check that it still hashes to what the register recorded — and refuses to
 * publish if it does not.
 */

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import {
  JUNIT_REPORT_PATH,
  MAP_PATH,
  decodeXmlAttribute,
  loadTraceabilityMap,
  normalizeExecutedFile,
  type LinkKind,
  type TraceabilityMap,
} from "./reconcile-traceability"
import {
  REGISTER_PATH,
  SOURCE_PATH,
  loadScenarioRegister,
  repoRoot,
  type ScenarioRegister,
} from "./register-scenarios"

export const STATUS_REPORT_PATH = "docs/verification/scenario-status.md"

/** The frozen predecessor spec. Read to be hashed; never written, never edited. */
export const FROZEN_SOURCE_PATH = SOURCE_PATH

/**
 * Bindings task 07 judged as probably overclaiming `asserts`. A link's kind is authored in the test
 * annotation, outside this task's scope, so they are **not** silently corrected here: they promote,
 * and the report says out loud that those promotions rest on bindings under review.
 */
export const BINDINGS_UNDER_REVIEW: Readonly<Record<string, string>> = {
  "EAP-PERS-004": "task 07: the asserting case exercises persistence wiring, not the scenario's claim in full",
  "EAP-RECL-004": "task 07: the asserting case covers the recall path partially; `asserts` looks generous",
  "EAP-LIFE-001": "task 07: weakly judged — the binding may be `covers-partially` in substance",
}

// ── The runner's verdict ──────────────────────────────────────────────────────────────────────

export type TestOutcome = "passed" | "failed" | "skipped"

export interface ExecutedOutcome {
  file: string
  test: string
  outcome: TestOutcome
}

const TESTCASE = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g
const ATTRIBUTE = (name: string): RegExp => new RegExp(`\\b${name}="([^"]*)"`)

/**
 * Every test case the runner reported, with its verdict. A bare `<testcase>` passed; a `<failure>`
 * or `<error>` child did not; a `<skipped>` child (which is also how `test.todo` is reported) never
 * ran its body and so proves nothing at all.
 *
 * Task 07's parser drops skipped cases, because a case that ran nothing cannot be an unclaimed test
 * and reporting it would invent a Traceability Gap. Here the opposite is true: a skipped case linked
 * as `asserts` must be *seen*, so that "the scenario's only asserting test is skipped" is reported
 * rather than looking identical to "the scenario has no link".
 */
export function parseJUnitOutcomes(xml: string, root: string = repoRoot()): ExecutedOutcome[] {
  const outcomes: ExecutedOutcome[] = []
  for (const match of xml.matchAll(TESTCASE)) {
    const attributes = match[1]!
    const body = match[3] ?? ""
    const name = ATTRIBUTE("name").exec(attributes)?.[1]
    const file = ATTRIBUTE("file").exec(attributes)?.[1]
    if (name === undefined || file === undefined) {
      throw new Error(
        `derive-status: a <testcase> in the JUnit report carries no ${
          name === undefined ? "name" : "file"
        } attribute, so its verdict cannot be attributed to a test case by file plus test name.`,
      )
    }
    const outcome: TestOutcome = /<(failure|error)\b/.test(body)
      ? "failed"
      : /<skipped\b/.test(body)
        ? "skipped"
        : "passed"
    outcomes.push({
      file: normalizeExecutedFile(decodeXmlAttribute(file), root),
      test: decodeXmlAttribute(name),
      outcome,
    })
  }
  return outcomes
}

const RANK: Record<TestOutcome, number> = { failed: 0, skipped: 1, passed: 2 }

export const outcomeKey = (file: string, test: string): string => `${file} ${test}`

/**
 * File+name to verdict, resolving repeated executions to the **worst** verdict observed. A retried
 * or re-run case that failed once and passed once has not proved its claim: taking the best verdict
 * would turn a known flake into evidence, which is the same lie as an authored marker, arrived at
 * by arithmetic.
 */
export function outcomeIndex(outcomes: readonly ExecutedOutcome[]): Map<string, TestOutcome> {
  const index = new Map<string, TestOutcome>()
  for (const entry of outcomes) {
    const key = outcomeKey(entry.file, entry.test)
    const existing = index.get(key)
    if (existing === undefined || RANK[entry.outcome] < RANK[existing]) index.set(key, entry.outcome)
  }
  return index
}

// ── Run identity ──────────────────────────────────────────────────────────────────────────────

export interface SuiteRunIdentity {
  runId: string
  commit: string
  junitPath: string
  source: "ci" | "local"
}

function headCommit(root: string): string {
  try {
    const dotGit = join(root, ".git")
    const gitDir = statSync(dotGit).isDirectory()
      ? dotGit
      : resolve(dirname(dotGit), readFileSync(dotGit, "utf8").trim().replace(/^gitdir:\s*/, ""))
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim()
    if (/^[0-9a-f]{40}$/i.test(head)) return head
    const ref = head.match(/^ref:\s+(.+)$/)?.[1]
    if (ref) {
      const looseRef = join(gitDir, ...ref.split("/"))
      if (existsSync(looseRef)) {
        const commit = readFileSync(looseRef, "utf8").trim()
        if (/^[0-9a-f]{40}$/i.test(commit)) return commit
      }
      const packedRefs = join(gitDir, "packed-refs")
      if (existsSync(packedRefs)) {
        const packed = readFileSync(packedRefs, "utf8")
          .split(/\r?\n/)
          .find((line) => line.endsWith(` ${ref}`))
          ?.split(" ")[0]
        if (packed && /^[0-9a-f]{40}$/i.test(packed)) return packed
      }
    }
  } catch {
    // Fall through to the Git executable for unusual repository layouts.
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  } catch {
    throw new Error(
      "derive-status: no commit could be resolved. Every `evidenced` row names the commit its " +
        "evidence was produced at (acceptance 3); a promotion with no commit is unfalsifiable and " +
        "is therefore not published. Set GITHUB_SHA or run inside a git working tree.",
    )
  }
}

/**
 * The identity of the Suite Run being evaluated. In CI it is the workflow run — the same identity
 * the uploaded artefacts carry. Locally there is no run id to borrow, so it is derived from the
 * digest of the runner's own report: stable for an unchanged report (regenerating twice does not
 * mint two run ids) and necessarily different for a different one.
 */
export function resolveRunIdentity(
  env: Record<string, string | undefined>,
  junitXml: string,
  root: string = repoRoot(),
): SuiteRunIdentity {
  const digest = createHash("sha256").update(junitXml).digest("hex").slice(0, 12)
  const ciRun = env.GITHUB_RUN_ID
  if (ciRun !== undefined && ciRun.length > 0) {
    return {
      runId: `${ciRun}-${env.GITHUB_RUN_ATTEMPT ?? "1"}`,
      commit: env.GITHUB_SHA ?? headCommit(root),
      junitPath: JUNIT_REPORT_PATH,
      source: "ci",
    }
  }
  return {
    runId: `local-${digest}`,
    commit: env.GITHUB_SHA ?? headCommit(root),
    junitPath: JUNIT_REPORT_PATH,
    source: "local",
  }
}

// ── The derivation ────────────────────────────────────────────────────────────────────────────

export type DerivedStatus = "evidenced" | "proposed" | "declared-untestable"

export type NotPromotedReason =
  | "evidenced"
  | "declared-untestable"
  | "unlinked"
  | "covers-partially-only"
  | "no-passing-asserts-link"

export interface TestCaseRef {
  testFile: string
  testName: string
}

/** An `asserts` link that did not earn its promotion, with the reason it did not. */
export interface WithheldEvidence extends TestCaseRef {
  outcome: "failed" | "skipped" | "not-executed"
}

export interface QuarantinedLink extends TestCaseRef {
  scenario: string
  kind: LinkKind
}

export interface DerivedScenarioStatus {
  id: string
  area: string
  heading: string
  status: DerivedStatus
  reason: NotPromotedReason
  assertsLinks: number
  coversPartiallyLinks: number
  /** The passing asserting executions that promoted it. Empty for everything not `evidenced`. */
  evidence: TestCaseRef[]
  withheld: WithheldEvidence[]
  /** Named only on a promotion: evidence without a run and a commit is not evidence. */
  runId: string | null
  commit: string | null
  bindingUnderReview: string | null
}

export interface DeriveInput {
  register: ScenarioRegister
  map: TraceabilityMap
  outcomes: readonly ExecutedOutcome[]
  run: SuiteRunIdentity
  mapSha256: string
  registerSha256: string
  frozenSourceSha256: string
}

export interface DerivedStatusReport {
  version: number
  run: SuiteRunIdentity
  inputs: {
    register: { path: string; sha256: string }
    map: { path: string; sha256: string }
    frozenSource: { path: string; sha256: string }
    executedTests: { path: string; reportedCases: number; passed: number; failed: number; skipped: number }
  }
  counts: {
    scenarios: number
    evidenced: number
    proposed: number
    declaredUntestable: number
    unlinked: number
    coversPartiallyOnly: number
    noPassingAssertsLink: number
  }
  scenarios: DerivedScenarioStatus[]
  /** Register entries carrying `evidenced` that this derivation does not support. */
  unsupportedAuthoredEvidenced: string[]
  /** Links into a `declared-untestable` scenario — reported here, failed by task 08's gate. */
  quarantinedLinks: QuarantinedLink[]
}

const refOrder = (a: TestCaseRef, b: TestCaseRef): number =>
  a.testFile.localeCompare(b.testFile) || a.testName.localeCompare(b.testName)

/**
 * `PromoteScenarioStatus`. Pure: the register, the map, one run's verdicts in, a report out. Every
 * refusal to promote is recorded with its reason, because a scenario missing from the evidenced
 * list and a scenario nobody looked at are otherwise the same silence.
 */
export function deriveStatus(input: DeriveInput): DerivedStatusReport {
  const { register, map, run } = input
  if (run.runId.trim().length === 0) {
    throw new Error(
      "derive-status: the evaluated Suite Run has no run id. Acceptance 3 requires every " +
        "`evidenced` row to name the run its evidence came from, so nothing is published without one.",
    )
  }
  if (run.commit.trim().length === 0) {
    throw new Error(
      "derive-status: the evaluated Suite Run has no commit. An `evidenced` row that names no " +
        "commit cannot be re-checked against the code that produced it and is inadmissible.",
    )
  }

  const verdicts = outcomeIndex(input.outcomes)
  const byScenario = new Map<string, typeof map.links>()
  for (const link of map.links) {
    const slot = byScenario.get(link.scenario)
    if (slot) slot.push(link)
    else byScenario.set(link.scenario, [link])
  }

  const scenarios: DerivedScenarioStatus[] = []
  const unsupportedAuthoredEvidenced: string[] = []
  const quarantinedLinks: QuarantinedLink[] = []

  for (const entry of register.scenarios) {
    if (entry.retired === true) continue
    const links = byScenario.get(entry.id) ?? []

    // The quarantine floor. `001` §5 rule 2: a Traceability Link into a Declared Untestable
    // Scenario is a Quarantine Violation by construction, so it is reported — never consumed as
    // evidence, and never netted off against the promotion it would otherwise justify.
    if (entry.status === "declared-untestable") {
      for (const link of links) {
        quarantinedLinks.push({
          scenario: link.scenario,
          testFile: link.testFile,
          testName: link.testName,
          kind: link.kind,
        })
      }
      scenarios.push({
        id: entry.id,
        area: entry.area,
        heading: entry.heading,
        status: "declared-untestable",
        reason: "declared-untestable",
        assertsLinks: links.filter((l) => l.kind === "asserts").length,
        coversPartiallyLinks: links.filter((l) => l.kind === "covers-partially").length,
        evidence: [],
        withheld: [],
        runId: null,
        commit: null,
        bindingUnderReview: null,
      })
      continue
    }

    const asserting = links.filter((link) => link.kind === "asserts")
    const evidence: TestCaseRef[] = []
    const withheld: WithheldEvidence[] = []
    for (const link of asserting) {
      const verdict = verdicts.get(outcomeKey(link.testFile, link.testName))
      if (verdict === "passed") {
        evidence.push({ testFile: link.testFile, testName: link.testName })
        continue
      }
      withheld.push({
        testFile: link.testFile,
        testName: link.testName,
        outcome: verdict === undefined ? "not-executed" : verdict,
      })
    }

    const coversPartiallyLinks = links.length - asserting.length
    const status: DerivedStatus = evidence.length > 0 ? "evidenced" : "proposed"
    const reason: NotPromotedReason =
      status === "evidenced"
        ? "evidenced"
        : asserting.length > 0
          ? "no-passing-asserts-link"
          : coversPartiallyLinks > 0
            ? "covers-partially-only"
            : "unlinked"

    // The falsification check. The register may carry `evidenced` only because the derivation
    // wrote it in an earlier run — or because someone typed it. Either way it is not consulted:
    // the status below is computed, and a claim this run cannot support is named here so the
    // regeneration diff exposes it.
    if (entry.status === "evidenced" && status !== "evidenced") {
      unsupportedAuthoredEvidenced.push(entry.id)
    }

    scenarios.push({
      id: entry.id,
      area: entry.area,
      heading: entry.heading,
      status,
      reason,
      assertsLinks: asserting.length,
      coversPartiallyLinks,
      evidence: evidence.sort(refOrder),
      withheld: withheld.sort(refOrder),
      runId: status === "evidenced" ? run.runId : null,
      commit: status === "evidenced" ? run.commit : null,
      bindingUnderReview:
        status === "evidenced" ? (BINDINGS_UNDER_REVIEW[entry.id] ?? null) : null,
    })
  }

  scenarios.sort((a, b) => a.id.localeCompare(b.id))

  const counted = (predicate: (s: DerivedScenarioStatus) => boolean): number =>
    scenarios.filter(predicate).length

  return {
    version: 1,
    run,
    inputs: {
      register: { path: REGISTER_PATH, sha256: input.registerSha256 },
      map: { path: MAP_PATH, sha256: input.mapSha256 },
      frozenSource: { path: FROZEN_SOURCE_PATH, sha256: input.frozenSourceSha256 },
      executedTests: {
        path: run.junitPath,
        reportedCases: verdicts.size,
        passed: [...verdicts.values()].filter((v) => v === "passed").length,
        failed: [...verdicts.values()].filter((v) => v === "failed").length,
        skipped: [...verdicts.values()].filter((v) => v === "skipped").length,
      },
    },
    counts: {
      scenarios: scenarios.length,
      evidenced: counted((s) => s.status === "evidenced"),
      proposed: counted((s) => s.status === "proposed"),
      declaredUntestable: counted((s) => s.status === "declared-untestable"),
      unlinked: counted((s) => s.reason === "unlinked"),
      coversPartiallyOnly: counted((s) => s.reason === "covers-partially-only"),
      noPassingAssertsLink: counted((s) => s.reason === "no-passing-asserts-link"),
    },
    scenarios,
    unsupportedAuthoredEvidenced: unsupportedAuthoredEvidenced.sort(),
    quarantinedLinks: quarantinedLinks.sort(
      (a, b) => a.scenario.localeCompare(b.scenario) || refOrder(a, b),
    ),
  }
}

// ── The frozen input ──────────────────────────────────────────────────────────────────────────

/**
 * Acceptance 3's other half. The register recorded the digest of `004` at seeding time; if the file
 * on disk no longer hashes to it, something wrote into the read-only predecessor tree and no report
 * derived from it may be published.
 */
export function assertFrozenSourceUnmodified(
  observedSha256: string,
  register: ScenarioRegister,
): void {
  if (observedSha256 === register.source.sha256) return
  throw new Error(
    `derive-status: ${FROZEN_SOURCE_PATH} is not byte-identical to the content ` +
      `${REGISTER_PATH} was seeded from (recorded ${register.source.sha256}, observed ` +
      `${observedSha256}). The predecessor spec is a read-only input and a promotion derived from ` +
      "a modified one would be evidence about a document nobody agreed to. Nothing was published.",
  )
}

// ── Rendering ─────────────────────────────────────────────────────────────────────────────────

const REPORT_POLICY = [
  "**DERIVED — never hand-edited.** This file is generated by",
  "`scripts/verification/derive-status.ts` from `docs/verification/traceability-map.json` and the",
  "runner's own JUnit report for one Suite Run. An edit here is overwritten by the next",
  "regeneration and reported by `--check`. A scenario reaches `evidenced` only by holding at least",
  "one `asserts` Traceability Link whose test case **passed in the run named below**;",
  "`covers-partially` links never promote, at any multiplicity, and a `declared-untestable`",
  "scenario is promoted by nothing. `docs/specs/cognitive_line/004-open-graph-mcp-test-scenarios.md`",
  "is a read-only input: the `[E]`→`[B]` transition lives here, beside the Scenario Register, and",
  "never as an edit to that spec.",
].join("\n")

const cell = (text: string): string => text.replace(/\|/g, "\\|")

const refs = (list: readonly TestCaseRef[]): string =>
  list.length === 0 ? "—" : list.map((r) => `${r.testFile} :: ${r.testName}`).join("<br>")

export function renderReport(report: DerivedStatusReport): string {
  const { counts, inputs, run } = report
  const lines: string[] = [
    "# Derived Scenario Status",
    "",
    REPORT_POLICY,
    "",
    "## Run",
    "",
    `| field | value |`,
    `|---|---|`,
    `| run id | \`${run.runId}\` |`,
    `| commit | \`${run.commit}\` |`,
    `| run identity source | ${run.source} |`,
    `| executed-test inventory | \`${inputs.executedTests.path}\` — ${inputs.executedTests.reportedCases} case(s): ${inputs.executedTests.passed} passed, ${inputs.executedTests.failed} failed, ${inputs.executedTests.skipped} skipped |`,
    `| traceability map | \`${inputs.map.path}\` sha256 \`${inputs.map.sha256}\` |`,
    `| scenario register | \`${inputs.register.path}\` sha256 \`${inputs.register.sha256}\` |`,
    `| frozen source (read-only) | \`${inputs.frozenSource.path}\` sha256 \`${inputs.frozenSource.sha256}\` — unmodified |`,
    "",
    "## Summary",
    "",
    `| status | scenarios |`,
    `|---|---:|`,
    `| \`evidenced\` | ${counts.evidenced} |`,
    `| \`proposed\` — an \`asserts\` link exists but no passing execution | ${counts.noPassingAssertsLink} |`,
    `| \`proposed\` — \`covers-partially\` links only | ${counts.coversPartiallyOnly} |`,
    `| \`proposed\` — no link at all | ${counts.unlinked} |`,
    `| \`declared-untestable\` (quarantined; promotable by nothing) | ${counts.declaredUntestable} |`,
    `| **total** | **${counts.scenarios}** |`,
    "",
    "## Status by Scenario Identifier",
    "",
    "`run` and `commit` are populated only where evidence exists — an `evidenced` row with no run",
    "or no commit is inadmissible and is never published.",
    "",
    "| scenario | status | reason | asserts | covers-partially | run | commit | evidence (passing asserting executions) |",
    "|---|---|---|---:|---:|---|---|---|",
  ]

  for (const scenario of report.scenarios) {
    lines.push(
      `| ${scenario.id} | ${scenario.status} | ${scenario.reason} | ${scenario.assertsLinks} | ` +
        `${scenario.coversPartiallyLinks} | ${scenario.runId ?? "—"} | ${scenario.commit ?? "—"} | ` +
        `${cell(refs(scenario.evidence))} |`,
    )
  }

  const withheld = report.scenarios.filter((s) => s.withheld.length > 0)
  lines.push("", "## Withheld Evidence", "")
  if (withheld.length === 0) {
    lines.push("No `asserts` link failed, was skipped, or went unexecuted in this run.")
  } else {
    lines.push(
      "An `asserts` link whose execution did not pass. Recorded so that the absence of a passing",
      "execution is visible rather than inferred from a missing row.",
      "",
      "| scenario | derived status | test case | outcome |",
      "|---|---|---|---|",
    )
    for (const scenario of withheld) {
      for (const ref of scenario.withheld) {
        lines.push(
          `| ${scenario.id} | ${scenario.status} | ${cell(`${ref.testFile} :: ${ref.testName}`)} | ${ref.outcome} |`,
        )
      }
    }
  }

  const reviewed = report.scenarios.filter((s) => s.bindingUnderReview !== null)
  lines.push("", "## Promotions Resting on Bindings Under Review", "")
  if (reviewed.length === 0) {
    lines.push("None promoted in this run.")
  } else {
    lines.push(
      "A link's kind is authored in the test annotation, outside this task's scope, so these are",
      "**not** silently corrected here: they promoted, and the reason to doubt them is published",
      "alongside the promotion rather than filed away.",
      "",
      "| scenario | concern |",
      "|---|---|",
      ...reviewed.map((s) => `| ${s.id} | ${cell(s.bindingUnderReview!)} |`),
    )
  }

  lines.push("", "## Unsupported `evidenced` Claims Discarded", "")
  if (report.unsupportedAuthoredEvidenced.length === 0) {
    lines.push("None. No `evidenced` status was found that this run's evidence does not support.")
  } else {
    lines.push(
      "These carried `evidenced` in the Scenario Register with no passing `asserts` link in this",
      "run. Status is derived, never authored: each has been reverted to `proposed` above.",
      "",
      ...report.unsupportedAuthoredEvidenced.map((id) => `- \`${id}\``),
    )
  }

  lines.push("", "## Links Into Quarantined Scenarios", "")
  if (report.quarantinedLinks.length === 0) {
    lines.push("None. No test case discharges a `declared-untestable` Scenario Identifier.")
  } else {
    lines.push(
      "A Traceability Link into a Declared Untestable Scenario is a Quarantine Violation by",
      "construction (`001` §5 rule 2). It promotes nothing here and fails the build at task 08's",
      "blocking gate.",
      "",
      "| scenario | kind | test case |",
      "|---|---|---|",
      ...report.quarantinedLinks.map(
        (l) => `| ${l.scenario} | ${l.kind} | ${cell(`${l.testFile} :: ${l.testName}`)} |`,
      ),
    )
  }

  lines.push("")
  return lines.join("\n")
}

// ── Reading the inputs from disk ──────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

export function deriveFromDisk(
  root: string,
  env: Record<string, string | undefined> = process.env,
): DerivedStatusReport {
  const registerRaw = readFileSync(join(root, ...REGISTER_PATH.split("/")), "utf8")
  // The one legitimate door through task 03's guard. This task opens no second one.
  const register = loadScenarioRegister(registerRaw, { writer: "derivation" })

  const frozenRaw = readFileSync(join(root, ...FROZEN_SOURCE_PATH.split("/")), "utf8")
  assertFrozenSourceUnmodified(sha256(frozenRaw), register)

  const mapRaw = readFileSync(join(root, ...MAP_PATH.split("/")), "utf8")
  const map = loadTraceabilityMap(mapRaw)

  const junitFile = join(root, ...JUNIT_REPORT_PATH.split("/"))
  if (!existsSync(junitFile)) {
    throw new Error(
      `derive-status: ${JUNIT_REPORT_PATH} is missing, so no Suite Run verdict is available. ` +
        "Promotion requires a *passing* execution, which the annotation sink does not record; " +
        'deriving without the runner\'s report would make "no passing execution" and "no run was ' +
        'looked at" the same output. Produce it with:\n  bun test --reporter=junit ' +
        `--reporter-outfile=${JUNIT_REPORT_PATH}`,
    )
  }
  const junitXml = readFileSync(junitFile, "utf8")

  return deriveStatus({
    register,
    map,
    outcomes: parseJUnitOutcomes(junitXml, root),
    run: resolveRunIdentity(env, junitXml, root),
    mapSha256: sha256(mapRaw),
    registerSha256: sha256(registerRaw),
    frozenSourceSha256: sha256(frozenRaw),
  })
}

/** The promotion set of a published report — the claim a regeneration has to reproduce. */
export function publishedPromotions(markdown: string): string[] {
  return [...markdown.matchAll(/^\| (EAP-[A-Z]+-\d{3}) \| evidenced \|/gm)]
    .map((match) => match[1]!)
    .sort()
}

function main(): number {
  const root = repoRoot()
  const check = process.argv.includes("--check")
  const reportFile = join(root, ...STATUS_REPORT_PATH.split("/"))

  const report = deriveFromDisk(root)
  const rendered = renderReport(report)
  const derived = report.scenarios
    .filter((scenario) => scenario.status === "evidenced")
    .map((scenario) => scenario.id)
    .sort()

  const summary =
    `${report.counts.evidenced} evidenced, ${report.counts.noPassingAssertsLink} with an ` +
    `asserts link but no passing execution, ${report.counts.coversPartiallyOnly} ` +
    `covers-partially only, ${report.counts.unlinked} unlinked, ` +
    `${report.counts.declaredUntestable} declared-untestable`

  if (check) {
    if (!existsSync(reportFile)) {
      console.error(`derived status: FAIL — ${STATUS_REPORT_PATH} does not exist.`)
      return 1
    }
    // Deliberately the promotion set and not the bytes: the report names the commit it was derived
    // at, so committing it changes the commit the next derivation would name. What must never drift
    // is the claim — a published `evidenced` with no evidence, or evidence with no published row.
    const published = publishedPromotions(readFileSync(reportFile, "utf8"))
    const invented = published.filter((id) => !derived.includes(id))
    const missing = derived.filter((id) => !published.includes(id))
    if (invented.length === 0 && missing.length === 0) {
      console.log(`derived status: PASS — ${summary}.`)
      return 0
    }
    if (invented.length > 0) {
      console.error(
        `derived status: FAIL — ${STATUS_REPORT_PATH} publishes ${invented.length} scenario(s) as ` +
          `evidenced that this run's evidence does not support: ${invented.join(", ")}. A marker ` +
          "may never be more optimistic than the evidence.",
      )
    }
    if (missing.length > 0) {
      console.error(
        `derived status: FAIL — ${missing.length} scenario(s) are evidenced by this run but absent ` +
          `from ${STATUS_REPORT_PATH}: ${missing.join(", ")}. Regenerate and commit.`,
      )
    }
    return 1
  }

  writeFileSync(reportFile, rendered, "utf8")
  console.log(`derived status: wrote ${STATUS_REPORT_PATH} — ${summary}.`)
  if (report.unsupportedAuthoredEvidenced.length > 0) {
    console.warn(
      `derived status: ${report.unsupportedAuthoredEvidenced.length} unsupported \`evidenced\` ` +
        `claim(s) discarded — ${report.unsupportedAuthoredEvidenced.join(", ")}.`,
    )
  }
  if (report.quarantinedLinks.length > 0) {
    console.warn(
      `derived status: ${report.quarantinedLinks.length} link(s) into a quarantined Scenario were ` +
        "reported and promoted nothing; task 08's gate fails the build on them.",
    )
  }
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
