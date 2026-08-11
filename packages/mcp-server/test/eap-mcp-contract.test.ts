import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, register } from "./helpers"

test("cognitive.initiate creates horizon and returns admitted outcome or typed refusal for invalid parent", async () => {
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
})

test("cognitive.propose enforces epistemic lifecycle sequence and refuses direct persistence bypass", async () => {
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
})

test("cognitive.promote handles immediate parent edges and refuses HORIZON_SKIP", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
    await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "mid", parentId: "root" })
    await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "leaf", parentId: "mid" })

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
})

test("cognitive.contest and cognitive.recall enforce evidence-backed contestation and invalidating severity", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")

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
})
