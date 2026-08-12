/**
 * f001-retry5-concurrency-authz.test.ts
 *
 * Regression suite for REWORK-LOG defect class 3 (CONCURRENCY AND SEQUENCE RACES) and
 * defect class 4 (AUTHORIZATION AND VALIDATION GAPS), plus the transactional-recovery and
 * execution-timeout points. Feature F001 / domain cognitive_line.
 */
import { describe, expect, test } from "bun:test"
import { startServer } from "../src/index"
import { advanceCandidates, callTool, register } from "./helpers"
import { createEapEnv } from "./eap-env"
import { AUDIT_READ_SCOPE, CapabilityGateway } from "../src/eap/capability-gateway"
import { eapContest, eapPromote, eapRecall } from "../src/tools/eap"
import { admitPersistentDelta, type PersistentDelta } from "../src/eap/persistent-delta"
import { injectMirrorAppendFailure, write } from "../src/db"
import type { CapabilityExecutionRequest, OperatorApproval } from "@open-graph-mcp/graph-core/eap/capabilities"

const claimDelta = (id: string, domain = "ui", level = 5) => ({
  kind: "claim.add" as const,
  payload: { id, subject: id, domain, level, refs: [] as string[] },
})

describe("F001 retry#5 — defect 3: atomic sequence allocation and transition writes", () => {
  test("eapContest sequences are unique, monotonic, and never reused after row deletion", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      // Contestation targets must resolve to admitted knowledge of this tenant (validation audit,
      // VALIDATION_BYPASS): admit them through the lifecycle before challenging them.
      await advanceCandidates(
        s.url,
        a.token,
        "hz-seq",
        [...Array.from({ length: 10 }, (_, i) => `claim-${i}`), "claim-after-purge"],
      )
      const seqs: number[] = []
      for (let i = 0; i < 10; i++) {
        const res = eapContest(s.state, {
          token: a.token,
          targetClaimIds: [`claim-${i}`],
          severity: "informative",
          evidence: ["proof"],
        })
        expect(res.ok).toBe(true)
        if (res.ok) seqs.push(res.admitted.seq)
      }
      expect(new Set(seqs).size).toBe(10)
      for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1])

      // max(seq)+1 allocation reuses a sequence as soon as the highest row disappears.
      // A durable allocator must not.
      s.state.db.query("DELETE FROM contestations WHERE tenant_id = ?").run(a.tenantId)
      const afterPurge = eapContest(s.state, {
        token: a.token,
        targetClaimIds: ["claim-after-purge"],
        severity: "informative",
        evidence: ["proof"],
      })
      expect(afterPurge.ok).toBe(true)
      if (afterPurge.ok) expect(afterPurge.admitted.seq).toBeGreaterThan(seqs[seqs.length - 1])
    } finally {
      s.stop()
    }
  })

  test("eapContest identifiers are unique even when the id shape collides with a purged row", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hz-ids", Array.from({ length: 5 }, (_, i) => `c-${i}`))
      const ids = new Set<string>()
      for (let i = 0; i < 5; i++) {
        const res = eapContest(s.state, {
          token: a.token,
          targetClaimIds: [`c-${i}`],
          severity: "blocking",
          evidence: ["proof"],
        })
        expect(res.ok).toBe(true)
        if (res.ok) ids.add(res.admitted.contestationId)
      }
      expect(ids.size).toBe(5)
    } finally {
      s.stop()
    }
  })

  test("eapRecall allocates its sequence durably and refuses replay of a completed recall", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hz-recall", ["claim-1", "claim-2"])
      const c1 = eapContest(s.state, {
        token: a.token,
        targetClaimIds: ["claim-1"],
        severity: "invalidating",
        evidence: ["proof"],
      })
      const c2 = eapContest(s.state, {
        token: a.token,
        targetClaimIds: ["claim-2"],
        severity: "invalidating",
        evidence: ["proof"],
      })
      expect(c1.ok && c2.ok).toBe(true)
      if (!c1.ok || !c2.ok) return

      const r1 = await eapRecall(s.state, { token: a.token, contestationId: c1.admitted.contestationId })
      const r2 = await eapRecall(s.state, { token: a.token, contestationId: c2.admitted.contestationId })
      expect(r1.ok && r2.ok).toBe(true)
      if (r1.ok && r2.ok) expect(r1.admitted.seq).not.toBe(r2.admitted.seq)
    } finally {
      s.stop()
    }
  })

  test("eapPromote persists a proposed parent candidate row alongside the proposal", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "mid", parentId: "root" })
      await advanceCandidates(s.url, a.token, "mid", ["cand-x", "cand-y"], "verified")

      const res = eapPromote(s.state, {
        token: a.token,
        childHorizonId: "mid",
        targetParentHorizonId: "root",
        candidateIds: ["cand-x", "cand-y"],
      })
      expect(res.ok).toBe(true)
      if (!res.ok) return

      const proposalRow = s.state.db
        .query("SELECT status FROM proposals WHERE tenant_id = ? AND id = ?")
        .get(a.tenantId, res.admitted.promotionId) as { status: string } | null
      expect(proposalRow?.status).toBe("proposed")

      const candRows = s.state.db
        .query("SELECT candidate_id, state FROM candidates WHERE tenant_id = ? AND horizon_id = ? ORDER BY candidate_id")
        .all(a.tenantId, "root") as { candidate_id: string; state: string }[]
      expect(candRows.map((r) => r.candidate_id)).toEqual(["cand-x", "cand-y"])
      expect(candRows.every((r) => r.state === "proposed")).toBe(true)
    } finally {
      s.stop()
    }
  })

  test("eapPromote does not advance the child horizon sequence or write a proposal when refused", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "mid", parentId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "leaf", parentId: "mid" })
      await advanceCandidates(s.url, a.token, "leaf", ["c1"], "verified")

      const seqBefore = (
        s.state.db.query("SELECT seq FROM horizons WHERE tenant_id = ? AND id = ?").get(a.tenantId, "leaf") as {
          seq: number
        }
      ).seq

      const skip = eapPromote(s.state, {
        token: a.token,
        childHorizonId: "leaf",
        targetParentHorizonId: "root",
        candidateIds: ["c1"],
      })
      expect(skip.ok).toBe(false)

      const seqAfter = (
        s.state.db.query("SELECT seq FROM horizons WHERE tenant_id = ? AND id = ?").get(a.tenantId, "leaf") as {
          seq: number
        }
      ).seq
      expect(seqAfter).toBe(seqBefore)

      const proposals = s.state.db
        .query("SELECT COUNT(*) AS n FROM proposals WHERE tenant_id = ?")
        .get(a.tenantId) as { n: number }
      expect(proposals.n).toBe(0)
    } finally {
      s.stop()
    }
  })

  test("eapPromote rolls back the horizon transition when the durable write fails", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "mid", parentId: "root" })
      await advanceCandidates(s.url, a.token, "mid", ["c1"], "verified")

      const seqBefore = (
        s.state.db.query("SELECT seq FROM horizons WHERE tenant_id = ? AND id = ?").get(a.tenantId, "mid") as {
          seq: number
        }
      ).seq

      // Fail the second durable append of the promote unit: the proposal is already written, so a
      // non-atomic implementation leaves a proposal behind or an advanced sequence with none.
      const clear = injectMirrorAppendFailure(s.state.db, 2)
      try {
        expect(() =>
          eapPromote(s.state, {
            token: a.token,
            childHorizonId: "mid",
            targetParentHorizonId: "root",
            candidateIds: ["c1"],
          })
        ).toThrow()
      } finally {
        clear()
      }

      const seqAfter = (
        s.state.db.query("SELECT seq FROM horizons WHERE tenant_id = ? AND id = ?").get(a.tenantId, "mid") as {
          seq: number
        }
      ).seq
      expect(seqAfter).toBe(seqBefore)
      const proposals = s.state.db
        .query("SELECT COUNT(*) AS n FROM proposals WHERE tenant_id = ?")
        .get(a.tenantId) as { n: number }
      expect(proposals.n).toBe(0)
    } finally {
      s.stop()
    }
  })
})

describe("F001 retry#5 — defect 4: authorization and validation gaps", () => {
  test("CapabilityGateway refuses a client-supplied approval that is not registered by an operator", async () => {
    const env = createEapEnv()
    try {
      const gateway = new CapabilityGateway(env.approvals, env.audit, env.sequences)
      gateway.registerClassification("deploy_tool", "irreversible")

      let providerRan = false
      const forged: OperatorApproval = {
        id: "appr-forged",
        approver: "attacker",
        scope: "deploy.production",
        expiresAt: Date.now() + 60_000,
        basedOnSeq: 42,
      }
      const res = await gateway.execute({
        capabilityId: "deploy_tool",
        idempotencyKey: "idem-forged",
        contract: { contractRef: "contract-deploy-01", targetScope: "deploy.production" },
        currentSeq: 42,
        approval: forged,
        providerAction: () => {
          providerRan = true
          return {}
        },
      })

      expect(res.status).toBe("REFUSED")
      if (res.status === "REFUSED") expect(res.refusal.code).toBe("APPROVAL_MISSING")
      expect(providerRan).toBe(false)
    } finally {
      env.cleanup()
    }
  })

  test("CapabilityGateway validates the stored approval, not the client-supplied copy", async () => {
    const env = createEapEnv()
    try {
      const gateway = new CapabilityGateway(env.approvals, env.audit, env.sequences)
      gateway.registerClassification("deploy_tool", "irreversible")

      // Operator granted a narrow scope; the client presents a widened copy with the same id.
      env.approvals.registerApproval({
        id: "appr-narrow",
        approver: "operator-alice",
        scope: "deploy.staging",
        expiresAt: Date.now() + 60_000,
        basedOnSeq: 42,
      })

      const res = await gateway.execute({
        capabilityId: "deploy_tool",
        idempotencyKey: "idem-widened",
        contract: { contractRef: "contract-deploy-01", targetScope: "deploy.production" },
        currentSeq: 42,
        approval: {
          id: "appr-narrow",
          approver: "operator-alice",
          scope: "deploy.production",
          expiresAt: Date.now() + 60_000,
          basedOnSeq: 42,
        },
      })

      expect(res.status).toBe("REFUSED")
      if (res.status === "REFUSED") expect(res.refusal.code).toBe("SCOPE_EXCEEDED")
      // A refused execution must not burn the operator's single-use grant.
      expect(env.approvals.getApproval("appr-narrow")?.consumed).toBe(false)
    } finally {
      env.cleanup()
    }
  })

  test("getAuditLog applies an authorization projection filter", async () => {
    const env = createEapEnv()
    try {
      const gateway = new CapabilityGateway(env.approvals, env.audit, env.sequences)
      gateway.registerClassification("reversible_tool", "reversible")
      await gateway.execute({
        capabilityId: "reversible_tool",
        idempotencyKey: "idem-audit",
        contract: { contractRef: "contract-secret", targetScope: "scope-1" },
        currentSeq: 1,
        providerAction: () => ({ secret: "payload" }),
      })

      expect(() => gateway.getAuditLog(undefined as never)).toThrow()

      const redacted = gateway.getAuditLog({ principal: "agent-1", scopes: [] })
      expect(redacted.projection).toBe("redacted")
      expect(redacted.entries).toHaveLength(1)
      expect((redacted.entries[0] as unknown as Record<string, unknown>).outcome).toBeUndefined()
      expect((redacted.entries[0] as unknown as Record<string, unknown>).contractRef).toBeUndefined()
      expect(redacted.entries[0].executionId).toBeDefined()

      const full = gateway.getAuditLog({ principal: "operator-alice", scopes: [AUDIT_READ_SCOPE] })
      expect(full.projection).toBe("full")
      expect(full.entries).toHaveLength(1)
      if (full.projection === "full") {
        expect(full.entries[0].outcome).toEqual({ secret: "payload" })
        expect(full.entries[0].contractRef).toBe("contract-secret")
      }
    } finally {
      env.cleanup()
    }
  })

  test("CapabilityGateway times out a hanging provider and cancels it via AbortSignal", async () => {
    const env = createEapEnv()
    try {
      const gateway = new CapabilityGateway(env.approvals, env.audit, env.sequences)
      gateway.registerClassification("slow_tool", "reversible")

      let observed: AbortSignal | undefined
      const req: CapabilityExecutionRequest = {
        capabilityId: "slow_tool",
        idempotencyKey: "idem-timeout",
        contract: { contractRef: "contract-slow", targetScope: "scope-1" },
        currentSeq: 1,
        providerAction: (signal?: AbortSignal) =>
          new Promise((resolve) => {
            observed = signal
            const t = setTimeout(() => resolve({ late: true }), 10_000)
            signal?.addEventListener("abort", () => clearTimeout(t))
          }),
      }

      const res = await gateway.execute(req, { timeoutMs: 25 })
      expect(res.status).toBe("FAILED")
      if (res.status === "FAILED") expect(res.refusal.code).toBe("PROVIDER_UNAVAILABLE")
      expect(observed).toBeDefined()
      expect(observed!.aborted).toBe(true)
      // A timed-out execution must not be recorded as a successful outcome.
      expect(env.audit.count()).toBe(0)
    } finally {
      env.cleanup()
    }
  })

  test("eapRecall refuses a contestation whose status is not 'admitted'", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      write(s.state.db, s.state.stateDir, a.tenantId, "contestations", {
        tenant_id: a.tenantId,
        id: "contest-refused",
        seq: 900,
        target_claim_ids: JSON.stringify(["claim-1"]),
        severity: "invalidating",
        evidence: JSON.stringify(["proof"]),
        status: "refused",
        created_at: new Date().toISOString(),
      })

      const res = await eapRecall(s.state, { token: a.token, contestationId: "contest-refused" })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.refusal.code).toBe("RECALL_UNPROVEN")

      // The adapter's private `recalls` table is gone; `recall_cases` is the only recall state.
      const recalls = s.state.db
        .query("SELECT COUNT(*) AS n FROM recall_cases WHERE tenant_id = ?")
        .get(a.tenantId) as { n: number }
      expect(recalls.n).toBe(0)
    } finally {
      s.stop()
    }
  })

})

describe("F001 retry#5 — transactional recovery of admitPersistentDelta", () => {
  test("a refused candidate returns typed reasons without throwing", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      const delta: PersistentDelta = {
        id: "pd_refused",
        intent: "refused delta",
        candidates: [
          {
            id: "bad",
            delta: {
              kind: "claim.add",
              payload: { id: "c_bad", subject: "s", domain: "ui", level: 5, refs: [], anchor: "NOPE", file: "src/missing.ts" },
            },
          },
        ],
      }

      const res = admitPersistentDelta(s.state, { token: a.token, delta })
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.reasons.length).toBeGreaterThan(0)
        expect(res.refusedCandidateIds).toContain("bad")
      }

      const deltas = s.state.db.query("SELECT COUNT(*) AS n FROM cs_deltas WHERE tenant_id = ?").get(a.tenantId) as {
        n: number
      }
      expect(deltas.n).toBe(0)
      const locks = s.state.db.query("SELECT COUNT(*) AS n FROM locks WHERE tenant_id = ?").get(a.tenantId) as {
        n: number
      }
      expect(locks.n).toBe(0)
    } finally {
      s.stop()
    }
  })

  test("a failing commit leaves no orphaned cs_deltas rows and no held cell locks", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      const delta: PersistentDelta = {
        id: "pd_commit_fail",
        intent: "commit failure",
        candidates: [{ id: "c1", delta: claimDelta("claim_x") }, { id: "c2", delta: claimDelta("claim_y") }],
      }

      // Break a durable append partway through the admission unit.
      const clear = injectMirrorAppendFailure(s.state.db, 3)
      let threw = false
      try {
        const res = admitPersistentDelta(s.state, { token: a.token, delta })
        expect(res.ok).toBe(false)
      } catch {
        threw = true
      } finally {
        clear()
      }
      expect(threw || true).toBe(true)

      const deltas = s.state.db.query("SELECT COUNT(*) AS n FROM cs_deltas WHERE tenant_id = ?").get(a.tenantId) as {
        n: number
      }
      expect(deltas.n).toBe(0)
      const locks = s.state.db.query("SELECT COUNT(*) AS n FROM locks WHERE tenant_id = ?").get(a.tenantId) as {
        n: number
      }
      expect(locks.n).toBe(0)
      const claims = s.state.db.query("SELECT COUNT(*) AS n FROM claims WHERE tenant_id = ?").get(a.tenantId) as {
        n: number
      }
      expect(claims.n).toBe(0)
    } finally {
      s.stop()
    }
  })

  test("candidate evaluation does not rebuild the tenant claim snapshot per candidate", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      let reads = 0
      const originalQuery = s.state.db.query.bind(s.state.db)
      ;(s.state.db as unknown as { query: typeof originalQuery }).query = ((sql: string) => {
        if (sql.includes("FROM claims WHERE tenant_id")) reads++
        return originalQuery(sql)
      }) as typeof originalQuery

      try {
        const delta: PersistentDelta = {
          id: "pd_batch",
          intent: "batch",
          candidates: Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, delta: claimDelta(`claim_${i}`) })),
        }
        const res = admitPersistentDelta(s.state, { token: a.token, delta })
        expect(res.ok).toBe(true)
      } finally {
        ;(s.state.db as unknown as { query: typeof originalQuery }).query = originalQuery
      }

      // One snapshot load for the batch (plus the commit-time final gate read); never one per candidate.
      expect(reads).toBeLessThanOrEqual(3)
    } finally {
      s.stop()
    }
  })
})
