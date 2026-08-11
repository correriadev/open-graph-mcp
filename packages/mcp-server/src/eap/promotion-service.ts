/**
 * Promotion Service Adapter
 * Scope: packages/mcp-server/src/eap/promotion-service.ts
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

export interface PromotionStore {
  horizons: Map<HorizonId, Horizon>
  proposals: Map<string, ParentProposal>
  events: PromotionProposedEvent[]
}

export class PromotionService {
  private store: PromotionStore = {
    horizons: new Map(),
    proposals: new Map(),
    events: [],
  }

  public registerHorizon(horizon: Horizon): void {
    if (!horizon.id || horizon.id.trim() === '') {
      throw new Error('HorizonId must be non-empty')
    }
    this.store.horizons.set(horizon.id, { ...horizon })
  }

  public getHorizon(id: HorizonId): Horizon | undefined {
    return this.store.horizons.get(id)
  }

  public updateSequence(id: HorizonId, seq: Sequence): void {
    const horizon = this.store.horizons.get(id)
    if (!horizon) {
      throw new Error(`Horizon '${id}' not found`)
    }
    if (seq < horizon.currentSeq) {
      throw new Error(`Sequence cannot decrease for horizon '${id}'`)
    }
    horizon.currentSeq = seq
  }

  public promote(request: PromotionRequest): PromotionResult {
    const childHorizon = this.store.horizons.get(request.childId)
    if (!childHorizon) {
      return {
        success: false,
        refusalCode: 'HORIZON_SKIP',
        message: `Child horizon '${request.childId}' does not exist.`,
        obligation: 'propose to an existing immediate topological parent',
      }
    }

    const parentHorizon = this.store.horizons.get(request.parentId)
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
      this.store.proposals.set(result.proposal.id, result.proposal)
      this.store.events.push(result.event)
    }

    return result
  }

  public getProposalsForParent(parentId: HorizonId): ParentProposal[] {
    return Array.from(this.store.proposals.values()).filter(
      (p) => p.parentId === parentId
    )
  }

  public getEvents(): PromotionProposedEvent[] {
    return [...this.store.events]
  }
}
