/**
 * horizon-store.ts — EAP Horizon & Admission Decision Persistence Adapter
 */
import { Database } from "bun:sqlite"
import { write, durableTransaction } from "../db"

export interface HorizonRecord {
  tenantId: string
  id: string
  parentId?: string | null
  state: string
  seq: number
  budgetAllocated: number
  budgetConsumed: number
  createdAt: string
  updatedAt: string
}

export type SaveHorizonResult =
  | { success: true; horizon: HorizonRecord }
  | { success: false; code: "STALE_SEQUENCE" | "ALREADY_EXISTS" | "NOT_FOUND" | "INVALID_PARENT"; reason: string }

export interface AdmissionDecisionRecord {
  tenantId: string
  id: string
  seq: number
  horizonId: string
  candidateId: string
  outcome: "ADMITTED" | "REFUSED"
  refusalCode?: string | null
  refusalObligation?: string | null
  createdAt: string
}

export class HorizonStore {
  constructor(
    private db: Database,
    private stateDir: string = ""
  ) {}

  public get(tenantId: string, id: string): HorizonRecord | null {
    const row = this.db
      .query(
        `SELECT tenant_id, id, parent_id, state, seq, budget_allocated, budget_consumed, created_at, updated_at
         FROM horizons WHERE tenant_id = ? AND id = ?`
      )
      .get(tenantId, id) as any

    if (!row) return null
    return {
      tenantId: row.tenant_id,
      id: row.id,
      parentId: row.parent_id ?? null,
      state: row.state,
      seq: Number(row.seq),
      budgetAllocated: Number(row.budget_allocated),
      budgetConsumed: Number(row.budget_consumed),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  public create(
    horizon: Omit<HorizonRecord, "seq" | "createdAt" | "updatedAt"> & {
      seq?: number
      createdAt?: string
      updatedAt?: string
    }
  ): SaveHorizonResult {
    return durableTransaction(this.db, () => {
      const existing = this.get(horizon.tenantId, horizon.id)
      if (existing) {
        return {
          success: false,
          code: "ALREADY_EXISTS",
          reason: `Horizon '${horizon.id}' already exists for tenant '${horizon.tenantId}'`,
        }
      }

      if (horizon.parentId) {
        const parent = this.get(horizon.tenantId, horizon.parentId)
        if (!parent) {
          return {
            success: false,
            code: "INVALID_PARENT",
            reason: `Declared parent horizon '${horizon.parentId}' does not exist for tenant '${horizon.tenantId}'`,
          }
        }
      }

      const now = horizon.createdAt ?? new Date().toISOString()
      const record: HorizonRecord = {
        tenantId: horizon.tenantId,
        id: horizon.id,
        parentId: horizon.parentId ?? null,
        state: horizon.state,
        seq: horizon.seq ?? 0,
        budgetAllocated: horizon.budgetAllocated,
        budgetConsumed: horizon.budgetConsumed ?? 0,
        createdAt: now,
        updatedAt: horizon.updatedAt ?? now,
      }

      write(this.db, this.stateDir, record.tenantId, "horizons", {
        tenant_id: record.tenantId,
        id: record.id,
        parent_id: record.parentId ?? null,
        state: record.state,
        seq: record.seq,
        budget_allocated: record.budgetAllocated,
        budget_consumed: record.budgetConsumed,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      })

      return { success: true, horizon: record }
    })
  }

  public saveTransition(
    tenantId: string,
    horizonId: string,
    expectedSeq: number,
    updates: { state?: string; budgetConsumed?: number; seq?: number; updatedAt?: string }
  ): SaveHorizonResult {
    return durableTransaction(this.db, () => {
      const current = this.get(tenantId, horizonId)
      if (!current) {
        return {
          success: false,
          code: "NOT_FOUND",
          reason: `Horizon '${horizonId}' not found for tenant '${tenantId}'`,
        }
      }

      if (current.seq !== expectedSeq) {
        return {
          success: false,
          code: "STALE_SEQUENCE",
          reason: `Stale sequence for horizon '${horizonId}': expected ${expectedSeq}, found ${current.seq}`,
        }
      }

      const newSeq = updates.seq ?? expectedSeq + 1
      const now = updates.updatedAt ?? new Date().toISOString()

      const updated: HorizonRecord = {
        ...current,
        state: updates.state ?? current.state,
        budgetConsumed: updates.budgetConsumed ?? current.budgetConsumed,
        seq: newSeq,
        updatedAt: now,
      }

      write(this.db, this.stateDir, tenantId, "horizons", {
        tenant_id: updated.tenantId,
        id: updated.id,
        parent_id: updated.parentId ?? null,
        state: updated.state,
        seq: updated.seq,
        budget_allocated: updated.budgetAllocated,
        budget_consumed: updated.budgetConsumed,
        created_at: updated.createdAt,
        updated_at: updated.updatedAt,
      })

      return { success: true, horizon: updated }
    })
  }
}

export class AdmissionLedgerStore {
  constructor(
    private db: Database,
    private stateDir: string = ""
  ) {}

  public appendDecision(decision: AdmissionDecisionRecord): AdmissionDecisionRecord {
    return durableTransaction(this.db, () => {
      write(this.db, this.stateDir, decision.tenantId, "admission_decisions", {
        tenant_id: decision.tenantId,
        id: decision.id,
        seq: decision.seq,
        horizon_id: decision.horizonId,
        candidate_id: decision.candidateId,
        outcome: decision.outcome,
        refusal_code: decision.refusalCode ?? null,
        refusal_obligation: decision.refusalObligation ?? null,
        created_at: decision.createdAt,
      })
      return decision
    })
  }

  public findDecision(tenantId: string, id: string): AdmissionDecisionRecord | null {
    const row = this.db
      .query(
        `SELECT tenant_id, id, seq, horizon_id, candidate_id, outcome, refusal_code, refusal_obligation, created_at
         FROM admission_decisions WHERE tenant_id = ? AND id = ?`
      )
      .get(tenantId, id) as any

    if (!row) return null
    return {
      tenantId: row.tenant_id,
      id: row.id,
      seq: Number(row.seq),
      horizonId: row.horizon_id,
      candidateId: row.candidate_id,
      outcome: row.outcome,
      refusalCode: row.refusal_code ?? null,
      refusalObligation: row.refusal_obligation ?? null,
      createdAt: row.created_at,
    }
  }

  public historySince(tenantId: string, minSeq: number): AdmissionDecisionRecord[] {
    const rows = this.db
      .query(
        `SELECT tenant_id, id, seq, horizon_id, candidate_id, outcome, refusal_code, refusal_obligation, created_at
         FROM admission_decisions WHERE tenant_id = ? AND seq > ? ORDER BY seq ASC`
      )
      .all(tenantId, minSeq) as any[]

    return rows.map((row) => ({
      tenantId: row.tenant_id,
      id: row.id,
      seq: Number(row.seq),
      horizonId: row.horizon_id,
      candidateId: row.candidate_id,
      outcome: row.outcome,
      refusalCode: row.refusal_code ?? null,
      refusalObligation: row.refusal_obligation ?? null,
      createdAt: row.created_at,
    }))
  }
}
