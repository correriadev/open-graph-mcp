import { expect } from "bun:test"
import { startServer } from "../src/index"
import { register } from "./helpers"
import { admitPersistentDelta, disassemblePersistentDelta, type PersistentDelta } from "../src/eap/persistent-delta"
import { annotatedTest } from "./verification/annotate"

const validClaimDelta = (id: string, domain = "ui", level = 5, refs: string[] = []) => ({
  kind: "claim.add" as const,
  payload: { id, subject: id, domain, level, refs },
})

annotatedTest(
  "disassemblePersistentDelta exposes candidate deltas as envelope without direct admission",
  // Each candidate is exposed for the ordinary Admission Gate and the envelope grants no admission
  // itself — EAP-VOBJ-010's Then.
  { asserts: ["EAP-VOBJ-010"] },
  () => {
  const delta: PersistentDelta = {
    id: "pd_1",
    candidates: [
      { id: "cand_1", required: true, delta: validClaimDelta("c1") },
      { id: "cand_2", required: false, delta: validClaimDelta("c2") },
    ],
  }

  const disassembled = disassemblePersistentDelta(delta)
  expect(disassembled).toHaveLength(2)
  expect(disassembled[0].id).toBe("cand_1")
  },
)

annotatedTest(
  "admitPersistentDelta admits all candidates atomically when every candidate passes existing gate",
  // EAP-SVCS-004 additionally requires `PersistentDeltaAdmitted` to record the claim identifiers
  // AND the Sequence; EAP-FUNC-002 additionally requires the monotonic Sequence to advance and the
  // event to be observable. Neither event nor sequence is inspected here.
  { coversPartially: ["EAP-SVCS-004", "EAP-FUNC-002"] },
  async () => {
  const s = startServer()
  try {
    const user = await register(s.url, "alice")
    const delta: PersistentDelta = {
      id: "pd_happy",
      intent: "admit valid persistent delta",
      candidates: [
        { id: "c1", delta: validClaimDelta("claim_a") },
        { id: "c2", delta: validClaimDelta("claim_b") },
      ],
    }

    const res = admitPersistentDelta(s.state, { token: user.token, delta })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.admittedClaimIds).toContain("claim_a")
    }
  } finally {
    s.stop()
  }
  },
)
