import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  FAMILY_IDS,
  QUARANTINE_PATH,
  QUARANTINE_MEMBERS,
  assertQuarantineConsistentWithRegister,
  attemptLift,
  loadQuarantine,
  membersOf,
  reconcileQuarantineMembers,
  serializeQuarantine,
  type QuarantineDocument,
  type QuarantineFamily,
} from "./quarantine"
import {
  REGISTER_PATH,
  SOURCE_PATH,
  loadScenarioRegister,
  parseScenarioHeadings,
  reconcileRegister,
  repoRoot,
  serializeRegister,
  type ScenarioRegister,
} from "./register-scenarios"

const ROOT = repoRoot()

const readQuarantineRaw = (): string => readFileSync(join(ROOT, QUARANTINE_PATH), "utf8")
const readQuarantine = (): QuarantineDocument => loadQuarantine(readQuarantineRaw())
const readRegister = (): ScenarioRegister =>
  loadScenarioRegister(readFileSync(join(ROOT, REGISTER_PATH), "utf8"))

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/**
 * `004` §1.1 "Ambiguity Quarantine": Should hold exactly seven families when the Ambiguity
 * Quarantine is loaded.
 */
describe("Ambiguity Quarantine — exactly seven families", () => {
  test("holds exactly seven families QA1-QA7 when the committed document is loaded", () => {
    const doc = readQuarantine()
    expect(doc.families.map((f) => f.id)).toEqual([...FAMILY_IDS])
    expect(doc.families).toHaveLength(7)
  })

  test("every family names at least one source clause and a lifting ADR amendment", () => {
    for (const family of readQuarantine().families) {
      expect(family.sourceClauses.length).toBeGreaterThan(0)
      for (const clause of family.sourceClauses) expect(clause.trim().length).toBeGreaterThan(0)
      // The lifting condition must name the family it lifts, so no amendment can lift by accident.
      expect(family.liftingCondition).toContain(family.id)
      expect(family.liftingAdr.trim().length).toBeGreaterThan(0)
    }
  })

  test("rejects a six-family document", () => {
    const doc = clone(readQuarantine())
    doc.families = doc.families.filter((f) => f.id !== "QA7")
    expect(() => loadQuarantine(JSON.stringify(doc))).toThrow(/exactly seven/i)
  })

  test("rejects an eight-family document", () => {
    const doc = clone(readQuarantine())
    const eighth = { ...clone(doc.families[0]!), id: "QA8" } as unknown as QuarantineFamily
    doc.families = [...doc.families, eighth]
    expect(() => loadQuarantine(JSON.stringify(doc))).toThrow(/QA8|exactly seven/i)
  })

  test("rejects a family id outside the closed union QA1..QA7", () => {
    const doc = clone(readQuarantine())
    ;(doc.families[2] as unknown as { id: string }).id = "QA0"
    expect(() => loadQuarantine(JSON.stringify(doc))).toThrow(/QA0/)
  })

  test("rejects a family whose lifting condition is missing", () => {
    const doc = clone(readQuarantine())
    doc.families[0]!.liftingCondition = ""
    expect(() => loadQuarantine(JSON.stringify(doc))).toThrow(/lifting/i)
  })

  test("rejects a family with no source clause", () => {
    const doc = clone(readQuarantine())
    doc.families[1]!.sourceClauses = []
    expect(() => loadQuarantine(JSON.stringify(doc))).toThrow(/source clause/i)
  })

  test("re-serializing the committed document is byte-identical", () => {
    expect(serializeQuarantine(readQuarantine())).toBe(readQuarantineRaw())
  })
})

/**
 * `004` §1.1: Should mark every member Declared Untestable when a family is recorded.
 */
describe("Ambiguity Quarantine — members are Declared Untestable", () => {
  test("leaves no family memberless", () => {
    const doc = readQuarantine()
    for (const id of FAMILY_IDS) expect(membersOf(doc, id).length).toBeGreaterThan(0)
  })

  test("shares no member between two families", () => {
    const all = readQuarantine().families.flatMap((f) => f.members)
    expect(new Set(all).size).toBe(all.length)
  })

  test("every member is registered in the reserved QUAR area", () => {
    const register = readRegister()
    const byId = new Map(register.scenarios.map((e) => [e.id, e]))
    for (const family of readQuarantine().families) {
      for (const member of family.members) {
        const entry = byId.get(member)
        expect(entry).toBeDefined()
        expect(entry!.area).toBe("QUAR")
        expect(entry!.retired).toBeUndefined()
      }
    }
  })

  test("every member carries status declared-untestable and neither [E] nor [B]", () => {
    const register = readRegister()
    const byId = new Map(register.scenarios.map((e) => [e.id, e]))
    for (const family of readQuarantine().families) {
      for (const member of family.members) {
        const entry = byId.get(member)!
        expect(entry.status).toBe("declared-untestable")
        expect(entry.heading).not.toMatch(/\[[EB]\]/)
      }
    }
  })

  test("the committed pair is consistent", () => {
    expect(() => assertQuarantineConsistentWithRegister(readQuarantine(), readRegister())).not.toThrow()
  })

  test("refuses a member left at proposed", () => {
    const register = clone(readRegister())
    const member = readQuarantine().families[0]!.members[0]!
    register.scenarios.find((e) => e.id === member)!.status = "proposed"
    expect(() => assertQuarantineConsistentWithRegister(readQuarantine(), register)).toThrow(
      new RegExp(`${member}[\\s\\S]*declared-untestable`, "i"),
    )
  })

  test("refuses a member whose heading carries an [E] or [B] marker", () => {
    const register = clone(readRegister())
    const member = readQuarantine().families[0]!.members[0]!
    const entry = register.scenarios.find((e) => e.id === member)!
    entry.heading = `${entry.heading} \`[E]\``
    expect(() => assertQuarantineConsistentWithRegister(readQuarantine(), register)).toThrow(
      /\[E\]|marker/i,
    )
  })

  test("refuses a member that is absent from the register", () => {
    const register = clone(readRegister())
    const member = readQuarantine().families[2]!.members[0]!
    register.scenarios = register.scenarios.filter((e) => e.id !== member)
    expect(() => assertQuarantineConsistentWithRegister(readQuarantine(), register)).toThrow(
      new RegExp(member),
    )
  })
})

/**
 * `004` §1.1: Should record measurement-without-assertion when the timing side-channel family is
 * stored. `001` §5 rule 3 extends the same admission to QA6.
 */
describe("Ambiguity Quarantine — measurement without assertion", () => {
  test("QA7 may measure and record but may never assert an expected outcome", () => {
    const qa7 = readQuarantine().families.find((f) => f.id === "QA7")!
    expect(qa7.measurement.mayMeasure).toBe(true)
    expect(qa7.measurement.mayAssert).toBe(false)
    expect(qa7.measurement.note).toMatch(/timing/i)
    expect(qa7.measurement.note).toMatch(/measure/i)
    expect(qa7.measurement.note).toMatch(/never assert|may not assert|not assert/i)
  })

  test("QA6 admits a Benchmark Ledger measurement and forbids asserting a bound", () => {
    const qa6 = readQuarantine().families.find((f) => f.id === "QA6")!
    expect(qa6.measurement.mayMeasure).toBe(true)
    expect(qa6.measurement.mayAssert).toBe(false)
    expect(qa6.measurement.note).toMatch(/benchmark ledger/i)
  })

  test("no family may ever assert an expected outcome", () => {
    for (const family of readQuarantine().families) expect(family.measurement.mayAssert).toBe(false)
  })

  test("rejects any document that grants a family permission to assert", () => {
    const doc = clone(readQuarantine())
    ;(doc.families[6]!.measurement as { mayAssert: boolean }).mayAssert = true
    expect(() => loadQuarantine(JSON.stringify(doc))).toThrow(/assert/i)
  })

  test("rejects a measuring family that records no measurement note", () => {
    const doc = clone(readQuarantine())
    doc.families[5]!.measurement.note = null
    expect(() => loadQuarantine(JSON.stringify(doc))).toThrow(/note/i)
  })
})

/**
 * `004` §1.1: Should refuse a lift when no merged ADR amendment names the family.
 */
describe("Ambiguity Quarantine — lifting", () => {
  test("refuses the lift and keeps the family when no merged amendment names it", () => {
    const doc = readQuarantine()
    const decision = attemptLift(doc, "QA4", [])
    expect(decision.lifted).toBe(false)
    expect(decision.reason).toMatch(/QA4/)
    expect(decision.document.families.map((f) => f.id)).toEqual([...FAMILY_IDS])
    expect(decision.memberStatus).toBe("declared-untestable")
  })

  test("refuses the lift when a merged amendment does not name the family", () => {
    const decision = attemptLift(readQuarantine(), "QA4", [
      { id: "ADR-0022", merged: true, namesFamilies: ["QA2"] },
    ])
    expect(decision.lifted).toBe(false)
    expect(decision.document.families).toHaveLength(7)
  })

  test("refuses the lift when an amendment names the family but is not merged", () => {
    const decision = attemptLift(readQuarantine(), "QA4", [
      { id: "ADR-0022", merged: false, namesFamilies: ["QA4"] },
    ])
    expect(decision.lifted).toBe(false)
    expect(decision.reason).toMatch(/merged/i)
    expect(decision.document.families).toHaveLength(7)
  })

  test("lifts only on a merged amendment naming the family, re-entering members as proposed", () => {
    const decision = attemptLift(readQuarantine(), "QA4", [
      { id: "ADR-0022", merged: true, namesFamilies: ["QA4"] },
    ])
    expect(decision.lifted).toBe(true)
    expect(decision.memberStatus).toBe("proposed")
    expect(decision.document.families.map((f) => f.id)).not.toContain("QA4")
    expect(decision.document.families).toHaveLength(6)
  })

  test("never mutates the document it was given", () => {
    const doc = readQuarantine()
    attemptLift(doc, "QA4", [{ id: "ADR-0022", merged: true, namesFamilies: ["QA4"] }])
    expect(doc.families).toHaveLength(7)
  })
})

/**
 * The register keeps task 03's 71 `004` headings intact and gains exactly the QUAR members; a
 * re-run of the seeder may never revert a `declared-untestable` mark back to `proposed`.
 */
describe("Scenario Register — quarantine members survive re-seeding", () => {
  test("keeps task 03's 71 headings at proposed and adds only QUAR members", () => {
    const register = readRegister()
    const quar = register.scenarios.filter((e) => e.area === "QUAR")
    const rest = register.scenarios.filter((e) => e.area !== "QUAR")
    expect(rest).toHaveLength(71)
    expect(rest.every((e) => e.status === "proposed")).toBe(true)
    expect(quar).toHaveLength(QUARANTINE_MEMBERS.length)
    expect(quar.every((e) => e.status === "declared-untestable")).toBe(true)
  })

  test("re-running the register seeder does not revert declared-untestable to proposed", () => {
    const register = readRegister()
    const source = readFileSync(join(ROOT, SOURCE_PATH), "utf8")
    const reseeded = reconcileRegister(register, parseScenarioHeadings(source), register.source.sha256)
    const byId = new Map(reseeded.scenarios.map((e) => [e.id, e]))
    for (const member of readQuarantine().families.flatMap((f) => f.members)) {
      expect(byId.get(member)?.status).toBe("declared-untestable")
      expect(byId.get(member)?.retired).toBeUndefined()
    }
    expect(serializeRegister(reseeded)).toBe(readFileSync(join(ROOT, REGISTER_PATH), "utf8"))
  })

  test("reconciling quarantine members into the register is idempotent", () => {
    const register = readRegister()
    const once = reconcileQuarantineMembers(register, readQuarantine())
    const twice = reconcileQuarantineMembers(once, readQuarantine())
    expect(serializeRegister(once)).toBe(serializeRegister(twice))
    expect(serializeRegister(once)).toBe(readFileSync(join(ROOT, REGISTER_PATH), "utf8"))
  })

  test("restores a hand-reverted member status on the next reconciliation", () => {
    const register = clone(readRegister())
    const member = QUARANTINE_MEMBERS[0]!.id
    register.scenarios.find((e) => e.id === member)!.status = "proposed"
    const fixed = reconcileQuarantineMembers(register, readQuarantine())
    expect(fixed.scenarios.find((e) => e.id === member)!.status).toBe("declared-untestable")
  })

  test("mints no member that already carries an [E] or [B] marker in its heading", () => {
    for (const member of QUARANTINE_MEMBERS) expect(member.heading).not.toMatch(/\[[EB]\]/)
  })
})
