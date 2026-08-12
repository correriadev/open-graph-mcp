/**
 * f001-retry5-durability.test.ts
 *
 * Regression suite for REWORK-LOG defect class 1 (DURABILITY / STATE DIVERGENCE) and
 * defect class 2 (UNBOUNDED MEMORY GROWTH), Feature F001 / domain cognitive_line.
 *
 * Every assertion here fails against a service that keeps epistemic state in a volatile
 * in-memory Map: the environment is closed and reopened from disk between write and read.
 */
import { describe, expect, test } from "bun:test"
import { createEapEnv } from "./eap-env"
import { startServer } from "../src/index"
import { callTool, register } from "./helpers"
import { SqliteContestationRepository, SqlitePromotionRepository } from "../src/eap/eap-repositories"
import { PromotionService } from "../src/eap/promotion-service"
import { ContestationService } from "../src/eap/contestation-service"
import { RecallWorker } from "../src/eap/recall-worker"
import { CapabilityGateway } from "../src/eap/capability-gateway"
import { InMemoryDependencyQuery, type RecallNotice } from "@open-graph-mcp/graph-core/eap/recall"
import type { OperatorApproval, CapabilityExecutionRequest } from "@open-graph-mcp/graph-core/eap/capabilities"

describe("F001 retry#5 — defect 1: durable epistemic state (no volatile Maps)", () => {
  test("PromotionService proposals and events survive a host process restart", () => {
    let env = createEapEnv()
    try {
      const before = new PromotionService(env.promotions)
      before.registerHorizon({ id: "hz-parent", parentId: null, currentSeq: 10 })
      before.registerHorizon({ id: "hz-child", parentId: "hz-parent", currentSeq: 10 })

      const result = before.promote({
        childId: "hz-child",
        parentId: "hz-parent",
        basedOnSeq: 10,
        distilled: [{ id: "c1", content: "distilled pattern" }],
      })
      expect(result.success).toBe(true)

      env = env.restart()

      const after = new PromotionService(env.promotions)
      expect(after.getHorizon("hz-child")?.parentId).toBe("hz-parent")
      const proposals = after.getProposalsForParent("hz-parent")
      expect(proposals).toHaveLength(1)
      expect(proposals[0].status).toBe("proposed")
      expect(after.getEvents()).toHaveLength(1)
    } finally {
      env.cleanup()
    }
  })

  test("PromotionService keeps no in-memory aggregate store", () => {
    const env = createEapEnv()
    try {
      const svc = new PromotionService(env.promotions) as unknown as Record<string, unknown>
      expect(svc.store).toBeUndefined()
    } finally {
      env.cleanup()
    }
  })

  test("ContestationService contestations survive a host process restart", () => {
    let env = createEapEnv()
    try {
      const before = new ContestationService(env.contestations)
      const admitted = before.contestKnowledge({
        id: "contest-durable-1",
        sourceHorizonId: "hz-beta",
        targetClaimIds: ["claim-101"],
        evidenceRefs: ["proof-url-999"],
        severity: "invalidating",
      })
      expect(admitted.status).toBe("ADMITTED")

      env = env.restart()

      const after = new ContestationService(env.contestations)
      const found = after.getContestation("contest-durable-1")
      expect(found).toBeDefined()
      expect(found?.severity).toBe("invalidating")
      expect(after.initiateRecall("contest-durable-1").status).toBe("INITIATED")
    } finally {
      env.cleanup()
    }
  })

  test("ContestationService allocates monotonic sequences from durable storage, not a reset counter", () => {
    let env = createEapEnv()
    try {
      const before = new ContestationService(env.contestations)
      const first = before.contestKnowledge({
        id: "c-seq-1",
        sourceHorizonId: "hz",
        targetClaimIds: ["k1"],
        evidenceRefs: ["e1"],
        severity: "blocking",
      })
      expect(first.status).toBe("ADMITTED")
      const firstSeq = first.status === "ADMITTED" ? (first.contestation.seq ?? -1) : -1

      env = env.restart()

      const after = new ContestationService(env.contestations)
      const second = after.contestKnowledge({
        id: "c-seq-2",
        sourceHorizonId: "hz",
        targetClaimIds: ["k2"],
        evidenceRefs: ["e2"],
        severity: "blocking",
      })
      expect(second.status).toBe("ADMITTED")
      const secondSeq = second.status === "ADMITTED" ? (second.contestation.seq ?? -1) : -1
      expect(secondSeq).toBeGreaterThan(firstSeq)
    } finally {
      env.cleanup()
    }
  })

  test("RecallWorker checkpoints survive a restart and resume to the same affected set", async () => {
    let env = createEapEnv()
    try {
      const depQuery = new InMemoryDependencyQuery([
        { from: "claim-B", to: "claim-A" },
        { from: "claim-C", to: "claim-B" },
      ])
      const notice: RecallNotice = {
        recallId: "rec-durable-1",
        contestationId: "cont-durable-1",
        targetClaimIds: ["claim-A"],
        severity: "invalidating",
        contestationStatus: "admitted",
        initiatedAt: new Date().toISOString(),
      }

      const before = new RecallWorker(env.recalls, depQuery)
      const created = await before.initiateRecall(notice)
      expect("refused" in created).toBe(false)
      const firstBatch = await before.processBatch("rec-durable-1", 1)
      expect(firstBatch).not.toBeNull()
      const processedBeforeRestart = firstBatch!.checkpoint.processedClaimIds.length
      expect(processedBeforeRestart).toBeGreaterThan(0)

      env = env.restart()

      const after = new RecallWorker(env.recalls, depQuery)
      const restored = await env.recalls.get("rec-durable-1")
      expect(restored).not.toBeNull()
      expect(restored!.checkpoint.processedClaimIds.length).toBe(processedBeforeRestart)

      let guard = 0
      let progress = await after.processBatch("rec-durable-1", 1)
      while (progress && !progress.isComplete && guard++ < 50) {
        progress = await after.processBatch("rec-durable-1", 1)
      }
      expect(progress?.isComplete).toBe(true)
      expect(new Set(progress!.checkpoint.processedClaimIds)).toEqual(
        new Set(["claim-A", "claim-B", "claim-C"])
      )
      expect(await after.getScar("rec-durable-1")).not.toBeNull()
    } finally {
      env.cleanup()
    }
  })

  test("operator approvals and their consumed flag survive a restart", () => {
    let env = createEapEnv()
    try {
      const approval: OperatorApproval = {
        id: "appr-durable",
        approver: "operator-alice",
        scope: "deploy.production",
        expiresAt: Date.now() + 3_600_000,
        basedOnSeq: 7,
      }
      env.approvals.registerApproval(approval)
      expect(env.approvals.consumeAuthorization("appr-durable").success).toBe(true)

      env = env.restart()

      const second = env.approvals.consumeAuthorization("appr-durable")
      expect(second.success).toBe(false)
      if (!second.success) expect(second.refusal.code).toBe("APPROVAL_ALREADY_USED")
    } finally {
      env.cleanup()
    }
  })

  test("capability execution outcomes are durable and idempotency survives a restart", async () => {
    let env = createEapEnv()
    try {
      const gateway = new CapabilityGateway(env.approvals, env.audit)
      gateway.registerClassification("reversible_tool", "reversible")

      const req: CapabilityExecutionRequest = {
        capabilityId: "reversible_tool",
        idempotencyKey: "idem-durable-1",
        contract: { contractRef: "contract-1", targetScope: "scope-1" },
        currentSeq: 1,
        providerAction: () => ({ ran: 1 }),
      }
      const first = await gateway.execute(req)
      expect(first.status).toBe("COMPLETED")

      env = env.restart()

      let ranAgain = false
      const gateway2 = new CapabilityGateway(env.approvals, env.audit)
      gateway2.registerClassification("reversible_tool", "reversible")
      const replay = await gateway2.execute({
        ...req,
        providerAction: () => {
          ranAgain = true
          return { ran: 2 }
        },
      })
      expect(replay.status).toBe("COMPLETED")
      if (replay.status === "COMPLETED") expect(replay.isCached).toBe(true)
      expect(ranAgain).toBe(false)
    } finally {
      env.cleanup()
    }
  })
})

describe("F001 retry#5 — defect 1: the domain service and the MCP adapter share one store", () => {
  test("a promotion admitted through the MCP tool is visible to PromotionService — no cross-layer divergence", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "mid", parentId: "root" })

      const viaTool = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "mid",
        targetParentHorizonId: "root",
        candidateIds: ["cand-x"],
      })
      expect(viaTool.ok).toBe(true)

      const repo = new SqlitePromotionRepository(s.state.db, s.state.stateDir, a.tenantId)
      const service = new PromotionService(repo)

      // The domain service reads the SAME rows the transport adapter wrote.
      expect(service.getHorizon("mid")?.parentId).toBe("root")
      const proposals = service.getProposalsForParent("root")
      expect(proposals.map((p) => p.id)).toContain(viaTool.admitted.promotionId)
    } finally {
      s.stop()
    }
  })

  test("a contestation admitted through the MCP tool is visible to ContestationService", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      const viaTool = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["claim-1"],
        severity: "invalidating",
        evidence: ["proof"],
      })
      expect(viaTool.ok).toBe(true)

      const service = new ContestationService(
        new SqliteContestationRepository(s.state.db, s.state.stateDir, a.tenantId)
      )
      const found = service.getContestation(viaTool.admitted.contestationId)
      expect(found?.severity).toBe("invalidating")
      expect(found?.admitted).toBe(true)
      expect(service.initiateRecall(viaTool.admitted.contestationId).status).toBe("INITIATED")
    } finally {
      s.stop()
    }
  })
})

describe("F001 retry#5 — defect 2: bounded memory for accumulating collections", () => {
  test("CapabilityGateway keeps no unbounded in-memory outcome or audit collections", () => {
    const env = createEapEnv()
    try {
      const gateway = new CapabilityGateway(env.approvals, env.audit) as unknown as Record<string, unknown>
      expect(gateway.executedOutcomes).toBeUndefined()
      expect(gateway.auditLog).toBeUndefined()
    } finally {
      env.cleanup()
    }
  })

  test("audit retention policy evicts oldest entries beyond the configured bound", async () => {
    const env = createEapEnv({ auditMaxEntries: 5 })
    try {
      const gateway = new CapabilityGateway(env.approvals, env.audit)
      gateway.registerClassification("reversible_tool", "reversible")

      for (let i = 0; i < 20; i++) {
        const res = await gateway.execute({
          capabilityId: "reversible_tool",
          idempotencyKey: `idem-retention-${i}`,
          contract: { contractRef: "contract-1", targetScope: "scope-1" },
          currentSeq: 1,
          providerAction: () => ({ i }),
        })
        expect(res.status).toBe("COMPLETED")
      }

      expect(env.audit.count()).toBe(5)
      const remaining = env.audit.list().map((e) => e.idempotencyKey)
      expect(remaining).toContain("idem-retention-19")
      expect(remaining).not.toContain("idem-retention-0")
    } finally {
      env.cleanup()
    }
  })

  test("ApprovalRepository stores approvals in SQLite rather than an unbounded Map", () => {
    const env = createEapEnv()
    try {
      for (let i = 0; i < 50; i++) {
        env.approvals.registerApproval({
          id: `appr-${i}`,
          approver: "op",
          scope: "s",
          expiresAt: Date.now() + 60_000,
          basedOnSeq: 1,
        })
      }
      const rows = env.db
        .query("SELECT COUNT(*) AS n FROM operator_approvals WHERE tenant_id = ?")
        .get(env.tenantId) as { n: number }
      expect(rows.n).toBe(50)
      expect((env.approvals as unknown as Record<string, unknown>).approvals).toBeUndefined()
    } finally {
      env.cleanup()
    }
  })
})
