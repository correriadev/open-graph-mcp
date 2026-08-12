/**
 * Epistemic Admission Protocol (EAP) — Contestation Service (Task 08).
 *
 * Retry#5 / REWORK-LOG defect 1 and 3: contestations and their sequence counter used to live in a
 * volatile `Map` plus a `currentSeq` field that reset to 1 on every process start — so a restart
 * both lost every admitted contestation and began re-issuing sequences that had already been used.
 * State now lives in `SqliteContestationRepository`, and the sequence comes from the durable atomic
 * allocator rather than an in-process counter or `MAX(seq)+1`.
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
import type { SqliteContestationRepository } from './eap-repositories'

export interface ContestKnowledgeRequest {
  id?: string
  sourceHorizonId: string
  targetClaimIds: string[]
  evidenceRefs: string[]
  severity: ContestationSeverity
  reason?: string
}

export class ContestationService {
  constructor(private readonly repo: SqliteContestationRepository) {
    if (!repo) {
      throw new Error('ContestationService requires a durable contestation repository')
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

    if (this.repo.exists(id)) {
      return {
        status: 'REFUSED',
        refusal: {
          code: 'CONTESTATION_REFUSED',
          clientObligation: 'Use a fresh contestation identifier; admitted records are append-only.',
          reason: `Contestation '${id}' already exists and cannot be overwritten.`,
        },
      }
    }

    const contestation = this.repo.save({
      id,
      sourceHorizonId: request.sourceHorizonId,
      targetClaimIds: [...request.targetClaimIds],
      evidenceRefs: request.evidenceRefs.filter((ref) => ref.trim().length > 0),
      severity: request.severity,
      reason: request.reason,
      submittedAt: new Date().toISOString(),
      admitted: true,
    })

    const event: KnowledgeContestedEvent = {
      type: 'KnowledgeContested',
      contestationId: contestation.id,
      sourceHorizonId: contestation.sourceHorizonId,
      targetClaimIds: [...contestation.targetClaimIds],
      severity: contestation.severity,
      evidenceRefs: [...contestation.evidenceRefs],
      timestamp: contestation.submittedAt,
      seq: contestation.seq!,
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
    const contestation = this.repo.get(contestationId)

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
    return this.repo.get(id)
  }
}
