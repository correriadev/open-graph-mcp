/**
 * eap.ts — External Agent Client Adapter for OpenGraph Cognitive Line (EAP).
 */

export type AgentRole = "intermediator" | "executor" | "operator"

export type RefusalCode =
  | "HORIZON_SKIP"
  | "STALE_SEQUENCE"
  | "EVIDENCE_REQUIRED"
  | "DIRECT_EDIT_FORBIDDEN"
  | "SCOPE_EXCEEDED"
  | "APPROVAL_EXPIRED"
  | "UNAUTHORIZED_IRREVERSIBLE"
  | "RECALL_UNPROVEN"
  | "HORIZON_BUDGET_EXHAUSTED"
  | "INVALID_TRANSITION"

export type ClientObligation =
  | "TARGET_PARENT_HORIZON"
  | "REFRESH_SEQUENCE"
  | "PROVIDE_EVIDENCE"
  | "SUBMIT_PROPOSAL"
  | "REQUEST_APPROVAL"
  | "OBTAIN_OPERATOR_AUTHORIZATION"
  | "PROVE_INVALIDATING_CONTESTATION"
  | "ESCALATE_WORKFLOW"
  | "FOLLOW_LIFECYCLE"

export interface Refusal {
  code: RefusalCode
  reason: string
  obligation: ClientObligation
  seq?: number
}

export interface ProposalInput {
  token?: string
  horizonId: string
  role: AgentRole
  candidateId?: string
  content: Record<string, unknown> | string
  evidenceRefs?: string[]
  basedOnSeq?: number
}

export interface ProposalOutcome {
  status: "admitted" | "refused"
  proposalId?: string
  outcome?: Record<string, unknown>
  refusal?: Refusal
}

export interface ClientAdapterConfig {
  mcpClient?: {
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  }
}

export interface HandledRefusalResult {
  handled: true
  actionRequired: ClientObligation
  recommendation: string
  canAutoRetry: boolean
}

const OBLIGATION_MAP: Record<RefusalCode, { obligation: ClientObligation; recommendation: string; canAutoRetry: boolean }> = {
  HORIZON_SKIP: {
    obligation: "TARGET_PARENT_HORIZON",
    recommendation: "Target the immediate declared parent horizon before promotion.",
    canAutoRetry: false,
  },
  STALE_SEQUENCE: {
    obligation: "REFRESH_SEQUENCE",
    recommendation: "Fetch the latest sequence from host and update basedOnSeq.",
    canAutoRetry: true,
  },
  EVIDENCE_REQUIRED: {
    obligation: "PROVIDE_EVIDENCE",
    recommendation: "Attach required mechanical evidence or provenance references.",
    canAutoRetry: false,
  },
  DIRECT_EDIT_FORBIDDEN: {
    obligation: "SUBMIT_PROPOSAL",
    recommendation: "Submit changes as a proposal through the Admission Gate.",
    canAutoRetry: false,
  },
  SCOPE_EXCEEDED: {
    obligation: "REQUEST_APPROVAL",
    recommendation: "Obtain valid operator approval for the requested scope.",
    canAutoRetry: false,
  },
  APPROVAL_EXPIRED: {
    obligation: "REQUEST_APPROVAL",
    recommendation: "Request a fresh operator approval (previous approval expired).",
    canAutoRetry: false,
  },
  UNAUTHORIZED_IRREVERSIBLE: {
    obligation: "OBTAIN_OPERATOR_AUTHORIZATION",
    recommendation: "Provide a valid single-use operator authorization for irreversible action.",
    canAutoRetry: false,
  },
  RECALL_UNPROVEN: {
    obligation: "PROVE_INVALIDATING_CONTESTATION",
    recommendation: "Admit an evidence-backed invalidating contestation before initiating recall.",
    canAutoRetry: false,
  },
  HORIZON_BUDGET_EXHAUSTED: {
    obligation: "ESCALATE_WORKFLOW",
    recommendation: "Escalate workflow to operator or wait for budget replenishment.",
    canAutoRetry: false,
  },
  INVALID_TRANSITION: {
    obligation: "FOLLOW_LIFECYCLE",
    recommendation: "Follow normative lifecycle sequence (proposed -> deliberated -> admitted -> concretized -> verified).",
    canAutoRetry: false,
  },
}

export class ExternalAgentClientAdapter {
  private mcpClient?: {
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  }

  constructor(config: ClientAdapterConfig = {}) {
    this.mcpClient = config.mcpClient
  }

  /**
   * Submits an Intermediator/Executor recommendation as a PROPOSAL.
   *
   * Two guards here exist because of the retry#5 rework findings:
   *
   *  - The session token is REQUIRED and forwarded verbatim. It used to fall back to `""`, which
   *    made the adapter submit anonymously; the host then rejected it with an opaque transport
   *    error instead of a typed refusal, and the client could not tell "not authenticated" from
   *    "refused by the gate".
   *  - Evidence is the caller's, or the proposal never leaves. It used to substitute a literal
   *    `["evidence-default"]` when the caller had none — the adapter FABRICATING the very evidence
   *    the Admission Gate exists to demand. An LLM-backed role with nothing to show must be refused
   *    here, not laundered into a well-formed submission.
   */
  async submitProposal(input: ProposalInput): Promise<ProposalOutcome> {
    if (typeof input.token !== "string" || input.token.trim() === "") {
      return {
        status: "refused",
        refusal: {
          code: "DIRECT_EDIT_FORBIDDEN",
          reason: "A session token is required: the host admits proposals only from an authenticated agent client",
          obligation: "SUBMIT_PROPOSAL",
        },
      }
    }

    const evidence = (input.evidenceRefs ?? []).filter((ref) => typeof ref === "string" && ref.trim().length > 0)
    if (evidence.length === 0) {
      return {
        status: "refused",
        refusal: {
          code: "EVIDENCE_REQUIRED",
          reason: "Proposal carries no evidence reference; the adapter never fabricates evidence on the caller's behalf",
          obligation: "PROVIDE_EVIDENCE",
        },
      }
    }

    const payload = {
      token: input.token,
      horizonId: input.horizonId,
      role: input.role,
      candidateId: input.candidateId ?? `cand_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      command: "DELIBERATE",
      // Field name matches the host's `cognitive.propose` contract exactly. Sending `evidenceRefs`
      // meant the host saw NO evidence and refused every proposal with EVIDENCE_REQUIRED.
      evidence,
      basedOnSeq: input.basedOnSeq ?? 0,
      submittedAs: "proposal",
    }

    if (this.mcpClient) {
      try {
        const result = (await this.mcpClient.callTool("cognitive.propose", payload)) as any
        // The host answers `{ ok: false, refusal }`; older transports answered `{ status: "refused" }`.
        // Both are a refusal, and neither is authority to retry — `handleRefusal` decides that.
        if (result?.ok === false || result?.status === "refused") {
          return {
            status: "refused",
            refusal: {
              code: result.refusal?.code ?? "INVALID_TRANSITION",
              reason: result.refusal?.reason ?? "Proposal refused by host gate",
              obligation: result.refusal?.obligation ?? OBLIGATION_MAP[result.refusal?.code as RefusalCode]?.obligation ?? "SUBMIT_PROPOSAL",
              seq: result.refusal?.seq,
            },
          }
        }
        return {
          status: "admitted",
          proposalId: result?.proposalId ?? payload.candidateId,
          outcome: result,
        }
      } catch (err: any) {
        return {
          status: "refused",
          refusal: {
            code: "INVALID_TRANSITION",
            reason: err?.message ?? "Transport or gate error",
            obligation: "FOLLOW_LIFECYCLE",
          },
        }
      }
    }

    // No transport configured: the adapter has no authority to admit anything on its own. Reporting
    // "admitted" here would be the client claiming host authority — the exact boundary the protocol
    // draws around LLM-backed roles.
    return {
      status: "refused",
      refusal: {
        code: "DIRECT_EDIT_FORBIDDEN",
        reason: "No MCP transport configured: only the deterministic host may admit a proposal",
        obligation: "SUBMIT_PROPOSAL",
      },
    }
  }

  async attemptDirectEdit(input: ProposalInput): Promise<ProposalOutcome> {
    return {
      status: "refused",
      refusal: {
        code: "DIRECT_EDIT_FORBIDDEN",
        reason: "External agent roles (Intermediator/Executor) have no direct write authority to persistent state",
        obligation: "SUBMIT_PROPOSAL",
        seq: input.basedOnSeq,
      },
    }
  }

  handleRefusal(refusal: Refusal): HandledRefusalResult {
    const info = OBLIGATION_MAP[refusal.code] ?? {
      obligation: refusal.obligation ?? "SUBMIT_PROPOSAL",
      recommendation: refusal.reason ?? "Follow protocol obligation",
      canAutoRetry: false,
    }

    return {
      handled: true,
      actionRequired: info.obligation,
      recommendation: info.recommendation,
      canAutoRetry: info.canAutoRetry,
    }
  }
}
