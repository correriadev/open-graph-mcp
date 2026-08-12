/**
 * f001-retry7-closure-gate.test.ts
 *
 * Fourth targeted pass on F001. Each test pins one finding from the TL/QA verdicts of this round:
 *
 *  1. RECALL-CLOSURE GATE (both reviewers' top finding). `recall.ts` records EVERY claim in the
 *     reverse closure as `normativelyResolvedState = 'recalled'` in `recall_cases.state` and in the
 *     scar, but the projection only writes a destination status for the contestation's DIRECT
 *     targets — 003 defers the destination status of indirect dependents. 003 defers the STATUS,
 *     not the existence of a gate: `VERIFY` and `cognitive.promote` must refuse a candidate that
 *     sits inside a recall closure while leaving its final status undecided.
 *  2. TRUTH-OWNERSHIP SUSPENSION IS ANNOUNCED. Every other writer to `authority` pairs the write
 *     with an always-broadcast event. The projection wrote `suspended` and emitted nothing; the only
 *     `TruthOwnershipSuspended` emissions came from the LAST batch's progress, so with any batchSize
 *     smaller than the closure, cells suspended in earlier batches were announced nowhere.
 *  3. ADVERTISED SCHEMAS MATCH THE HANDLERS. For an MCP server whose consumer is an agent, the
 *     `tools/list` schema IS the interface; it omitted `evidence`, `candidateIds`, `basedOnSeq`
 *     and `batchSize`, so a schema-driven client could not perform a transition or a promotion.
 *  4. Smaller confirmed items: `checkpoint` is no longer validated-and-discarded; batch-cap
 *     exhaustion carries a distinct signal; an unrecognized candidate state fails CLOSED instead of
 *     resetting the lifecycle; `basedOnSeq: -0` is not a sequence.
 */
import { describe, expect, test } from "bun:test"
import { startServer } from "../src/index"
import { advanceCandidates, callTool, register, rpc } from "./helpers"
import { write } from "../src/db"
import { matches } from "../src/state"
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

function seedGraphOwnedCell(s: { state: { db: any; stateDir: string } }, tenantId: string, cell: string): void {
  write(s.state.db, s.state.stateDir, tenantId, "authority", {
    tenant_id: tenantId,
    cell,
    value: "graph",
    last_flip_seq: 1,
    last_flip_by: "alice",
  })
}

const candidateState = (s: any, tenantId: string, horizonId: string, candidateId: string): string | null => {
  const row = s.state.db
    .query("SELECT state FROM candidates WHERE tenant_id = ? AND horizon_id = ? AND candidate_id = ?")
    .get(tenantId, horizonId, candidateId) as { state: string } | null
  return row?.state ?? null
}

/**
 * QA's end-to-end reproduction: k2 rests on k1, k1 is contested and recalled, k2 is an INDIRECT
 * dependent of the recall closure.
 */
async function recallWithIndirectDependent(s: any) {
  const a = await register(s.url, "alice")
  await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
  await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "h1", parentId: "root" })
  await advanceCandidates(s.url, a.token, "h1", ["k1", "k2"])
  seedClaim(s, a.tenantId, { id: "k1", seq: 1, domain: "auth", level: "P1" })
  seedClaim(s, a.tenantId, { id: "k2", seq: 2, domain: "billing", level: "P1", refs: ["k1"] })

  const contest = await callTool(s.url, "cognitive.contest", {
    token: a.token,
    targetClaimIds: ["k1"],
    severity: "invalidating",
    evidence: ["counter-example"],
  })
  expect(contest.ok).toBe(true)
  const recall = await callTool(s.url, "cognitive.recall", {
    token: a.token,
    contestationId: contest.admitted.contestationId,
  })
  expect(recall.ok).toBe(true)
  expect(recall.admitted.affectedClaimIds).toEqual(["k1", "k2"])
  return a
}

describe("a candidate inside a recall closure cannot complete its lifecycle (003 defers the STATUS, not the gate)", () => {
  test("an indirect dependent may still be CONCRETIZEd but is refused at VERIFY", async () => {
    const s = startServer()
    try {
      const a = await recallWithIndirectDependent(s)

      // The deferral holds: no destination status is invented for the indirect dependent.
      expect(candidateState(s, a.tenantId, "h1", "k2")).toBe("admitted")

      const concretize = await callTool(s.url, "cognitive.propose", {
        token: a.token,
        horizonId: "h1",
        candidateId: "k2",
        command: "CONCRETIZE",
        evidence: ["ev"],
      })
      expect(concretize.ok).toBe(true)

      const verify = await callTool(s.url, "cognitive.propose", {
        token: a.token,
        horizonId: "h1",
        candidateId: "k2",
        command: "VERIFY",
        evidence: ["ev"],
      })
      expect(verify.ok).toBe(false)
      expect(verify.refusal.code).toBe("REHAB_WITHOUT_PROOF")
      expect(verify.refusal.reason).toContain("recall closure")

      // Still undecided, still not verified.
      expect(candidateState(s, a.tenantId, "h1", "k2")).toBe("concretized")
    } finally {
      s.stop()
    }
  })

  test("a verified candidate that a later recall pulled into its closure cannot be promoted", async () => {
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
      expect(recall.ok).toBe(true)
      expect(recall.admitted.affectedClaimIds).toContain("k2")
      expect(candidateState(s, a.tenantId, "h1", "k2")).toBe("verified")

      const promote = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "h1",
        targetParentHorizonId: "root",
        candidateIds: ["k2"],
      })
      expect(promote.ok).toBe(false)
      expect(promote.refusal.code).toBe("REHAB_WITHOUT_PROOF")

      // Nothing entered the parent horizon, and no proposal was minted.
      expect(candidateState(s, a.tenantId, "root", "k2")).toBeNull()
      const proposals = s.state.db
        .query("SELECT COUNT(*) AS n FROM proposals WHERE tenant_id = ?")
        .get(a.tenantId) as { n: number }
      expect(proposals.n).toBe(0)
    } finally {
      s.stop()
    }
  })

  test("a candidate untouched by any recall closure still verifies and promotes", async () => {
    const s = startServer()
    try {
      const a = await recallWithIndirectDependent(s)
      await advanceCandidates(s.url, a.token, "h1", ["k3"], "verified")

      const promote = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "h1",
        targetParentHorizonId: "root",
        candidateIds: ["k3"],
      })
      expect(promote.ok).toBe(true)
      expect(candidateState(s, a.tenantId, "root", "k3")).toBe("proposed")
    } finally {
      s.stop()
    }
  })
})

describe("truth-ownership suspension is announced on the channel the authority view subscribes to", () => {
  test("every suspended cell emits TruthOwnershipSuspended, including cells suspended in a non-final batch", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      seedClaim(s, a.tenantId, { id: "c-root", seq: 1, domain: "auth", level: "P1" })
      seedClaim(s, a.tenantId, { id: "c-dep", seq: 2, domain: "billing", level: "P1", refs: ["c-root"] })
      seedGraphOwnedCell(s, a.tenantId, "auth:1")
      seedGraphOwnedCell(s, a.tenantId, "billing:1")

      const contest = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["c-root"],
        severity: "invalidating",
        evidence: ["counter-example"],
      })
      // batchSize 1 over a two-claim closure: the FIRST cell is suspended in a batch that is not
      // the last, which is precisely the case that used to be announced nowhere.
      const recall = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
        batchSize: 1,
      })
      expect(recall.ok).toBe(true)
      expect(new Set(recall.admitted.suspendedCells)).toEqual(new Set(["auth:1", "billing:1"]))

      const emitted = s.state.db
        .query("SELECT target_id, payload FROM events WHERE tenant_id = ? AND kind = 'TruthOwnershipSuspended' ORDER BY seq")
        .all(a.tenantId) as { target_id: string; payload: string }[]
      expect(new Set(emitted.map((e) => e.target_id))).toEqual(new Set(["auth:1", "billing:1"]))
      expect(emitted).toHaveLength(2)
      for (const row of emitted) {
        const payload = JSON.parse(row.payload)
        expect(payload.cellKey).toBe(row.target_id)
        expect(String(payload.recallId)).toContain("recall-")
      }

      // Durable table and announcement agree.
      const suspended = s.state.db
        .query("SELECT cell FROM authority WHERE tenant_id = ? AND value = 'suspended' ORDER BY cell")
        .all(a.tenantId) as { cell: string }[]
      expect(suspended.map((r) => r.cell)).toEqual(["auth:1", "billing:1"])
    } finally {
      s.stop()
    }
  })

  test("TruthOwnershipSuspended ignores session filters, exactly as authority.flipped does", () => {
    const env = {
      schemaVersion: 1 as const,
      seq: 1,
      ts: new Date().toISOString(),
      kind: "TruthOwnershipSuspended",
      target: "auth:1",
      payload: { cellKey: "auth:1" },
      graphId: "g",
    }
    expect(matches([{ kind: "changeset", id: "no-such-changeset" }], env as any)).toBe(true)
  })
})

describe("the advertised tool schemas are the interface", () => {
  const schemaOf = async (base: string, name: string) => {
    const list = (await rpc(base, "tools/list")) as { tools: { name: string; inputSchema: any }[] }
    const tool = list.tools.find((t) => t.name === name)
    expect(tool).toBeDefined()
    return tool!.inputSchema
  }

  test("cognitive.propose advertises evidence (required) and basedOnSeq, and the advertised contract works", async () => {
    const s = startServer()
    try {
      const schema = await schemaOf(s.url, "cognitive.propose")
      expect(Object.keys(schema.properties)).toEqual(
        expect.arrayContaining(["token", "horizonId", "candidateId", "command", "evidence", "basedOnSeq"]),
      )
      expect(schema.required).toContain("evidence")

      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "hz" })
      const advertisedCall: Record<string, unknown> = {}
      for (const field of schema.required as string[]) {
        advertisedCall[field] =
          field === "token" ? a.token
          : field === "horizonId" ? "hz"
          : field === "candidateId" ? "cand-1"
          : field === "command" ? "DELIBERATE"
          : field === "evidence" ? ["ev"]
          : "x"
      }
      const res = await callTool(s.url, "cognitive.propose", advertisedCall)
      expect(res.ok).toBe(true)
    } finally {
      s.stop()
    }
  })

  test("cognitive.promote advertises candidateIds (required) and basedOnSeq", async () => {
    const s = startServer()
    try {
      const schema = await schemaOf(s.url, "cognitive.promote")
      expect(Object.keys(schema.properties)).toEqual(
        expect.arrayContaining(["token", "childHorizonId", "targetParentHorizonId", "candidateIds", "basedOnSeq"]),
      )
      expect(schema.required).toContain("candidateIds")

      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "child", parentId: "root" })
      await advanceCandidates(s.url, a.token, "child", ["p1"], "verified")
      const res = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "child",
        targetParentHorizonId: "root",
        candidateIds: ["p1"],
      })
      expect(res.ok).toBe(true)
    } finally {
      s.stop()
    }
  })

  test("cognitive.recall advertises batchSize and does NOT advertise the unsupported checkpoint", async () => {
    const s = startServer()
    try {
      const schema = await schemaOf(s.url, "cognitive.recall")
      expect(Object.keys(schema.properties)).toContain("batchSize")
      expect(Object.keys(schema.properties)).not.toContain("checkpoint")
    } finally {
      s.stop()
    }
  })

  test("cognitive.contest and cognitive.initiate advertise every field their handlers accept", async () => {
    const s = startServer()
    try {
      const contest = await schemaOf(s.url, "cognitive.contest")
      expect(Object.keys(contest.properties)).toEqual(
        expect.arrayContaining(["token", "targetClaimIds", "severity", "evidence", "sourceHorizonId", "reason"]),
      )
      expect(contest.properties.severity.enum).toEqual(["informative", "blocking", "invalidating"])

      const initiate = await schemaOf(s.url, "cognitive.initiate")
      expect(Object.keys(initiate.properties)).toEqual(
        expect.arrayContaining(["token", "horizonId", "parentId", "seed", "budget"]),
      )
    } finally {
      s.stop()
    }
  })
})

describe("smaller confirmed items", () => {
  test("cognitive.recall refuses `checkpoint` as unsupported rather than validating and discarding it", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hz", ["k1"])
      const contest = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["k1"],
        severity: "invalidating",
        evidence: ["counter-example"],
      })
      const res = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
        checkpoint: 999999,
      })
      expect(res.ok).toBe(false)
      expect(res.refusal.code).toBe("MALFORMED_CONTRACT")
      expect(res.refusal.reason).toContain("checkpoint")

      // Refused whole: no recall case was opened behind the caller's back.
      const cases = s.state.db
        .query("SELECT COUNT(*) AS n FROM recall_cases WHERE tenant_id = ?")
        .get(a.tenantId) as { n: number }
      expect(cases.n).toBe(0)
    } finally {
      s.stop()
    }
  })

  test("exhausting the batch cap is reported distinctly instead of looking like completion", async () => {
    const s = startServer()
    const original = RECALL_LIMITS.maxBatches
    try {
      RECALL_LIMITS.maxBatches = 1
      const a = await register(s.url, "alice")
      seedClaim(s, a.tenantId, { id: "e-root", seq: 1, domain: "auth", level: "P1" })
      seedClaim(s, a.tenantId, { id: "e-dep", seq: 2, domain: "auth", level: "P1", refs: ["e-root"] })
      await advanceCandidates(s.url, a.token, "hz", ["e-root"])

      const contest = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["e-root"],
        severity: "invalidating",
        evidence: ["counter-example"],
      })
      const res = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
        batchSize: 1,
      })
      expect(res.ok).toBe(true)
      expect(res.admitted.status).not.toBe("completed")
      expect(res.admitted.complete).toBe(false)
      expect(res.admitted.batchLimitReached).toBe(true)
      expect(res.admitted.maxBatches).toBe(1)
      expect(res.admitted.remainingClaimIds.length).toBeGreaterThan(0)
    } finally {
      RECALL_LIMITS.maxBatches = original
      s.stop()
    }
  })

  test("a completed recall reports complete:true and no batch-limit signal", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hz", ["k1"])
      const contest = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["k1"],
        severity: "invalidating",
        evidence: ["counter-example"],
      })
      const res = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
      })
      expect(res.ok).toBe(true)
      expect(res.admitted.status).toBe("completed")
      expect(res.admitted.complete).toBe(true)
      expect(res.admitted.batchLimitReached).toBeUndefined()
    } finally {
      s.stop()
    }
  })

  test("an unrecognized stored candidate state fails CLOSED instead of restarting the lifecycle", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hz", ["weird"])
      s.state.db
        .query("UPDATE candidates SET state = 'weird-state' WHERE tenant_id = ? AND candidate_id = ?")
        .run(a.tenantId, "weird")

      const res = await callTool(s.url, "cognitive.propose", {
        token: a.token,
        horizonId: "hz",
        candidateId: "weird",
        command: "DELIBERATE",
        evidence: ["ev"],
      })
      expect(res.ok).toBe(false)
      expect(res.refusal.code).toBe("ILLEGAL_TRANSITION")
      expect(candidateState(s, a.tenantId, "hz", "weird")).toBe("weird-state")
    } finally {
      s.stop()
    }
  })

  test("basedOnSeq: -0 is not a sequence", async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "hz" })
      // JSON has no -0 literal that survives a round trip, so drive the adapter directly.
      const { eapPropose } = await import("../src/tools/eap")
      const res = eapPropose(s.state, {
        token: a.token,
        horizonId: "hz",
        candidateId: "c1",
        command: "DELIBERATE",
        evidence: ["ev"],
        basedOnSeq: -0,
      })
      expect(res.ok).toBe(false)
      expect((res as any).refusal.code).toBe("MALFORMED_CONTRACT")
    } finally {
      s.stop()
    }
  })
})
