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
  EXCLUDED_LEVELS,
  EVIDENCE_SURFACES,
  MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION,
  SELF_REPORT_PHRASES,
  WORKING_PAPER_PATH,
  extractAppendixD,
  loadManifest,
  loadRefusalTaxonomy,
  parseLevelClauses,
  renderReport,
  roleForLevel,
  sha256,
  validateManifest,
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

  test("claims L0, L1 and L2 in full", () => {
    for (const item of manifest.items) {
      if (item.level === "L3") continue
      expect(item.claim.state).toBe("claimed")
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
