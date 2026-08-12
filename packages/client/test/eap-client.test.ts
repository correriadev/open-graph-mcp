/**
 * eap-client.test.ts — Task 12 (External Agent Client Adapter) plus the retry#5 regression for
 * REWORK-LOG defect class 4: the adapter must forward the real session token and the caller's
 * evidence, and must never fabricate evidence or submit anonymously.
 */
import { describe, expect, test } from "bun:test"
import { ExternalAgentClientAdapter, type Refusal } from "../src/eap"

describe("ExternalAgentClientAdapter — proposal submission contract", () => {
  test("forwards the session token and the caller's evidence under the host's 'evidence' field", async () => {
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
  })

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

  test("maps a host typed refusal to its declared client obligation without auto-retrying", async () => {
    const adapter = new ExternalAgentClientAdapter()
    const refusal: Refusal = {
      code: "DIRECT_EDIT_FORBIDDEN",
      reason: "external clients cannot mutate persistent state",
      obligation: "SUBMIT_PROPOSAL",
    }
    const handled = adapter.handleRefusal(refusal)
    expect(handled.actionRequired).toBe("SUBMIT_PROPOSAL")
    expect(handled.canAutoRetry).toBe(false)
  })

  test("a direct-edit attempt is refused by the adapter itself", async () => {
    const adapter = new ExternalAgentClientAdapter()
    const outcome = await adapter.attemptDirectEdit({
      token: "tok-123",
      horizonId: "h1",
      role: "executor",
      content: "x",
    })
    expect(outcome.status).toBe("refused")
    expect(outcome.refusal?.code).toBe("DIRECT_EDIT_FORBIDDEN")
  })
})
