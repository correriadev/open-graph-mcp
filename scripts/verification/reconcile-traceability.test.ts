/**
 * F002 task 07 — the Bidirectional Traceability Map.
 *
 * Every case below is one `#####` scenario of
 * `docs/specs/cognitive_line_test_automation/004-open-graph-mcp-test-scenarios.md`, named in the
 * comment above it. Nothing here invents a scenario.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { loadQuarantine, QUARANTINE_PATH, type QuarantineDocument } from "./quarantine"
import {
  loadScenarioRegister,
  REGISTER_PATH,
  repoRoot,
  type ScenarioEntry,
  type ScenarioRegister,
} from "./register-scenarios"
import {
  buildLinks,
  decodeXmlAttribute,
  diffMaps,
  discoverCorpusFiles,
  distinctAnnotationRecords,
  loadTraceabilityMap,
  MAP_PATH,
  normalizeExecutedFile,
  parseJUnitTestCases,
  reconcile,
  serializeMap,
  type AnnotationRecordLike,
  type ExecutedTestCase,
  type ReconcileInput,
} from "./reconcile-traceability"

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────

function entry(id: string, over: Partial<ScenarioEntry> = {}): ScenarioEntry {
  return {
    id,
    area: id.split("-")[1] as ScenarioEntry["area"],
    section: "1.1",
    group: null,
    heading: `Heading for ${id}`,
    status: "proposed",
    ...over,
  }
}

function register(...entries: ScenarioEntry[]): ScenarioRegister {
  return {
    version: 1,
    policy: "fixture",
    source: { path: "fixture.md", sha256: "0".repeat(64), headingCount: entries.length },
    scenarios: entries,
  }
}

function record(
  file: string,
  name: string,
  scenarios: { id: string; kind: "asserts" | "covers-partially" }[],
  declaredUntestable: string[] = [],
): AnnotationRecordLike {
  return {
    file,
    test: name,
    scenarios,
    items: [],
    defects: [],
    declaredUntestable,
    pid: 1,
    emittedAt: "2026-01-01T00:00:00.000Z",
  }
}

const emptyQuarantine: QuarantineDocument = { version: 1, policy: "fixture", families: [] }

function input(over: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    register: register(entry("EAP-LIFE-001")),
    quarantine: emptyQuarantine,
    records: [],
    executed: [],
    corpusFiles: [],
    registerSha256: "a".repeat(64),
    ...over,
  }
}

const executed = (file: string, name: string): ExecutedTestCase => ({ file, test: name })

// ── 004 §1.1 Traceability Map ─────────────────────────────────────────────────────────────────

describe("Traceability Map — gaps in both directions", () => {
  // 004 §1.1 "Should report an unlinked Scenario as a Traceability Gap when no test case discharges it"
  test("reports a proposed scenario that no annotation names in the unlinked-scenario gap list", () => {
    const map = reconcile(
      input({ register: register(entry("EAP-LIFE-001"), entry("EAP-LIFE-002")) }),
    )

    expect(map.gaps.unlinkedScenarios.map((gap) => gap.id)).toEqual([
      "EAP-LIFE-001",
      "EAP-LIFE-002",
    ])
    expect(map.gaps.unlinkedScenarios[0]).toMatchObject({
      id: "EAP-LIFE-001",
      area: "LIFE",
      heading: "Heading for EAP-LIFE-001",
    })
    expect(map.counts.unlinkedScenarios).toBe(2)
  })

  // 004 §1.1 "Should report an unclaimed test case as a Traceability Gap when it discharges no Scenario"
  test("reports an executed corpus test case that emitted no annotation, in a separate list, by file and test name", () => {
    const file = "packages/mcp-server/test/recall.test.ts"
    const map = reconcile(
      input({
        corpusFiles: [file],
        records: [record(file, "claims a scenario", [{ id: "EAP-LIFE-001", kind: "asserts" }])],
        executed: [executed(file, "claims a scenario"), executed(file, "claims nothing")],
      }),
    )

    expect(map.gaps.unclaimedTests).toEqual([{ testFile: file, testName: "claims nothing" }])
    // Separate lists: the unclaimed test is not mixed into the scenario direction.
    expect(map.gaps.unlinkedScenarios).toEqual([])
    expect(Object.keys(map.gaps)).toEqual(["unlinkedScenarios", "unclaimedTests"])
  })

  test("counts a test case outside the declared corpus as neither claimed nor unclaimed", () => {
    const corpus = "packages/mcp-server/test/recall.test.ts"
    const map = reconcile(
      input({
        corpusFiles: [corpus],
        executed: [executed("packages/mcp-server/test/transport.test.ts", "not EAP")],
      }),
    )

    expect(map.gaps.unclaimedTests).toEqual([])
    expect(map.corpus.testCaseCount).toBe(0)
  })

  // 004 §1.1 "Should distinguish an `asserts` link from a `covers-partially` link when both target one Scenario"
  test("records all three links and reports the two kinds distinctly, never summed", () => {
    const files = ["a.test.ts", "b.test.ts", "c.test.ts"]
    const map = reconcile(
      input({
        corpusFiles: files,
        records: [
          record(files[0]!, "one", [{ id: "EAP-LIFE-001", kind: "asserts" }]),
          record(files[1]!, "two", [{ id: "EAP-LIFE-001", kind: "covers-partially" }]),
          record(files[2]!, "three", [{ id: "EAP-LIFE-001", kind: "covers-partially" }]),
        ],
        executed: [executed(files[0]!, "one"), executed(files[1]!, "two"), executed(files[2]!, "three")],
      }),
    )

    expect(map.links).toHaveLength(3)
    expect(map.counts.links).toEqual({ asserts: 1, coversPartially: 2, total: 3 })
    expect(map.scenarios).toEqual([
      { id: "EAP-LIFE-001", assertsLinks: 1, coversPartiallyLinks: 2, coverage: "asserts" },
    ])
    // Never summed into one coverage count.
    expect(map.counts).not.toHaveProperty("coverageCount")
  })

  test("marks a scenario carrying only covers-partially links as covers-partially-only, never as asserts", () => {
    const file = "a.test.ts"
    const map = reconcile(
      input({
        corpusFiles: [file],
        records: [record(file, "partial", [{ id: "EAP-LIFE-001", kind: "covers-partially" }])],
        executed: [executed(file, "partial")],
      }),
    )

    expect(map.scenarios[0]).toEqual({
      id: "EAP-LIFE-001",
      assertsLinks: 0,
      coversPartiallyLinks: 1,
      coverage: "covers-partially-only",
    })
    expect(map.counts.scenariosWithAssertsLink).toBe(0)
    expect(map.counts.scenariosCoveredPartiallyOnly).toBe(1)
    // A partially covered scenario is linked, so it is not a gap — but it is not evidence either.
    expect(map.gaps.unlinkedScenarios).toEqual([])
  })

  // 004 §1.1 "Should name the asserting test case by file and test name when a link is materialised"
  test("carries file plus test name on every materialised link", () => {
    const file = "packages/graph-core/test/horizon.test.ts"
    const map = reconcile(
      input({
        corpusFiles: [file],
        records: [record(file, "names its case", [{ id: "EAP-LIFE-001", kind: "asserts" }])],
        executed: [executed(file, "names its case")],
      }),
    )

    expect(map.links[0]).toEqual({
      scenario: "EAP-LIFE-001",
      testFile: file,
      testName: "names its case",
      kind: "asserts",
    })
  })

  test("rejects a committed link that identifies only a file or a suite", () => {
    const base = loadTraceabilityMap(serializeMap(reconcile(input())))
    const raw = (links: unknown[]): string =>
      JSON.stringify({ ...base, links }, null, 2)

    expect(() =>
      loadTraceabilityMap(
        raw([{ scenario: "EAP-LIFE-001", testFile: "a.test.ts", testName: "", kind: "asserts" }]),
      ),
    ).toThrow(/test name/i)
    expect(() =>
      loadTraceabilityMap(raw([{ scenario: "EAP-LIFE-001", testFile: "a.test.ts", kind: "asserts" }])),
    ).toThrow(/test name/i)
    expect(() =>
      loadTraceabilityMap(
        raw([{ scenario: "EAP-LIFE-001", testFile: "", testName: "n", kind: "asserts" }]),
      ),
    ).toThrow(/file/i)
  })

  // 004 §1.1 "Should produce byte-stable output when the map is regenerated for an unchanged corpus"
  test("produces byte-identical output when regenerated over unchanged inputs", () => {
    const file = "a.test.ts"
    const build = (): string =>
      serializeMap(
        reconcile(
          input({
            corpusFiles: [file],
            records: [record(file, "one", [{ id: "EAP-LIFE-001", kind: "asserts" }])],
            executed: [executed(file, "one")],
          }),
        ),
      )

    expect(build()).toBe(build())
  })

  test("produces byte-identical output when the same suite ran twice and the sink accumulated duplicates", () => {
    const file = "a.test.ts"
    const once = record(file, "one", [{ id: "EAP-LIFE-001", kind: "asserts" }])
    const build = (records: AnnotationRecordLike[]): string =>
      serializeMap(
        reconcile(input({ corpusFiles: [file], records, executed: [executed(file, "one")] })),
      )

    const second: AnnotationRecordLike = { ...once, pid: 99, emittedAt: "2026-06-06T00:00:00.000Z" }
    expect(build([once, second, { ...once, pid: 3 }])).toBe(build([once]))
  })

  test("orders links, scenarios and gaps deterministically regardless of input order", () => {
    const files = ["b.test.ts", "a.test.ts"]
    const records = [
      record(files[0]!, "z", [{ id: "EAP-LIFE-002", kind: "asserts" }]),
      record(files[1]!, "y", [{ id: "EAP-LIFE-001", kind: "asserts" }]),
    ]
    const build = (order: number[]): string =>
      serializeMap(
        reconcile(
          input({
            register: register(entry("EAP-LIFE-002"), entry("EAP-LIFE-001"), entry("EAP-LIFE-003")),
            corpusFiles: [...files].reverse(),
            records: order.map((i) => records[i]!),
            executed: [executed(files[0]!, "z"), executed(files[1]!, "y")],
          }),
        ),
      )

    expect(build([0, 1])).toBe(build([1, 0]))
    const map = reconcile(
      input({
        register: register(entry("EAP-LIFE-002"), entry("EAP-LIFE-001")),
        corpusFiles: files,
        records,
        executed: [executed(files[0]!, "z"), executed(files[1]!, "y")],
      }),
    )
    expect(map.scenarios.map((s) => s.id)).toEqual(["EAP-LIFE-001", "EAP-LIFE-002"])
    expect(map.links.map((l) => l.scenario)).toEqual(["EAP-LIFE-001", "EAP-LIFE-002"])
  })
})

// ── 004 §1.2 Value Objects ────────────────────────────────────────────────────────────────────

describe("Traceability Map — link validation", () => {
  // 004 §1.2 "Should reject a `TraceabilityLink` whose kind is neither `asserts` nor `covers-partially`"
  test("rejects a link kind outside the closed union and names the offending annotation", () => {
    const file = "a.test.ts"
    expect(() =>
      buildLinks([
        record(file, "bad", [{ id: "EAP-LIFE-001", kind: "covers" as "asserts" }]),
      ]),
    ).toThrow(/covers.*a\.test\.ts.*bad|a\.test\.ts :: bad/s)
  })

  test("rejects a committed map whose link kind is outside the closed union", () => {
    const base = loadTraceabilityMap(serializeMap(reconcile(input())))
    const raw = JSON.stringify(
      {
        ...base,
        links: [
          { scenario: "EAP-LIFE-001", testFile: "a.test.ts", testName: "n", kind: "sort-of" },
        ],
      },
      null,
      2,
    )
    expect(() => loadTraceabilityMap(raw)).toThrow(/kind/i)
  })

  test("rejects a link naming an identifier that is not EAP-<AREA>-<NNN>", () => {
    expect(() => buildLinks([record("a.test.ts", "n", [{ id: "LIFE-1", kind: "asserts" }])])).toThrow(
      /LIFE-1/,
    )
  })

  test("refuses to commit two different kinds for one scenario and test case, naming the remedy", () => {
    const file = "a.test.ts"
    expect(() =>
      buildLinks([
        record(file, "n", [{ id: "EAP-LIFE-001", kind: "asserts" }]),
        record(file, "n", [{ id: "EAP-LIFE-001", kind: "covers-partially" }]),
      ]),
    ).toThrow(/EAP-LIFE-001[\s\S]*asserts[\s\S]*covers-partially|stale/i)
  })
})

// ── 004 §1.1 Test Corpus / Ambiguity Quarantine ───────────────────────────────────────────────

describe("Traceability Map — quarantine and register discipline", () => {
  // 004 §1.1 "Should report rather than commit a test that discharges a quarantined identifier"
  test("commits no link into a quarantined family and reports the binding for the gate", () => {
    const file = "a.test.ts"
    const quarantine: QuarantineDocument = {
      version: 1,
      policy: "fixture",
      families: [
        {
          id: "QA2",
          question: "q",
          whyAPassingTestWouldDecideIt: "w",
          sourceClauses: ["c"],
          liftingAdr: "ADR-0021",
          liftingCondition: "a merged amendment naming QA2",
          measurement: { mayMeasure: false, mayAssert: false, note: null },
          members: ["EAP-QUAR-002"],
        },
      ],
    }
    const map = reconcile(
      input({
        register: register(
          entry("EAP-LIFE-001"),
          entry("EAP-QUAR-002", { status: "declared-untestable", area: "QUAR" }),
        ),
        quarantine,
        corpusFiles: [file],
        records: [
          record(file, "decides it", [{ id: "EAP-QUAR-002", kind: "asserts" }], ["EAP-QUAR-002"]),
        ],
        executed: [executed(file, "decides it")],
      }),
    )

    expect(map.links).toEqual([])
    expect(map.quarantineViolations).toEqual([
      {
        scenario: "EAP-QUAR-002",
        familyId: "QA2",
        testFile: file,
        testName: "decides it",
        kind: "asserts",
      },
    ])
    // The quarantined scenario is not a Traceability Gap: it is deliberately untestable.
    expect(map.gaps.unlinkedScenarios.map((g) => g.id)).toEqual(["EAP-LIFE-001"])
  })

  test("excludes a declared-untestable and a retired scenario from the unlinked-scenario gap list", () => {
    const map = reconcile(
      input({
        register: register(
          entry("EAP-LIFE-001"),
          entry("EAP-LIFE-002", { retired: true }),
          entry("EAP-QUAR-001", { status: "declared-untestable", area: "QUAR" }),
        ),
      }),
    )

    expect(map.gaps.unlinkedScenarios.map((g) => g.id)).toEqual(["EAP-LIFE-001"])
    expect(map.scenarios.map((s) => s.id)).toEqual(["EAP-LIFE-001"])
  })

  test("refuses an annotation naming a scenario the register does not hold", () => {
    const file = "a.test.ts"
    expect(() =>
      reconcile(
        input({
          corpusFiles: [file],
          records: [record(file, "n", [{ id: "EAP-LIFE-404", kind: "asserts" }])],
          executed: [executed(file, "n")],
        }),
      ),
    ).toThrow(/EAP-LIFE-404/)
  })

  test("drops and reports a record whose test case no longer exists in the corpus", () => {
    const file = "a.test.ts"
    const map = reconcile(
      input({
        corpusFiles: [file],
        records: [record(file, "old name", [{ id: "EAP-LIFE-001", kind: "asserts" }])],
        executed: [executed(file, "new name")],
      }),
    )

    expect(map.links).toEqual([])
    expect(map.staleAnnotationRecords).toEqual([{ testFile: file, testName: "old name" }])
    expect(map.gaps.unlinkedScenarios.map((g) => g.id)).toEqual(["EAP-LIFE-001"])
    expect(map.gaps.unclaimedTests).toEqual([{ testFile: file, testName: "new name" }])
  })

  test("reports, and never links, a record emitted from a file outside the declared corpus", () => {
    const outside = "packages/mcp-server/test/verification/annotate.test.ts"
    const map = reconcile(
      input({
        corpusFiles: ["a.test.ts"],
        records: [record(outside, "probe", [{ id: "EAP-LIFE-001", kind: "asserts" }])],
        executed: [executed(outside, "probe")],
      }),
    )

    expect(map.links).toEqual([])
    expect(map.recordsOutsideDeclaredCorpus).toEqual([{ testFile: outside, testName: "probe" }])
    expect(map.gaps.unclaimedTests).toEqual([])
  })

  test("writes no scenario status into the map at all — status is the register's, `evidenced` is task 09's", () => {
    const map = JSON.parse(
      serializeMap(reconcile(input({ register: register(entry("EAP-LIFE-001")) }))),
    ) as unknown

    const offences: string[] = []
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) return node.forEach((item, i) => walk(item, `${path}[${i}]`))
      if (node !== null && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          if (key === "status") offences.push(`${path}.status`)
          // `policy` is the file's own prose, which must be free to say that status lives elsewhere.
          if (key !== "policy") walk(value, `${path}.${key}`)
        }
        return
      }
      if (typeof node === "string" && node.includes("evidenced")) offences.push(path)
    }
    walk(map, "$")

    expect(offences).toEqual([])
  })
})

// ── 004 §1.3 Domain Services ──────────────────────────────────────────────────────────────────

describe("ReconcileTraceability — statelessness and drift", () => {
  // 004 §1.3 "Should carry no state between executions when a verification service runs twice"
  test("produces an equal result on a second execution over identical inputs", () => {
    const file = "a.test.ts"
    const make = (): ReconcileInput =>
      input({
        corpusFiles: [file],
        records: [record(file, "one", [{ id: "EAP-LIFE-001", kind: "asserts" }])],
        executed: [executed(file, "one")],
      })

    expect(reconcile(make())).toEqual(reconcile(make()))
  })

  test("never mutates the inputs it was handed", () => {
    const file = "a.test.ts"
    const records = [record(file, "one", [{ id: "EAP-LIFE-001", kind: "asserts" }])]
    const frozen = JSON.stringify(records)
    reconcile(input({ corpusFiles: [file], records, executed: [executed(file, "one")] }))
    expect(JSON.stringify(records)).toBe(frozen)
  })

  // TraceabilityMapStore.diff (003 §Section 5)
  test("reports drift as a reviewable diff of added and removed links and gaps", () => {
    const file = "a.test.ts"
    const before = reconcile(input({ register: register(entry("EAP-LIFE-001")) }))
    const after = reconcile(
      input({
        corpusFiles: [file],
        records: [record(file, "one", [{ id: "EAP-LIFE-001", kind: "asserts" }])],
        executed: [executed(file, "one")],
      }),
    )

    const drift = diffMaps(before, after)
    expect(drift.drifted).toBe(true)
    expect(drift.addedLinks).toEqual([
      { scenario: "EAP-LIFE-001", testFile: file, testName: "one", kind: "asserts" },
    ])
    expect(drift.removedLinks).toEqual([])
    expect(drift.closedScenarioGaps).toEqual(["EAP-LIFE-001"])
    expect(diffMaps(before, before).drifted).toBe(false)
  })

  // 004 §1.3 "Should lose no Traceability Link when the Test Corpus is renamed"
  test("keeps every scenario's links under the new path when a corpus file is renamed", () => {
    const link = (file: string) =>
      reconcile(
        input({
          corpusFiles: [file],
          records: [record(file, "one", [{ id: "EAP-LIFE-001", kind: "asserts" }])],
          executed: [executed(file, "one")],
        }),
      )

    const before = link("packages/mcp-server/test/f001-retry8-resume-index.test.ts")
    const after = link("packages/mcp-server/test/recall-resume.test.ts")
    expect(after.scenarios).toEqual(before.scenarios)
    expect(after.links[0]!.testFile).toBe("packages/mcp-server/test/recall-resume.test.ts")
    expect(diffMaps(before, after).lostScenarioLinks).toEqual([])
  })
})

// ── 004 §2.1 Repositories and Persistence ─────────────────────────────────────────────────────

describe("Executed-test inventory (the runner's own output)", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3">
  <testsuite name="packages\\graph-core\\test\\horizon.test.ts" file="packages\\graph-core\\test\\horizon.test.ts">
    <testsuite name="Horizon" file="packages\\graph-core\\test\\horizon.test.ts">
      <testcase name="Should admit &quot;a&quot; &amp; b" classname="Horizon" file="packages\\graph-core\\test\\horizon.test.ts" />
    </testsuite>
  </testsuite>
  <testsuite name="packages/mcp-server/test/recall.test.ts" file="packages/mcp-server/test/recall.test.ts">
    <testcase name="ran" file="packages/mcp-server/test/recall.test.ts"></testcase>
    <testcase name="never ran" file="packages/mcp-server/test/recall.test.ts"><skipped /></testcase>
  </testsuite>
</testsuites>
`

  test("collects one entry per executed case, by file and test name, with the runner's escaping undone", () => {
    expect(parseJUnitTestCases(xml)).toEqual([
      { file: "packages/graph-core/test/horizon.test.ts", test: 'Should admit "a" & b' },
      { file: "packages/mcp-server/test/recall.test.ts", test: "ran" },
    ])
  })

  test("omits a skipped or todo case, which executed nothing and can annotate nothing", () => {
    expect(parseJUnitTestCases(xml).map((c) => c.test)).not.toContain("never ran")
  })

  test("undoes exactly one level of XML escaping, so a name containing an entity survives", () => {
    expect(decodeXmlAttribute("&quot;q&quot; &apos;s&apos; &lt;x&gt; &amp; y")).toBe(`"q" 's' <x> & y`)
    // A test case literally named `a &gt; b` is escaped once by the runner and must decode back to
    // itself, not to `a > b` — the name is matched against the annotation record verbatim.
    expect(decodeXmlAttribute("a &amp;gt; b")).toBe("a &gt; b")
  })

  test("normalises a runner path to a repo-relative path with forward slashes", () => {
    expect(normalizeExecutedFile("packages\\graph-core\\test\\horizon.test.ts")).toBe(
      "packages/graph-core/test/horizon.test.ts",
    )
    expect(normalizeExecutedFile("./packages/mcp-server/test/recall.test.ts")).toBe(
      "packages/mcp-server/test/recall.test.ts",
    )
  })

  test("refuses a per-package runner path that cannot be resolved to a repository file", () => {
    expect(() => normalizeExecutedFile("test/horizon.test.ts")).toThrow(/repository root/i)
  })

  test("deduplicates annotation records across accumulated runs, ignoring pid and timestamp", () => {
    const one = record("a.test.ts", "n", [{ id: "EAP-LIFE-001", kind: "asserts" }])
    const distinct = distinctAnnotationRecords([
      one,
      { ...one, pid: 2, emittedAt: "2027-01-01T00:00:00.000Z" },
      record("a.test.ts", "n", [{ id: "EAP-LIFE-002", kind: "asserts" }]),
    ])
    expect(distinct).toHaveLength(2)
  })
})

// ── The committed artefact ────────────────────────────────────────────────────────────────────

describe("The committed Traceability Map", () => {
  const root = repoRoot()
  const committed = (): string => readFileSync(join(root, MAP_PATH), "utf8")

  test("round-trips through load and serialize byte for byte", () => {
    const raw = committed()
    expect(serializeMap(loadTraceabilityMap(raw))).toBe(raw)
  })

  test("names every link by file and test name and never by suite alone", () => {
    const map = loadTraceabilityMap(committed())
    expect(map.links.length).toBeGreaterThan(0)
    for (const link of map.links) {
      expect(link.testFile).toMatch(/^packages\/.+\.test\.ts$/)
      expect(link.testName.trim().length).toBeGreaterThan(0)
    }
  })

  test("holds no link into any quarantined family", () => {
    const map = loadTraceabilityMap(committed())
    const quarantined = new Set(
      loadQuarantine(readFileSync(join(root, QUARANTINE_PATH), "utf8")).families.flatMap(
        (family) => family.members,
      ),
    )
    expect(map.links.filter((link) => quarantined.has(link.scenario))).toEqual([])
    expect(map.quarantineViolations).toEqual([])
  })

  test("agrees with the committed Scenario Register on which scenarios are live and proposed", () => {
    const map = loadTraceabilityMap(committed())
    const live = loadScenarioRegister(readFileSync(join(root, REGISTER_PATH), "utf8"), {
      writer: "derivation",
    }).scenarios.filter((e) => e.retired !== true && e.status === "proposed")

    expect(map.scenarios.map((s) => s.id).sort()).toEqual(live.map((e) => e.id).sort())
    expect(map.counts.unlinkedScenarios).toBe(map.gaps.unlinkedScenarios.length)
    expect(
      map.counts.scenariosWithAssertsLink +
        map.counts.scenariosCoveredPartiallyOnly +
        map.counts.unlinkedScenarios,
    ).toBe(map.scenarios.length)
  })

  test("keeps the two gap directions in separate, non-overlapping lists", () => {
    const map = loadTraceabilityMap(committed())
    const linkedScenarios = new Set(map.links.map((l) => l.scenario))
    for (const gap of map.gaps.unlinkedScenarios) expect(linkedScenarios.has(gap.id)).toBe(false)

    const linkedCases = new Set(map.links.map((l) => `${l.testFile} :: ${l.testName}`))
    for (const gap of map.gaps.unclaimedTests) {
      expect(linkedCases.has(`${gap.testFile} :: ${gap.testName}`)).toBe(false)
    }
  })

  test("declares the corpus as the annotated EAP test files, excluding the verification machinery's own tests", () => {
    const discovered = discoverCorpusFiles(root)
    expect(loadTraceabilityMap(committed()).corpus.files).toEqual(discovered)
    expect(discovered).toContain("packages/mcp-server/test/recall.test.ts")
    expect(discovered).not.toContain("packages/mcp-server/test/verification/annotate.test.ts")
  })
})
