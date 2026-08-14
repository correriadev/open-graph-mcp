/**
 * read-model-projection-and-freshness.test.ts
 *
 * A completed recall and a queryable graph cannot disagree, and a caller cannot assert its own
 * freshness. The five properties pinned here:
 *
 *  1. Recall degradation and truth-ownership suspension are projected onto the READ MODEL
 *     (`candidates`, `authority`) inside the same unit of work that checkpoints the case, so a
 *     completed recall and a queryable graph cannot disagree. The destination status of INDIRECT
 *     dependents stays deferred (003 §Deferred), so only directly-recalled claims are projected.
 *  2. The capability gateway resolves the current sequence from durable governed state; a caller
 *     cannot assert the sequence its own approval is validated against.
 *  3. `basedOnSeq` is bounded and compared for EQUALITY with the observed sequence.
 *  4. `cognitive.recall` establishes idempotency and satisfies it in ONE atomic unit.
 *  5. `cognitive.promote` is idempotent; `cognitive.contest` refuses partially-invalid evidence;
 *     a corrupt stored JSON column produces a typed Refusal, never a raw SyntaxError.
 */
import { describe, expect, test } from "bun:test"
import { annotatedTest } from "./verification/annotate"
import { startServer } from "../src/index"
import { advanceCandidates, callTool, register } from "./helpers"
import { write } from "../src/db"
import { eapRecall } from "../src/tools/eap"

/**
 * RETRY PROVENANCE — F002 task 13, `RetireRetryArchaeology` (003 §Snippet K).
 *
 * This file was `f001-retry6-readmodel-and-freshness.test.ts`. The `retry6` fragment recorded the
 * validation ATTEMPT that produced the suite — the third targeted pass on F001 — not the behaviour
 * it protects. The lineage is not destroyed by the rename: it is demoted to the record below, where
 * provenance belongs and where it can be read without being mistaken for the subject under test.
 *
 * The move is proved inert rather than eyeballed: the pre-rename `AssertionFingerprint` — the
 * order-insensitive multiset of `(matcher, normalized-subject)` pairs, 53 `expect` calls over 39
 * distinct pairs — is reproduced EXACTLY under the new path, and
 * `docs/verification/assertion-fingerprints.json` carries the same hash under the stable id
 * `f001-retry6-readmodel-and-freshness` with the old path retained in `previousPaths`.
 */
export const RetryProvenance = {
  previousFileName: "f001-retry6-readmodel-and-freshness.test.ts",
  retryPass: "F001 retry #6 (third targeted pass)",
  findingClasses: [
    "TL/QA — recall degradation and truth-ownership suspension are not projected onto the read model",
    "TL/QA — the capability gateway trusted the caller's asserted sequence instead of durable state",
    "TL/QA — basedOnSeq was unbounded and not compared for equality with the observed sequence",
    "TL/QA — boundary commands were not idempotent under concurrency and replay",
    "TL/QA — a partially-invalid contract was accepted, and a corrupt stored JSON column crashed",
  ],
  findingSource: "F001 retry #6 TL/QA verdicts (see docs/specs/cognitive_line/REWORK-LOG.md)",
  fingerprintId: "f001-retry6-readmodel-and-freshness",
  fingerprintHash: "7775a9fde83dc62e011e5926f8f1a065661df0db09cf4471212a6903e462e37b",
  expectCallsPreserved: 53,
  retiredBy: "F002 task 13",
} as const

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

const candidateState = (s: any, tenantId: string, horizonId: string, candidateId: string): string | null => {
  const row = s.state.db
    .query("SELECT state FROM candidates WHERE tenant_id = ? AND horizon_id = ? AND candidate_id = ?")
    .get(tenantId, horizonId, candidateId) as { state: string } | null
  return row?.state ?? null
}

describe("recall projects its degradation onto the read model", () => {
  annotatedTest(
    "a recalled claim is no longer admitted knowledge in `candidates`, and cannot climb the lifecycle",
    // The recall's degradation reaches the read model and the recalled claim stops behaving as
    // admitted knowledge. EAP-FUNC-003's When requires an interruption and a resume (absent here)
    // and EAP-RECL-004 is about the surviving scar, which this case does not read.
    { coversPartially: ["EAP-FUNC-003", "EAP-RECL-004"] },
    async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "h1", ["k1"])
      expect(candidateState(s, a.tenantId, "h1", "k1")).toBe("admitted")

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
      expect(recall.admitted.status).toBe("completed")

      // THE PROJECTION: the durable read model agrees with the completed recall.
      expect(candidateState(s, a.tenantId, "h1", "k1")).toBe("recalled")

      // Invalidated knowledge cannot keep climbing.
      const advance = await callTool(s.url, "cognitive.propose", {
        token: a.token,
        horizonId: "h1",
        candidateId: "k1",
        command: "CONCRETIZE",
        evidence: ["ev"],
      })
      expect(advance.ok).toBe(false)
      expect(advance.refusal.code).toBe("ILLEGAL_TRANSITION")

      // And it no longer resolves as admitted knowledge for a further contestation.
      const recontest = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["k1"],
        severity: "blocking",
        evidence: ["more"],
      })
      expect(recontest.ok).toBe(false)
      expect(recontest.refusal.code).toBe("RESOURCE_ABSENT")
    } finally {
      s.stop()
    }
    },
  )

  annotatedTest(
    "a recalled candidate cannot be promoted into a parent horizon",
    // Recalled knowledge is not promotable — the read-model half of EAP-FUNC-003's degradation.
    { coversPartially: ["EAP-FUNC-003"] },
    async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "child", parentId: "root" })
      await advanceCandidates(s.url, a.token, "child", ["c-prom"], "verified")

      const contest = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["c-prom"],
        severity: "invalidating",
        evidence: ["counter-example"],
      })
      expect(contest.ok).toBe(true)
      const recall = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
      })
      expect(recall.ok).toBe(true)

      const promoted = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "child",
        targetParentHorizonId: "root",
        candidateIds: ["c-prom"],
      })
      expect(promoted.ok).toBe(false)
      expect(promoted.refusal.code).toBe("ILLEGAL_TRANSITION")
    } finally {
      s.stop()
    }
    },
  )

  annotatedTest(
    "truth-ownership suspension reaches the `authority` table, and indirect dependents stay deferred",
    // EAP-FUNC-003's "graph-owned affected cells emit TruthOwnershipSuspended", without the
    // interruption-and-resume the scenario's When requires.
    //
    // Deliberately NOT linked to EAP-QUAR-002 (family QA2, destination status of indirect recall
    // dependents). The second half of this case asserts that the read model invents NO destination
    // status for the indirect dependent — it keeps QA2 open rather than deciding it, so there is
    // nothing to discharge and `003` §Section 2 forbids a link into a quarantined family anyway.
    { coversPartially: ["EAP-FUNC-003"] },
    async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")

      seedClaim(s, a.tenantId, { id: "c-root", seq: 1, domain: "ui", level: "P5" })
      seedClaim(s, a.tenantId, { id: "c-dep", seq: 2, domain: "ui", level: "P5", refs: ["c-root"] })
      write(s.state.db, s.state.stateDir, a.tenantId, "authority", {
        tenant_id: a.tenantId,
        cell: "ui:5",
        value: "graph",
        last_flip_seq: 1,
        last_flip_by: "alice",
      })
      // `c-dep` also exists as a lifecycle candidate: it is an INDIRECT dependent of the recalled
      // claim, whose destination status 003 explicitly defers.
      await advanceCandidates(s.url, a.token, "hz", ["c-dep"])

      const contest = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["c-root"],
        severity: "invalidating",
        evidence: ["counter-example"],
      })
      const recall = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
      })
      expect(recall.ok).toBe(true)
      expect(recall.admitted.suspendedCells).toEqual(["ui:5"])

      const authority = s.state.db
        .query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?")
        .get(a.tenantId, "ui:5") as { value: string }
      expect(authority.value).toBe("suspended")

      // DEFERRED, ON PURPOSE: the indirect dependent is in the closure and scarred, but the read
      // model does not invent a destination status for it.
      expect(recall.admitted.affectedClaimIds).toEqual(["c-dep", "c-root"])
      expect(candidateState(s, a.tenantId, "hz", "c-dep")).toBe("admitted")
    } finally {
      s.stop()
    }
    },
  )
})

describe("the capability gateway resolves freshness from durable state, not from the request", () => {
  annotatedTest(
    "an approval bound to a sequence the horizon never reached is refused even when the caller asserts it",
    // EAP-VOBJ-011's Sequence arm, in full: the request is based on a different Sequence than the
    // durable state holds, authorization is refused, and the grant is not consumed. ERRP-004 is
    // partial — the provider is not called, but its evidence-waiver clause is untouched.
    { asserts: ["EAP-VOBJ-011"], coversPartially: ["EAP-ERRP-004"] },
    async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "hz" })

      const services = s.eap(a.tenantId)
      services.capabilities.registerClassification("deploy_tool", "irreversible")
      expect(
        services.approvalRepo.registerApproval({
          id: "apS",
          approver: "operator-alice",
          scope: "deploy.production",
          expiresAt: Date.now() + 60_000,
          basedOnSeq: 99,
        }).registered,
      ).toBe(true)

      let providerRan = false
      const res = await services.capabilities.execute({
        capabilityId: "deploy_tool",
        idempotencyKey: "idem-forged-seq",
        contract: { contractRef: "contract-deploy", targetScope: "deploy.production" },
        // THE EXPLOIT: the caller asserts the very sequence its approval was bound to.
        currentSeq: 99,
        approval: { id: "apS" } as any,
        providerAction: () => {
          providerRan = true
          return { deployed: true }
        },
      })

      expect(res.status).toBe("REFUSED")
      if (res.status === "REFUSED") expect(res.refusal.code).toBe("APPROVAL_STALE_SEQ")
      expect(providerRan).toBe(false)
      expect(services.approvalRepo.getApproval("apS")?.consumed).toBe(false)
    } finally {
      s.stop()
    }
    },
  )

  annotatedTest(
    "an approval bound to the sequence the durable horizon actually holds executes",
    // The positive path of EAP-FUNC-004 (a matching non-expired approval on the CURRENT Sequence
    // executes). Neither `CapabilityExecuted` nor the consumption of the grant is read back here.
    { coversPartially: ["EAP-FUNC-004"] },
    async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hz", ["k1"])
      const observed = s.state.db
        .query("SELECT COALESCE(MAX(seq), 0) AS seq FROM horizons WHERE tenant_id = ?")
        .get(a.tenantId) as { seq: number }
      expect(observed.seq).toBeGreaterThan(0)

      const services = s.eap(a.tenantId)
      services.capabilities.registerClassification("deploy_tool", "irreversible")
      services.approvalRepo.registerApproval({
        id: "apOk",
        approver: "operator-alice",
        scope: "deploy.production",
        expiresAt: Date.now() + 60_000,
        basedOnSeq: observed.seq,
      })

      const res = await services.capabilities.execute({
        capabilityId: "deploy_tool",
        idempotencyKey: "idem-fresh-seq",
        contract: { contractRef: "contract-deploy", targetScope: "deploy.production" },
        // Deliberately WRONG in the request: the gateway must ignore it entirely.
        currentSeq: 12345,
        approval: { id: "apOk" } as any,
        providerAction: () => ({ deployed: true }),
      })

      expect(res.status).toBe("COMPLETED")
    } finally {
      s.stop()
    }
    },
  )
})

describe("basedOnSeq is bounded and compared for equality with the observed sequence", () => {
  annotatedTest(
    "an oversized basedOnSeq is a malformed contract, not a free pass through the freshness gate",
    // EAP-SEC-002: an out-of-range contract value is refused before any lifecycle or repository
    // action — the candidate row is never created.
    { asserts: ["EAP-SEC-002"] },
    async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hb", ["k1"])

      const res = await callTool(s.url, "cognitive.propose", {
        token: a.token,
        horizonId: "hb",
        candidateId: "k2",
        command: "DELIBERATE",
        evidence: ["ev"],
        basedOnSeq: 1e308,
      })
      expect(res.ok).toBe(false)
      expect(res.refusal.code).toBe("MALFORMED_CONTRACT")
      expect(candidateState(s, a.tenantId, "hb", "k2")).toBeNull()

      const promoted = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "hb",
        targetParentHorizonId: "hb",
        candidateIds: ["k1"],
        basedOnSeq: 1e308,
      })
      expect(promoted.ok).toBe(false)
      expect(promoted.refusal.code).toBe("MALFORMED_CONTRACT")
    } finally {
      s.stop()
    }
    },
  )

  annotatedTest(
    "a basedOnSeq claiming a FUTURE sequence is refused as not fresh",
    // EAP-VOBJ-007 is about a NEGATIVE or DECREASING Sequence; this refuses one that runs AHEAD of
    // the observed value. Same freshness invariant, different arm — hence partial.
    { coversPartially: ["EAP-VOBJ-007"] },
    async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hb", ["k1"])
      const horizon = s.state.db
        .query("SELECT seq FROM horizons WHERE tenant_id = ? AND id = ?")
        .get(a.tenantId, "hb") as { seq: number }

      const ahead = await callTool(s.url, "cognitive.propose", {
        token: a.token,
        horizonId: "hb",
        candidateId: "k2",
        command: "DELIBERATE",
        evidence: ["ev"],
        basedOnSeq: horizon.seq + 5,
      })
      expect(ahead.ok).toBe(false)
      expect(ahead.refusal.code).toBe("STALE_BASE")

      // The observed sequence itself is accepted.
      const exact = await callTool(s.url, "cognitive.propose", {
        token: a.token,
        horizonId: "hb",
        candidateId: "k2",
        command: "DELIBERATE",
        evidence: ["ev"],
        basedOnSeq: horizon.seq,
      })
      expect(exact.ok).toBe(true)
    } finally {
      s.stop()
    }
    },
  )
})

describe("boundary commands are idempotent under concurrency and replay", () => {
  annotatedTest(
    "two concurrent cognitive.recall calls for one contestation open exactly one case",
    // EAP-FUNC-003's "processed idempotently" clause, under concurrency rather than under the
    // interruption-and-resume the scenario specifies.
    { coversPartially: ["EAP-FUNC-003"] },
    async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      seedClaim(s, a.tenantId, { id: "c-race", seq: 1, domain: "ui", level: "P5" })
      const contest = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["c-race"],
        severity: "invalidating",
        evidence: ["counter-example"],
      })

      // Driven through the adapter directly: two `cognitive.recall` invocations interleaving at the
      // adapter's OWN await points inside one process. Over HTTP the two requests happen to be
      // dispatched sequentially, which hides the window rather than closing it.
      const args = { token: a.token, contestationId: contest.admitted.contestationId }
      const [first, second] = (await Promise.all([eapRecall(s.state, args), eapRecall(s.state, args)])) as any[]

      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      expect(first.admitted.recallId).toBe(second.admitted.recallId)
      expect(first.admitted.seq).toBe(second.admitted.seq)

      const cases = s.state.db
        .query("SELECT COUNT(*) AS n FROM recall_cases WHERE tenant_id = ?")
        .get(a.tenantId) as { n: number }
      expect(cases.n).toBe(1)
      // Exactly one recall sequence was burned for one epistemic act.
      const allocator = s.state.db
        .query("SELECT value FROM eap_sequences WHERE tenant_id = ? AND name = 'recalls'")
        .get(a.tenantId) as { value: number }
      expect(allocator.value).toBe(1)
    } finally {
      s.stop()
    }
    },
  )

  annotatedTest(
    "replaying cognitive.promote returns the same proposal instead of minting a second one",
    // EAP-SEC-003's "the host performs no state transition" on replay — but the scenario's Given is
    // a captured EVENT replayed as a command, whereas this replays the COMMAND itself. Partial.
    { coversPartially: ["EAP-SEC-003"] },
    async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "child", parentId: "root" })
      await advanceCandidates(s.url, a.token, "child", ["c3"], "verified")

      const first = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "child",
        targetParentHorizonId: "root",
        candidateIds: ["c3"],
      })
      expect(first.ok).toBe(true)
      const seqAfterFirst = (
        s.state.db.query("SELECT seq FROM horizons WHERE tenant_id = ? AND id = ?").get(a.tenantId, "child") as {
          seq: number
        }
      ).seq

      const second = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "child",
        targetParentHorizonId: "root",
        candidateIds: ["c3"],
      })
      expect(second.ok).toBe(true)
      expect(second.admitted.promotionId).toBe(first.admitted.promotionId)
      expect(second.admitted.replayed).toBe(true)

      const proposals = s.state.db
        .query("SELECT COUNT(*) AS n FROM proposals WHERE tenant_id = ? AND child_id = ? AND parent_id = ?")
        .get(a.tenantId, "child", "root") as { n: number }
      expect(proposals.n).toBe(1)
      const seqAfterSecond = (
        s.state.db.query("SELECT seq FROM horizons WHERE tenant_id = ? AND id = ?").get(a.tenantId, "child") as {
          seq: number
        }
      ).seq
      expect(seqAfterSecond).toBe(seqAfterFirst)
    } finally {
      s.stop()
    }
    },
  )
})

describe("contracts are refused whole, and corrupt durable state refuses instead of crashing", () => {
  annotatedTest(
    "cognitive.contest refuses evidence with a non-string element rather than silently dropping it",
    // EAP-SVCS-007's terminal evidence refusal, for a partially-malformed evidence array rather
    // than the "no required evidence" Given the scenario states.
    { coversPartially: ["EAP-SVCS-007"] },
    async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hz", ["k1"])

      const res = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["k1"],
        severity: "invalidating",
        evidence: [{ a: 1 }, "ok-ev"],
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
    },
  )

  annotatedTest(
    "a corrupt contestations column yields a typed Refusal, not a SyntaxError out of the repository",
    // EAP-XPRT-002's "a typed MCP Refusal with a stable RefusalCode and no partial side effect".
    // The scenario's Given is a request that violates a host RULE, not corrupt durable state, and
    // the client obligation is not read back — so the link is partial.
    { coversPartially: ["EAP-XPRT-002"] },
    async () => {
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
      s.state.db
        .query("UPDATE contestations SET target_claim_ids = '{not json' WHERE tenant_id = ? AND id = ?")
        .run(a.tenantId, contest.admitted.contestationId)

      const recall = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
      })
      expect(recall.ok).toBe(false)
      expect(recall.refusal.code).toBe("RESOURCE_ABSENT")
    } finally {
      s.stop()
    }
    },
  )

  annotatedTest(
    "a corrupt recall_cases.state column yields a typed Refusal on replay",
    // Same partial relationship to EAP-XPRT-002 as the case above.
    { coversPartially: ["EAP-XPRT-002"] },
    async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      seedClaim(s, a.tenantId, { id: "c-corrupt", seq: 1, domain: "ui", level: "P5" })
      const contest = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["c-corrupt"],
        severity: "invalidating",
        evidence: ["counter-example"],
      })
      const first = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
      })
      expect(first.ok).toBe(true)

      s.state.db
        .query("UPDATE recall_cases SET state = '{not json' WHERE tenant_id = ? AND id = ?")
        .run(a.tenantId, first.admitted.recallId)

      const replay = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contest.admitted.contestationId,
      })
      expect(replay.ok).toBe(false)
      expect(replay.refusal.code).toBe("RESOURCE_ABSENT")
    } finally {
      s.stop()
    }
    },
  )
})
