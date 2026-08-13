import { describe, expect } from "bun:test"
import { annotatedTest } from "../../mcp-server/test/verification/annotate"
import { Horizon } from "../src/eap/horizon"

describe("Horizon Governance Aggregate (Task 03)", () => {
  annotatedTest(
    "1. Non-root horizon requires declared parent",
    {
      asserts: ["EAP-HRZN-002"],
      // EAP-HRZN-001 additionally requires a provenanced Negotiation Seed, a valid Budget Ledger,
      // and the absence of inherited Relative Authority. Only the declared-parent clause is here.
      coversPartially: ["EAP-HRZN-001"],
    },
    () => {
    expect(() => new Horizon({ id: "child-1", parentId: "" })).toThrow("declared parent")
    const root = new Horizon({ id: "root-1", isRoot: true })
    expect(root.isRoot).toBe(true)
    const child = new Horizon({ id: "child-1", parentId: "root-1" })
    expect(child.parentId).toBe("root-1")
    },
  )

  annotatedTest(
    "2. Budget exhaustion produces escalation",
    // EAP-HRZN-003 also requires that `HorizonBudgetExhausted` is RECORDED. This case observes the
    // escalation outcome and its reason only — no event is inspected — so the link is partial.
    { coversPartially: ["EAP-HRZN-003"] },
    () => {
    const horizon = new Horizon({ id: "hz-1", budgetLimit: 10 })
    const seed = { provenance: [{ id: "ev-1", type: "doc" }], references: [] }
    const res1 = horizon.requestPromotion(seed, 10)
    expect(res1.outcome).toBe("promoted")

    const res2 = horizon.requestPromotion(seed, 10)
    expect(res2.outcome).toBe("escalate")
    expect(res2.reason).toBe("BUDGET_EXHAUSTED")
    },
  )

  annotatedTest(
    "3. Relative Authority cannot be assigned to another horizon",
    { asserts: ["EAP-HRZN-004"] },
    () => {
    const horizon = new Horizon({ id: "hz-1" })
    const resForbidden = horizon.assignRelativeAuthority("other-hz")
    expect(resForbidden.success).toBe(false)
    expect(horizon.hasRelativeAuthority()).toBe(false)

    const resOk = horizon.assignRelativeAuthority("hz-1")
    expect(resOk.success).toBe(true)
    expect(horizon.hasRelativeAuthority()).toBe(true)
    },
  )
})
