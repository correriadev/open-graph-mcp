import { expect } from "bun:test"
import { ExternalAgentClientAdapter } from "../src/eap"
import { annotatedTest } from "../../mcp-server/test/verification/annotate.ts"

annotatedTest(
  "Client Conformance Suite: External Agent Client Adapter Protocol Invariants",
  {
    // Two clauses, each covered in part: EAP-ERRP-001 (a direct-persistence attempt is returned as a
    // typed governed refusal — observed here on the CLIENT side only, so it proves nothing about
    // host-side mutation) and EAP-XPRT-005 (the adapter applies the declared obligation).
    // Deliberately NOT linked to EAP-SVCS-010: this file is named a conformance suite but runs no
    // `AssessConformance` and issues no host/client verdict.
    coversPartially: ["EAP-ERRP-001", "EAP-XPRT-005"],
  },
  async () => {
  const adapter = new ExternalAgentClientAdapter()

  const directEditResult = await adapter.attemptDirectEdit({
    horizonId: "h1",
    role: "executor",
    content: "direct edit claim",
  })
  expect(directEditResult.status).toBe("refused")
  expect(directEditResult.refusal?.code).toBe("DIRECT_EDIT_FORBIDDEN")
  expect(directEditResult.refusal?.obligation).toBe("SUBMIT_PROPOSAL")

  const handled = adapter.handleRefusal(directEditResult.refusal!)
  expect(handled.handled).toBe(true)
  expect(handled.actionRequired).toBe("SUBMIT_PROPOSAL")
  },
)
