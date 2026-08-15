/**
 * packages/graph-core/src/eap/horizon.ts
 * Horizon Governance Aggregate Root and Topology Rules.
 */

import { BudgetLedger } from './budget'
import { createHorizonId, validateNegotiationSeed, NegotiationSeed } from './types'

export interface HorizonConfig {
  id: string
  parentId?: string | null
  isRoot?: boolean
  budgetLimit?: number
  budgetConsumed?: number
}

export interface DomainEvent {
  kind: string
  payload: Record<string, unknown>
  timestamp: string
}

export class Horizon {
  public readonly id: string
  public readonly parentId: string | null
  public readonly isRoot: boolean
  public readonly budget: BudgetLedger
  private relativeAuthority: boolean
  private events: DomainEvent[]

  constructor(config: HorizonConfig) {
    if (!config.id || config.id.trim().length === 0) {
      throw new Error("HorizonId must be a non-empty string")
    }
    this.id = createHorizonId(config.id)
    this.isRoot = config.isRoot ?? (config.parentId == null)

    if (this.isRoot) {
      if (config.parentId != null) {
        throw new Error("Root Horizon cannot have a parent")
      }
      this.parentId = null
    } else {
      if (!config.parentId || config.parentId.trim().length === 0) {
        throw new Error("Non-root Horizon must have exactly one declared parent")
      }
      this.parentId = config.parentId.trim()
    }

    this.budget = new BudgetLedger(config.budgetLimit ?? 100, config.budgetConsumed ?? 0)
    this.relativeAuthority = false
    this.events = []

    this.recordEvent("HorizonInitiated", {
      horizonId: this.id,
      parentId: this.parentId,
      isRoot: this.isRoot,
    })
  }

  public assignRelativeAuthority(targetHorizonId: string): { success: boolean; reason?: string } {
    if (targetHorizonId !== this.id) {
      return {
        success: false,
        reason: "AUTHORITY_TRANSFER_FORBIDDEN: Relative Authority cannot be assigned to another horizon",
      }
    }
    this.relativeAuthority = true
    return { success: true }
  }

  public hasRelativeAuthority(): boolean {
    return this.relativeAuthority
  }

  public requestPromotion(seed: unknown, cost: number = 10): { outcome: "promoted" | "escalate"; reason?: string } {
    validateNegotiationSeed(seed)

    if (this.budget.isExhausted() || !this.budget.consume(cost)) {
      this.recordEvent("HorizonBudgetExhausted", {
        horizonId: this.id,
        budgetRef: this.budget.snapshot(),
      })
      return { outcome: "escalate", reason: "BUDGET_EXHAUSTED" }
    }

    return { outcome: "promoted" }
  }

  public getEvents(): readonly DomainEvent[] {
    return [...this.events]
  }

  private recordEvent(kind: string, payload: Record<string, unknown>) {
    this.events.push({
      kind,
      payload,
      timestamp: new Date().toISOString(),
    })
  }
}

import type { HorizonKind } from "../relationship-types"

export const PROMOTION_PARENT_TOPOLOGY: Record<string, HorizonKind | null> = {
  negotiation: "transformation",
  microtask: "transformation",
  transformation: "persistent",
  persistent: null,
};

export function getPromotionParent(sourceHorizon: string): HorizonKind | null {
  if (sourceHorizon === "session") {
    throw new Error("Session is excluded from promotion horizons");
  }
  if (!(sourceHorizon in PROMOTION_PARENT_TOPOLOGY)) {
    throw new Error(`Unknown horizon: '${sourceHorizon}'`);
  }
  return PROMOTION_PARENT_TOPOLOGY[sourceHorizon];
}

export function validatePromotionTarget(sourceHorizon: string, targetHorizon: string): void {
  if (sourceHorizon === "session" || targetHorizon === "session") {
    throw new Error("Session is excluded from promotion topology");
  }
  const expectedParent = getPromotionParent(sourceHorizon);
  if (!expectedParent || expectedParent !== targetHorizon) {
    const err: any = new Error(
      `HORIZON_SKIP: Promotion target '${targetHorizon}' is not the declared immediate parent of horizon '${sourceHorizon}'.`
    );
    err.code = "HORIZON_SKIP";
    throw err;
  }
}

