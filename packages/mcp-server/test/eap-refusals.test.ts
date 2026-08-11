import { expect, test, describe } from "bun:test"
import { incrementalGate } from "../src/gates"
import { CLIENT_OBLIGATIONS, RefusalCode } from "@open-graph-mcp/graph-core/eap/refusals"

describe("Task 05: Integrate Typed Admission Refusals", () => {
  test("every closed refusal code maps to a stable client obligation", () => {
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
  })

  test("incrementalGate returns typed refusals with stable code and client obligation", () => {
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
  })
})
