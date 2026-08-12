/**
 * f001-transport-delegation.test.ts
 *
 * The Retry #5 Validation Audit's root-cause finding: `tools/eap.ts` was a second, weaker
 * implementation of the domain services rather than a thin port over them, so five retries of
 * hardening landed on a layer production traffic never reached.
 *
 * Every test here pins ONE rule that only exists because the adapter now delegates. Each fails
 * against the pre-wiring adapter, which returned `ok: true` for all of them.
 */
import { describe, expect, test } from "bun:test"
import { startServer } from "../src/index"
import { advanceCandidates, callTool, register } from "./helpers"
import { write } from "../src/db"
import { CapabilityGateway } from "../src/eap/capability-gateway"
import { SqliteDependencyQuery } from "../src/eap/dependency-query"

/** A committed graph claim: `refs` are the claims it rests on, i.e. the recall closure's edges. */
function seedClaim(
  s: { state: { db: any; stateDir: string } },
  tenantId: string,
  claim: { id: string; seq: number; domain: string; level: string; refs?: string[] },
): void {
  write(s.state.db, s.state.stateDir, tenantId, "claims", {
    tenant_id: tenantId,
    id: claim.id,
    seq: claim.seq,
    subject: claim.id,
    domain: claim.domain,
    level: claim.level,
    refs: JSON.stringify(claim.refs ?? []),
    anchor: null,
    file: null,
    verdict_confidence: null,
    verdict_overclaim: null,
    supersedes: null,
    covers: JSON.stringify([]),
  })
}

describe("cognitive.contest delegates to ContestationService", () => {
  test("evidence elements are inspected: [null] is EVIDENCE_REQUIRED, not an admitted contestation", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hz", ["claim-1"])

      const res = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["claim-1"],
        severity: "invalidating",
        evidence: [null],
      })
      expect(res.ok).toBe(false)
      expect(res.refusal.code).toBe("EVIDENCE_REQUIRED")

      const rows = s.state.db
        .query("SELECT COUNT(*) AS n FROM contestations WHERE tenant_id = ?")
        .get(a.tenantId) as { n: number }
      expect(rows.n).toBe(0)
    } finally {
      s.stop()
    }
  })

  test("targets must resolve to admitted knowledge — a fabricated or traversal-shaped id is refused", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")

      for (const target of ["does-not-exist", "../../etc/passwd", "claim-1"]) {
        const res = await callTool(s.url, "cognitive.contest", {
          token: a.token,
          targetClaimIds: [target],
          severity: "invalidating",
          evidence: ["counter-example"],
        })
        expect(res.ok).toBe(false)
        expect(res.refusal.code).toBe("RESOURCE_ABSENT")
      }

      // A candidate that has NOT reached `admitted` is not contestable knowledge either.
      await advanceCandidates(s.url, a.token, "hz", ["only-deliberated"])
      s.state.db
        .query("UPDATE candidates SET state = 'deliberated' WHERE tenant_id = ? AND candidate_id = ?")
        .run(a.tenantId, "only-deliberated")
      const early = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["only-deliberated"],
        severity: "blocking",
        evidence: ["proof"],
      })
      expect(early.ok).toBe(false)
      expect(early.refusal.code).toBe("RESOURCE_ABSENT")
    } finally {
      s.stop()
    }
  })

  test("target resolution is tenant-scoped: another tenant's admitted claim is absent, never contestable", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      const b = await register(s.url, "bob", "tenant-b")
      await advanceCandidates(s.url, a.token, "hz", ["alice-claim"])

      const res = await callTool(s.url, "cognitive.contest", {
        token: b.token,
        targetClaimIds: ["alice-claim"],
        severity: "invalidating",
        evidence: ["counter-example"],
      })
      expect(res.ok).toBe(false)
      expect(res.refusal.code).toBe("RESOURCE_ABSENT")
    } finally {
      s.stop()
    }
  })

  test("an admitted contestation carries the domain's own provenance, not a hardcoded status", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hz-src", ["claim-1"])

      const res = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["claim-1"],
        severity: "blocking",
        evidence: ["proof"],
        sourceHorizonId: "hz-src",
        reason: "measurement contradicts the claim",
      })
      expect(res.ok).toBe(true)

      const row = s.state.db
        .query("SELECT source_horizon_id, reason, status, evidence FROM contestations WHERE tenant_id = ? AND id = ?")
        .get(a.tenantId, res.admitted.contestationId) as {
        source_horizon_id: string
        reason: string
        status: string
        evidence: string
      }
      expect(row.source_horizon_id).toBe("hz-src")
      expect(row.reason).toBe("measurement contradicts the claim")
      expect(row.status).toBe("admitted")
      expect(JSON.parse(row.evidence)).toEqual(["proof"])
    } finally {
      s.stop()
    }
  })
})

describe("cognitive.promote delegates to PromotionService and reads the child's candidates", () => {
  test("an arbitrary candidate id cannot be injected into a parent horizon", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "mid", parentId: "root" })

      const res = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "mid",
        targetParentHorizonId: "root",
        candidateIds: ["fabricated"],
      })
      expect(res.ok).toBe(false)
      expect(res.refusal.code).toBe("RESOURCE_ABSENT")

      const rows = s.state.db
        .query("SELECT COUNT(*) AS n FROM candidates WHERE tenant_id = ? AND horizon_id = ?")
        .get(a.tenantId, "root") as { n: number }
      expect(rows.n).toBe(0)
    } finally {
      s.stop()
    }
  })

  test("a candidate that has not reached VERIFIED in the child is refused as an illegal transition", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "mid", parentId: "root" })
      await advanceCandidates(s.url, a.token, "mid", ["half-baked"], "admitted")

      const res = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "mid",
        targetParentHorizonId: "root",
        candidateIds: ["half-baked"],
      })
      expect(res.ok).toBe(false)
      expect(res.refusal.code).toBe("ILLEGAL_TRANSITION")

      // Finish the lifecycle and the SAME call is admitted.
      await advanceCandidates(s.url, a.token, "mid", ["half-baked"], "verified").catch(() => {})
      for (const command of ["CONCRETIZE", "VERIFY"]) {
        await callTool(s.url, "cognitive.propose", {
          token: a.token,
          horizonId: "mid",
          candidateId: "half-baked",
          command,
          evidence: ["ev"],
        })
      }
      const ok = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "mid",
        targetParentHorizonId: "root",
        candidateIds: ["half-baked"],
      })
      expect(ok.ok).toBe(true)
      const parentCandidate = s.state.db
        .query("SELECT state FROM candidates WHERE tenant_id = ? AND horizon_id = ? AND candidate_id = ?")
        .get(a.tenantId, "root", "half-baked") as { state: string }
      // Promotion never inherits the child's admission: it re-enters the parent at the start.
      expect(parentCandidate.state).toBe("proposed")
    } finally {
      s.stop()
    }
  })
})

describe("cognitive.recall drives RecallWorker over the recall_* aggregate", () => {
  test("the closure is a real reverse-dependency traversal, and case/checkpoint/scar are all written", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")

      // c-dep depends on c-mid, which depends on c-root. Contesting c-root must reach both.
      seedClaim(s, a.tenantId, { id: "c-root", seq: 1, domain: "ui", level: "P5" })
      seedClaim(s, a.tenantId, { id: "c-mid", seq: 2, domain: "ui", level: "P5", refs: ["c-root"] })
      seedClaim(s, a.tenantId, { id: "c-dep", seq: 3, domain: "ui", level: "P5", refs: ["c-mid"] })
      write(s.state.db, s.state.stateDir, a.tenantId, "authority", {
        tenant_id: a.tenantId,
        cell: "ui:5",
        value: "graph",
        last_flip_seq: 1,
        last_flip_by: "alice",
      })

      const contest = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["c-root"],
        severity: "invalidating",
        evidence: ["counter-example"],
      })
      expect(contest.ok).toBe(true)

      const recall = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
      })
      expect(recall.ok).toBe(true)
      expect(recall.admitted.status).toBe("completed")
      // NOT the contested ids copied verbatim — the transitive dependents are in the closure.
      expect(recall.admitted.affectedClaimIds).toEqual(["c-dep", "c-mid", "c-root"])
      expect(recall.admitted.checkpoint).toBeGreaterThan(0)
      expect(recall.admitted.degradedClaims.map((d: { claimId: string }) => d.claimId).sort()).toEqual([
        "c-dep",
        "c-mid",
        "c-root",
      ])
      // Degradation reached a graph-owned cell, so truth ownership is suspended.
      expect(recall.admitted.suspendedCells).toEqual(["ui:5"])

      const db = s.state.db
      const cases = db
        .query("SELECT status FROM recall_cases WHERE tenant_id = ? AND id = ?")
        .get(a.tenantId, recall.admitted.recallId) as { status: string }
      expect(cases.status).toBe("completed")
      const checkpoint = db
        .query("SELECT checkpoint FROM recall_checkpoints WHERE tenant_id = ? AND recall_id = ?")
        .get(a.tenantId, recall.admitted.recallId) as { checkpoint: string }
      expect(JSON.parse(checkpoint.checkpoint).remainingClaimIds).toEqual([])
      const scar = db
        .query("SELECT scar FROM recall_scars WHERE tenant_id = ? AND recall_id = ?")
        .get(a.tenantId, recall.admitted.recallId) as { scar: string }
      expect(JSON.parse(scar.scar).affectedClaimIds).toEqual(["c-dep", "c-mid", "c-root"])
    } finally {
      s.stop()
    }
  })

  test("there is no second recall schema: the adapter's private `recalls` table is gone", async () => {
    const s = startServer()
    try {
      const present = s.state.db
        .query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'recalls'")
        .get() as { n: number }
      expect(present.n).toBe(0)
    } finally {
      s.stop()
    }
  })

  test("replaying recall returns the same case and sequence rather than re-degrading", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      seedClaim(s, a.tenantId, { id: "c-solo", seq: 1, domain: "ui", level: "P5" })
      const contest = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["c-solo"],
        severity: "invalidating",
        evidence: ["counter-example"],
      })

      const first = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
      })
      const second = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
      })
      expect(second.ok).toBe(true)
      expect(second.admitted.recallId).toBe(first.admitted.recallId)
      expect(second.admitted.seq).toBe(first.admitted.seq)
      expect(second.admitted.replayed).toBe(true)

      const cases = s.state.db
        .query("SELECT COUNT(*) AS n FROM recall_cases WHERE tenant_id = ?")
        .get(a.tenantId) as { n: number }
      expect(cases.n).toBe(1)
    } finally {
      s.stop()
    }
  })

  test("SqliteDependencyQuery survives a malformed refs column instead of throwing out of the boundary", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      seedClaim(s, a.tenantId, { id: "c-ok", seq: 1, domain: "ui", level: "P5" })
      s.state.db.query("UPDATE claims SET refs = '{not json' WHERE tenant_id = ? AND id = ?").run(a.tenantId, "c-ok")
      const q = new SqliteDependencyQuery(s.state.db, a.tenantId)
      expect(q.reverseClosure(["c-ok"])).toEqual(["c-ok"])
    } finally {
      s.stop()
    }
  })
})

describe("the EAP composition root is reachable from the server", () => {
  test("capability execution and persistent-delta admission are wired, not orphaned", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      const services = s.eap(a.tenantId)

      expect(services.capabilities).toBeInstanceOf(CapabilityGateway)
      services.capabilities.registerClassification("read_tool", "reversible")
      const executed = await services.capabilities.execute({
        capabilityId: "read_tool",
        idempotencyKey: "idem-wired",
        contract: { contractRef: "contract-read", targetScope: "read.scope" },
        currentSeq: 1,
        providerAction: () => ({ ran: true }),
      })
      expect(executed.status).toBe("COMPLETED")
      expect(services.auditRepo.count()).toBe(1)

      const admitted = services.admitPersistentDelta({
        token: a.token,
        delta: {
          id: "pd-wired",
          intent: "wired delta",
          candidates: [
            {
              id: "c1",
              delta: { kind: "claim.add", payload: { id: "pd_claim", subject: "s", domain: "ui", level: 5, refs: [] } },
            },
          ],
        },
      })
      expect(admitted.ok).toBe(true)
      if (admitted.ok) expect(admitted.admittedClaimIds).toEqual(["pd_claim"])
    } finally {
      s.stop()
    }
  })

  test("the governed services the transport uses are the same objects the composition root builds", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hz", ["claim-1"])
      const viaTool = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["claim-1"],
        severity: "invalidating",
        evidence: ["proof"],
      })
      expect(viaTool.ok).toBe(true)

      // Read back through the DOMAIN service, not the table.
      const services = s.eap(a.tenantId)
      const found = services.contestations.getContestation(viaTool.admitted.contestationId)
      expect(found?.admitted).toBe(true)
      expect(services.contestations.initiateRecall(viaTool.admitted.contestationId).status).toBe("INITIATED")
    } finally {
      s.stop()
    }
  })
})
