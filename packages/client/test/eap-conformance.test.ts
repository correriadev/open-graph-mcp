import { expect, test } from "bun:test"
import { ExternalAgentClientAdapter } from "../src/eap"

test("Client Conformance Suite: External Agent Client Adapter Protocol Invariants", async () => {
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
})
