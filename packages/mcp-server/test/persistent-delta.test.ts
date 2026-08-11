import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { register } from "./helpers"
import { admitPersistentDelta, disassemblePersistentDelta, type PersistentDelta } from "../src/eap/persistent-delta"

const validClaimDelta = (id: string, domain = "ui", level = 5, refs: string[] = []) => ({
  kind: "claim.add" as const,
  payload: { id, subject: id, domain, level, refs },
})

test("disassemblePersistentDelta exposes candidate deltas as envelope without direct admission", () => {
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
})

test("admitPersistentDelta admits all candidates atomically when every candidate passes existing gate", async () => {
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
})
