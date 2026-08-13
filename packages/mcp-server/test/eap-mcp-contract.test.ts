import { expect } from "bun:test"
import { startServer } from "../src/index"
import { advanceCandidates, callTool, register } from "./helpers"
import { annotatedTest } from "./verification/annotate"

annotatedTest(
  "cognitive.initiate creates horizon and returns admitted outcome or typed refusal for invalid parent",
  {
    // EAP-XPRT-001: a valid `initiate` returns the admitted outcome through the MCP Cognitive
    // Binding, and the transport adds no policy of its own.
    asserts: ["EAP-XPRT-001"],
    // Each of these is touched as one step of that flow: the host-side InitiateHorizon service
    // (SVCS-003, whose seedRef/budgetRef payload is not inspected), the malformed-contract refusal
    // (ERRP-002) and the absent-parent outcome (ERRP-003, whose cross-tenant clause is elsewhere).
    coversPartially: ["EAP-SVCS-003", "EAP-ERRP-002", "EAP-ERRP-003"],
  },
  async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")

    const resRoot = await callTool(s.url, "cognitive.initiate", {
      token: a.token,
      horizonId: "horizon-root",
      seed: { provenance: ["doc:001"] },
    })
    expect(resRoot.ok).toBe(true)
    expect(resRoot.admitted.horizonId).toBe("horizon-root")
    expect(resRoot.admitted.parentId).toBeNull()
    expect(resRoot.admitted.status).toBe("initiated")

    const resChild = await callTool(s.url, "cognitive.initiate", {
      token: a.token,
      horizonId: "horizon-child",
      parentId: "horizon-root",
    })
    expect(resChild.ok).toBe(true)
    expect(resChild.admitted.parentId).toBe("horizon-root")

    const resBadParent = await callTool(s.url, "cognitive.initiate", {
      token: a.token,
      horizonId: "horizon-orphan",
      parentId: "non-existent-parent",
    })
    expect(resBadParent.ok).toBe(false)
    expect(resBadParent.refusal.code).toBe("RESOURCE_ABSENT")

    const resEmptyId = await callTool(s.url, "cognitive.initiate", {
      token: a.token,
      horizonId: "",
    })
    expect(resEmptyId.ok).toBe(false)
    expect(resEmptyId.refusal.code).toBe("MALFORMED_CONTRACT")
  } finally {
    s.stop()
  }
  },
)

annotatedTest(
  "cognitive.propose enforces epistemic lifecycle sequence and refuses direct persistence bypass",
  {
    // Four scenarios each touched as one step: the out-of-order refusal (LIFE-002) and the boundary
    // command refusal (LIFE-003) are observed at the transport rather than on the aggregate and the
    // resulting STATE is not read back; ERRP-001's "no mutation occurs" and XPRT-002's client
    // obligation are likewise not inspected.
    coversPartially: ["EAP-LIFE-002", "EAP-LIFE-003", "EAP-ERRP-001", "EAP-XPRT-002"],
  },
  async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "h1" })

    const p1 = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "h1",
      candidateId: "cand-1",
      command: "DELIBERATE",
      evidence: ["ev-deliberate"],
    })
    expect(p1.ok).toBe(true)

    const p2 = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "h1",
      candidateId: "cand-1",
      command: "ADMIT",
      evidence: ["ev-admit"],
    })
    expect(p2.ok).toBe(true)

    const pBad = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "h1",
      candidateId: "cand-1",
      command: "VERIFY",
      evidence: ["ev-bad"],
    })
    expect(pBad.ok).toBe(false)
    expect(pBad.refusal.code).toBe("ILLEGAL_TRANSITION")

    const pBoundary = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "h1",
      candidateId: "cand-1",
      command: "PROMOTE",
      evidence: ["ev-boundary"],
    })
    expect(pBoundary.ok).toBe(false)
    expect(pBoundary.refusal.code).toBe("BOUNDARY_COMMAND_AS_STATE")

    const pBypass = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "h1",
      candidateId: "cand-1",
      command: "CONCRETIZE",
      evidence: ["ev-bypass"],
      directPersistence: true,
    })
    expect(pBypass.ok).toBe(false)
    expect(pBypass.refusal.code).toBe("DIRECT_EDIT_FORBIDDEN")
  } finally {
    s.stop()
  }
  },
)

annotatedTest(
  "cognitive.promote handles immediate parent edges and refuses HORIZON_SKIP",
  // The transport-level view of PROM-001 and PROM-002. Neither the non-inheritance clause nor the
  // absence of a stored parent proposal after the skip is checked here; promotion.test.ts and
  // f001-transport-delegation carry the `asserts` links.
  { coversPartially: ["EAP-PROM-001", "EAP-PROM-002"] },
  async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
    await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "mid", parentId: "root" })
    await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "leaf", parentId: "mid" })
    // Only VERIFIED knowledge is promotable — the child horizon has to actually hold it.
    await advanceCandidates(s.url, a.token, "leaf", ["c1"], "verified")

    const promValid = await callTool(s.url, "cognitive.promote", {
      token: a.token,
      childHorizonId: "leaf",
      targetParentHorizonId: "mid",
      candidateIds: ["c1"],
    })
    expect(promValid.ok).toBe(true)
    expect(promValid.admitted.status).toBe("proposed")

    const promSkip = await callTool(s.url, "cognitive.promote", {
      token: a.token,
      childHorizonId: "leaf",
      targetParentHorizonId: "root",
      candidateIds: ["c1"],
    })
    expect(promSkip.ok).toBe(false)
    expect(promSkip.refusal.code).toBe("HORIZON_SKIP")
  } finally {
    s.stop()
  }
  },
)

annotatedTest(
  "cognitive.contest and cognitive.recall enforce evidence-backed contestation and invalidating severity",
  // The evidence refusal (SVCS-007), the informative-contestation recall refusal (RECL-002) and the
  // admitted-contestation path (SVCS-006) are each one step of this flow; none of their durable
  // "and nothing was written / nothing was edited" clauses is inspected.
  { coversPartially: ["EAP-SVCS-006", "EAP-SVCS-007", "EAP-RECL-002"] },
  async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    // A contestation targets ADMITTED knowledge; the targets have to exist in this tenant first.
    await advanceCandidates(s.url, a.token, "hz-claims", ["claim-1", "claim-2"])

    const contestNoEv = await callTool(s.url, "cognitive.contest", {
      token: a.token,
      targetClaimIds: ["claim-1"],
      severity: "invalidating",
      evidence: [],
    })
    expect(contestNoEv.ok).toBe(false)
    expect(contestNoEv.refusal.code).toBe("EVIDENCE_REQUIRED")

    const contestInfo = await callTool(s.url, "cognitive.contest", {
      token: a.token,
      targetClaimIds: ["claim-1"],
      severity: "informative",
      evidence: ["proof-1"],
    })
    expect(contestInfo.ok).toBe(true)

    const recallRefused = await callTool(s.url, "cognitive.recall", {
      token: a.token,
      contestationId: contestInfo.admitted.contestationId,
    })
    expect(recallRefused.ok).toBe(false)
    expect(recallRefused.refusal.code).toBe("RECALL_UNPROVEN")

    const contestInval = await callTool(s.url, "cognitive.contest", {
      token: a.token,
      targetClaimIds: ["claim-1", "claim-2"],
      severity: "invalidating",
      evidence: ["proof-counter-example"],
    })
    expect(contestInval.ok).toBe(true)

    const recallOk = await callTool(s.url, "cognitive.recall", {
      token: a.token,
      contestationId: contestInval.admitted.contestationId,
    })
    expect(recallOk.ok).toBe(true)
    expect(recallOk.admitted.status).toBe("completed")
    expect(recallOk.admitted.affectedClaimIds).toEqual(["claim-1", "claim-2"])
  } finally {
    s.stop()
  }
  },
)
