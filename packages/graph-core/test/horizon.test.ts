import { describe, expect, it } from "bun:test"
import { Horizon, getPromotionParent, validatePromotionTarget } from "../src/eap/horizon"

describe("Horizon Governance Aggregate (Task 03)", () => {
  it("1. Non-root horizon requires declared parent", () => {
    expect(() => new Horizon({ id: "child-1", parentId: "" })).toThrow("declared parent")
    const root = new Horizon({ id: "root-1", isRoot: true })
    expect(root.isRoot).toBe(true)
    const child = new Horizon({ id: "child-1", parentId: "root-1" })
    expect(child.parentId).toBe("root-1")
  })

  it("2. Budget exhaustion produces escalation", () => {
    const horizon = new Horizon({ id: "hz-1", budgetLimit: 10 })
    const seed = { provenance: [{ id: "ev-1", type: "doc" }], references: [] }
    const res1 = horizon.requestPromotion(seed, 10)
    expect(res1.outcome).toBe("promoted")

    const res2 = horizon.requestPromotion(seed, 10)
    expect(res2.outcome).toBe("escalate")
    expect(res2.reason).toBe("BUDGET_EXHAUSTED")
  })

  it("3. Relative Authority cannot be assigned to another horizon", () => {
    const horizon = new Horizon({ id: "hz-1" })
    const resForbidden = horizon.assignRelativeAuthority("other-hz")
    expect(resForbidden.success).toBe(false)
    expect(horizon.hasRelativeAuthority()).toBe(false)

    const resOk = horizon.assignRelativeAuthority("hz-1")
    expect(resOk.success).toBe(true)
    expect(horizon.hasRelativeAuthority()).toBe(true)
  })

  describe("Normative Promotion Parent Topology (Task 07)", () => {
    it("names transformation as parent of negotiation and microtask", () => {
      expect(getPromotionParent("negotiation")).toBe("transformation");
      expect(getPromotionParent("microtask")).toBe("transformation");
    });

    it("names persistent as parent of transformation", () => {
      expect(getPromotionParent("transformation")).toBe("persistent");
    });

    it("persistent has no parent (root)", () => {
      expect(getPromotionParent("persistent")).toBeNull();
    });

    it("excludes session from promotion parents", () => {
      expect(() => getPromotionParent("session")).toThrow(/Session is excluded/);
      expect(() => validatePromotionTarget("session", "transformation")).toThrow(/Session is excluded/);
    });

    it("returns HORIZON_SKIP on non-parent promotion target", () => {
      // microtask promoting directly to persistent skips transformation
      expect(() => validatePromotionTarget("microtask", "persistent")).toThrow(/HORIZON_SKIP/);
      expect(() => validatePromotionTarget("negotiation", "persistent")).toThrow(/HORIZON_SKIP/);
    });

    it("accepts valid immediate parent promotion targets", () => {
      expect(() => validatePromotionTarget("negotiation", "transformation")).not.toThrow();
      expect(() => validatePromotionTarget("microtask", "transformation")).not.toThrow();
      expect(() => validatePromotionTarget("transformation", "persistent")).not.toThrow();
    });
  });
})

