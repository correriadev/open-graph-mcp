import { describe, expect, test } from "bun:test"
import { Horizon } from "../src/eap/horizon"

describe("Horizon Governance Aggregate (Task 03)", () => {
  test("1. Non-root horizon requires declared parent", () => {
    expect(() => new Horizon({ id: "child-1", parentId: "" })).toThrow("declared parent")
    const root = new Horizon({ id: "root-1", isRoot: true })
    expect(root.isRoot).toBe(true)
    const child = new Horizon({ id: "child-1", parentId: "root-1" })
    expect(child.parentId).toBe("root-1")
  })

  test("2. Budget exhaustion produces escalation", () => {
    const horizon = new Horizon({ id: "hz-1", budgetLimit: 10 })
    const seed = { provenance: [{ id: "ev-1", type: "doc" }], references: [] }
    const res1 = horizon.requestPromotion(seed, 10)
    expect(res1.outcome).toBe("promoted")

    const res2 = horizon.requestPromotion(seed, 10)
    expect(res2.outcome).toBe("escalate")
    expect(res2.reason).toBe("BUDGET_EXHAUSTED")
  })

  test("3. Relative Authority cannot be assigned to another horizon", () => {
    const horizon = new Horizon({ id: "hz-1" })
    const resForbidden = horizon.assignRelativeAuthority("other-hz")
    expect(resForbidden.success).toBe(false)
    expect(horizon.hasRelativeAuthority()).toBe(false)

    const resOk = horizon.assignRelativeAuthority("hz-1")
    expect(resOk.success).toBe(true)
    expect(horizon.hasRelativeAuthority()).toBe(true)
  })
})
