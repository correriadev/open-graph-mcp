/**
 * eap-client.test.ts — Task 12 (External Agent Client Adapter) plus the retry#5 regression for
 * REWORK-LOG defect class 4: the adapter must forward the real session token and the caller's
 * evidence, and must never fabricate evidence or submit anonymously.
 */
import { describe, expect, test } from "bun:test"
import { ExternalAgentClientAdapter, type Refusal } from "../src/eap"
import { annotatedTest } from "../../mcp-server/test/verification/annotate.ts"

describe("ExternalAgentClientAdapter — proposal submission contract", () => {
  annotatedTest(
    "forwards the session token and the caller's evidence under the host's 'evidence' field",
    // EAP-XPRT-003: an Intermediator's output enters as a PROPOSAL. Proven here only for the
    // adapter's half — the MCP client is a stub, so "only the deterministic MCP host may admit or
    // persist it" is not exercised.
    { coversPartially: ["EAP-XPRT-003"] },
    async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const adapter = new ExternalAgentClientAdapter({
      mcpClient: {
        callTool: async (name, args) => {
          calls.push({ name, args })
          return { ok: true, admitted: { candidateId: "cand-1" } }
        },
      },
    })

    const outcome = await adapter.submitProposal({
      token: "tok-123",
      horizonId: "h1",
      role: "intermediator",
      candidateId: "cand-1",
      content: "distilled",
      evidenceRefs: ["ev-1", "ev-2"],
      basedOnSeq: 4,
    })

    expect(outcome.status).toBe("admitted")
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe("cognitive.propose")
    expect(calls[0].args.token).toBe("tok-123")
    expect(calls[0].args.evidence).toEqual(["ev-1", "ev-2"])
    expect(calls[0].args.evidenceRefs).toBeUndefined()
    },
  )

  // OUT OF SCOPE (F002 task 06): an adapter-local session-token guard (retry#5 defect class 4).
  // `004` specifies authentication as a precondition of its MCP scenarios ("an authenticated Agent
  // Client") and mints no scenario for the client-side check, so there is nothing to discharge.
  test("refuses locally, without calling the host, when the session token is absent", async () => {
    let called = false
    const adapter = new ExternalAgentClientAdapter({
      mcpClient: {
        callTool: async () => {
          called = true
          return { ok: true }
        },
      },
    })

    const outcome = await adapter.submitProposal({
      horizonId: "h1",
      role: "executor",
      content: "x",
      evidenceRefs: ["ev-1"],
    })

    expect(outcome.status).toBe("refused")
    expect(called).toBe(false)
  })

  // OUT OF SCOPE (F002 task 06): the evidence refusal `004` specifies (EAP-SVCS-007) is the HOST's,
  // returned by `ContestKnowledge` through the Admission Gate. This case refuses in the adapter
  // before the host is reached, which is a different obligation and no registered scenario.
  test("never fabricates evidence: an empty evidence set is refused with EVIDENCE_REQUIRED", async () => {
    let called = false
    const adapter = new ExternalAgentClientAdapter({
      mcpClient: {
        callTool: async () => {
          called = true
          return { ok: true }
        },
      },
    })

    const outcome = await adapter.submitProposal({
      token: "tok-123",
      horizonId: "h1",
      role: "executor",
      content: "x",
      evidenceRefs: [],
    })

    expect(outcome.status).toBe("refused")
    expect(outcome.refusal?.code).toBe("EVIDENCE_REQUIRED")
    expect(called).toBe(false)
  })

  annotatedTest(
    "maps a host typed refusal to its declared client obligation without auto-retrying",
    { asserts: ["EAP-XPRT-005"] },
    async () => {
    const adapter = new ExternalAgentClientAdapter()
    const refusal: Refusal = {
      code: "DIRECT_EDIT_FORBIDDEN",
      reason: "external clients cannot mutate persistent state",
      obligation: "SUBMIT_PROPOSAL",
    }
    const handled = adapter.handleRefusal(refusal)
    expect(handled.actionRequired).toBe("SUBMIT_PROPOSAL")
    expect(handled.canAutoRetry).toBe(false)
    },
  )

  annotatedTest(
    "a direct-edit attempt is refused by the adapter itself",
    // EAP-ERRP-001 requires that NO MUTATION occurs at the host. This case only shows the adapter
    // refusing before any host call, so it covers the scenario in part.
    { coversPartially: ["EAP-ERRP-001"] },
    async () => {
    const adapter = new ExternalAgentClientAdapter()
    const outcome = await adapter.attemptDirectEdit({
      token: "tok-123",
      horizonId: "h1",
      role: "executor",
      content: "x",
    })
    expect(outcome.status).toBe("refused")
    expect(outcome.refusal?.code).toBe("DIRECT_EDIT_FORBIDDEN")
    },
  )
})
