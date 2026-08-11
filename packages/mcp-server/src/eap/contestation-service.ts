/**
 * Epistemic Admission Protocol (EAP) — Contestation Service
 */

import {
  Contestation,
  ContestationAdmissionResult,
  ContestationSeverity,
  KnowledgeContestedEvent,
  RecallInitiationResult,
  canInitiateRecall,
  validateEvidence,
} from '@open-graph-mcp/graph-core/eap/contestation'

export interface ContestKnowledgeRequest {
  id?: string
  sourceHorizonId: string
  targetClaimIds: string[]
  evidenceRefs: string[]
  severity: ContestationSeverity
  reason?: string
}

export interface MockClaim {
  id: string
  content: string
  status: string
}

export class ContestationService {
  private contestations: Map<string, Contestation> = new Map()
  private claims: Map<string, MockClaim> = new Map()
  private currentSeq: number = 1

  constructor(initialClaims: MockClaim[] = []) {
    for (const claim of initialClaims) {
      this.claims.set(claim.id, { ...claim })
    }
  }

  public contestKnowledge(request: ContestKnowledgeRequest): ContestationAdmissionResult {
    if (!request.targetClaimIds || request.targetClaimIds.length === 0) {
      return {
        status: 'REFUSED',
        refusal: {
          code: 'INVALID_TARGET_CLAIM',
          clientObligation: 'Provide at least one target claim ID to contest.',
          reason: 'Contestation must target one or more valid claim IDs.',
        },
      }
    }

    if (!validateEvidence(request.evidenceRefs)) {
      return {
        status: 'REFUSED',
        refusal: {
          code: 'EVIDENCE_REQUIRED',
          clientObligation: 'Present verifiable evidence anchors; contestation requires evidence.',
          reason: 'Contestation cannot be admitted without required evidence references.',
        },
      }
    }

    const id = request.id || `contestation-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    const seq = this.currentSeq++
    const contestation: Contestation = {
      id,
      sourceHorizonId: request.sourceHorizonId,
      targetClaimIds: [...request.targetClaimIds],
      evidenceRefs: request.evidenceRefs.filter((ref) => ref.trim().length > 0),
      severity: request.severity,
      reason: request.reason,
      submittedAt: new Date().toISOString(),
      seq,
      admitted: true,
    }

    this.contestations.set(id, contestation)

    const event: KnowledgeContestedEvent = {
      type: 'KnowledgeContested',
      contestationId: contestation.id,
      sourceHorizonId: contestation.sourceHorizonId,
      targetClaimIds: [...contestation.targetClaimIds],
      severity: contestation.severity,
      evidenceRefs: [...contestation.evidenceRefs],
      timestamp: contestation.submittedAt,
      seq,
    }

    return {
      status: 'ADMITTED',
      contestation,
      event,
    }
  }

  public attemptDirectClaimMutation(claimId: string, action: 'edit' | 'delete'): ContestationAdmissionResult {
    return {
      status: 'REFUSED',
      refusal: {
        code: 'DIRECT_EDIT_FORBIDDEN',
        clientObligation: 'A contestation cannot directly edit or delete an admitted claim.',
        reason: `Direct ${action} of admitted claim "${claimId}" is forbidden. Submit an evidence-backed contestation proposal instead.`,
      },
    }
  }

  public initiateRecall(contestationId: string): RecallInitiationResult {
    const contestation = this.contestations.get(contestationId)

    if (!contestation) {
      return {
        status: 'REFUSED',
        refusal: {
          code: 'RECALL_UNPROVEN',
          clientObligation: 'Recall requires an admitted invalidating contestation.',
          reason: `Contestation with ID "${contestationId}" was not found.`,
        },
      }
    }

    if (!contestation.admitted) {
      return {
        status: 'REFUSED',
        refusal: {
          code: 'RECALL_UNPROVEN',
          clientObligation: 'Only admitted invalidating contestations can initiate recall.',
          reason: `Contestation "${contestationId}" is not admitted.`,
        },
      }
    }

    if (!canInitiateRecall(contestation)) {
      return {
        status: 'REFUSED',
        refusal: {
          code: 'RECALL_UNPROVEN',
          clientObligation: 'Only admitted invalidating contestations can initiate recall.',
          reason: `Contestation severity is "${contestation.severity}", but "invalidating" is required for recall initiation.`,
        },
      }
    }

    return {
      status: 'INITIATED',
      recallCaseId: `recall-${contestation.id}`,
      targetClaimIds: [...contestation.targetClaimIds],
      contestationId: contestation.id,
    }
  }

  public getContestation(id: string): Contestation | undefined {
    return this.contestations.get(id)
  }

  public getClaim(id: string): MockClaim | undefined {
    return this.claims.get(id)
  }
}
