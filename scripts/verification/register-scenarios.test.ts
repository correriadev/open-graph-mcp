import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  AREAS,
  REGISTER_PATH,
  SOURCE_PATH,
  areaForSection,
  loadScenarioRegister,
  mintIdentifier,
  parseScenarioHeadings,
  reconcileRegister,
  repoRoot,
  serializeRegister,
  type ScenarioRegister,
} from "./register-scenarios"

const ROOT = repoRoot()
const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex")
const readSource = (): string => readFileSync(join(ROOT, SOURCE_PATH), "utf8")

/**
 * Per-area scenario counts fixed by the closed area map of
 * docs/specs/cognitive_line_test_automation/003 §Section 2. Total = 71.
 */
const AREA_MAP_COUNTS: Record<string, number> = {
  LIFE: 3,
  HRZN: 4,
  ADMS: 3,
  PROM: 3,
  RECL: 4,
  VOBJ: 12,
  SVCS: 10,
  EVNT: 2,
  PERS: 9,
  XPRT: 5,
  CAPB: 3,
  FUNC: 4,
  ERRP: 4,
  SEC: 5,
}

const FIXTURE_TWO_AREAS = [
  "# Test Scenarios",
  "",
  "## 1. Unit Scenarios",
  "",
  "### 1.1 Aggregates and Decision Models",
  "",
  "#### Horizon `[E]`",
  "",
  "##### Should alpha `[E]`",
  "",
  "- **Given** a",
  "",
  "##### Should beta `[E]`",
  "",
  "- **Given** b",
  "",
  "##### Should gamma `[E]`",
  "",
  "- **Given** c",
  "",
  "### 1.2 Value Objects and Contract Types",
  "",
  "##### Should delta `[B]`",
  "",
  "- **Given** d",
  "",
].join("\n")

describe("parseScenarioHeadings — every 004 heading resolves to a covering area", () => {
  test("Should assign exactly one Scenario Identifier when a Given/When/Then heading is registered", () => {
    const parsed = parseScenarioHeadings(FIXTURE_TWO_AREAS)
    const register = reconcileRegister(null, parsed, "fixture-sha")

    expect(register.scenarios).toHaveLength(4)
    const alpha = register.scenarios.filter((s) => s.heading.includes("alpha"))
    expect(alpha).toHaveLength(1)
    expect(alpha[0]!.id).toBe("EAP-HRZN-001")
    expect(alpha[0]!.status).toBe("proposed")
    expect(new Set(register.scenarios.map((s) => s.id)).size).toBe(4)
  })

  test("finds exactly the 71 level-5 headings of the frozen 004", () => {
    const parsed = parseScenarioHeadings(readSource())
    expect(parsed).toHaveLength(71)
  })

  test("covers every section of 004 with exactly one area, matching the 003 area map counts", () => {
    const parsed = parseScenarioHeadings(readSource())
    const counts: Record<string, number> = {}
    for (const p of parsed) {
      expect(AREAS).toContain(p.area)
      counts[p.area] = (counts[p.area] ?? 0) + 1
    }
    expect(counts).toEqual(AREA_MAP_COUNTS)
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(71)
  })

  test("refuses a section that no area covers instead of inventing one", () => {
    expect(() => areaForSection("9.9", "Unknown Group")).toThrow(/9\.9/)
  })

  test("leaves 004 byte-identical — it is opened read-only", () => {
    const before = sha256(readSource())
    const parsed = parseScenarioHeadings(readSource())
    reconcileRegister(null, parsed, sha256(readSource()))
    expect(sha256(readSource())).toBe(before)
  })
})

describe("mintIdentifier — closed area set", () => {
  test("Should reject an area outside the closed set when a Scenario Identifier is minted", () => {
    expect(() => mintIdentifier("NOPE", 1)).toThrow(/NOPE/)
    expect(() => mintIdentifier("nope", 1)).toThrow(/nope/)
  })

  test("mints a zero-padded three-digit number inside the closed set", () => {
    expect(mintIdentifier("QUAR", 7)).toBe("EAP-QUAR-007")
    expect(mintIdentifier("SEC", 123)).toBe("EAP-SEC-123")
  })
})

describe("reconcileRegister — identifier stability", () => {
  test("Should reproduce every Scenario Identifier when the seeder re-runs against an unchanged source", () => {
    const parsed = parseScenarioHeadings(FIXTURE_TWO_AREAS)
    const first = reconcileRegister(null, parsed, "sha-1")
    const second = reconcileRegister(first, parseScenarioHeadings(FIXTURE_TWO_AREAS), "sha-1")

    expect(serializeRegister(second)).toBe(serializeRegister(first))
    for (const entry of first.scenarios) {
      const again = second.scenarios.find((s) => s.heading === entry.heading)
      expect(again?.id).toBe(entry.id)
    }
  })

  test("is byte-stable across a real regeneration of the frozen 004", () => {
    const source = readSource()
    const parsed = parseScenarioHeadings(source)
    const first = reconcileRegister(null, parsed, sha256(source))
    const second = reconcileRegister(first, parseScenarioHeadings(source), sha256(source))
    expect(serializeRegister(second)).toBe(serializeRegister(first))
  })

  test("Should keep the Scenario Identifier stable when the scenario heading text is renamed", () => {
    const parsed = parseScenarioHeadings(FIXTURE_TWO_AREAS)
    const first = reconcileRegister(null, parsed, "sha-1")
    const betaId = first.scenarios.find((s) => s.heading.includes("beta"))!.id

    const renamed = FIXTURE_TWO_AREAS.replace(
      "##### Should beta `[E]`",
      "##### Should beta, reworded for clarity `[E]`",
    )
    const second = reconcileRegister(first, parseScenarioHeadings(renamed), "sha-2")

    const moved = second.scenarios.find((s) => s.heading.includes("reworded"))
    expect(moved?.id).toBe(betaId)
    expect(moved?.heading).toBe("Should beta, reworded for clarity")
    expect(second.scenarios.filter((s) => !s.retired)).toHaveLength(4)
    expect(second.scenarios.some((s) => s.retired)).toBe(false)
  })

  test("keeps identifiers when a scenario is inserted in the middle, numbering only the newcomer", () => {
    const parsed = parseScenarioHeadings(FIXTURE_TWO_AREAS)
    const first = reconcileRegister(null, parsed, "sha-1")
    const before = new Map(first.scenarios.map((s) => [s.heading, s.id]))

    const inserted = FIXTURE_TWO_AREAS.replace(
      "##### Should beta `[E]`",
      "##### Should inserted `[E]`\n\n- **Given** i\n\n##### Should beta `[E]`",
    )
    const second = reconcileRegister(first, parseScenarioHeadings(inserted), "sha-3")

    for (const [heading, id] of before) {
      expect(second.scenarios.find((s) => s.heading === heading)?.id).toBe(id)
    }
    expect(second.scenarios.find((s) => s.heading === "Should inserted")?.id).toBe("EAP-HRZN-004")
    expect(second.scenarios).toHaveLength(5)
  })

  test("Should refuse to reuse a Scenario Identifier when its scenario has been retired", () => {
    const first = reconcileRegister(null, parseScenarioHeadings(FIXTURE_TWO_AREAS), "sha-1")
    const gammaId = first.scenarios.find((s) => s.heading.includes("gamma"))!.id
    expect(gammaId).toBe("EAP-HRZN-003")

    // gamma is deleted from the source; a brand-new scenario takes its place in the same area.
    const removed = FIXTURE_TWO_AREAS.replace(
      "##### Should gamma `[E]`\n\n- **Given** c\n\n",
      "##### Should brand new `[E]`\n\n- **Given** n\n\n",
    )
    const second = reconcileRegister(first, parseScenarioHeadings(removed), "sha-4")

    const retired = second.scenarios.find((s) => s.id === gammaId)
    expect(retired?.retired).toBe(true)
    expect(retired?.heading).toBe("Should gamma")

    const fresh = second.scenarios.find((s) => s.heading === "Should brand new")
    expect(fresh?.id).toBe("EAP-HRZN-004")
    expect(fresh?.id).not.toBe(gammaId)

    // And a third generation still may not fall back onto the retired number.
    const third = reconcileRegister(
      second,
      parseScenarioHeadings(
        removed.replace(
          "##### Should brand new `[E]`",
          "##### Should brand new `[E]`\n\n- **Given** q\n\n##### Should later still `[E]`",
        ),
      ),
      "sha-5",
    )
    expect(third.scenarios.find((s) => s.heading === "Should later still")?.id).toBe("EAP-HRZN-005")
    expect(third.scenarios.find((s) => s.id === gammaId)?.retired).toBe(true)
  })

  test("never emits an evidenced status from the seeder", () => {
    const register = reconcileRegister(null, parseScenarioHeadings(readSource()), "sha-x")
    expect(register.scenarios.every((s) => s.status === "proposed")).toBe(true)
  })

  test("preserves a status set by a downstream task instead of resetting it to proposed", () => {
    const first = reconcileRegister(null, parseScenarioHeadings(FIXTURE_TWO_AREAS), "sha-1")
    const quarantined: ScenarioRegister = {
      ...first,
      scenarios: first.scenarios.map((s) =>
        s.heading === "Should delta" ? { ...s, status: "declared-untestable" as const } : s,
      ),
    }
    const second = reconcileRegister(
      quarantined,
      parseScenarioHeadings(FIXTURE_TWO_AREAS),
      "sha-1",
    )
    expect(second.scenarios.find((s) => s.heading === "Should delta")?.status).toBe(
      "declared-untestable",
    )
  })
})

describe("loadScenarioRegister — evidenced is not author-writable", () => {
  test("Should refuse an authored `evidenced` status when the register is loaded", () => {
    const first = reconcileRegister(null, parseScenarioHeadings(FIXTURE_TWO_AREAS), "sha-1")
    const tampered = JSON.parse(serializeRegister(first)) as ScenarioRegister
    tampered.scenarios[1]!.status = "evidenced"
    const raw = JSON.stringify(tampered)

    expect(() => loadScenarioRegister(raw)).toThrow(new RegExp(tampered.scenarios[1]!.id))
    expect(() => loadScenarioRegister(raw)).toThrow(/evidenced/)
    // The derivation service is the one writer allowed to carry that status.
    expect(loadScenarioRegister(raw, { writer: "derivation" }).scenarios[1]!.status).toBe(
      "evidenced",
    )
  })

  test("rejects an identifier whose area is outside the closed set", () => {
    const first = reconcileRegister(null, parseScenarioHeadings(FIXTURE_TWO_AREAS), "sha-1")
    const tampered = JSON.parse(serializeRegister(first)) as ScenarioRegister
    tampered.scenarios[0]!.id = "EAP-NOPE-001"
    expect(() => loadScenarioRegister(JSON.stringify(tampered))).toThrow(/NOPE/)
  })

  test("rejects a duplicated identifier", () => {
    const first = reconcileRegister(null, parseScenarioHeadings(FIXTURE_TWO_AREAS), "sha-1")
    const tampered = JSON.parse(serializeRegister(first)) as ScenarioRegister
    tampered.scenarios[1]!.id = tampered.scenarios[0]!.id
    expect(() => loadScenarioRegister(JSON.stringify(tampered))).toThrow(/duplicate/i)
  })

  test("rejects a status outside the closed union", () => {
    const first = reconcileRegister(null, parseScenarioHeadings(FIXTURE_TWO_AREAS), "sha-1")
    const tampered = JSON.parse(serializeRegister(first)) as Record<string, unknown>
    ;(tampered.scenarios as Record<string, unknown>[])[0]!.status = "verified"
    expect(() => loadScenarioRegister(JSON.stringify(tampered))).toThrow(/verified/)
  })
})

describe("committed register — docs/verification/scenario-register.json", () => {
  const committedRaw = (): string => readFileSync(join(ROOT, REGISTER_PATH), "utf8")

  test("holds one entry per 004 heading, all at status proposed", () => {
    const register = loadScenarioRegister(committedRaw())
    // Entries minted from `004` itself. Task 04 adds `QUAR` members that come from no `004`
    // heading and are `declared-untestable` by construction, so they are excluded here.
    const fromSource = register.scenarios.filter((s) => !s.retired && s.area !== "QUAR")
    expect(fromSource).toHaveLength(71)
    expect(fromSource.every((s) => s.status === "proposed")).toBe(true)
    expect(register.source.path).toBe(SOURCE_PATH)
  })

  test("records the sha256 of the frozen 004 it was seeded from", () => {
    const register = loadScenarioRegister(committedRaw())
    expect(register.source.sha256).toBe(sha256(readSource()))
    expect(register.source.headingCount).toBe(71)
  })

  test("regenerates byte for byte from the unchanged 004, reassigning nothing", () => {
    const source = readSource()
    const committed = loadScenarioRegister(committedRaw(), { writer: "derivation" })
    const regenerated = reconcileRegister(
      committed,
      parseScenarioHeadings(source),
      sha256(source),
    )
    expect(serializeRegister(regenerated)).toBe(committedRaw())
  })

  test("uses every area of the map, and of the reserved areas only QUAR", () => {
    const register = loadScenarioRegister(committedRaw())
    const used = new Set(register.scenarios.map((s) => s.area))
    // QUAR is populated by task 04 with the QA1-QA7 family members; CNTS and CLNT stay reserved
    // and empty. Every scenario the seeder derives from `004` still lands in the mapped areas.
    expect([...used].sort()).toEqual([...Object.keys(AREA_MAP_COUNTS), "QUAR"].sort())
    for (const reserved of ["CNTS", "CLNT"]) expect(used.has(reserved)).toBe(false)
    expect(
      register.scenarios.filter((s) => s.area === "QUAR").every((s) => s.status === "declared-untestable"),
    ).toBe(true)
  })
})
