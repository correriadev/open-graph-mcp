import { describe, expect, it, beforeEach } from "bun:test"
import { promoteKnowledge, Horizon, PromotionRequest } from "@open-graph-mcp/graph-core/eap/promotion"
import { PromotionService } from "../src/eap/promotion-service"

describe("One-Edge Promotion (Task 06)", () => {
  let service: PromotionService

  const parentHorizon: Horizon = {
    id: "horizon-parent-01",
    parentId: null,
    currentSeq: 10,
  }

  const childHorizon: Horizon = {
    id: "horizon-child-01",
    parentId: "horizon-parent-01",
    currentSeq: 10,
  }

  beforeEach(() => {
    service = new PromotionService()
    service.registerHorizon(parentHorizon)
    service.registerHorizon(childHorizon)
  })

  it("returns HORIZON_SKIP when Promotion targets a non-parent Horizon", () => {
    const request: PromotionRequest = {
      childId: childHorizon.id,
      parentId: "horizon-other-99",
      basedOnSeq: 10,
      distilled: [{ id: "c1", content: "distilled claim" }],
    }

    const result = service.promote(request)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.refusalCode).toBe("HORIZON_SKIP")
    }
  })

  it("returns STALE_BASE when basedOnSeq precedes current applicable Sequence", () => {
    const request: PromotionRequest = {
      childId: childHorizon.id,
      parentId: parentHorizon.id,
      basedOnSeq: 5,
      distilled: [{ id: "c1", content: "distilled claim" }],
    }

    const result = service.promote(request)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.refusalCode).toBe("STALE_BASE")
    }
  })

  it("creates a parent proposal in proposed status when Promotion succeeds", () => {
    const request: PromotionRequest = {
      childId: childHorizon.id,
      parentId: parentHorizon.id,
      basedOnSeq: 10,
      distilled: [{ id: "c1", content: "distilled pattern" }],
    }

    const result = service.promote(request)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.proposal.status).toBe("proposed")
    }
  })
})
