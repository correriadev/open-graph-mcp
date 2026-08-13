import { expect, describe } from "bun:test"
import { incrementalGate } from "../src/gates"
import { CLIENT_OBLIGATIONS, RefusalCode } from "@open-graph-mcp/graph-core/eap/refusals"
import { annotatedTest } from "./verification/annotate"

describe("Task 05: Integrate Typed Admission Refusals", () => {
  annotatedTest(
    "every closed refusal code maps to a stable client obligation",
    // EAP-VOBJ-009 rejects a code with NO obligation. This case walks a hand-listed subset of the
    // taxonomy and shows each has one — the converse, and not over the whole closed set.
    { coversPartially: ["EAP-VOBJ-009"] },
    () => {
    const codes: RefusalCode[] = [
      "ANCHOR_NOT_FOUND",
      "COVERAGE_UNBALANCED",
      "CELL_KEY_NONCANONICAL",
      "LADDER_VIOLATION",
      "PROVENANCE_MISSING",
      "TURN_SCOPE",
    ]

    for (const code of codes) {
      const obligation = CLIENT_OBLIGATIONS[code]
      expect(obligation).toBeDefined()
      expect(typeof obligation).toBe("string")
    }
    },
  )

  annotatedTest(
    "incrementalGate returns typed refusals with stable code and client obligation",
    // EAP-ADMS-002 requires EXACTLY ONE refusal carrying its explicit client obligation. This case
    // asserts `refusals.length > 0` and the first code only, so neither clause is fully proven.
    { coversPartially: ["EAP-ADMS-002"] },
    () => {
    const res = incrementalGate(
      {
        kind: "claim.add",
        payload: {
          id: "c1",
          subject: "s",
          domain: "ui",
          level: 5,
          refs: [],
          anchor: "NON_EXISTENT_ANCHOR",
          file: "src/missing.ts",
        },
      },
      {
        lockedCells: ["ui:5"],
        existingClaims: [],
        readFile: () => "some content without the anchor",
      }
    )

    expect(res.ok).toBe(false)
    expect(res.refusals.length).toBeGreaterThan(0)
    expect(res.refusals[0].code).toBe("ANCHOR_NOT_FOUND")
    },
  )
})
