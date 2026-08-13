import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  BENCHMARK_LEDGER_PATH,
  GATE_NAME,
  UNDECIDED_BANNER,
  classifyObservation,
  detectQuarantineViolations,
  explainViolation,
  findQuarantineMentions,
  quarantinedMembers,
  runGate,
  type GateInput,
  type MeasurementObservation,
} from "./quarantine-gate"
import {
  FAMILY_IDS,
  QUARANTINE_PATH,
  loadQuarantine,
  type QuarantineDocument,
  type QuarantineFamilyId,
} from "./quarantine"
import {
  MAP_PATH,
  loadTraceabilityMap,
  type AnnotationRecordLike,
  type TraceabilityMap,
} from "./reconcile-traceability"
import { REGISTER_PATH, loadScenarioRegister, repoRoot } from "./register-scenarios"

const ROOT = repoRoot()

const readQuarantine = (): QuarantineDocument =>
  loadQuarantine(readFileSync(join(ROOT, QUARANTINE_PATH), "utf8"))
const readMap = (): TraceabilityMap =>
  loadTraceabilityMap(readFileSync(join(ROOT, MAP_PATH), "utf8"))
const readRegister = () =>
  loadScenarioRegister(readFileSync(join(ROOT, REGISTER_PATH), "utf8"), { writer: "derivation" })

/** The member Scenario Identifier of a family, as the committed quarantine records it. */
const memberOf = (doc: QuarantineDocument, id: QuarantineFamilyId): string => {
  const family = doc.families.find((candidate) => candidate.id === id)
  if (family === undefined) throw new Error(`test fixture: no family ${id}`)
  return family.members[0]!
}

const record = (overrides: Partial<AnnotationRecordLike> = {}): AnnotationRecordLike => ({
  file: "packages/mcp-server/test/recall.test.ts",
  test: "a case that discharges something",
  scenarios: [],
  items: [],
  defects: [],
  declaredUntestable: [],
  pid: 1,
  emittedAt: "2026-08-13T00:00:00.000Z",
  ...overrides,
})

/** An input whose only live source is the one supplied — the others are explicitly empty, not absent. */
const input = (doc: QuarantineDocument, overrides: Partial<GateInput> = {}): GateInput => ({
  quarantine: doc,
  records: [],
  map: null,
  corpusMentions: [],
  observations: [],
  ...overrides,
})

/**
 * `004` §1.3: Should fail the build when a Traceability Link points into any of the seven
 * quarantined families — "for each of the seven families independently".
 */
describe("DetectQuarantineViolation — a link into any of the seven families fails the gate", () => {
  test("fails for each of QA1-QA7 independently, naming family, test file and test name", () => {
    const doc = readQuarantine()
    expect(doc.families.map((family) => family.id)).toEqual([...FAMILY_IDS])

    for (const id of FAMILY_IDS) {
      const scenario = memberOf(doc, id)
      const report = detectQuarantineViolations(
        input(doc, {
          records: [
            record({
              file: "packages/mcp-server/test/recall-cascade.test.ts",
              test: `a deliberately added link into ${id}`,
              scenarios: [{ id: scenario, kind: "asserts" }],
              declaredUntestable: [scenario],
            }),
          ],
        }),
      )

      expect(report.outcome).toBe("fail")
      expect(report.violations).toHaveLength(1)
      const violation = report.violations[0]!
      expect(violation.familyId).toBe(id)
      expect(violation.scenario).toBe(scenario)
      expect(violation.testFile).toBe("packages/mcp-server/test/recall-cascade.test.ts")
      expect(violation.testName).toBe(`a deliberately added link into ${id}`)

      // Acceptance 1: the family id, the test file and the test name are all in the message.
      expect(report.message).toContain(id)
      expect(report.message).toContain("packages/mcp-server/test/recall-cascade.test.ts")
      expect(report.message).toContain(`a deliberately added link into ${id}`)
    }
  })

  test("covers exactly the seven families the committed quarantine declares", () => {
    const doc = readQuarantine()
    const report = detectQuarantineViolations(input(doc))
    expect(report.familiesCovered).toEqual([...FAMILY_IDS])
    expect(report.familiesCovered).toHaveLength(7)
    expect(report.familiesCovered).toContain("QA7")
  })

  test("fails on a `covers-partially` link exactly as on an `asserts` link", () => {
    const doc = readQuarantine()
    const scenario = memberOf(doc, "QA4")
    const report = detectQuarantineViolations(
      input(doc, {
        records: [
          record({
            test: "partially covers the undecided closure width",
            scenarios: [{ id: scenario, kind: "covers-partially" }],
            declaredUntestable: [scenario],
          }),
        ],
      }),
    )
    expect(report.outcome).toBe("fail")
    expect(report.violations[0]!.kind).toBe("covers-partially")
  })

  test("passes when no source names a quarantined Scenario", () => {
    const doc = readQuarantine()
    const report = detectQuarantineViolations(
      input(doc, {
        records: [record({ scenarios: [{ id: "EAP-RECL-003", kind: "asserts" }] })],
      }),
    )
    expect(report.outcome).toBe("pass")
    expect(report.violations).toEqual([])
  })

  test("declares itself blocking", () => {
    const report = detectQuarantineViolations(input(readQuarantine()))
    expect(report.gate).toBe(GATE_NAME)
    expect(report.blocking).toBe(true)
  })
})

/**
 * `004` §1.3: Should distinguish an undecided behaviour from a broken test when a Quarantine
 * Violation is reported. Acceptance 2 — a developer who reads "test failed" fixes the test, and
 * here fixing the test means picking the outcome the quarantine exists to defer.
 */
describe("DetectQuarantineViolation — an undecided behaviour is not a broken test", () => {
  test("states the behaviour is undecided, names the lifting ADR amendment, and forbids fixing the test", () => {
    const doc = readQuarantine()
    const family = doc.families.find((candidate) => candidate.id === "QA2")!
    const violation = {
      familyId: "QA2" as QuarantineFamilyId,
      scenario: family.members[0]!,
      testFile: "packages/mcp-server/test/f001-retry7-closure-gate.test.ts",
      testName: "an indirect dependent lands in `contested`",
      kind: "asserts" as const,
      source: "annotation-sink" as const,
    }
    const message = explainViolation(violation, family)

    expect(message).toContain(UNDECIDED_BANNER)
    expect(message.toUpperCase()).toContain("UNDECIDED")
    // It must say, in as many words, that the test is not the thing that is wrong.
    expect(message).toMatch(/not (a |)broken test|test is not broken/i)
    // The remedy is an ADR amendment, never a code or assertion change.
    expect(message).toContain(family.liftingAdr)
    expect(message).toContain(family.liftingCondition)
    expect(message).toMatch(/amendment/i)
    expect(message).toMatch(/do not (change|"?fix"?|adjust)/i)
    // And it says WHY, so the reader can see the decision they were about to make.
    expect(message).toContain(family.question)
    expect(message).toContain(family.whyAPassingTestWouldDecideIt)
  })

  test("carries none of the vocabulary of an ordinary assertion failure", () => {
    const doc = readQuarantine()
    const family = doc.families.find((candidate) => candidate.id === "QA7")!
    const message = explainViolation(
      {
        familyId: "QA7",
        scenario: family.members[0]!,
        testFile: "packages/mcp-server/test/eap-refusals.test.ts",
        testName: "a refusal takes the same time whatever the caller may see",
        kind: "asserts",
        source: "annotation-sink",
      },
      family,
    )
    // An ordinary bun failure reads "expected X to be Y" / "Received". Nothing here may read that
    // way, or the reader reaches for the assertion instead of the ADR.
    expect(message).not.toMatch(/expected .* to (be|equal)/i)
    expect(message).not.toMatch(/^\s*Received:/im)
    expect(message).not.toMatch(/assertion failed/i)
  })
})

/**
 * `004` §1.3: Should permit a measurement inside a quarantined family when it asserts no outcome.
 * `001` §5 rule 3 — QA6 and QA7 admit measurement without assertion; everything else does not.
 */
describe("DetectQuarantineViolation — measurement without assertion", () => {
  const observation = (overrides: Partial<MeasurementObservation> = {}): MeasurementObservation => ({
    familyId: "QA6",
    metric: "closure.reDerivation.wallMs",
    value: 1843,
    unit: "ms",
    runId: "R-1",
    commit: "5cf8daa",
    runnerFingerprint: "linux-x64-bun1.3.14",
    testFile: "packages/mcp-server/test/probes/volume.probe.ts",
    testName: "100k-claim closure re-derivation cost",
    ...overrides,
  })

  test("passes a QA6 probe that records a cost and asserts nothing", () => {
    const doc = readQuarantine()
    const report = detectQuarantineViolations(input(doc, { observations: [observation()] }))
    expect(report.outcome).toBe("pass")
    expect(report.violations).toEqual([])
    expect(report.permittedMeasurements).toHaveLength(1)
    expect(report.permittedMeasurements[0]!.familyId).toBe("QA6")
    expect(report.permittedMeasurements[0]!.metric).toBe("closure.reDerivation.wallMs")
  })

  test("passes a QA7 timing-differential probe that records refusal timing and asserts nothing", () => {
    const doc = readQuarantine()
    const report = detectQuarantineViolations(
      input(doc, {
        observations: [
          observation({
            familyId: "QA7",
            metric: "refusal.NOT_FOUND.latencyMs",
            testName: "refusal-code timing differential, recorded",
          }),
        ],
      }),
    )
    expect(report.outcome).toBe("pass")
    expect(report.permittedMeasurements[0]!.familyId).toBe("QA7")
  })

  test("fails a QA6 observation that carries a bound — the measurement became a decision", () => {
    const doc = readQuarantine()
    const report = detectQuarantineViolations(
      input(doc, { observations: [observation({ bound: 2000 })] }),
    )
    expect(report.outcome).toBe("fail")
    expect(report.violations[0]!.familyId).toBe("QA6")
    expect(report.violations[0]!.kind).toBe("measurement")
    expect(report.message).toMatch(/bound|assert/i)
  })

  test("fails a QA7 observation that carries an expected outcome", () => {
    const doc = readQuarantine()
    const report = detectQuarantineViolations(
      input(doc, {
        observations: [observation({ familyId: "QA7", expected: "indistinguishable" })],
      }),
    )
    expect(report.outcome).toBe("fail")
    expect(report.violations[0]!.familyId).toBe("QA7")
  })

  test("fails any observation inside QA1-QA5, which admit no measurement at all", () => {
    const doc = readQuarantine()
    for (const id of ["QA1", "QA2", "QA3", "QA4", "QA5"] as const) {
      const report = detectQuarantineViolations(
        input(doc, { observations: [observation({ familyId: id })] }),
      )
      expect(report.outcome).toBe("fail")
      expect(report.violations[0]!.familyId).toBe(id)
    }
  })

  test("classifyObservation reads permission from the family's own measurement policy", () => {
    const doc = readQuarantine()
    const qa6 = doc.families.find((family) => family.id === "QA6")!
    const qa1 = doc.families.find((family) => family.id === "QA1")!
    expect(classifyObservation(qa6, observation()).permitted).toBe(true)
    expect(classifyObservation(qa6, observation({ asserted: true })).permitted).toBe(false)
    expect(classifyObservation(qa1, observation({ familyId: "QA1" })).permitted).toBe(false)
  })
})

/** Every input the gate is willing to believe, and the one it refuses to be silent about. */
describe("DetectQuarantineViolation — the sources it reads", () => {
  test("catches a violation recorded in the committed Traceability Map", () => {
    const doc = readQuarantine()
    const map = readMap()
    const scenario = memberOf(doc, "QA3")
    const report = detectQuarantineViolations(
      input(doc, {
        map: {
          ...map,
          quarantineViolations: [
            {
              scenario,
              familyId: "QA3",
              testFile: "packages/mcp-server/test/contestation.test.ts",
              testName: "a RecallNotice is one admitted object",
              kind: "asserts",
            },
          ],
        },
      }),
    )
    expect(report.outcome).toBe("fail")
    expect(report.violations[0]!.source).toBe("traceability-map")
    expect(report.violations[0]!.familyId).toBe("QA3")
  })

  test("catches a quarantined member smuggled into the committed map's `links`", () => {
    const doc = readQuarantine()
    const map = readMap()
    const scenario = memberOf(doc, "QA1")
    const report = detectQuarantineViolations(
      input(doc, {
        map: {
          ...map,
          links: [
            ...map.links,
            {
              scenario,
              testFile: "packages/mcp-server/test/promotion.test.ts",
              testName: "a promotion in flight across a changed DAG",
              kind: "asserts",
            },
          ],
        },
      }),
    )
    expect(report.outcome).toBe("fail")
    expect(report.violations[0]!.source).toBe("traceability-map")
  })

  test("catches a quarantined identifier written into corpus source, before any run", () => {
    const doc = readQuarantine()
    const scenario = memberOf(doc, "QA5")
    const source = [
      "import { annotatedTest } from './verification/annotate'",
      "",
      `annotatedTest("legacy verified maps to admitted", { asserts: ["${scenario}"] }, () => {`,
      "  expect(map('verified')).toBe('admitted')",
      "})",
      "",
    ].join("\n")

    const mentions = findQuarantineMentions(
      "packages/graph-core/test/eap-types.test.ts",
      source,
      quarantinedMembers(doc),
    )
    expect(mentions).toHaveLength(1)
    expect(mentions[0]!.scenario).toBe(scenario)
    expect(mentions[0]!.testName).toBe("legacy verified maps to admitted")

    const report = detectQuarantineViolations(input(doc, { corpusMentions: mentions }))
    expect(report.outcome).toBe("fail")
    expect(report.violations[0]!.source).toBe("corpus-source")
    expect(report.violations[0]!.familyId).toBe("QA5")
  })

  test("names the enclosing case when the annotation is in `annotatedTest`'s multi-line form", () => {
    const doc = readQuarantine()
    const scenario = memberOf(doc, "QA5")
    // The shape the real corpus uses: the call, the name, then the annotation, on three lines. A
    // same-line-only search walks past all three and reports whatever case came BEFORE — naming an
    // innocent test case in a message whose whole purpose is to name the guilty one.
    const source = [
      'test("an earlier, innocent case", () => {})',
      "",
      "annotatedTest(",
      '  "the case that actually carries the binding",',
      `  { coversPartially: ["EAP-VOBJ-009", "${scenario}"] },`,
      "  () => {},",
      ")",
    ].join("\n")

    const mentions = findQuarantineMentions("packages/graph-core/test/x.test.ts", source, quarantinedMembers(doc))
    expect(mentions).toHaveLength(1)
    expect(mentions[0]!.testName).toBe("the case that actually carries the binding")
    expect(mentions[0]!.line).toBe(5)
  })

  test("does not trip on a quarantined identifier named only in a comment", () => {
    const doc = readQuarantine()
    const scenario = memberOf(doc, "QA2")
    const source = [
      `// Deliberately NOT linked to ${scenario} (family QA2): this case keeps the question open.`,
      "/*",
      ` * ${scenario} would be a Quarantine Violation by construction.`,
      " */",
      'test("an indirect dependent stays deferred", () => {})',
    ].join("\n")
    expect(findQuarantineMentions("packages/mcp-server/test/x.test.ts", source, quarantinedMembers(doc))).toEqual([])
  })

  test("refuses to swallow a map-reported violation it cannot attribute to a family", () => {
    const doc = readQuarantine()
    const map = readMap()
    // The `QA?` fallback task 07 writes when a declared-untestable scenario belongs to no family.
    // Skipping it would be a silent pass in the one artefact that already knows a rule was broken.
    expect(() =>
      detectQuarantineViolations(
        input(doc, {
          map: {
            ...map,
            quarantineViolations: [
              {
                scenario: "EAP-GHOST-001",
                familyId: "QA?" as QuarantineFamilyId,
                testFile: "packages/mcp-server/test/x.test.ts",
                testName: "a binding into nothing",
                kind: "asserts",
              },
            ],
          },
        }),
      ),
    ).toThrow(/EAP-GHOST-001/)
  })

  test("refuses to swallow a Benchmark Ledger observation naming a family that does not exist", () => {
    const doc = readQuarantine()
    expect(() =>
      detectQuarantineViolations(
        input(doc, {
          observations: [
            {
              familyId: "QA9" as QuarantineFamilyId,
              metric: "closure.wallMs",
              value: 1,
              runId: "R-1",
              commit: "c",
              runnerFingerprint: "fp",
              bound: 2,
            },
          ],
        }),
      ),
    ).toThrow(/QA9/)
  })

  test("refuses to report a pass when it consulted no source at all", () => {
    const doc = readQuarantine()
    const report = detectQuarantineViolations({
      quarantine: doc,
      records: null,
      map: null,
      corpusMentions: null,
      observations: null,
    })
    expect(report.outcome).toBe("fail")
    expect(report.message).toMatch(/no (evidence )?source/i)
  })

  test("names the sources it consulted so a green verdict is auditable", () => {
    const doc = readQuarantine()
    const report = detectQuarantineViolations(input(doc, { map: readMap() }))
    expect(report.sourcesConsulted).toContain("annotation-sink")
    expect(report.sourcesConsulted).toContain("traceability-map")
    expect(report.sourcesConsulted).toContain("corpus-source")
    expect(report.outcome).toBe("pass")
  })
})

/**
 * `004` §3.2: Should block the merge when a test case discharges a quarantined Scenario. Acceptance
 * 3 — the gate is turned on only because the check is real against this corpus, not because it was
 * pointed at nothing.
 */
describe("the quarantine gate against the committed repository", () => {
  test("passes, and the register still holds every family member declared-untestable", () => {
    const report = runGate(ROOT)
    if (report.outcome !== "pass") console.error(report.message)
    expect(report.violations).toEqual([])
    expect(report.outcome).toBe("pass")
    expect(report.familiesCovered).toEqual([...FAMILY_IDS])

    const register = readRegister()
    const doc = readQuarantine()
    for (const family of doc.families) {
      for (const member of family.members) {
        const entry = register.scenarios.find((candidate) => candidate.id === member)
        expect(entry?.status).toBe("declared-untestable")
      }
    }
  })

  test("consults the corpus source even with no run behind it, so a fresh clone is still checked", () => {
    const report = runGate(ROOT)
    expect(report.sourcesConsulted).toContain("corpus-source")
    expect(report.sourcesConsulted).toContain("traceability-map")
  })

  test("the committed Traceability Map holds no link into a quarantined family", () => {
    const doc = readQuarantine()
    const members = quarantinedMembers(doc)
    const map = readMap()
    expect(map.links.filter((link) => members.has(link.scenario))).toEqual([])
    expect(map.quarantineViolations).toEqual([])
  })

  test("names the Benchmark Ledger it would read, so a later task appends to the path the gate checks", () => {
    expect(BENCHMARK_LEDGER_PATH).toBe("docs/verification/benchmark-ledger.jsonl")
  })
})
