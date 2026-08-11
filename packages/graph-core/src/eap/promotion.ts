/**
 * One-Edge Promotion Domain Aggregate & Logic
 * Scope: packages/graph-core/src/eap/promotion.ts
 */

import { RefusalCode } from './refusals'

export type HorizonId = string
export type Sequence = number

export interface Candidate {
  id: string
  content: string
  metadata?: Record<string, unknown>
}

export interface Horizon {
  id: HorizonId
  parentId?: HorizonId | null
  currentSeq: Sequence
}

export interface PromotionRequest {
  childId: HorizonId
  parentId: HorizonId
  basedOnSeq: Sequence
  distilled: Candidate[]
}

export interface ParentProposal {
  id: string
  parentId: HorizonId
  childId: HorizonId
  candidates: Candidate[]
  status: 'proposed'
  basedOnSeq: Sequence
  createdAt: string
}

export interface PromotionProposedEvent {
  promotionId: string
  childId: HorizonId
  parentId: HorizonId
  basedOnSeq: Sequence
  distilled: Candidate[]
  timestamp: string
}

export interface PromotionRefusal {
  success: false
  refusalCode: RefusalCode
  message: string
  obligation: string
}

export interface PromotionSuccess {
  success: true
  promotionId: string
  proposal: ParentProposal
  event: PromotionProposedEvent
}

export type PromotionResult = PromotionSuccess | PromotionRefusal

export function promoteKnowledge(
  childHorizon: Horizon,
  request: PromotionRequest,
  currentApplicableSeq: Sequence
): PromotionResult {
  if (!childHorizon.parentId || request.parentId !== childHorizon.parentId) {
    return {
      success: false,
      refusalCode: 'HORIZON_SKIP',
      message: `Promotion target '${request.parentId}' is not the declared immediate parent of horizon '${childHorizon.id}'.`,
      obligation: 'propose to the immediate topological parent',
    }
  }

  if (request.basedOnSeq < currentApplicableSeq) {
    return {
      success: false,
      refusalCode: 'STALE_BASE',
      message: `Promotion basedOnSeq (${request.basedOnSeq}) is stale relative to current sequence (${currentApplicableSeq}).`,
      obligation: 'rebase or revalidate before attempting promotion',
    }
  }

  const promotionId = `prom-${childHorizon.id}-${request.parentId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const timestamp = new Date().toISOString()

  const proposal: ParentProposal = {
    id: `prop-${promotionId}`,
    parentId: request.parentId,
    childId: request.childId,
    candidates: request.distilled,
    status: 'proposed',
    basedOnSeq: request.basedOnSeq,
    createdAt: timestamp,
  }

  const event: PromotionProposedEvent = {
    promotionId,
    childId: request.childId,
    parentId: request.parentId,
    basedOnSeq: request.basedOnSeq,
    distilled: request.distilled,
    timestamp,
  }

  return {
    success: true,
    promotionId,
    proposal,
    event,
  }
}
