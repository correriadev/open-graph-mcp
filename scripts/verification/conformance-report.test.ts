/**
 * F002 task 10 — Apêndice D transcribed into a Conformance Manifest.
 *
 * These tests drive `conformance-report.ts`'s exported pure functions directly and pin the
 * committed manifest against the Working Paper on disk. The Working Paper and the ADR are
 * read-only inputs here: nothing in this file writes to `docs/PRD/**` or `docs/adr/**`.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  APPENDIX_HEADING,
  CLAIM_STATES,
  CONFORMANCE_ITEM_ID,
  EXCLUDED_LEVELS,
  EVIDENCE_SURFACES,
  MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION,
  SELF_REPORT_PHRASES,
  WORKING_PAPER_PATH,
  assessConformance,
  assessmentViolations,
  extractAppendixD,
  loadManifest,
  loadRefusalTaxonomy,
  parseLevelClauses,
  renderAssessment,
  renderReport,
  roleForLevel,
  sha256,
  validateManifest,
  type AnnotationRecordLike,
  type ConformanceManifest,
} from "./conformance-report"
import { repoRoot } from "./register-scenarios"

const root = repoRoot()
const readRepo = (path: string): string => readFileSync(join(root, ...path.split("/")), "utf8")

const paper = readRepo(WORKING_PAPER_PATH)
const section = extractAppendixD(paper)
const clauses = parseLevelClauses(section)
const manifestRaw = readRepo(MANIFEST_PATH)
const manifest = loadManifest(manifestRaw)
const taxonomy = loadRefusalTaxonomy(root)

const clone = (): ConformanceManifest => JSON.parse(JSON.stringify(manifest)) as ConformanceManifest

describe("extractAppendixD", () => {
  test("delimits the appendix by its own heading and the next section boundary", () => {
    expect(section.path).toBe(WORKING_PAPER_PATH)
    expect(section.text.startsWith(APPENDIX_HEADING)).toBe(true)
    expect(section.startLine).toBe(1164)
    expect(section.endLine).toBeGreaterThanOrEqual(1176)
    expect(section.sha256).toBe(sha256(section.text))
  })

  test("stops at the next `## ` heading rather than running to the end of the document", () => {
    const synthetic = ["# Doc", "", `${APPENDIX_HEADING} — x`, "", "body", "", "## Next", "", "other"].join("\n")
    const cut = extractAppendixD(synthetic)
    expect(cut.text).toContain("body")
    expect(cut.text).not.toContain("other")
    expect(cut.startLine).toBe(3)
  })

  test("refuses a document with no Apêndice D rather than hashing an empty string", () => {
    expect(() => extractAppendixD("# Doc\n\nno appendix here\n")).toThrow(/Apêndice D/)
  })
})

describe("parseLevelClauses", () => {
  test("yields one clause per semicolon-delimited fragment of L0–L4", () => {
    const perLevel = (level: string): number => clauses.filter((c) => c.level === level).length
    expect(perLevel("L0")).toBe(4)
    expect(perLevel("L1")).toBe(5)
    expect(perLevel("L2")).toBe(9)
    expect(perLevel("L3")).toBe(9)
    expect(perLevel("L4")).toBe(5)
  })

  test("anchors every clause to the source line its level is written on", () => {
    const lineOf = (level: string): number[] => [
      ...new Set(clauses.filter((c) => c.level === level).map((c) => c.sourceLine)),
    ]
    expect(lineOf("L0")).toEqual([1168])
    expect(lineOf("L1")).toEqual([1170])
    expect(lineOf("L2")).toEqual([1172])
    expect(lineOf("L3")).toEqual([1174])
    expect(lineOf("L4")).toEqual([1176])
  })

  test("carries the Portuguese verbatim — no translation, no trailing punctuation surgery", () => {
    const l0 = clauses.filter((c) => c.level === "L0").map((c) => c.clause)
    expect(l0[0]).toBe("resolve resources")
    expect(l0[3]).toBe("nunca trata resposta de um horizonte como autoritativa fora dele")
    for (const clause of clauses) expect(paper).toContain(clause.clause)
  })
})

describe("roleForLevel", () => {
  test("L0–L1 certify clients and L2–L4 certify hosts; no agent certifies as a host", () => {
    expect(roleForLevel("L0")).toBe("client")
    expect(roleForLevel("L1")).toBe("client")
    expect(roleForLevel("L2")).toBe("host")
    expect(roleForLevel("L3")).toBe("host")
    expect(roleForLevel("L4")).toBe("host")
  })
})

describe("the committed manifest", () => {
  test("is versioned and pins the digest of the section it was transcribed from", () => {
    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(manifest.source.path).toBe(WORKING_PAPER_PATH)
    expect(manifest.source.startLine).toBe(section.startLine)
    expect(manifest.source.endLine).toBe(section.endLine)
    expect(manifest.source.sha256).toBe(section.sha256)
  })

  test("records that Apêndice D is still marked `[E → G2]` pending graduation", () => {
    expect(manifest.graduation.marker).toBe("[E → G2]")
    expect(manifest.graduation.graduated).toBe(false)
    expect(manifest.graduation.note.length).toBeGreaterThan(0)
  })

  test("transcribes L0–L3 one item per clause, in source order, with stable greppable ids", () => {
    const transcribed = clauses.filter((c) => c.level !== "L4")
    expect(manifest.items.length).toBe(transcribed.length)
    expect(manifest.items.length).toBe(27)
    for (const [index, clause] of transcribed.entries()) {
      const item = manifest.items[index]!
      expect(item.clause).toBe(clause.clause)
      expect(item.level).toBe(clause.level)
      expect(item.sourceLine).toBe(clause.sourceLine)
      expect(item.itemId).toMatch(/^EAP-L[0-3]-\d{3}$/)
      expect(item.itemId.startsWith(`EAP-${clause.level}-`)).toBe(true)
    }
    expect(new Set(manifest.items.map((i) => i.itemId)).size).toBe(manifest.items.length)
  })

  test("carries every clause verbatim in the Working Paper's Portuguese", () => {
    for (const item of manifest.items) expect(section.text).toContain(item.clause)
  })

  test("keeps any English restatement in a separate field, never in `clause`", () => {
    for (const item of manifest.items) {
      expect(typeof item.restatementEn).toBe("string")
      expect(item.restatementEn).not.toBe(item.clause)
    }
  })

  test("gives each item a role that matches its level", () => {
    for (const item of manifest.items) expect(item.role).toBe(roleForLevel(item.level))
  })

  test("omits L4 federation rows entirely and says why", () => {
    expect(manifest.items.some((item) => item.level === "L4")).toBe(false)
    expect(manifest.excludedLevels.map((entry) => entry.level)).toEqual([...EXCLUDED_LEVELS])
    for (const entry of manifest.excludedLevels) expect(entry.reason.length).toBeGreaterThan(0)
  })

  test("names refusal codes only from the closed taxonomy, or none with a stated reason", () => {
    for (const item of manifest.items) {
      for (const code of item.refusalCodes) expect(taxonomy).toContain(code)
      if (item.refusalCodes.length === 0) {
        expect(item.refusalCodesNote === null).toBe(false)
        expect((item.refusalCodesNote ?? "").length).toBeGreaterThan(0)
      }
    }
  })

  test("gives every item a host-log observable evidence predicate, never a self-report", () => {
    for (const item of manifest.items) {
      expect(EVIDENCE_SURFACES).toContain(item.evidence.surface)
      expect(item.evidence.predicate.length).toBeGreaterThan(40)
      for (const phrase of SELF_REPORT_PHRASES) {
        expect(item.evidence.predicate.toLowerCase()).not.toContain(phrase)
      }
    }
  })

  /**
   * REFINED BY TASK 11, NOT WEAKENED. Task 10 wrote this as "every L0/L1/L2 item is `claimed`",
   * which encoded a judgement made by READING SOURCE — the only evidence available at the time.
   * Task 11 ran the checklist against real transport and found claims that no host record
   * discharges. It has the authority to demote and none to promote, so the invariant this file
   * defends is the one that survives an assessment:
   *
   *   an L0/L1/L2 item is `claimed`, or `demoted` WITH an assessment record behind it — and
   *   `not-yet-claimed` remains an L3-only affordance.
   *
   * The guard task 10 built is intact and is pinned separately below: an L0/L1/L2 item downgraded
   * to `not-yet-claimed` — "we never claimed this" — is still a violation, because that erases the
   * fact that the claim was made, assessed, and failed. `demoted` costs an evidence record;
   * `not-yet-claimed` costs nothing, which is exactly why it may not be the exit from a claim.
   */
  test("keeps L0, L1 and L2 out of `not-yet-claimed`: a claim leaves only through a demotion", () => {
    for (const item of manifest.items) {
      if (item.level === "L3") continue
      expect(item.claim.state === "claimed" || item.claim.state === "demoted").toBe(true)
      expect(item.claim.state).not.toBe("not-yet-claimed")
    }
  })

  test("backs every demotion with an assessment record naming the limb it could not observe", () => {
    const demoted = manifest.items.filter((item) => item.claim.state === "demoted")
    expect(demoted.length).toBeGreaterThan(0)
    for (const item of demoted) {
      expect(item.claim.assessment).toBeDefined()
      expect(item.claim.assessment!.assessedBy.length).toBeGreaterThan(0)
      expect(item.claim.assessment!.observation.length).toBeGreaterThan(0)
      expect(item.claim.assessment!.unobservableLimb.length).toBeGreaterThan(0)
    }
  })

  test("never carries an assessment record on an item that was not demoted", () => {
    for (const item of manifest.items) {
      if (item.claim.state === "demoted") continue
      expect(item.claim.assessment ?? null).toBeNull()
    }
  })

  test("gives each L3 item its own claim state, with a rationale behind it", () => {
    const l3 = manifest.items.filter((item) => item.level === "L3")
    expect(l3.length).toBe(9)
    for (const item of l3) {
      expect(CLAIM_STATES).toContain(item.claim.state)
      expect(item.claim.rationale.length).toBeGreaterThan(0)
    }
    expect(new Set(l3.map((item) => item.claim.state)).size).toBeGreaterThan(1)
  })

  test("does not claim the R9 budget clause: the ledger is stored but never enforced", () => {
    const budget = manifest.items.find((item) => item.clause === "budgets com R9")
    expect(budget).toBeDefined()
    expect(budget!.itemId).toBe("EAP-L3-007")
    expect(budget!.claim.state).toBe("not-yet-claimed")
    expect(budget!.claim.rationale).toContain("HorizonBudgetExhausted")
    expect(budget!.claim.evidenceRefs.length).toBeGreaterThan(0)
    for (const ref of budget!.claim.evidenceRefs) expect(ref).toMatch(/^[\w./-]+:\d+(-\d+)?$/)
  })
})

describe("validateManifest", () => {
  test("passes the committed manifest against the Working Paper on disk", () => {
    expect(validateManifest(manifest, section, taxonomy)).toEqual([])
  })

  test("catches a reworded clause — the acceptance criterion this file exists to defend", () => {
    const mutated = clone()
    mutated.items[0]!.clause = "resolves resources"
    expect(validateManifest(mutated, section, taxonomy).join("\n")).toMatch(/verbatim|not found/i)
  })

  test("catches a dropped clause", () => {
    const mutated = clone()
    mutated.items.splice(5, 1)
    expect(validateManifest(mutated, section, taxonomy).length).toBeGreaterThan(0)
  })

  test("catches an L4 federation row smuggled in", () => {
    const mutated = clone()
    mutated.items.push({ ...manifest.items[26]!, itemId: "EAP-L4-001", level: "L4" as never })
    expect(validateManifest(mutated, section, taxonomy).join("\n")).toMatch(/L4/)
  })

  test("catches an agent certifying as a host", () => {
    const mutated = clone()
    mutated.items[0]!.role = "host"
    expect(validateManifest(mutated, section, taxonomy).join("\n")).toMatch(/role/i)
  })

  test("catches a duplicated item id", () => {
    const mutated = clone()
    mutated.items[1]!.itemId = mutated.items[0]!.itemId
    expect(validateManifest(mutated, section, taxonomy).join("\n")).toMatch(/duplicate/i)
  })

  test("catches a stale source digest — an edit to the Working Paper is never silent", () => {
    const mutated = clone()
    mutated.source.sha256 = sha256("something else entirely")
    expect(validateManifest(mutated, section, taxonomy).join("\n")).toMatch(/sha256/i)
  })

  test("catches a self-reported evidence predicate", () => {
    const mutated = clone()
    mutated.items[0]!.evidence.predicate =
      "The implementation resolves every declared resource URI correctly, as the vendor reports."
    expect(validateManifest(mutated, section, taxonomy).join("\n")).toMatch(/self-report|host log/i)
  })

  test("catches a refusal code outside the closed taxonomy", () => {
    const mutated = clone()
    mutated.items[0]!.refusalCodes = ["NOT_A_REAL_CODE"]
    expect(validateManifest(mutated, section, taxonomy).join("\n")).toMatch(/NOT_A_REAL_CODE/)
  })

  test("catches an L2 item downgraded out of its full claim", () => {
    const mutated = clone()
    const l2 = mutated.items.find((item) => item.level === "L2")!
    l2.claim.state = "not-yet-claimed"
    expect(validateManifest(mutated, section, taxonomy).join("\n")).toMatch(/L2/)
  })

  test("catches a demotion with no assessment record — the cheap exit from a claim", () => {
    const mutated = clone()
    const l2 = mutated.items.find((item) => item.level === "L2")!
    l2.claim.state = "demoted"
    l2.claim.assessment = null
    expect(validateManifest(mutated, section, taxonomy).join("\n")).toMatch(/assessment/i)
  })

  test("catches an assessment record smuggled onto an item that is still claimed", () => {
    const mutated = clone()
    const claimed = mutated.items.find((item) => item.claim.state === "claimed")!
    claimed.claim.assessment = {
      assessedBy: "nobody",
      observation: "nothing was run",
      unobservableLimb: "none",
    }
    expect(validateManifest(mutated, section, taxonomy).join("\n")).toMatch(/assessment/i)
  })
})

// ── Task 11: AssessConformance ────────────────────────────────────────────────────────────────

/**
 * These drive `assessConformance` with FIXTURE annotation records rather than the live
 * `.verification/annotations.jsonl`. That is deliberate and not laziness: `bun test` writes that
 * sink while this file is executing, in an order nothing guarantees, so a test that read it would
 * assert against a race. The live sink is read by the `--check` entry point, after a run — which is
 * the same stance `derive-status.ts` takes toward the JUnit report.
 */
const record = (test_: string, items: string[], file = "packages/mcp-server/test/x.test.ts"): AnnotationRecordLike => ({
  file,
  test: test_,
  items,
})

describe("CONFORMANCE_ITEM_ID", () => {
  /**
   * The identifier spaces are DIFFERENT and must never be conflated. A Scenario Identifier
   * (`EAP-FUNC-001`) names a row of the Scenario Register; a Conformance Item Id (`EAP-L2-001`)
   * names a clause of Apêndice D. They share a prefix and nothing else.
   */
  test("matches a Conformance Item Id and rejects a Scenario Identifier", () => {
    expect(CONFORMANCE_ITEM_ID.test("EAP-L0-001")).toBe(true)
    expect(CONFORMANCE_ITEM_ID.test("EAP-L3-009")).toBe(true)
    expect(CONFORMANCE_ITEM_ID.test("EAP-FUNC-001")).toBe(false)
    expect(CONFORMANCE_ITEM_ID.test("EAP-SVCS-010")).toBe(false)
    expect(CONFORMANCE_ITEM_ID.test("EAP-L4-001")).toBe(false)
  })
})

describe("assessConformance", () => {
  test("attributes a claimed item to every annotated test case that discharges it", () => {
    const claimed = manifest.items.find((item) => item.claim.state === "claimed")!
    const assessment = assessConformance(manifest, [
      record("case one", [claimed.itemId]),
      record("case two", [claimed.itemId], "packages/client/test/y.test.ts"),
    ])
    const assessed = assessment.items.find((item) => item.itemId === claimed.itemId)!
    expect(assessed.verdict).toBe("discharged")
    expect(assessed.dischargedBy.map((c) => c.testName).sort()).toEqual(["case one", "case two"])
  })

  test("ACCEPTANCE 1 — a claimed item with no discharging test case is `undischarged`", () => {
    const claimed = manifest.items.find((item) => item.claim.state === "claimed")!
    const assessment = assessConformance(manifest, [])
    expect(assessment.items.find((item) => item.itemId === claimed.itemId)!.verdict).toBe("undischarged")
  })

  test("ACCEPTANCE 3 — a `not-yet-claimed` item is a declared exclusion, never a failure", () => {
    const excluded = manifest.items.find((item) => item.claim.state === "not-yet-claimed")!
    const assessed = assessConformance(manifest, []).items.find((item) => item.itemId === excluded.itemId)!
    expect(assessed.verdict).toBe("declared-exclusion")
    expect(assessed.verdict).not.toBe("undischarged")
    expect(assessed.verdict).not.toBe("discharged")
  })

  test("ACCEPTANCE 3 — a `demoted` item is a declared exclusion too, and is never green", () => {
    const mutated = clone()
    const l2 = mutated.items.find((item) => item.level === "L2")!
    l2.claim.state = "demoted"
    l2.claim.assessment = { assessedBy: "t11", observation: "o", unobservableLimb: "l" }
    const assessed = assessConformance(mutated, []).items.find((item) => item.itemId === l2.itemId)!
    expect(assessed.verdict).toBe("declared-exclusion")
  })

  test("a declared exclusion stays an exclusion even when a test case names it", () => {
    // An annotation cannot promote. Task 11 has demotion authority and no promotion authority, so a
    // test that names an unclaimed item must not turn the row green behind the manifest's back.
    const excluded = manifest.items.find((item) => item.claim.state === "not-yet-claimed")!
    const assessment = assessConformance(manifest, [record("eager case", [excluded.itemId])])
    expect(assessment.items.find((item) => item.itemId === excluded.itemId)!.verdict).toBe("declared-exclusion")
  })

  test("ACCEPTANCE 2 — host and client verdicts are separate and are never merged", () => {
    const assessment = assessConformance(manifest, [])
    expect(assessment.byRole.client.role).toBe("client")
    expect(assessment.byRole.host.role).toBe("host")
    // L0+L1 are the client's nine; L2+L3 are the host's eighteen.
    expect(assessment.byRole.client.total).toBe(9)
    expect(assessment.byRole.host.total).toBe(18)
    // Nothing anywhere in the result sums the two into one figure.
    const keys = Object.keys(assessment as unknown as Record<string, unknown>)
    for (const forbidden of ["total", "passRate", "overall", "combined", "score"]) {
      expect(keys).not.toContain(forbidden)
    }
    expect(JSON.stringify(assessment)).not.toContain("passRate")
  })

  test("tallies each level separately within a role", () => {
    const assessment = assessConformance(manifest, [])
    const levels = (role: "client" | "host"): Record<string, number> =>
      Object.fromEntries(assessment.byRole[role].levels.map((tally) => [tally.level, tally.total]))
    expect(levels("client")).toEqual({ L0: 4, L1: 5 })
    expect(levels("host")).toEqual({ L2: 9, L3: 9 })
  })

  test("names an annotation that discharges a Conformance Item id the manifest does not carry", () => {
    const assessment = assessConformance(manifest, [record("wrong id", ["EAP-L2-099"])])
    expect(assessment.unknownItemIds.map((entry) => entry.itemId)).toEqual(["EAP-L2-099"])
  })

  test("rejects a Scenario Identifier used as a Conformance Item id", () => {
    const assessment = assessConformance(manifest, [record("conflated", ["EAP-FUNC-001"])])
    expect(assessment.malformedItemIds.map((entry) => entry.itemId)).toEqual(["EAP-FUNC-001"])
    expect(assessment.unknownItemIds).toEqual([])
  })

  test("ignores a record that names no Conformance Item at all", () => {
    const assessment = assessConformance(manifest, [record("scenario-only case", [])])
    expect(assessment.unknownItemIds).toEqual([])
    expect(assessment.malformedItemIds).toEqual([])
  })

  test("deduplicates an accumulating sink: the same record twice is one discharging case", () => {
    const claimed = manifest.items.find((item) => item.claim.state === "claimed")!
    const one = record("repeated case", [claimed.itemId])
    const assessment = assessConformance(manifest, [one, { ...one }, { ...one }])
    expect(assessment.items.find((item) => item.itemId === claimed.itemId)!.dischargedBy.length).toBe(1)
  })
})

describe("assessmentViolations", () => {
  test("ACCEPTANCE 1 — an undischarged claimed item fails the gate, naming the item", () => {
    const claimed = manifest.items.find((item) => item.claim.state === "claimed")!
    const violations = assessmentViolations(assessConformance(manifest, []))
    expect(violations.join("\n")).toContain(claimed.itemId)
    expect(violations.length).toBeGreaterThan(0)
  })

  test("ACCEPTANCE 3 — declared exclusions produce no violation", () => {
    const onlyExclusions = clone()
    onlyExclusions.items = onlyExclusions.items.filter((item) => item.claim.state !== "claimed")
    expect(onlyExclusions.items.length).toBeGreaterThan(0)
    expect(assessmentViolations(assessConformance(onlyExclusions, []))).toEqual([])
  })

  test("fails on an annotation naming an item the manifest does not carry", () => {
    const violations = assessmentViolations(assessConformance(manifest, [record("wrong id", ["EAP-L2-099"])]))
    expect(violations.join("\n")).toContain("EAP-L2-099")
  })

  test("fails on a Scenario Identifier smuggled into the Conformance Item channel", () => {
    const violations = assessmentViolations(assessConformance(manifest, [record("conflated", ["EAP-FUNC-001"])]))
    expect(violations.join("\n")).toMatch(/EAP-FUNC-001/)
    expect(violations.join("\n")).toMatch(/Scenario Identifier|Conformance Item Id/i)
  })

  test("passes when every claimed item is discharged by at least one test case", () => {
    const records = manifest.items
      .filter((item) => item.claim.state === "claimed")
      .map((item) => record(`discharges ${item.itemId}`, [item.itemId]))
    expect(assessmentViolations(assessConformance(manifest, records))).toEqual([])
  })
})

describe("renderAssessment", () => {
  test("ACCEPTANCE 2 — reports the client and the host under separate headings", () => {
    const report = renderAssessment(assessConformance(manifest, []))
    expect(report).toMatch(/client/i)
    expect(report).toMatch(/host/i)
    expect(report).toContain("L0")
    expect(report).toContain("L2")
    // One pass rate over both roles is precisely the number this report exists to refuse to print.
    expect(report.toLowerCase()).not.toContain("overall")
    expect(report.toLowerCase()).not.toContain("combined")
  })

  test("ACCEPTANCE 3 — prints declared exclusions in their own section, not among failures", () => {
    const report = renderAssessment(assessConformance(manifest, []))
    expect(report).toMatch(/declared exclusion/i)
    const excluded = manifest.items.find((item) => item.claim.state === "not-yet-claimed")!
    expect(report).toContain(excluded.itemId)
  })

  test("attributes each discharged item to the test case that discharged it", () => {
    const claimed = manifest.items.find((item) => item.claim.state === "claimed")!
    const report = renderAssessment(assessConformance(manifest, [record("the discharging case", [claimed.itemId])]))
    expect(report).toContain("the discharging case")
    expect(report).toContain(claimed.itemId)
  })
})

describe("loadManifest", () => {
  test("refuses a manifest written against a different schema version", () => {
    const mutated = clone()
    mutated.schemaVersion = MANIFEST_SCHEMA_VERSION + 1
    expect(() => loadManifest(JSON.stringify(mutated))).toThrow(/schemaVersion/)
  })

  test("refuses a manifest whose items are not an array", () => {
    expect(() => loadManifest(JSON.stringify({ schemaVersion: MANIFEST_SCHEMA_VERSION }))).toThrow()
  })
})

describe("renderReport", () => {
  test("reports counts per level and per claim state without inventing an assessment", () => {
    const report = renderReport(manifest, [])
    expect(report).toContain("L2")
    expect(report).toContain("not-yet-claimed")
    expect(report).toContain("EAP-L3-007")
    expect(report).toContain("27")
  })

  test("surfaces violations when there are any", () => {
    const report = renderReport(manifest, ["conformance: something is wrong"])
    expect(report).toContain("something is wrong")
  })
})
