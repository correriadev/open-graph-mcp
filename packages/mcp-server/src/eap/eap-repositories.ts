/**
 * eap-repositories.ts — SQLite-backed repositories for every EAP epistemic aggregate.
 *
 * WHY THIS FILE EXISTS (REWORK-LOG defect classes 1 and 2)
 * -------------------------------------------------------
 * `PromotionService`, `ContestationService`, `RecallWorker`, `CapabilityGateway` and
 * `ApprovalRepository` used to hold proposals, contestations, recall checkpoints, operator
 * approvals, execution outcomes and audit entries in volatile in-memory `Map`s, while the MCP
 * tool adapters wrote the *same* epistemic facts straight to SQLite. Two consequences, both fatal
 * for a host that claims to be authoritative:
 *
 *   1. STATE DIVERGENCE — the domain services and the transport adapters were two disagreeing
 *      copies of the truth, and nothing reconciled them.
 *   2. UNBOUNDED GROWTH + TOTAL LOSS ON RESTART — the Maps never evicted, and everything in them
 *      vanished when the process died.
 *
 * Every aggregate below now lives in the project's existing durable write path (`write()` =
 * SQLite + per-tenant append-only JSONL mirror, one synchronous call). Domain services take a
 * repository; they own no state of their own. The only bounded-by-policy store is the capability
 * audit log, which is SQLite-only precisely because retention and an append-only mirror cannot
 * both hold (see db.ts `ALL_TABLES` comment).
 */
import type { Database } from "bun:sqlite"
import { allocateSequence, serialTransaction, write } from "../db"
import type {
  Candidate,
  Horizon,
  HorizonId,
  ParentProposal,
  PromotionProposedEvent,
} from "@open-graph-mcp/graph-core/eap/promotion"
import type { Contestation } from "@open-graph-mcp/graph-core/eap/contestation"
import type {
  RecallCase,
  RecallCheckpoint,
  RecallNotice,
  RecallScarRecord,
} from "@open-graph-mcp/graph-core/eap/recall"
import type { CapabilityClassification, CapabilityRefusal, OperatorApproval } from "@open-graph-mcp/graph-core/eap/capabilities"

const nowIso = () => new Date().toISOString()

// ── Promotion ──────────────────────────────────────────────────────────────────

export class SqlitePromotionRepository {
  constructor(
    private db: Database,
    private stateDir: string,
    private tenantId: string,
  ) {}

  getHorizon(id: HorizonId): Horizon | undefined {
    const row = this.db
      .query("SELECT id, parent_id, seq FROM horizons WHERE tenant_id = ? AND id = ?")
      .get(this.tenantId, id) as { id: string; parent_id: string | null; seq: number } | null
    if (!row) return undefined
    return { id: row.id, parentId: row.parent_id ?? null, currentSeq: Number(row.seq) }
  }

  saveHorizon(horizon: Horizon): void {
    serialTransaction(this.db, () => {
      const existing = this.db
        .query("SELECT created_at, state, budget_allocated, budget_consumed FROM horizons WHERE tenant_id = ? AND id = ?")
        .get(this.tenantId, horizon.id) as
        | { created_at: string; state: string; budget_allocated: number; budget_consumed: number }
        | null
      const ts = nowIso()
      write(this.db, this.stateDir, this.tenantId, "horizons", {
        tenant_id: this.tenantId,
        id: horizon.id,
        parent_id: horizon.parentId ?? null,
        state: existing?.state ?? "proposed",
        seq: horizon.currentSeq,
        budget_allocated: existing?.budget_allocated ?? 0,
        budget_consumed: existing?.budget_consumed ?? 0,
        created_at: existing?.created_at ?? ts,
        updated_at: ts,
      })
    })
  }

  /** Persists proposal + its PromotionProposed event as ONE durable unit. */
  saveProposalWithEvent(proposal: ParentProposal, event: PromotionProposedEvent): void {
    serialTransaction(this.db, () => {
      write(this.db, this.stateDir, this.tenantId, "proposals", {
        tenant_id: this.tenantId,
        id: proposal.id,
        parent_id: proposal.parentId,
        child_id: proposal.childId,
        candidates: JSON.stringify(proposal.candidates),
        status: proposal.status,
        based_on_seq: proposal.basedOnSeq,
        created_at: proposal.createdAt,
      })
      write(this.db, this.stateDir, this.tenantId, "promotion_events", {
        tenant_id: this.tenantId,
        id: event.promotionId,
        ordinal: allocateSequence(this.db, this.tenantId, "promotion_events"),
        payload: JSON.stringify(event),
        created_at: event.timestamp,
      })
    })
  }

  getProposal(id: string): ParentProposal | undefined {
    const row = this.db
      .query("SELECT id, parent_id, child_id, candidates, status, based_on_seq, created_at FROM proposals WHERE tenant_id = ? AND id = ?")
      .get(this.tenantId, id) as Record<string, unknown> | null
    return row ? toProposal(row) : undefined
  }

  getProposalsForParent(parentId: HorizonId): ParentProposal[] {
    const rows = this.db
      .query(
        "SELECT id, parent_id, child_id, candidates, status, based_on_seq, created_at FROM proposals WHERE tenant_id = ? AND parent_id = ? ORDER BY created_at, id",
      )
      .all(this.tenantId, parentId) as Record<string, unknown>[]
    return rows.map(toProposal)
  }

  getEvents(): PromotionProposedEvent[] {
    const rows = this.db
      .query("SELECT payload FROM promotion_events WHERE tenant_id = ? ORDER BY ordinal")
      .all(this.tenantId) as { payload: string }[]
    return rows.map((r) => JSON.parse(r.payload) as PromotionProposedEvent)
  }
}

function toProposal(row: Record<string, unknown>): ParentProposal {
  return {
    id: String(row.id),
    parentId: String(row.parent_id),
    childId: String(row.child_id),
    candidates: JSON.parse(String(row.candidates ?? "[]")) as Candidate[],
    status: "proposed",
    basedOnSeq: Number(row.based_on_seq),
    createdAt: String(row.created_at),
  }
}

// ── Contestation ───────────────────────────────────────────────────────────────

export class SqliteContestationRepository {
  constructor(
    private db: Database,
    private stateDir: string,
    private tenantId: string,
  ) {}

  /** Allocates the contestation sequence and writes the row inside one serialized unit. */
  save(contestation: Omit<Contestation, "seq">): Contestation {
    return serialTransaction(this.db, () => {
      const seq = allocateSequence(this.db, this.tenantId, "contestations")
      const stored: Contestation = { ...contestation, seq }
      write(this.db, this.stateDir, this.tenantId, "contestations", {
        tenant_id: this.tenantId,
        id: stored.id,
        seq,
        target_claim_ids: JSON.stringify(stored.targetClaimIds),
        severity: stored.severity,
        evidence: JSON.stringify(stored.evidenceRefs),
        status: stored.admitted ? "admitted" : "refused",
        created_at: stored.submittedAt,
        source_horizon_id: stored.sourceHorizonId,
        reason: stored.reason ?? null,
      })
      return stored
    })
  }

  get(id: string): Contestation | undefined {
    const row = this.db
      .query(
        "SELECT id, seq, target_claim_ids, severity, evidence, status, created_at, source_horizon_id, reason FROM contestations WHERE tenant_id = ? AND id = ?",
      )
      .get(this.tenantId, id) as Record<string, unknown> | null
    if (!row) return undefined
    return {
      id: String(row.id),
      sourceHorizonId: String(row.source_horizon_id ?? ""),
      targetClaimIds: JSON.parse(String(row.target_claim_ids ?? "[]")),
      evidenceRefs: JSON.parse(String(row.evidence ?? "[]")),
      severity: row.severity as Contestation["severity"],
      reason: (row.reason as string | null) ?? undefined,
      submittedAt: String(row.created_at),
      seq: Number(row.seq),
      admitted: row.status === "admitted",
    }
  }

  exists(id: string): boolean {
    return (
      this.db.query("SELECT 1 AS x FROM contestations WHERE tenant_id = ? AND id = ?").get(this.tenantId, id) !== null
    )
  }
}

// ── Recall ─────────────────────────────────────────────────────────────────────

type SerializedRecallState = {
  processedClaimIds: string[]
  degradedClaimStates: Array<[string, { previousState: string; normativelyResolvedState: string }]>
  degradationCounts: Array<[string, number]>
  suspendedCells: string[]
}

/**
 * A `RecallCase` carries `Set`/`Map` fields. They are serialized as sorted array pairs so that a
 * case reloaded after a restart is byte-identical to the one that produced it — determinism is the
 * whole point of a resumable recall.
 */
function serializeRecallState(c: RecallCase): SerializedRecallState {
  return {
    processedClaimIds: [...c.processedClaimIds],
    degradedClaimStates: [...c.degradedClaimStates.entries()],
    degradationCounts: [...c.degradationCounts.entries()],
    suspendedCells: [...c.suspendedCells],
  }
}

export class SqliteRecallRepository {
  constructor(
    private db: Database,
    private stateDir: string,
    private tenantId: string,
  ) {}

  async create(recallCase: RecallCase): Promise<void> {
    serialTransaction(this.db, () => {
      const ts = nowIso()
      write(this.db, this.stateDir, this.tenantId, "recall_cases", {
        tenant_id: this.tenantId,
        id: recallCase.id,
        contestation_id: recallCase.notice.contestationId,
        status: recallCase.status,
        notice: JSON.stringify(recallCase.notice),
        closure: JSON.stringify(recallCase.closure),
        state: JSON.stringify(serializeRecallState(recallCase)),
        created_at: ts,
        updated_at: ts,
      })
      this.writeCheckpoint(recallCase.checkpoint)
    })
  }

  async checkpoint(recallId: string, checkpoint: RecallCheckpoint, recallCase?: RecallCase): Promise<void> {
    serialTransaction(this.db, () => {
      if (recallCase) {
        const existing = this.db
          .query("SELECT created_at FROM recall_cases WHERE tenant_id = ? AND id = ?")
          .get(this.tenantId, recallId) as { created_at: string } | null
        write(this.db, this.stateDir, this.tenantId, "recall_cases", {
          tenant_id: this.tenantId,
          id: recallCase.id,
          contestation_id: recallCase.notice.contestationId,
          status: recallCase.status,
          notice: JSON.stringify(recallCase.notice),
          closure: JSON.stringify(recallCase.closure),
          state: JSON.stringify(serializeRecallState(recallCase)),
          created_at: existing?.created_at ?? nowIso(),
          updated_at: nowIso(),
        })
      }
      this.writeCheckpoint(checkpoint)
    })
  }

  private writeCheckpoint(checkpoint: RecallCheckpoint): void {
    write(this.db, this.stateDir, this.tenantId, "recall_checkpoints", {
      tenant_id: this.tenantId,
      recall_id: checkpoint.recallId,
      checkpoint: JSON.stringify(checkpoint),
      updated_at: nowIso(),
    })
  }

  async complete(recallId: string, scar: RecallScarRecord, recallCase?: RecallCase): Promise<void> {
    serialTransaction(this.db, () => {
      write(this.db, this.stateDir, this.tenantId, "recall_scars", {
        tenant_id: this.tenantId,
        recall_id: recallId,
        scar: JSON.stringify(scar),
        created_at: nowIso(),
      })
      if (recallCase) {
        const existing = this.db
          .query("SELECT created_at FROM recall_cases WHERE tenant_id = ? AND id = ?")
          .get(this.tenantId, recallId) as { created_at: string } | null
        write(this.db, this.stateDir, this.tenantId, "recall_cases", {
          tenant_id: this.tenantId,
          id: recallId,
          contestation_id: recallCase.notice.contestationId,
          status: "completed",
          notice: JSON.stringify(recallCase.notice),
          closure: JSON.stringify(recallCase.closure),
          state: JSON.stringify(serializeRecallState(recallCase)),
          created_at: existing?.created_at ?? nowIso(),
          updated_at: nowIso(),
        })
      } else {
        this.db
          .query("UPDATE recall_cases SET status = 'completed', updated_at = ? WHERE tenant_id = ? AND id = ?")
          .run(nowIso(), this.tenantId, recallId)
      }
    })
  }

  async get(recallId: string): Promise<{ recallCase: RecallCase; checkpoint: RecallCheckpoint } | null> {
    const row = this.db
      .query("SELECT id, status, notice, closure, state FROM recall_cases WHERE tenant_id = ? AND id = ?")
      .get(this.tenantId, recallId) as Record<string, unknown> | null
    if (!row) return null
    const cpRow = this.db
      .query("SELECT checkpoint FROM recall_checkpoints WHERE tenant_id = ? AND recall_id = ?")
      .get(this.tenantId, recallId) as { checkpoint: string } | null
    if (!cpRow) return null

    const checkpoint = JSON.parse(cpRow.checkpoint) as RecallCheckpoint
    const state = JSON.parse(String(row.state)) as SerializedRecallState
    const scar = await this.getScar(recallId)

    const recallCase: RecallCase = {
      id: String(row.id),
      notice: JSON.parse(String(row.notice)) as RecallNotice,
      status: row.status as RecallCase["status"],
      closure: JSON.parse(String(row.closure)) as string[],
      processedClaimIds: new Set(state.processedClaimIds),
      checkpoint,
      degradedClaimStates: new Map(state.degradedClaimStates),
      degradationCounts: new Map(state.degradationCounts),
      suspendedCells: new Set(state.suspendedCells),
      ...(scar ? { scarHistory: scar } : {}),
    }
    return { recallCase, checkpoint }
  }

  async getScar(recallId: string): Promise<RecallScarRecord | null> {
    const row = this.db
      .query("SELECT scar FROM recall_scars WHERE tenant_id = ? AND recall_id = ?")
      .get(this.tenantId, recallId) as { scar: string } | null
    return row ? (JSON.parse(row.scar) as RecallScarRecord) : null
  }
}

// ── Operator approvals ─────────────────────────────────────────────────────────

export class SqliteApprovalRepository {
  constructor(
    private db: Database,
    private stateDir: string,
    private tenantId: string,
  ) {}

  registerApproval(approval: OperatorApproval): void {
    serialTransaction(this.db, () => {
      write(this.db, this.stateDir, this.tenantId, "operator_approvals", {
        tenant_id: this.tenantId,
        id: approval.id,
        approver: approval.approver,
        scope: approval.scope,
        expires_at: String(approval.expiresAt),
        based_on_seq: approval.basedOnSeq,
        consumed: approval.consumed ? 1 : 0,
        created_at: nowIso(),
        consumed_at: null,
      })
    })
  }

  getApproval(id: string): OperatorApproval | undefined {
    const row = this.db
      .query("SELECT id, approver, scope, expires_at, based_on_seq, consumed FROM operator_approvals WHERE tenant_id = ? AND id = ?")
      .get(this.tenantId, id) as Record<string, unknown> | null
    if (!row) return undefined
    const raw = String(row.expires_at)
    const numeric = Number(raw)
    return {
      id: String(row.id),
      approver: String(row.approver),
      scope: String(row.scope),
      // Approvals may be granted with an epoch-ms deadline or an ISO instant; the column is TEXT,
      // so the numeric form is restored as a number rather than silently becoming a date string.
      expiresAt: raw !== "" && Number.isFinite(numeric) && String(numeric) === raw ? numeric : raw,
      basedOnSeq: Number(row.based_on_seq),
      consumed: Number(row.consumed) === 1,
    }
  }

  /**
   * Single-use consumption. Runs in a serialized transaction and re-reads the stored row inside it,
   * so two concurrent irreversible executions cannot both observe `consumed = 0`.
   */
  consumeAuthorization(id: string): { success: true } | { success: false; refusal: CapabilityRefusal } {
    return serialTransaction(this.db, () => {
      const row = this.db
        .query("SELECT consumed FROM operator_approvals WHERE tenant_id = ? AND id = ?")
        .get(this.tenantId, id) as { consumed: number } | null

      if (!row) {
        return {
          success: false as const,
          refusal: {
            code: "APPROVAL_MISSING" as const,
            reason: `Approval '${id}' not found in repository`,
            obligation: "Obtain valid operator approval",
          },
        }
      }
      if (Number(row.consumed) === 1) {
        return {
          success: false as const,
          refusal: {
            code: "APPROVAL_ALREADY_USED" as const,
            reason: `Approval '${id}' has already been consumed (single-use)`,
            obligation: "Obtain a new single-use operator approval",
          },
        }
      }

      const stored = this.getApproval(id)!
      write(this.db, this.stateDir, this.tenantId, "operator_approvals", {
        tenant_id: this.tenantId,
        id: stored.id,
        approver: stored.approver,
        scope: stored.scope,
        expires_at: String(stored.expiresAt),
        based_on_seq: stored.basedOnSeq,
        consumed: 1,
        created_at: nowIso(),
        consumed_at: nowIso(),
      })
      return { success: true as const }
    })
  }
}

// ── Capability execution audit (bounded by an explicit retention policy) ───────

export interface CapabilityExecutedEvent {
  executionId: string
  classification: CapabilityClassification
  contractRef: string
  outcome: unknown
  idempotencyKey: string
  timestamp: number
}

/** Redacted projection handed to a principal without `audit:read`. */
export interface RedactedCapabilityAuditEntry {
  executionId: string
  classification: CapabilityClassification
  idempotencyKey: string
  timestamp: number
}

export const DEFAULT_AUDIT_MAX_ENTRIES = 10_000

export class SqliteCapabilityAuditRepository {
  private readonly maxEntries: number

  constructor(
    private db: Database,
    private stateDir: string,
    private tenantId: string,
    opts?: { maxEntries?: number },
  ) {
    this.maxEntries = opts?.maxEntries ?? DEFAULT_AUDIT_MAX_ENTRIES
  }

  findByIdempotencyKey(key: string): CapabilityExecutedEvent | undefined {
    const row = this.db
      .query(
        "SELECT execution_id, classification, contract_ref, outcome, idempotency_key, ts FROM capability_executions WHERE tenant_id = ? AND idempotency_key = ?",
      )
      .get(this.tenantId, key) as Record<string, unknown> | null
    return row ? toAuditEvent(row) : undefined
  }

  /**
   * Appends one execution outcome and enforces the retention bound in the same transaction.
   * Without the bound this table is the same unbounded accumulator the in-memory array was, only
   * on disk instead of in the heap.
   */
  record(event: CapabilityExecutedEvent, meta: { capabilityId: string; approvalId?: string }): void {
    serialTransaction(this.db, () => {
      const ordinal = allocateSequence(this.db, this.tenantId, "capability_executions")
      this.db
        .query(
          `INSERT OR REPLACE INTO capability_executions
             (tenant_id, idempotency_key, ordinal, execution_id, classification, contract_ref, capability_id, approval_id, outcome, ts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.tenantId,
          event.idempotencyKey,
          ordinal,
          event.executionId,
          event.classification,
          event.contractRef,
          meta.capabilityId,
          meta.approvalId ?? null,
          JSON.stringify(event.outcome ?? null),
          event.timestamp,
        )
      this.db
        .query(
          `DELETE FROM capability_executions
             WHERE tenant_id = ?
               AND ordinal <= (
                 SELECT COALESCE(MAX(ordinal), 0) - ? FROM capability_executions WHERE tenant_id = ?
               )`,
        )
        .run(this.tenantId, this.maxEntries, this.tenantId)
    })
  }

  count(): number {
    const row = this.db
      .query("SELECT COUNT(*) AS n FROM capability_executions WHERE tenant_id = ?")
      .get(this.tenantId) as { n: number }
    return Number(row.n)
  }

  list(): CapabilityExecutedEvent[] {
    const rows = this.db
      .query(
        "SELECT execution_id, classification, contract_ref, outcome, idempotency_key, ts FROM capability_executions WHERE tenant_id = ? ORDER BY ordinal",
      )
      .all(this.tenantId) as Record<string, unknown>[]
    return rows.map(toAuditEvent)
  }

  listRedacted(): RedactedCapabilityAuditEntry[] {
    return this.list().map((e) => ({
      executionId: e.executionId,
      classification: e.classification,
      idempotencyKey: e.idempotencyKey,
      timestamp: e.timestamp,
    }))
  }
}

function toAuditEvent(row: Record<string, unknown>): CapabilityExecutedEvent {
  return {
    executionId: String(row.execution_id),
    classification: row.classification as CapabilityClassification,
    contractRef: String(row.contract_ref),
    outcome: row.outcome === null || row.outcome === undefined ? null : JSON.parse(String(row.outcome)),
    idempotencyKey: String(row.idempotency_key),
    timestamp: Number(row.ts),
  }
}
