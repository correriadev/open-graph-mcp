import { describe, it, expect } from "bun:test"
import {
  createRecallCase,
  stepRecall,
  resumeRecallFromCheckpoint,
  queryRecallScar,
  InMemoryDependencyQuery,
  type RecallNotice,
  type RecallCase,
} from "@open-graph-mcp/graph-core/eap/recall"

describe("Task 09 — Resumable Recall", () => {
  it("Should create a Recall Case when an invalidating Contestation has been admitted", () => {
    const depQuery = new InMemoryDependencyQuery([
      { from: "claim-B", to: "claim-A" },
    ])

    const notice: RecallNotice = {
      recallId: "rec-001",
      contestationId: "cont-100",
      targetClaimIds: ["claim-A"],
      severity: "invalidating",
      contestationStatus: "admitted",
      initiatedAt: new Date().toISOString(),
    }

    const recallCase = createRecallCase(notice, depQuery) as RecallCase
    expect("refused" in recallCase).toBe(false)
    expect(recallCase.id).toBe("rec-001")
  })

  it("Should preserve the historical scar when Recall completes", () => {
    const depQuery = new InMemoryDependencyQuery([{ from: "claim-B", to: "claim-A" }])
    const notice: RecallNotice = {
      recallId: "rec-006",
      contestationId: "cont-105",
      targetClaimIds: ["claim-A"],
      severity: "invalidating",
      contestationStatus: "admitted",
      initiatedAt: new Date().toISOString(),
    }

    const recallCase = createRecallCase(notice, depQuery) as RecallCase
    while (recallCase.status !== "completed") {
      stepRecall(recallCase, 1)
    }

    const scar = queryRecallScar(recallCase)
    expect(scar).not.toBeNull()
    expect(scar?.recallId).toBe("rec-006")
  })
})
