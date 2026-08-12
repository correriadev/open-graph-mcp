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
import { projectRecallToReadModel } from "./recall-projection"
import { indexRecallClosure, markRecallClosureIndexed } from "./recall-closure"
import { StoredStateCorruptionError } from "./stored-state"
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
import {
  resolveExpiry,
  type CapabilityClassification,
  type CapabilityRefusal,
  type OperatorApproval,
} from "@open-graph-mcp/graph-core/eap/capabilities"

const nowIso = () => new Date().toISOString()

/**
 * A stored JSON column that does not parse — defined in `stored-state.ts` and re-exported here,
 * where every importer already expects it. `dependency-query.ts` models the same discipline for the
 * columns where an empty result is the honest answer; here the row IS the aggregate, so the only
 * honest answer is a refusal.
 */
export { StoredStateCorruptionError } from "./stored-state"

function parseStored<T>(raw: unknown, table: string, column: string, rowId: string, fallback?: string): T {
  const text = raw === null || raw === undefined ? (fallback ?? "null") : String(raw)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new StoredStateCorruptionError(table, column, rowId)
  }
}

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
    return rows.map((r, i) => parseStored<PromotionProposedEvent>(r.payload, "promotion_events", "payload", `ordinal#${i}`))
  }
}

function toProposal(row: Record<string, unknown>): ParentProposal {
  return {
    id: String(row.id),
    parentId: String(row.parent_id),
    childId: String(row.child_id),
    candidates: parseStored<Candidate[]>(row.candidates, "proposals", "candidates", String(row.id), "[]"),
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
      targetClaimIds: parseStored<string[]>(row.target_claim_ids, "contestations", "target_claim_ids", String(row.id), "[]"),
      evidenceRefs: parseStored<string[]>(row.evidence, "contestations", "evidence", String(row.id), "[]"),
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

/** Pushes already-durable events onto the live session bus. Runs only after the unit of work
 *  that wrote them has COMMITTED. */
export type Broadcast = () => void
const NO_BROADCAST: Broadcast = () => {}

/**
 * Publishes the read model's own domain events.
 *
 * The write model and the durable read model already committed together; the notification channel
 * was left out of that unit (TL Tier 3). This is the port that puts it back in: the repository
 * hands over exactly what the projection changed, and the composition root (`services.ts`) binds it
 * to `appendEvent`. It is optional so that the pure-persistence tests can construct a repository
 * with no server state; production always supplies it.
 *
 * CONTRACT (retry #8, TL Tier 4). This is called INSIDE the transaction that wrote the suspension,
 * and it must WRITE the durable `events` row there — `appendEvent(..., { defer: true })`, exactly
 * as `changeset.ts` does for `authority.flipped`. It returns the broadcast, which the repository
 * runs only once the transaction has returned. Running the whole `appendEvent` afterwards, as this
 * used to, put the events row in its own implicit transaction: a failure between the two left
 * `authority` at `suspended` with no row in the append-only log a reconnecting session replays from.
 */
export interface RecallReadModelPublisher {
  truthOwnershipSuspended(cells: string[], recallCase: RecallCase): Broadcast
}

export class SqliteRecallRepository {
  constructor(
    private db: Database,
    private stateDir: string,
    private tenantId: string,
    private publisher?: RecallReadModelPublisher,
  ) {}

  /**
   * Writes the announcement in the SAME unit of work as the suspension it describes, and returns
   * the push to live sessions for the caller to run once that unit has RETURNED (i.e. committed).
   * Publishing inside the unit would let a subscriber observe an ownership change a rollback then
   * erases; writing the event outside it would let the ownership change outlive its own audit row.
   */
  private announce(cells: string[], recallCase: RecallCase): Broadcast {
    if (cells.length === 0 || !this.publisher) return NO_BROADCAST
    return this.publisher.truthOwnershipSuspended(cells, recallCase)
  }

  async create(recallCase: RecallCase): Promise<void> {
    this.createSync(recallCase)
  }

  /**
   * Synchronous creation, for a caller that must establish idempotency (does a case exist?) and
   * satisfy it (create the case) inside ONE serialized transaction. `create` above is the async
   * face of exactly this; there is no second write path.
   */
  createSync(recallCase: RecallCase): void {
    serialTransaction(this.db, () => {
      const ts = nowIso()
      const closure = JSON.stringify(recallCase.closure)
      write(this.db, this.stateDir, this.tenantId, "recall_cases", {
        tenant_id: this.tenantId,
        id: recallCase.id,
        contestation_id: recallCase.notice.contestationId,
        status: recallCase.status,
        notice: JSON.stringify(recallCase.notice),
        closure,
        state: JSON.stringify(serializeRecallState(recallCase)),
        created_at: ts,
        updated_at: ts,
      })
      // The closure gate's index, in the SAME unit as the closure it indexes: a case that commits is
      // gateable, a case that rolls back leaves no index row behind. The closure is immutable after
      // creation, so this is the only place that has to maintain it.
      indexRecallClosure(this.db, this.tenantId, recallCase.id, closure)
      markRecallClosureIndexed(this.db, this.tenantId)
      this.writeCheckpoint(recallCase.checkpoint)
    })
  }

  /** Row-level existence, synchronous on purpose: it is the read half of an atomic idempotency
   *  guard and must be able to run in the same serialized transaction as the write half. */
  exists(recallId: string): boolean {
    return (
      this.db.query("SELECT 1 AS x FROM recall_cases WHERE tenant_id = ? AND id = ?").get(this.tenantId, recallId) !==
      null
    )
  }

  async checkpoint(recallId: string, checkpoint: RecallCheckpoint, recallCase?: RecallCase): Promise<void> {
    this.checkpointSync(recallId, checkpoint, recallCase)()
  }

  /**
   * Synchronous checkpoint, returning the post-commit broadcast.
   *
   * The synchronous face exists so a caller can LOAD a case, step it and check it back inside ONE
   * `serialTransaction`. While every step was reachable only through `async` methods, the load and
   * the write were separated by microtask boundaries, so two callers driving the same case each
   * stepped a separately loaded copy and the second overwrote the first (see `RecallWorker.driveSync`).
   */
  checkpointSync(recallId: string, checkpoint: RecallCheckpoint, recallCase?: RecallCase): Broadcast {
    let broadcast: Broadcast = NO_BROADCAST
    serialTransaction(this.db, (): string[] => {
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
        // SAME UNIT OF WORK as the checkpoint: the read model can never lag the case state it is
        // derived from, not even by one failed transaction. See recall-projection.ts.
        const projected = projectRecallToReadModel(this.db, this.stateDir, this.tenantId, recallCase)
        broadcast = this.announce(projected.suspendedCells, recallCase)
        this.writeCheckpoint(checkpoint)
        return projected.suspendedCells
      }
      this.writeCheckpoint(checkpoint)
      return []
    })
    return broadcast
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
    this.completeSync(recallId, scar, recallCase)()
  }

  /** Synchronous completion, returning the post-commit broadcast. See `checkpointSync`. */
  completeSync(recallId: string, scar: RecallScarRecord, recallCase?: RecallCase): Broadcast {
    let broadcast: Broadcast = NO_BROADCAST
    serialTransaction(this.db, (): void => {
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
        const projected = projectRecallToReadModel(this.db, this.stateDir, this.tenantId, recallCase)
        broadcast = this.announce(projected.suspendedCells, recallCase)
        return
      } else {
        // The caller did not hand us the case, but completion still has to travel the SAME durable
        // path. The old raw UPDATE touched SQLite only: the append-only JSONL mirror never saw the
        // status change, so `rebuildFromJsonl` replayed the pre-completion row and a finished recall
        // came back as `in_progress` to be processed a second time (validation audit, DATA_INTEGRITY).
        // Read the stored row, flip the status, and re-write it through `write()`.
        const stored = this.db
          .query("SELECT contestation_id, notice, closure, state, created_at FROM recall_cases WHERE tenant_id = ? AND id = ?")
          .get(this.tenantId, recallId) as
          | { contestation_id: string; notice: string; closure: string; state: string; created_at: string }
          | null
        if (!stored) throw new Error(`Recall case '${recallId}' not found; cannot complete`)
        write(this.db, this.stateDir, this.tenantId, "recall_cases", {
          tenant_id: this.tenantId,
          id: recallId,
          contestation_id: stored.contestation_id,
          status: "completed",
          notice: stored.notice,
          closure: stored.closure,
          state: stored.state,
          created_at: stored.created_at,
          updated_at: nowIso(),
        })
      }
    })
    return broadcast
  }

  async get(recallId: string): Promise<{ recallCase: RecallCase; checkpoint: RecallCheckpoint } | null> {
    return this.getSync(recallId)
  }

  /** Synchronous load, so a caller can load-decide-write inside one transaction. See `checkpointSync`. */
  getSync(recallId: string): { recallCase: RecallCase; checkpoint: RecallCheckpoint } | null {
    const row = this.db
      .query("SELECT id, status, notice, closure, state FROM recall_cases WHERE tenant_id = ? AND id = ?")
      .get(this.tenantId, recallId) as Record<string, unknown> | null
    if (!row) return null
    const cpRow = this.db
      .query("SELECT checkpoint FROM recall_checkpoints WHERE tenant_id = ? AND recall_id = ?")
      .get(this.tenantId, recallId) as { checkpoint: string } | null
    if (!cpRow) return null

    const checkpoint = parseStored<RecallCheckpoint>(cpRow.checkpoint, "recall_checkpoints", "checkpoint", recallId)
    const state = parseStored<SerializedRecallState>(row.state, "recall_cases", "state", recallId)
    const scar = this.getScarSync(recallId)

    const recallCase: RecallCase = {
      id: String(row.id),
      notice: parseStored<RecallNotice>(row.notice, "recall_cases", "notice", recallId),
      status: row.status as RecallCase["status"],
      closure: parseStored<string[]>(row.closure, "recall_cases", "closure", recallId),
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
    return this.getScarSync(recallId)
  }

  getScarSync(recallId: string): RecallScarRecord | null {
    const row = this.db
      .query("SELECT scar FROM recall_scars WHERE tenant_id = ? AND recall_id = ?")
      .get(this.tenantId, recallId) as { scar: string } | null
    return row ? parseStored<RecallScarRecord>(row.scar, "recall_scars", "scar", recallId) : null
  }
}

// ── Observed admission sequence ────────────────────────────────────────────────

/**
 * The sequence an operator approval is validated against.
 *
 * `validateOperatorApproval` compares the STORED grant's `basedOnSeq` with "the current sequence".
 * Until this existed, the gateway took that second operand from `request.currentSeq` — the caller's
 * own field — so a holder of an unconsumed, unexpired, in-scope grant could replay it against
 * arbitrary world state simply by asserting the sequence the grant was bound to, and
 * `APPROVAL_STALE_SEQ` was inert (validation audit, AUTH_BYPASS). Freshness is a property of the
 * host's durable state, so it is read from the host's durable state.
 */
export interface ObservedSequenceSource {
  currentSeq(): number
}

/** The tenant's highest governed Horizon sequence; 0 when the tenant has initiated no horizon. */
export class SqliteObservedSequenceSource implements ObservedSequenceSource {
  constructor(
    private db: Database,
    private tenantId: string,
  ) {}

  currentSeq(): number {
    const row = this.db
      .query("SELECT COALESCE(MAX(seq), 0) AS seq FROM horizons WHERE tenant_id = ?")
      .get(this.tenantId) as { seq: number } | null
    return Number(row?.seq ?? 0)
  }
}

// ── Operator approvals ─────────────────────────────────────────────────────────

export type ApprovalRegistrationResult = { registered: true } | { registered: false; reason: string }

export class SqliteApprovalRepository {
  constructor(
    private db: Database,
    private stateDir: string,
    private tenantId: string,
  ) {}

  /**
   * Registration is CREATE-ONLY and validates the deadline.
   *
   * This used to be an unconditional `INSERT OR REPLACE` keyed on (tenant_id, id) that also wrote
   * the `consumed` column. Re-registering the id of an already-spent single-use grant therefore
   * reset `consumed` to 0 and re-armed a spent irreversible authorization — an authorization bypass
   * reproduced end-to-end by the Retry #5 validation audit. An approval id is now write-once:
   * consumption is terminal, and re-registering an existing id is refused rather than silently
   * overwriting the operator's grant.
   *
   * The expiry is validated here too: an `expiresAt` that resolves to no instant can never be
   * evaluated by `validateOperatorApproval`, so storing it would create a grant that fails open
   * anywhere the fail-closed check is not reached.
   */
  registerApproval(approval: OperatorApproval): ApprovalRegistrationResult {
    return serialTransaction(this.db, () => {
      if (typeof approval.id !== "string" || approval.id.trim() === "") {
        return { registered: false as const, reason: "Approval id must be a non-empty string" }
      }
      if (resolveExpiry(approval.expiresAt) === null) {
        return {
          registered: false as const,
          reason: `Approval expiry '${String(approval.expiresAt)}' is not a valid instant`,
        }
      }
      const existing = this.db
        .query("SELECT consumed FROM operator_approvals WHERE tenant_id = ? AND id = ?")
        .get(this.tenantId, approval.id) as { consumed: number } | null
      if (existing) {
        return {
          registered: false as const,
          reason: `Approval '${approval.id}' is already registered${
            Number(existing.consumed) === 1 ? " and has been consumed" : ""
          }; approval identifiers are single-use and write-once`,
        }
      }
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
      return { registered: true as const }
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
        "SELECT execution_id, classification, contract_ref, outcome, idempotency_key, ts FROM capability_executions WHERE tenant_id = ? AND idempotency_key = ? AND status = 'completed'",
      )
      .get(this.tenantId, key) as Record<string, unknown> | null
    return row ? toAuditEvent(row) : undefined
  }

  /**
   * Durably RESERVES an idempotency key before the provider is called.
   *
   * Checking `findByIdempotencyKey` and recording only afterwards leaves the whole provider call
   * unguarded: three concurrent requests carrying the same key all read "no outcome yet" and all
   * invoke the external effect (validation audit, RACE_CONDITION). The reservation is an INSERT of
   * a `reserved` row under the table's UNIQUE (tenant_id, idempotency_key) primary key, inside a
   * serialized transaction — so exactly one caller can hold a key at a time, and the loser can tell
   * the difference between "already done" and "in flight" instead of duplicating the effect.
   *
   * Returns false when the key is already held or already completed.
   */
  reserve(key: string, meta: { capabilityId: string; classification: CapabilityClassification; contractRef: string }): boolean {
    return serialTransaction(this.db, () => {
      const existing = this.db
        .query("SELECT status FROM capability_executions WHERE tenant_id = ? AND idempotency_key = ?")
        .get(this.tenantId, key) as { status: string } | null
      if (existing) return false
      const ordinal = allocateSequence(this.db, this.tenantId, "capability_executions")
      this.db
        .query(
          `INSERT INTO capability_executions
             (tenant_id, idempotency_key, ordinal, execution_id, classification, contract_ref, capability_id, approval_id, outcome, ts, status)
           VALUES (?, ?, ?, '', ?, ?, ?, NULL, NULL, ?, 'reserved')`,
        )
        .run(this.tenantId, key, ordinal, meta.classification, meta.contractRef, meta.capabilityId, Date.now())
      return true
    })
  }

  /** Releases a reservation that never produced an outcome. Never touches a completed row. */
  release(key: string): void {
    this.db
      .query("DELETE FROM capability_executions WHERE tenant_id = ? AND idempotency_key = ? AND status = 'reserved'")
      .run(this.tenantId, key)
  }

  /**
   * Appends one execution outcome and enforces the retention bound in the same transaction.
   * Without the bound this table is the same unbounded accumulator the in-memory array was, only
   * on disk instead of in the heap.
   */
  record(event: CapabilityExecutedEvent, meta: { capabilityId: string; approvalId?: string }): void {
    serialTransaction(this.db, () => {
      // Reuse the ordinal the reservation already burned for this key. Allocating a second one
      // would make the retention window count reservations as if they were outcomes.
      const held = this.db
        .query("SELECT ordinal FROM capability_executions WHERE tenant_id = ? AND idempotency_key = ?")
        .get(this.tenantId, event.idempotencyKey) as { ordinal: number } | null
      const ordinal = held ? Number(held.ordinal) : allocateSequence(this.db, this.tenantId, "capability_executions")
      this.db
        .query(
          `INSERT OR REPLACE INTO capability_executions
             (tenant_id, idempotency_key, ordinal, execution_id, classification, contract_ref, capability_id, approval_id, outcome, ts, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
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
               AND status = 'completed'
               AND ordinal <= (
                 SELECT COALESCE(MAX(ordinal), 0) - ? FROM capability_executions WHERE tenant_id = ?
               )`,
        )
        .run(this.tenantId, this.maxEntries, this.tenantId)
    })
  }

  count(): number {
    const row = this.db
      .query("SELECT COUNT(*) AS n FROM capability_executions WHERE tenant_id = ? AND status = 'completed'")
      .get(this.tenantId) as { n: number }
    return Number(row.n)
  }

  list(): CapabilityExecutedEvent[] {
    const rows = this.db
      .query(
        "SELECT execution_id, classification, contract_ref, outcome, idempotency_key, ts FROM capability_executions WHERE tenant_id = ? AND status = 'completed' ORDER BY ordinal",
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
    outcome:
      row.outcome === null || row.outcome === undefined
        ? null
        : parseStored<unknown>(row.outcome, "capability_executions", "outcome", String(row.execution_id)),
    idempotencyKey: String(row.idempotency_key),
    timestamp: Number(row.ts),
  }
}
