import { describe, expect } from "bun:test"
import {
  createRecallCase,
  stepRecall,
  resumeRecallFromCheckpoint,
  queryRecallScar,
  InMemoryDependencyQuery,
  type RecallNotice,
  type RecallCase,
} from "@open-graph-mcp/graph-core/eap/recall"
import { annotatedTest } from "./verification/annotate"

describe("Task 09 — Resumable Recall", () => {
  annotatedTest(
    "Should create a Recall Case when an invalidating Contestation has been admitted",
    // The case is created from an ADMITTED invalidating notice over a registered reverse-dependency
    // edge, which is EAP-RECL-001's Given/When/Then verbatim.
    { asserts: ["EAP-RECL-001"] },
    () => {
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
    },
  )

  annotatedTest(
    "Should preserve the historical scar when Recall completes",
    // EAP-RECL-004: the scar stays queryable after completion. The scenario's second clause — that
    // no admitted record is erased or directly rewritten — is not observed here, but the scar's
    // survival is the scenario's named subject, so the link is `asserts`.
    { asserts: ["EAP-RECL-004"] },
    () => {
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
    },
  )
})
