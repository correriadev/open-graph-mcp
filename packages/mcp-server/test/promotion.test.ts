import { describe, expect, beforeEach, afterEach } from "bun:test"
import { annotatedTest } from "./verification/annotate"
import { Horizon, PromotionRequest } from "@open-graph-mcp/graph-core/eap/promotion"
import { PromotionService } from "../src/eap/promotion-service"
import { createEapEnv, type EapEnv } from "./eap-env"

describe("One-Edge Promotion (Task 06)", () => {
  let env: EapEnv
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
    env = createEapEnv()
    service = new PromotionService(env.promotions)
    service.registerHorizon(parentHorizon)
    service.registerHorizon(childHorizon)
  })

  afterEach(() => {
    env.cleanup()
  })

  annotatedTest(
    "returns HORIZON_SKIP when Promotion targets a non-parent Horizon",
    // Refused with HORIZON_SKIP and no parent proposal stored — both clauses of EAP-PROM-002.
    { asserts: ["EAP-PROM-002"] },
    () => {
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
    expect(service.getProposalsForParent("horizon-other-99")).toHaveLength(0)
    },
  )

  annotatedTest(
    "returns STALE_BASE when basedOnSeq precedes current applicable Sequence",
    // The normative stale refusal, and no knowledge transferred (no proposal in the parent).
    { asserts: ["EAP-PROM-003"] },
    () => {
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
    expect(service.getProposalsForParent(parentHorizon.id)).toHaveLength(0)
    },
  )

  annotatedTest(
    "creates a parent proposal in proposed status when Promotion succeeds",
    // EAP-PROM-001 also requires "without inherited admission or Relative Authority". This case
    // shows the parent proposal exists in `proposed` status; the non-inheritance clause is asserted
    // by f001-transport-delegation's "a candidate that has not reached VERIFIED..." case.
    { coversPartially: ["EAP-PROM-001"] },
    () => {
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
      expect(service.getProposalsForParent(parentHorizon.id).map((p) => p.id)).toContain(result.proposal.id)
    }
    },
  )
})
