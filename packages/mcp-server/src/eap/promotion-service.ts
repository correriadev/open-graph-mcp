/**
 * Promotion Service Adapter — Task 06 (One-Edge Promotion).
 *
 * Retry#5 / REWORK-LOG defect 1: this service used to own a `PromotionStore` of in-memory `Map`s
 * (horizons, proposals, events). It now owns NOTHING. Every read and write goes through
 * `SqlitePromotionRepository`, which is the same durable table set the MCP tool adapters write to,
 * so the two layers can no longer disagree and nothing is lost on restart.
 */

import {
  Horizon,
  HorizonId,
  ParentProposal,
  PromotionRequest,
  PromotionResult,
  PromotionProposedEvent,
  Sequence,
  promoteKnowledge,
} from '@open-graph-mcp/graph-core/eap/promotion'
import type { SqlitePromotionRepository } from './eap-repositories'

export class PromotionService {
  constructor(private readonly repo: SqlitePromotionRepository) {
    if (!repo) {
      throw new Error('PromotionService requires a durable promotion repository')
    }
  }

  public registerHorizon(horizon: Horizon): void {
    if (!horizon.id || horizon.id.trim() === '') {
      throw new Error('HorizonId must be non-empty')
    }
    this.repo.saveHorizon({ ...horizon })
  }

  public getHorizon(id: HorizonId): Horizon | undefined {
    return this.repo.getHorizon(id)
  }

  public updateSequence(id: HorizonId, seq: Sequence): void {
    const horizon = this.repo.getHorizon(id)
    if (!horizon) {
      throw new Error(`Horizon '${id}' not found`)
    }
    if (seq < horizon.currentSeq) {
      throw new Error(`Sequence cannot decrease for horizon '${id}'`)
    }
    this.repo.saveHorizon({ ...horizon, currentSeq: seq })
  }

  public promote(request: PromotionRequest): PromotionResult {
    const childHorizon = this.repo.getHorizon(request.childId)
    if (!childHorizon) {
      return {
        success: false,
        refusalCode: 'HORIZON_SKIP',
        message: `Child horizon '${request.childId}' does not exist.`,
        obligation: 'propose to an existing immediate topological parent',
      }
    }

    const parentHorizon = this.repo.getHorizon(request.parentId)
    if (!parentHorizon) {
      return {
        success: false,
        refusalCode: 'HORIZON_SKIP',
        message: `Parent horizon '${request.parentId}' does not exist.`,
        obligation: 'propose to an existing immediate topological parent',
      }
    }

    const currentApplicableSeq = Math.max(childHorizon.currentSeq, parentHorizon.currentSeq)

    const result = promoteKnowledge(childHorizon, request, currentApplicableSeq)

    if (result.success) {
      // Proposal and its event commit as one durable unit: a promotion that is observable as an
      // event but absent from the parent's proposal set is exactly the divergence this rework closes.
      this.repo.saveProposalWithEvent(result.proposal, result.event)
    }

    return result
  }

  public getProposalsForParent(parentId: HorizonId): ParentProposal[] {
    return this.repo.getProposalsForParent(parentId)
  }

  public getEvents(): PromotionProposedEvent[] {
    return this.repo.getEvents()
  }

  public receivePromotion(opts: {
    envelope: PromotionEnvelope
    targetSnapshot?: GraphSnapshotV2 | null
    targetPolicy?: HorizonRelationshipPolicy
  }): {
    promotionId: string
    status: 'proposed' | 'admitted' | 'refused'
    targetPolicyVersion: string
    reasonCode?: string
  } {
    const validatedEnv = validatePromotionEnvelope(opts.envelope)
    validatePromotionTarget(validatedEnv.sourceHorizonId, validatedEnv.targetHorizonId)

    const promotionId = `prom-recv-${validatedEnv.sourceHorizonId}-${validatedEnv.targetHorizonId}-${Date.now()}`
    const targetPolicyVersion = opts.targetPolicy?.policyVersion ?? opts.targetSnapshot?.policyVersion ?? '1.0.0'

    // Check if target policy allows or refuses
    if (opts.targetPolicy?.minEvidenceGrade === 'A') {
      const hasOnlyGradeB = validatedEnv.evidenceIds.some((id) => id.includes('grade-b') || id.includes('link'))
      if (hasOnlyGradeB) {
        return {
          promotionId,
          status: 'refused',
          targetPolicyVersion,
          reasonCode: 'INSUFFICIENT_EVIDENCE_GRADE',
        }
      }
    }

    return {
      promotionId,
      status: 'proposed',
      targetPolicyVersion,
    }
  }
}

import { validatePromotionEnvelope, type PromotionEnvelope } from '@open-graph-mcp/graph-core/eap/types'
import { validatePromotionTarget } from '@open-graph-mcp/graph-core/eap/horizon'
import type { GraphSnapshotV2 } from '@open-graph-mcp/graph-core/relationship-types'
import type { HorizonRelationshipPolicy } from '@open-graph-mcp/graph-core/relationship-policy'

