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

/**
 * F002 task 11 — the CLIENT-side half of AssessConformance, and it discharges no Conformance Item
 * on purpose.
 *
 * Task 11 demoted `EAP-L0-003` ("distingue recusa de erro de transporte") and `EAP-L1-005`
 * ("recusa como resultado de primeira classe — exibe código e razões, ... não re-submete
 * cegamente"). Both clauses are about what a CLIENT does after a refusal, and both demotions rest
 * on one fact about this repository: no client here drives transport and then acts on the answer.
 *
 * That fact is asserted here rather than left in a rationale, so the demotion is falsifiable. The
 * adapter accepts an `mcpClient` by injection and, on a refusal, returns *advice* —
 * `actionRequired`, `recommendation`, `canAutoRetry`. It never issues the next request itself. So:
 *
 *  - the retry-versus-no-retry behaviour `EAP-L0-003` asks a host log to distinguish is never
 *    performed by this client, and a host log therefore cannot contain it; and
 *  - the "exibe código e razões" limb of `EAP-L1-005` terminates in a return value a caller may
 *    render — client-side display, invisible to a host log BY NATURE, not by omission.
 *
 * This case carries NO `items`: it is the guard on two demotions, not evidence for them. When
 * someone gives this adapter a retry policy that issues its own follow-up request, this test breaks
 * — which is exactly the moment those two items should be reassessed.
 */
annotatedTest(
  "AssessConformance client — the adapter answers a refusal with advice and never issues the next request itself",
  {
    // Contributes to "report conformance without granting authority": it establishes, client-side,
    // which obligations are not observable at all. It proves no clause, hence covers-partially.
    coversPartially: ["EAP-SVCS-010"],
  },
  async () => {
    const adapter = new ExternalAgentClientAdapter()

    const refused = await adapter.attemptDirectEdit({
      horizonId: "h1",
      role: "executor",
      content: "direct edit claim",
    })
    expect(refused.status).toBe("refused")

    // The refusal is surfaced as data the CALLER may render. Nothing here reaches a host.
    const handled = adapter.handleRefusal(refused.refusal!)
    expect(typeof handled.recommendation).toBe("string")
    expect(handled.recommendation.length).toBeGreaterThan(0)
    expect(typeof handled.canAutoRetry).toBe("boolean")

    // `handleRefusal` is a pure verdict on the refusal: given the same refusal twice it answers the
    // same way, because it performs no request between the two calls. A client that resubmitted
    // would have moved host state and could not be idempotent here.
    const again = adapter.handleRefusal(refused.refusal!)
    expect(again).toEqual(handled)

    // The decisive observation: an adapter wired to a transport that would RECORD any call it made
    // records none, because a refusal is answered with advice and the follow-up is the caller's.
    const attempted: string[] = []
    const wired = new ExternalAgentClientAdapter({
      mcpClient: {
        callTool: async (name: string) => {
          attempted.push(name)
          throw new Error("transport unavailable")
        },
      },
    })
    const wiredRefusal = await wired.attemptDirectEdit({
      horizonId: "h1",
      role: "executor",
      content: "direct edit claim",
    })
    expect(wiredRefusal.status).toBe("refused")
    wired.handleRefusal(wiredRefusal.refusal!)
    // No request was issued in response to the refusal — so no host log can carry the retry
    // behaviour EAP-L0-003 and EAP-L1-005 ask an assessor to read.
    expect(attempted).toEqual([])
  },
)
