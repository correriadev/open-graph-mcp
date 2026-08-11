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

  async submitProposal(input: ProposalInput): Promise<ProposalOutcome> {
    const payload = {
      token: input.token ?? "",
      horizonId: input.horizonId,
      role: input.role,
      candidateId: input.candidateId ?? `cand_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      command: "DELIBERATE",
      evidence: input.evidenceRefs && input.evidenceRefs.length > 0 ? input.evidenceRefs : ["evidence-default"],
      basedOnSeq: input.basedOnSeq ?? 0,
      submittedAs: "proposal",
    }

    if (this.mcpClient) {
      try {
        const result = (await this.mcpClient.callTool("cognitive.propose", payload)) as any
        if (result?.status === "refused") {
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

    return {
      status: "admitted",
      proposalId: payload.candidateId,
      outcome: { payload },
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
