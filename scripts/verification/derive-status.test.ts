import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  FROZEN_SOURCE_PATH,
  STATUS_REPORT_PATH,
  assertFrozenSourceUnmodified,
  deriveFromDisk,
  deriveStatus,
  outcomeIndex,
  parseJUnitOutcomes,
  renderReport,
  resolveRunIdentity,
  type DeriveInput,
  type DerivedStatusReport,
  type ExecutedOutcome,
} from "./derive-status"
import {
  MAP_PATH,
  loadTraceabilityMap,
  type TraceabilityLink,
  type TraceabilityMap,
} from "./reconcile-traceability"
import {
  REGISTER_PATH,
  loadScenarioRegister,
  repoRoot,
  serializeRegister,
  type ScenarioEntry,
  type ScenarioRegister,
} from "./register-scenarios"

// F002 task 09 — Derive Scenario Status From Evidence.
//
// Discharges this domain's `004` §2:
//   "Should promote a Scenario to `evidenced` only when an `asserts` link passed in the same run"
//   "Should refuse promotion when only `covers-partially` links exist"
//   "Should refuse promotion when the linked test case did not pass in that run"
//   "Should discard a hand-written `evidenced` marker when status is derived"
//   "Should leave `docs/specs/cognitive_line/004` unmodified when any status is promoted"
// and §1.1 "Should refuse an authored `evidenced` status when the register is loaded" — through
// task 03's own guard, which this file exercises rather than reimplements.

const ROOT = repoRoot()

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex")

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────
//
// Two real repository paths, because the executed-test inventory refuses a file the repository
// does not hold (task 07's `normalizeExecutedFile`) — a synthetic path would be rejected before
// any status could be derived from it.
const FILE_A = "scripts/verification/derive-status.ts"
const FILE_B = "scripts/verification/reconcile-traceability.ts"

const entry = (id: string, status: ScenarioEntry["status"] = "proposed"): ScenarioEntry => ({
  id,
  area: id.split("-")[1] as ScenarioEntry["area"],
  section: "1.1",
  group: null,
  heading: `heading for ${id}`,
  status,
})

const link = (
  scenario: string,
  testFile: string,
  testName: string,
  kind: TraceabilityLink["kind"],
): TraceabilityLink => ({ scenario, testFile, testName, kind })

const registerOf = (scenarios: ScenarioEntry[]): ScenarioRegister => ({
  version: 1,
  policy: "fixture",
  source: { path: FROZEN_SOURCE_PATH, sha256: "fixture-sha", headingCount: scenarios.length },
  scenarios,
})

const mapOf = (links: TraceabilityLink[]): TraceabilityMap =>
  ({
    version: 1,
    policy: "fixture",
    generator: "fixture",
    links,
    scenarios: [],
    gaps: { unlinkedScenarios: [], unclaimedTests: [] },
    quarantineViolations: [],
    staleAnnotationRecords: [],
    recordsOutsideDeclaredCorpus: [],
  }) as unknown as TraceabilityMap

const outcome = (
  file: string,
  test: string,
  result: ExecutedOutcome["outcome"],
): ExecutedOutcome => ({ file, test, outcome: result })

const input = (over: Partial<DeriveInput>): DeriveInput => ({
  register: registerOf([entry("EAP-LIFE-001")]),
  map: mapOf([]),
  outcomes: [],
  run: { runId: "R-1", commit: "c0ffee", junitPath: ".verification/junit.xml", source: "local" },
  mapSha256: "map-sha",
  registerSha256: "register-sha",
  frozenSourceSha256: "frozen-sha",
  ...over,
})

const statusOf = (report: DerivedStatusReport, id: string): string =>
  report.scenarios.find((s) => s.id === id)?.status ?? "<absent>"
const reasonOf = (report: DerivedStatusReport, id: string): string =>
  report.scenarios.find((s) => s.id === id)?.reason ?? "<absent>"

// ── The runner's verdict, not the runner's inventory ──────────────────────────────────────────

describe("The executed-test inventory carries a verdict, not merely an execution", () => {
  test("a bare <testcase> is a pass, a <failure> child is a failure, a <skipped> child is skipped", () => {
    const xml = `<testsuites>
      <testcase name="green" file="${FILE_A}" />
      <testcase name="red" file="${FILE_A}"><failure type="AssertionError" /></testcase>
      <testcase name="todo" file="${FILE_A}"><skipped message="TODO" /></testcase>
    </testsuites>`
    expect(parseJUnitOutcomes(xml, ROOT)).toEqual([
      outcome(FILE_A, "green", "passed"),
      outcome(FILE_A, "red", "failed"),
      outcome(FILE_A, "todo", "skipped"),
    ])
  })

  test("an <error> child is a failure — an uncaught throw proves nothing about the claim", () => {
    const xml = `<testsuites><testcase name="boom" file="${FILE_A}"><error type="Error" /></testcase></testsuites>`
    expect(parseJUnitOutcomes(xml, ROOT)[0]!.outcome).toBe("failed")
  })

  test("two executions of one test case resolve to the worst verdict, never the best", () => {
    const index = outcomeIndex([
      outcome(FILE_A, "flaky", "passed"),
      outcome(FILE_A, "flaky", "failed"),
    ])
    expect(index.get(`${FILE_A} flaky`)).toBe("failed")
  })

  test("a test case the runner never reported has no verdict at all", () => {
    expect(outcomeIndex([]).get(`${FILE_A} absent`)).toBeUndefined()
  })
})

// ── Acceptance 1 — evidenced requires an asserts link that passed in the same run ──────────────

describe("Promotion requires an `asserts` link whose test passed in the evaluated run", () => {
  // 004 §2: "Given a Scenario Identifier with at least one `asserts` link whose test case passed
  //          in Suite Run R at commit C ... the derived report marks the scenario `evidenced` and
  //          names run id R, commit C, and the discharging test references"
  test("one passing `asserts` link promotes the scenario and names run, commit and test case", () => {
    const report = deriveStatus(
      input({
        register: registerOf([entry("EAP-LIFE-001")]),
        map: mapOf([link("EAP-LIFE-001", FILE_A, "proves it", "asserts")]),
        outcomes: [outcome(FILE_A, "proves it", "passed")],
      }),
    )
    const derived = report.scenarios.find((s) => s.id === "EAP-LIFE-001")!
    expect(derived.status).toBe("evidenced")
    expect(derived.runId).toBe("R-1")
    expect(derived.commit).toBe("c0ffee")
    expect(derived.evidence).toEqual([{ testFile: FILE_A, testName: "proves it" }])
    expect(report.counts.evidenced).toBe(1)
  })

  test("a scenario with no link at all stays `proposed`", () => {
    const report = deriveStatus(input({ register: registerOf([entry("EAP-LIFE-001")]) }))
    expect(statusOf(report, "EAP-LIFE-001")).toBe("proposed")
    expect(reasonOf(report, "EAP-LIFE-001")).toBe("unlinked")
  })

  test("a passing test case linked to one scenario promotes no other scenario", () => {
    const report = deriveStatus(
      input({
        register: registerOf([entry("EAP-LIFE-001"), entry("EAP-LIFE-002")]),
        map: mapOf([link("EAP-LIFE-001", FILE_A, "proves it", "asserts")]),
        outcomes: [outcome(FILE_A, "proves it", "passed")],
      }),
    )
    expect(statusOf(report, "EAP-LIFE-002")).toBe("proposed")
  })
})

// ── Acceptance 2 — covers-partially alone never promotes ──────────────────────────────────────

describe("`covers-partially` links never promote, at any multiplicity", () => {
  // 004 §2: "Given a Scenario Identifier with three `covers-partially` links, all of whose test
  //          cases passed ... the scenario remains `proposed` and no partial-link count is
  //          sufficient to promote it"
  test("three passing `covers-partially` links leave the scenario `proposed`", () => {
    const report = deriveStatus(
      input({
        register: registerOf([entry("EAP-HRZN-001")]),
        map: mapOf([
          link("EAP-HRZN-001", FILE_A, "one", "covers-partially"),
          link("EAP-HRZN-001", FILE_A, "two", "covers-partially"),
          link("EAP-HRZN-001", FILE_B, "three", "covers-partially"),
        ]),
        outcomes: [
          outcome(FILE_A, "one", "passed"),
          outcome(FILE_A, "two", "passed"),
          outcome(FILE_B, "three", "passed"),
        ],
      }),
    )
    expect(statusOf(report, "EAP-HRZN-001")).toBe("proposed")
    expect(reasonOf(report, "EAP-HRZN-001")).toBe("covers-partially-only")
    expect(report.scenarios[0]!.coversPartiallyLinks).toBe(3)
    expect(report.scenarios[0]!.assertsLinks).toBe(0)
  })

  test("a hundred passing partial links still do not add up to one `asserts` link", () => {
    const links = Array.from({ length: 100 }, (_, i) =>
      link("EAP-HRZN-001", FILE_A, `partial ${i}`, "covers-partially"),
    )
    const report = deriveStatus(
      input({
        register: registerOf([entry("EAP-HRZN-001")]),
        map: mapOf(links),
        outcomes: links.map((l) => outcome(l.testFile, l.testName, "passed")),
      }),
    )
    expect(statusOf(report, "EAP-HRZN-001")).toBe("proposed")
    expect(report.counts.evidenced).toBe(0)
  })
})

// ── Acceptance 1, the other half — a failing, skipped or absent execution never promotes ──────

describe("An `asserts` link that did not pass in the evaluated run never promotes", () => {
  // 004 §2: "Given an `asserts` link whose test case failed, was skipped, or did not execute in
  //          the evaluated run ... the scenario remains `proposed` and the report records the
  //          absence of a passing execution"
  const cases: [string, ExecutedOutcome[]][] = [
    ["failed", [outcome(FILE_A, "claims it", "failed")]],
    ["skipped", [outcome(FILE_A, "claims it", "skipped")]],
    ["did not execute", []],
  ]

  for (const [label, outcomes] of cases) {
    test(`a linked test case that ${label} leaves the scenario \`proposed\``, () => {
      const report = deriveStatus(
        input({
          register: registerOf([entry("EAP-ADMS-001")]),
          map: mapOf([link("EAP-ADMS-001", FILE_A, "claims it", "asserts")]),
          outcomes,
        }),
      )
      expect(statusOf(report, "EAP-ADMS-001")).toBe("proposed")
      expect(reasonOf(report, "EAP-ADMS-001")).toBe("no-passing-asserts-link")
      const derived = report.scenarios[0]!
      expect(derived.assertsLinks).toBe(1)
      expect(derived.evidence).toEqual([])
      // The absence is recorded, not merely implied by a missing row.
      expect(derived.withheld).toEqual([
        { testFile: FILE_A, testName: "claims it", outcome: label === "did not execute" ? "not-executed" : label },
      ])
    })
  }

  test("one passing `asserts` link promotes even when a sibling `asserts` link failed", () => {
    const report = deriveStatus(
      input({
        register: registerOf([entry("EAP-ADMS-001")]),
        map: mapOf([
          link("EAP-ADMS-001", FILE_A, "green", "asserts"),
          link("EAP-ADMS-001", FILE_B, "red", "asserts"),
        ]),
        outcomes: [outcome(FILE_A, "green", "passed"), outcome(FILE_B, "red", "failed")],
      }),
    )
    // 003 §Section 4: promotion needs *at least one* passing asserting execution. The failing
    // sibling is still reported, so the promotion is not laundered.
    expect(statusOf(report, "EAP-ADMS-001")).toBe("evidenced")
    expect(report.scenarios[0]!.withheld).toEqual([
      { testFile: FILE_B, testName: "red", outcome: "failed" },
    ])
  })
})

// ── The quarantine floor ──────────────────────────────────────────────────────────────────────

describe("A `declared-untestable` scenario is promoted by nothing", () => {
  test("a passing `asserts` link into a quarantined scenario does not promote it", () => {
    const report = deriveStatus(
      input({
        register: registerOf([entry("EAP-QUAR-001", "declared-untestable")]),
        map: mapOf([link("EAP-QUAR-001", FILE_A, "picks an outcome", "asserts")]),
        outcomes: [outcome(FILE_A, "picks an outcome", "passed")],
      }),
    )
    expect(statusOf(report, "EAP-QUAR-001")).toBe("declared-untestable")
    expect(reasonOf(report, "EAP-QUAR-001")).toBe("declared-untestable")
    expect(report.counts.evidenced).toBe(0)
    // The link is a Quarantine Violation; the derivation reports it and defers the build failure
    // to task 08's blocking gate rather than staying silent about it.
    expect(report.quarantinedLinks).toEqual([
      { scenario: "EAP-QUAR-001", testFile: FILE_A, testName: "picks an outcome", kind: "asserts" },
    ])
  })

  test("a retired scenario is not carried into the report at all", () => {
    const retired: ScenarioEntry = { ...entry("EAP-LIFE-009"), retired: true }
    const report = deriveStatus(input({ register: registerOf([entry("EAP-LIFE-001"), retired]) }))
    expect(report.scenarios.map((s) => s.id)).toEqual(["EAP-LIFE-001"])
  })
})

// ── Falsification: the marker can never be more optimistic than the evidence ──────────────────

describe("A hand-authored `evidenced` is discarded, never honoured", () => {
  // 004 §2: "Given a committed derived status report that has been edited by hand to mark a
  //          scenario `evidenced` with no supporting link or run ... the edit is overwritten, the
  //          scenario reverts to `proposed`, and the regeneration diff exposes the falsification"
  test("an `evidenced` status in the register with no evidence reverts to `proposed`", () => {
    const report = deriveStatus(
      input({ register: registerOf([entry("EAP-PERS-001", "evidenced")]) }),
    )
    expect(statusOf(report, "EAP-PERS-001")).toBe("proposed")
    expect(report.unsupportedAuthoredEvidenced).toEqual(["EAP-PERS-001"])
  })

  test("an `evidenced` status backed by real evidence is reported as derived, not as authored", () => {
    const report = deriveStatus(
      input({
        register: registerOf([entry("EAP-PERS-001", "evidenced")]),
        map: mapOf([link("EAP-PERS-001", FILE_A, "proves it", "asserts")]),
        outcomes: [outcome(FILE_A, "proves it", "passed")],
      }),
    )
    expect(statusOf(report, "EAP-PERS-001")).toBe("evidenced")
    expect(report.unsupportedAuthoredEvidenced).toEqual([])
  })

  test("the register's own guard still refuses a hand-authored `evidenced` — this task opens no second door", () => {
    const authored = serializeRegister(registerOf([entry("EAP-PERS-001", "evidenced")]))
    expect(() => loadScenarioRegister(authored)).toThrow(/EAP-PERS-001/)
    expect(() => loadScenarioRegister(authored)).toThrow(/derivation service/)
    // And the derivation door — the one this task uses — is the only one that opens.
    expect(loadScenarioRegister(authored, { writer: "derivation" }).scenarios).toHaveLength(1)
  })

  test("the rendered report states, in the file itself, that it is derived and hand edits are overwritten", () => {
    const rendered = renderReport(deriveStatus(input({})))
    expect(rendered).toContain("DERIVED")
    expect(rendered).toMatch(/never hand-edited|overwritten/i)
  })
})

// ── Acceptance 3 — run identity, and the frozen source stays frozen ───────────────────────────

describe("Every `evidenced` row names its run id and commit", () => {
  test("the rendered report names run id and commit for each promoted scenario", () => {
    const report = deriveStatus(
      input({
        register: registerOf([entry("EAP-LIFE-001")]),
        map: mapOf([link("EAP-LIFE-001", FILE_A, "proves it", "asserts")]),
        outcomes: [outcome(FILE_A, "proves it", "passed")],
      }),
    )
    const rendered = renderReport(report)
    const row = rendered.split("\n").find((line) => line.includes("EAP-LIFE-001"))!
    expect(row).toContain("R-1")
    expect(row).toContain("c0ffee")
    expect(row).toContain("proves it")
  })

  test("a run identity with no commit is refused — an evidenced row with no commit is inadmissible", () => {
    expect(() =>
      deriveStatus(input({ run: { runId: "R-1", commit: "", junitPath: "x", source: "local" } })),
    ).toThrow(/commit/)
  })

  test("a run identity with no run id is refused", () => {
    expect(() =>
      deriveStatus(input({ run: { runId: "", commit: "c0ffee", junitPath: "x", source: "local" } })),
    ).toThrow(/run id/i)
  })

  test("CI run identity comes from the workflow run, a local one from the report's own digest", () => {
    const ci = resolveRunIdentity(
      { GITHUB_RUN_ID: "12345", GITHUB_RUN_ATTEMPT: "2", GITHUB_SHA: "abc123" },
      "<testsuites/>",
      ROOT,
    )
    expect(ci).toMatchObject({ runId: "12345-2", commit: "abc123", source: "ci" })

    const local = resolveRunIdentity({}, "<testsuites/>", ROOT)
    expect(local.source).toBe("local")
    // Stable for an unchanged report: the same suite output must not mint a new run id.
    expect(resolveRunIdentity({}, "<testsuites/>", ROOT).runId).toBe(local.runId)
    expect(local.runId).not.toBe(resolveRunIdentity({}, "<testsuites></testsuites>", ROOT).runId)
  })
})

describe("The frozen predecessor spec is an input and stays byte-identical", () => {
  // 004 §2: "Then docs/specs/cognitive_line/004-open-graph-mcp-test-scenarios.md is byte-identical
  //          to its pre-run content and the promotion lives only in the derived report"
  test("the derivation refuses to publish when the frozen source no longer hashes to the register's record", () => {
    const register = registerOf([entry("EAP-LIFE-001")])
    expect(() => assertFrozenSourceUnmodified("deadbeef", register)).toThrow(/byte-identical/)
    expect(() =>
      assertFrozenSourceUnmodified(register.source.sha256, register),
    ).not.toThrow()
  })

  test("the frozen source on disk still hashes to what the committed register recorded", () => {
    const register = loadScenarioRegister(readFileSync(join(ROOT, REGISTER_PATH), "utf8"), {
      writer: "derivation",
    })
    const frozen = readFileSync(join(ROOT, ...FROZEN_SOURCE_PATH.split("/")), "utf8")
    expect(sha256(frozen)).toBe(register.source.sha256)
  })

  test("the derivation names no write target under the read-only predecessor tree", () => {
    const source = readFileSync(join(ROOT, "scripts", "verification", "derive-status.ts"), "utf8")
    // The frozen path is read; the only write targets are the report and stdout.
    expect(source).not.toMatch(/writeFileSync\([^)]*cognitive_line\//)
    expect(source).not.toMatch(/writeFileSync\([^)]*harness-history/)
  })
})

// ── Against the committed artefacts ───────────────────────────────────────────────────────────

describe("The derivation over the committed register and map", () => {
  const committedMap = (): TraceabilityMap =>
    loadTraceabilityMap(readFileSync(join(ROOT, MAP_PATH), "utf8"))

  test("no more scenarios are promoted than the map holds distinct `asserts` scenarios", () => {
    const map = committedMap()
    const promotable = new Set(
      map.links.filter((l) => l.kind === "asserts").map((l) => l.scenario),
    ).size
    const register = loadScenarioRegister(readFileSync(join(ROOT, REGISTER_PATH), "utf8"), {
      writer: "derivation",
    })
    const report = deriveStatus(
      input({
        register,
        map,
        // Assume the whole corpus passed — the ceiling case.
        outcomes: map.links.map((l) => outcome(l.testFile, l.testName, "passed")),
      }),
    )
    expect(report.counts.evidenced).toBeLessThanOrEqual(promotable)
    expect(report.counts.evidenced + report.counts.proposed + report.counts.declaredUntestable).toBe(
      report.scenarios.length,
    )
  })

  test("the published report holds exactly the scenarios a regeneration promotes", () => {
    const published = join(ROOT, ...STATUS_REPORT_PATH.split("/"))
    expect(existsSync(published)).toBe(true)
    const junit = join(ROOT, ".verification", "junit.xml")
    if (!existsSync(junit)) return // No run in this working tree; the CI gate covers that case.

    const report = deriveFromDisk(ROOT)
    const rendered = readFileSync(published, "utf8")
    const promoted = report.scenarios.filter((s) => s.status === "evidenced").map((s) => s.id)
    // Deliberately not a byte comparison: the report names the commit it was derived at, so
    // committing it necessarily changes the commit it would next name. The invariant that matters
    // is that the published promotion set is exactly the derived one — no row without evidence,
    // and no evidence without a row.
    const listed = [...rendered.matchAll(/^\| (EAP-[A-Z]+-\d{3}) \| evidenced \|/gm)].map((m) => m[1]!)
    expect(listed.sort()).toEqual(promoted.sort())
  })
})
