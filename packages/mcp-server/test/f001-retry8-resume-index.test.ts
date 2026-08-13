/**
 * f001-retry8-resume-index.test.ts
 *
 * Fifth targeted pass on F001. Each test pins one finding the previous commit (7b497fa) INTRODUCED
 * and this one corrects:
 *
 *  1. THE GATE HAS A MODELLED EXIT for the one dead end that is not the deferred-ADR one. A recall
 *     that exhausted its batch cap returns an obligation telling the operator to re-drive it with a
 *     larger batchSize — but the only tool that could re-drive it REPLAYED the partial case instead
 *     and hardcoded `batchLimitReached: false`, so the documented remedy was unreachable and the
 *     closure stayed frozen forever. `cognitive.recall` now RESUMES an unfinished case, inside the
 *     same synchronous serialTransaction that decides to resume, so two concurrent resumes cannot
 *     both advance the same case. A COMPLETED case still replays idempotently.
 *  2. THE CLOSURE GATE IS INDEXED. `findRecallClosureMembership` scanned every `recall_cases` row of
 *     the tenant (no index on the table at all) and JSON.parsed every closure blob, once per VERIFY
 *     and once PER CANDIDATE inside the promote transaction. Membership is now a derived, indexed
 *     table resolved ONCE for the whole candidate set.
 *  3. THE DEGRADATION REPORT ACCUMULATES. The non-replay branch reported the LAST batch's
 *     degradations only, so a batched drive and an immediate replay of the SAME case disagreed.
 *  4. THE SUSPENSION EVENT COMMITS WITH THE WRITE IT DESCRIBES. `announce` ran the whole
 *     `appendEvent` after the transaction had returned, so the `events` row landed in its own
 *     implicit transaction: a failure between the two left `authority` at `suspended` with nothing
 *     in the append-only log a reconnecting session replays from.
 */
import { describe, expect, test } from "bun:test"
import { annotatedTest } from "./verification/annotate"
import { startServer } from "../src/index"
import { advanceCandidates, callTool, register } from "./helpers"
import { injectMirrorAppendFailure, rebuildFromJsonl, write } from "../src/db"
import { RECALL_LIMITS } from "../src/tools/eap"

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

/** k1 <- k2 <- k3 <- ... : a chain of `length` claims whose reverse closure from k1 is all of them. */
async function seedChain(s: any, length: number): Promise<{ token: string; tenantId: string; contestationId: string }> {
  const a = await register(s.url, "alice")
  await advanceCandidates(s.url, a.token, "hz", ["k1"])
  for (let i = 1; i <= length; i++) {
    seedClaim(s, a.tenantId, {
      id: `k${i}`,
      seq: i,
      domain: `d${i}`,
      level: "P1",
      refs: i === 1 ? [] : [`k${i - 1}`],
    })
  }
  const contest = await callTool(s.url, "cognitive.contest", {
    token: a.token,
    targetClaimIds: ["k1"],
    severity: "invalidating",
    evidence: ["counter-example"],
  })
  expect(contest.ok).toBe(true)
  return { token: a.token, tenantId: a.tenantId, contestationId: contest.admitted.contestationId }
}

describe("an unfinished recall case is RESUMED, not replayed (the documented remedy is reachable)", () => {
  annotatedTest(
    "re-driving a batch-cap-exhausted case finishes it and reports it as resumed",
    // EAP-RECL-003: the case is interrupted after a durable checkpoint, resumed, and the final
    // affected set is the whole closure (k1..k4) with exactly ONE scar row — the scenario's "no
    // degradation is applied twice". The batch cap is only the mechanism used to interrupt it; no
    // bound is asserted, so quarantine family QA6 stays open.
    { asserts: ["EAP-RECL-003"] },
    async () => {
    const s = startServer()
    const original = RECALL_LIMITS.maxBatches
    try {
      RECALL_LIMITS.maxBatches = 1
      const a = await seedChain(s, 4)

      const first = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: a.contestationId,
        batchSize: 1,
      })
      expect(first.ok).toBe(true)
      expect(first.admitted.complete).toBe(false)
      expect(first.admitted.batchLimitReached).toBe(true)
      expect(first.admitted.remainingClaimIds.length).toBe(3)

      // THE REMEDY THE REFUSAL NAMES: re-drive with a larger batchSize. It must RESUME.
      const second = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: a.contestationId,
        batchSize: 10,
      })
      expect(second.ok).toBe(true)
      expect(second.admitted.complete).toBe(true)
      expect(second.admitted.status).toBe("completed")
      expect(second.admitted.resumed).toBe(true)
      expect(second.admitted.replayed).toBeUndefined()
      expect(second.admitted.remainingClaimIds).toEqual([])
      expect(second.admitted.batchLimitReached).toBeUndefined()
      expect(second.admitted.degradedClaims.map((d: any) => d.claimId).sort()).toEqual(["k1", "k2", "k3", "k4"])

      const row = s.state.db
        .query("SELECT status FROM recall_cases WHERE tenant_id = ?")
        .get(a.tenantId) as { status: string }
      expect(row.status).toBe("completed")
      const scars = s.state.db
        .query("SELECT COUNT(*) AS n FROM recall_scars WHERE tenant_id = ?")
        .get(a.tenantId) as { n: number }
      expect(scars.n).toBe(1)
    } finally {
      RECALL_LIMITS.maxBatches = original
      s.stop()
    }
    },
  )

  annotatedTest(
    "two concurrent drives of the same case cannot both advance it",
    // EAP-RECL-003's "no degradation is applied twice" (every degradation count is 1), under
    // concurrency rather than under the checkpointed resume the scenario specifies.
    { coversPartially: ["EAP-RECL-003"] },
    async () => {
    const s = startServer()
    try {
      const a = await seedChain(s, 4)
      const [first, second] = await Promise.all([
        callTool(s.url, "cognitive.recall", { token: a.token, contestationId: a.contestationId, batchSize: 1 }),
        callTool(s.url, "cognitive.recall", { token: a.token, contestationId: a.contestationId, batchSize: 1 }),
      ])
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)

      // One case, one scar, one sequence — and the closure was traversed exactly once.
      const cases = s.state.db.query("SELECT COUNT(*) AS n FROM recall_cases WHERE tenant_id = ?").get(a.tenantId) as { n: number }
      expect(cases.n).toBe(1)
      const scars = s.state.db.query("SELECT COUNT(*) AS n FROM recall_scars WHERE tenant_id = ?").get(a.tenantId) as { n: number }
      expect(scars.n).toBe(1)
      const degraded = s.state.db
        .query("SELECT state FROM recall_cases WHERE tenant_id = ?")
        .get(a.tenantId) as { state: string }
      const counts = JSON.parse(degraded.state).degradationCounts as [string, number][]
      expect(counts.map(([, n]) => n)).toEqual(counts.map(() => 1))
    } finally {
      s.stop()
    }
    },
  )

  // OUT OF SCOPE (F002 task 06), and deliberately NOT linked to EAP-QUAR-002. The case exists to
  // PIN that completing a recall does not decide the destination status of an indirect dependent —
  // quarantine family QA2 stays open, which is the opposite of discharging it.
  test("resuming to completion does NOT clear the gate: the closure is still closed (003 defers the exit)", async () => {
    const s = startServer()
    const original = RECALL_LIMITS.maxBatches
    try {
      RECALL_LIMITS.maxBatches = 1
      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "h1", parentId: "root" })
      await advanceCandidates(s.url, a.token, "h1", ["k1"])
      await advanceCandidates(s.url, a.token, "h1", ["k2"])
      seedClaim(s, a.tenantId, { id: "k1", seq: 1, domain: "auth", level: "P1" })
      seedClaim(s, a.tenantId, { id: "k2", seq: 2, domain: "billing", level: "P1", refs: ["k1"] })
      const contest = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["k1"],
        severity: "invalidating",
        evidence: ["counter-example"],
      })
      const partial = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
        batchSize: 1,
      })
      expect(partial.admitted.complete).toBe(false)

      const finished = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
        batchSize: 10,
      })
      expect(finished.admitted.complete).toBe(true)

      // THE RESIDUAL, PINNED SO IT IS NOT MISTAKEN FOR A FIX: resumption gives the CASE an exit, not
      // the indirect dependent. The gate matches membership with no status predicate, and 003 defers
      // the destination status this dead end resolves into, so k2 stays refused after completion.
      await callTool(s.url, "cognitive.propose", {
        token: a.token, horizonId: "h1", candidateId: "k2", command: "CONCRETIZE", evidence: ["ev"],
      })
      const verify = await callTool(s.url, "cognitive.propose", {
        token: a.token, horizonId: "h1", candidateId: "k2", command: "VERIFY", evidence: ["brand-new-proof"],
      })
      expect(verify.ok).toBe(false)
      expect(verify.refusal.code).toBe("REHAB_WITHOUT_PROOF")
    } finally {
      RECALL_LIMITS.maxBatches = original
      s.stop()
    }
  })

  annotatedTest(
    "a COMPLETED case still replays idempotently: no second drive, no second event",
    // EAP-RECL-003's "no degradation is applied twice", observed under replay of a COMPLETED case
    // rather than under a resume from a checkpoint.
    { coversPartially: ["EAP-RECL-003"] },
    async () => {
    const s = startServer()
    try {
      const a = await seedChain(s, 3)
      const first = await callTool(s.url, "cognitive.recall", { token: a.token, contestationId: a.contestationId })
      expect(first.ok).toBe(true)
      expect(first.admitted.complete).toBe(true)

      const eventsBefore = s.state.db
        .query("SELECT COUNT(*) AS n FROM events WHERE tenant_id = ?")
        .get(a.tenantId) as { n: number }

      const second = await callTool(s.url, "cognitive.recall", { token: a.token, contestationId: a.contestationId })
      expect(second.ok).toBe(true)
      expect(second.admitted.replayed).toBe(true)
      expect(second.admitted.resumed).toBeUndefined()
      expect(second.admitted.complete).toBe(true)
      expect(second.admitted.degradedClaims.map((d: any) => d.claimId).sort()).toEqual(
        first.admitted.degradedClaims.map((d: any) => d.claimId).sort(),
      )

      const eventsAfter = s.state.db
        .query("SELECT COUNT(*) AS n FROM events WHERE tenant_id = ?")
        .get(a.tenantId) as { n: number }
      expect(eventsAfter.n).toBe(eventsBefore.n)
    } finally {
      s.stop()
    }
    },
  )
})

describe("the degradation report is the whole case, not the last batch", () => {
  annotatedTest(
    "a batched drive and an immediate replay of the same case report the same degradations",
    // EAP-RECL-003's "the final affected set equals uninterrupted execution" — approximated by
    // comparing a batched drive against its own replay rather than against a separate, genuinely
    // uninterrupted run, so the link stays partial.
    { coversPartially: ["EAP-RECL-003"] },
    async () => {
    const s = startServer()
    try {
      const a = await seedChain(s, 4)
      const driven = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: a.contestationId,
        batchSize: 1,
      })
      expect(driven.ok).toBe(true)
      expect(driven.admitted.complete).toBe(true)
      expect(driven.admitted.degradedClaims.map((d: any) => d.claimId).sort()).toEqual(["k1", "k2", "k3", "k4"])

      const replay = await callTool(s.url, "cognitive.recall", { token: a.token, contestationId: a.contestationId })
      expect(replay.admitted.replayed).toBe(true)
      expect(replay.admitted.degradedClaims.map((d: any) => d.claimId).sort()).toEqual(
        driven.admitted.degradedClaims.map((d: any) => d.claimId).sort(),
      )
    } finally {
      s.stop()
    }
    },
  )
})

describe("closure membership is an indexed lookup resolved once per command", () => {
  /** Wraps db.query so a test can see exactly which SQL the gate issues, and how often. */
  function spyQueries(db: any, needle: string): { sqls: string[]; restore: () => void } {
    const sqls: string[] = []
    const original = db.query.bind(db)
    db.query = (sql: string) => {
      if (sql.includes(needle)) sqls.push(sql)
      return original(sql)
    }
    return { sqls, restore: () => (db.query = original) }
  }

  // OUT OF SCOPE (F002 task 06): a query-plan assertion — one membership lookup per command, index
  // backed. `004` specifies governed outcomes and mints no scenario about host query shape.
  test("a promotion of N candidates resolves membership ONCE, with an index-backed plan", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "h1", parentId: "root" })
      const ids = ["p1", "p2", "p3", "p4", "p5"]
      await advanceCandidates(s.url, a.token, "h1", ids, "verified")

      const spy = spyQueries(s.state.db, "recall_closure_members")
      const promote = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "h1",
        targetParentHorizonId: "root",
        candidateIds: ids,
      })
      spy.restore()
      expect(promote.ok).toBe(true)

      const membershipSql = spy.sqls.filter((q) => q.includes("SELECT") && q.includes("JOIN recall_cases"))
      expect(membershipSql).toHaveLength(1)

      const sql = membershipSql[0]!
      const params = new Array((sql.match(/\?/g) ?? []).length).fill("x")
      const plan = s.state.db.query(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]
      const details = plan.map((p) => p.detail).join(" | ")
      expect(details).not.toContain("SCAN recall_cases")
      expect(details).not.toContain("SCAN recall_closure_members")
      expect(details).toContain("recall_closure_members")
    } finally {
      s.stop()
    }
  })

  annotatedTest(
    "the closure membership index survives a rebuild from the JSONL mirror",
    // EAP-PERS-001's "rebuild identical persistent state from durable JSONL", observed on the
    // derived closure-membership index rather than on the claims / ownership / Sequence triple the
    // scenario enumerates — and via the gate's behaviour rather than by comparing state directly.
    { coversPartially: ["EAP-PERS-001"] },
    async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "h1", parentId: "root" })
      await advanceCandidates(s.url, a.token, "h1", ["k1"])
      await advanceCandidates(s.url, a.token, "h1", ["k2"], "verified")
      seedClaim(s, a.tenantId, { id: "k1", seq: 1, domain: "auth", level: "P1" })
      seedClaim(s, a.tenantId, { id: "k2", seq: 2, domain: "billing", level: "P1", refs: ["k1"] })

      const contest = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["k1"],
        severity: "invalidating",
        evidence: ["counter-example"],
      })
      const recall = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
      })
      expect(recall.admitted.affectedClaimIds).toContain("k2")

      const members = s.state.db
        .query("SELECT claim_id FROM recall_closure_members WHERE tenant_id = ? ORDER BY claim_id")
        .all(a.tenantId) as { claim_id: string }[]
      expect(members.map((m) => m.claim_id)).toEqual(["k1", "k2"])

      // The mirror is the truth; the members table is a derived index and is NOT mirrored. A rebuild
      // must not leave the gate failing OPEN.
      rebuildFromJsonl(s.state.db, s.state.stateDir, a.tenantId)

      const promote = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "h1",
        targetParentHorizonId: "root",
        candidateIds: ["k2"],
      })
      expect(promote.ok).toBe(false)
      expect(promote.refusal.code).toBe("REHAB_WITHOUT_PROOF")
    } finally {
      s.stop()
    }
    },
  )

  annotatedTest(
    "a recall case written behind the write path with an unreadable closure still fails CLOSED",
    // EAP-XPRT-002's "a stable RefusalCode without a partial side effect", reached from corrupt
    // durable state rather than from the host-rule violation the scenario's Given names, and
    // without reading back the client obligation.
    { coversPartially: ["EAP-XPRT-002"] },
    async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hz", ["u1"])
      await callTool(s.url, "cognitive.propose", {
        token: a.token,
        horizonId: "hz",
        candidateId: "u1",
        command: "CONCRETIZE",
        evidence: ["ev"],
      })
      s.state.db
        .query(
          "INSERT INTO recall_cases (tenant_id, id, contestation_id, status, notice, closure, state, created_at, updated_at) VALUES (?, 'rc-bad', 'ct-bad', 'active', '{}', '{not json', '{}', '2020-01-01', '2020-01-01')",
        )
        .run(a.tenantId)

      const verify = await callTool(s.url, "cognitive.propose", {
        token: a.token,
        horizonId: "hz",
        candidateId: "u1",
        command: "VERIFY",
        evidence: ["ev"],
      })
      expect(verify.ok).toBe(false)
      expect(verify.refusal.code).toBe("RESOURCE_ABSENT")
      expect(verify.refusal.reason).toContain("rc-bad")
    } finally {
      s.stop()
    }
    },
  )
})

describe("the suspension event commits with the write it describes", () => {
  annotatedTest(
    "no durable suspension without the append-only row that announces it, at any failure point",
    // EAP-PERS-002: a durable transaction fails midway and neither store exposes a partial
    // committed result. The failure is injected into the JSONL MIRROR append at each of the 14
    // durable append points of the unit, and after every one the `authority` row and the
    // append-only `events` row still agree — so both halves of the scenario's Then are observed,
    // over both the SQLite side and the authoritative history.
    { asserts: ["EAP-PERS-002"] },
    async () => {
    // A recall of a one-claim closure over a graph-owned cell performs a bounded number of durable
    // appends. Injecting a failure at EACH of them must never leave the pair half-written.
    for (let injectAt = 1; injectAt <= 14; injectAt++) {
      const s = startServer()
      try {
        const a = await register(s.url, "alice")
        await advanceCandidates(s.url, a.token, "hz", ["s1"])
        seedClaim(s, a.tenantId, { id: "s1", seq: 1, domain: "auth", level: "P1" })
        write(s.state.db, s.state.stateDir, a.tenantId, "authority", {
          tenant_id: a.tenantId,
          cell: "auth:1",
          value: "graph",
          last_flip_seq: 1,
          last_flip_by: "alice",
        })
        const contest = await callTool(s.url, "cognitive.contest", {
          token: a.token,
          targetClaimIds: ["s1"],
          severity: "invalidating",
          evidence: ["counter-example"],
        })

        const undo = injectMirrorAppendFailure(s.state.db, injectAt)
        try {
          await callTool(s.url, "cognitive.recall", { token: a.token, contestationId: contest.admitted.contestationId })
        } catch {
          // The injected failure surfaces as a tool error; what matters is the durable state it left.
        }
        undo()

        const suspended = s.state.db
          .query("SELECT COUNT(*) AS n FROM authority WHERE tenant_id = ? AND value = 'suspended'")
          .get(a.tenantId) as { n: number }
        const announced = s.state.db
          .query("SELECT COUNT(*) AS n FROM events WHERE tenant_id = ? AND kind = 'TruthOwnershipSuspended'")
          .get(a.tenantId) as { n: number }
        expect({ injectAt, suspended: suspended.n, announced: announced.n }).toEqual({
          injectAt,
          suspended: announced.n,
          announced: announced.n,
        })
      } finally {
        s.stop()
      }
    }
    },
  )
})
