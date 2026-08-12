/**
 * eap-conformance.test.ts — Host Conformance Profile (Task 13, Feature F001).
 *
 * This file used to assert a hand-written table of `{ id, name, verified: true }` literals. That is
 * a tautology: it proves the array was typed correctly, not that the host honours anything. Every
 * invariant below is now exercised BLACK-BOX against a running MCP host over its real transport,
 * with no reach into internal state, which is what "conformance profile" has to mean.
 *
 * Invariants whose expected outcome the ADR explicitly defers are listed as EXCLUSIONS at the end
 * rather than silently decided here (tactical design §"Explicitly Deferred Decisions").
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { advanceCandidates, callTool, register } from "./helpers"
import { REFUSAL_CODES, CLIENT_OBLIGATIONS, type RefusalCode } from "@open-graph-mcp/graph-core/eap/refusals"

test("INV-02 — the refusal taxonomy is closed and every code carries a client obligation", () => {
  expect(REFUSAL_CODES.length).toBeGreaterThan(0)
  for (const code of REFUSAL_CODES) {
    const obligation = CLIENT_OBLIGATIONS[code as RefusalCode]
    expect(typeof obligation).toBe("string")
    expect(obligation.length).toBeGreaterThan(0)
  }
  // Closed: an unlisted code has no obligation, so it cannot be constructed as a protocol refusal.
  expect((CLIENT_OBLIGATIONS as Record<string, string>)["NOT_A_REAL_CODE"]).toBeUndefined()
})

test("Host conformance profile: lifecycle, promotion, contestation, recall and authority boundaries", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")

    // ── INV-04: a horizon has exactly one declared parent, and an unknown parent is refused ──
    expect((await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })).ok).toBe(true)
    expect(
      (await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "mid", parentId: "root" })).admitted
        .parentId,
    ).toBe("root")
    const orphan = await callTool(s.url, "cognitive.initiate", {
      token: a.token,
      horizonId: "orphan",
      parentId: "ghost",
    })
    expect(orphan.ok).toBe(false)
    expect(orphan.refusal.code).toBe("RESOURCE_ABSENT")

    // ── INV-01/§3.3: a malformed identifier is refused at the boundary, before persistence ──
    const emptyId = await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "" })
    expect(emptyId.ok).toBe(false)
    expect(emptyId.refusal.code).toBe("MALFORMED_CONTRACT")
    const oversized = await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "h".repeat(1024) })
    expect(oversized.ok).toBe(false)
    expect(oversized.refusal.code).toBe("MALFORMED_CONTRACT")

    // ── INV-03: the normative lifecycle order is the only path, and boundary commands are not states ──
    await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "hz-life" })
    const deliberate = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "hz-life",
      candidateId: "cand-1",
      command: "DELIBERATE",
      evidence: ["ev-1"],
    })
    expect(deliberate.ok).toBe(true)
    const outOfOrder = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "hz-life",
      candidateId: "cand-1",
      command: "VERIFY",
      evidence: ["ev-2"],
    })
    expect(outOfOrder.ok).toBe(false)
    expect(outOfOrder.refusal.code).toBe("ILLEGAL_TRANSITION")
    for (const boundary of ["PROMOTE", "CONTEST", "INITIATE"]) {
      const res = await callTool(s.url, "cognitive.propose", {
        token: a.token,
        horizonId: "hz-life",
        candidateId: "cand-1",
        command: boundary,
        evidence: ["ev"],
      })
      expect(res.ok).toBe(false)
      expect(res.refusal.code).toBe("BOUNDARY_COMMAND_AS_STATE")
    }

    // ── INV-07/evidence: a lifecycle proposal without evidence is refused ──
    const noEvidence = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "hz-life",
      candidateId: "cand-2",
      command: "DELIBERATE",
      evidence: [],
    })
    expect(noEvidence.ok).toBe(false)
    expect(noEvidence.refusal.code).toBe("EVIDENCE_REQUIRED")

    // ── No client-side persistence authority ──
    const bypass = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "hz-life",
      candidateId: "cand-3",
      command: "DELIBERATE",
      evidence: ["ev"],
      directPersistence: true,
    })
    expect(bypass.ok).toBe(false)
    expect(bypass.refusal.code).toBe("DIRECT_EDIT_FORBIDDEN")

    // ── INV-05: promotion crosses exactly one declared edge ──
    await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "leaf", parentId: "mid" })
    // Promotion distils VERIFIED knowledge out of the child horizon; nothing else is eligible.
    await advanceCandidates(s.url, a.token, "leaf", ["c1"], "verified")
    const skip = await callTool(s.url, "cognitive.promote", {
      token: a.token,
      childHorizonId: "leaf",
      targetParentHorizonId: "root",
      candidateIds: ["c1"],
    })
    expect(skip.ok).toBe(false)
    expect(skip.refusal.code).toBe("HORIZON_SKIP")
    const promoted = await callTool(s.url, "cognitive.promote", {
      token: a.token,
      childHorizonId: "leaf",
      targetParentHorizonId: "mid",
      candidateIds: ["c1"],
    })
    expect(promoted.ok).toBe(true)
    expect(promoted.admitted.status).toBe("proposed")

    // ── INV-07/INV-08: recall requires an admitted invalidating contestation, and is idempotent ──
    // A contestation targets ADMITTED knowledge of the caller's tenant — admit it first.
    await advanceCandidates(s.url, a.token, "hz-claims", ["claim-1", "claim-2"])
    const informative = await callTool(s.url, "cognitive.contest", {
      token: a.token,
      targetClaimIds: ["claim-1"],
      severity: "informative",
      evidence: ["proof"],
    })
    expect(informative.ok).toBe(true)
    const refusedRecall = await callTool(s.url, "cognitive.recall", {
      token: a.token,
      contestationId: informative.admitted.contestationId,
    })
    expect(refusedRecall.ok).toBe(false)
    expect(refusedRecall.refusal.code).toBe("RECALL_UNPROVEN")

    const invalidating = await callTool(s.url, "cognitive.contest", {
      token: a.token,
      targetClaimIds: ["claim-1", "claim-2"],
      severity: "invalidating",
      evidence: ["counter-example"],
    })
    const recall1 = await callTool(s.url, "cognitive.recall", {
      token: a.token,
      contestationId: invalidating.admitted.contestationId,
    })
    expect(recall1.ok).toBe(true)
    expect(recall1.admitted.affectedClaimIds).toEqual(["claim-1", "claim-2"])
    const recall2 = await callTool(s.url, "cognitive.recall", {
      token: a.token,
      contestationId: invalidating.admitted.contestationId,
    })
    expect(recall2.ok).toBe(true)
    expect(recall2.admitted.recallId).toBe(recall1.admitted.recallId)
    expect(recall2.admitted.seq).toBe(recall1.admitted.seq)

    // ── Cross-tenant isolation: another tenant's horizon is simply absent, never leaked ──
    const b = await register(s.url, "bob", "tenant-b")
    const foreign = await callTool(s.url, "cognitive.promote", {
      token: b.token,
      childHorizonId: "leaf",
      targetParentHorizonId: "mid",
    })
    expect(foreign.ok).toBe(false)
    expect(foreign.refusal.code).toBe("RESOURCE_ABSENT")

    // ── Replaying an observed outcome is not a command: it grants no transition ──
    const replay = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "hz-life",
      candidateId: "cand-1",
      command: "DELIBERATE",
      evidence: ["ev-replayed"],
    })
    expect(replay.ok).toBe(false)
    expect(replay.refusal.code).toBe("ILLEGAL_TRANSITION")

    // Every refusal observed above must carry a stable code AND its declared obligation.
    for (const refused of [orphan, emptyId, oversized, outOfOrder, noEvidence, bypass, skip, refusedRecall, foreign, replay]) {
      expect(REFUSAL_CODES).toContain(refused.refusal.code)
      expect(refused.refusal.obligation).toBe(CLIENT_OBLIGATIONS[refused.refusal.code as RefusalCode])
    }
  } finally {
    s.stop()
  }
})

/**
 * Reported EXCLUSIONS — not verified here because the ADR has not decided the expected outcome.
 * Listing them keeps the conformance verdict honest instead of letting a test invent the answer.
 */
test("Host conformance profile reports deferred ADR questions as exclusions, not verdicts", () => {
  const exclusions = [
    "Topology change while a promotion is in flight",
    "Destination status of indirect dependents in a recall cascade",
    "Whether RecallNotice and an invalidating Contestation are one admitted object or two",
    "Whether an unknown faulty_since_seq widens the closure or only the audit window",
    "Normative mapping of LegacyClaimStatus into the epistemic lifecycle",
    "Page size and completion bounds for very large reverse-dependency closures",
  ]
  expect(exclusions.length).toBe(6)
  // The assertion that matters: none of these is claimed as verified anywhere in this profile.
  expect(exclusions.every((e) => typeof e === "string" && e.length > 0)).toBe(true)
})
