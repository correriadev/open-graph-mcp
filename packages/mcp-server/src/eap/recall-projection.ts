/**
 * recall-projection.ts — projects a Recall Case onto the READ MODEL.
 *
 * WHY THIS FILE EXISTS (retry #6, TL Tier 1 / QA DATA_INTEGRITY)
 * -------------------------------------------------------------
 * Recall genuinely traversed, degraded and scarred — but every one of those effects lived inside
 * the `recall_cases.state` JSON blob, which only `SqliteRecallRepository` reads. `stepRecall`
 * mutates the `ExecutionContext` Maps that `buildRecallExecutionContext` rebuilds per call, so a
 * claim degraded to `recalled` still read `admitted` in `candidates`, could be advanced with
 * `cognitive.propose CONCRETIZE`, and could be VERIFYed and promoted into a parent horizon.
 * Invalidated knowledge kept climbing the lifecycle, and a graph-owned cell whose truth ownership
 * the domain had suspended still read `graph` in the `authority` table that `authorityOf` (and
 * therefore the gates, `graph.impact` and `authority.flip`) consults.
 *
 * The projection runs inside the SAME durable unit of work that checkpoints the case (see
 * `SqliteRecallRepository.checkpoint` / `.complete`), so a completed recall and a queryable graph
 * cannot disagree about what is still admitted.
 *
 * WHAT IS PROJECTED, AND WHAT IS DELIBERATELY NOT
 * ----------------------------------------------
 *  - DIRECTLY recalled claims (the contestation's own `targetClaimIds`) become `recalled` in the
 *    `candidates` lifecycle table.
 *  - Cells whose truth ownership the domain suspended become `suspended` in `authority` — the same
 *    value, table and `write()` path `watch-bridge.ts` already uses for a β-cell demotion, and the
 *    consumer 003 §Events names for `TruthOwnershipSuspended`.
 *  - INDIRECT dependents are NOT given a destination status. 003 defers exactly that question
 *    ("the exact destination status of indirect dependents in a Recall cascade"), and this
 *    projection stops at the boundary rather than deciding it. They remain in the closure, the
 *    checkpoint and the scar, which is where the deferred decision will be resolved from.
 *  - The `claims` table is NOT rewritten. 004 §1.1 requires that "no admitted record is erased or
 *    directly rewritten"; committed claims are append-only and `state.claimsCache` is built on that
 *    invariant. Truth ownership of the claim's cell is the read-model consequence of a recall, and
 *    that is what is projected.
 *
 * WHAT THE PROJECTION REPORTS (retry #7, TL Tier 3)
 * ------------------------------------------------
 * Every other writer to the `authority` table pairs the write with an event that `state.ts` lists as
 * ALWAYS_BROADCAST, precisely because an ownership change is something every connected session must
 * learn. This projection wrote `suspended` and announced nothing; the only `TruthOwnershipSuspended`
 * emissions on the tool path came from the LAST batch's progress, so with any `batchSize` smaller
 * than the closure, cells suspended in earlier batches were durably suspended and announced nowhere.
 *
 * The projection now RETURNS the cells it newly suspended, so the caller (`SqliteRecallRepository`)
 * can publish one event per cell once the unit of work has COMMITTED — a live session and the
 * `authority` table cannot disagree, and no subscriber ever observes a suspension a rollback erases.
 */
import type { Database } from "bun:sqlite"
import type { RecallCase } from "@open-graph-mcp/graph-core/eap/recall"
import { write } from "../db"
import { canonicalCell } from "../cell"

/** What this projection call actually changed, for the caller to announce after the commit. */
export interface RecallProjectionResult {
  /** Cells this call moved from graph-owned to `suspended`. Empty on a re-applied batch. */
  suspendedCells: string[]
}

/**
 * Applies `recallCase`'s durable degradation and suspension to the read model. Idempotent: it is
 * called once per checkpointed batch and re-applies the same terminal values — which is also why
 * `suspendedCells` is the NEWLY suspended set and not the case's whole suspension history: a cell
 * already at `suspended` is skipped, so re-projection announces nothing twice.
 *
 * MUST be called from inside a `serialTransaction` — it is part of the checkpoint's unit of work,
 * never a separate one.
 */
export function projectRecallToReadModel(
  db: Database,
  stateDir: string,
  tenantId: string,
  recallCase: RecallCase,
): RecallProjectionResult {
  const now = new Date().toISOString()

  // 1. Directly recalled claims lose their admitted lifecycle state.
  const directTargets = new Set(recallCase.notice.targetClaimIds)
  for (const [claimId, degradation] of recallCase.degradedClaimStates) {
    if (!directTargets.has(claimId)) continue
    const rows = db
      .query("SELECT horizon_id, seq, created_at, state FROM candidates WHERE tenant_id = ? AND candidate_id = ?")
      .all(tenantId, claimId) as { horizon_id: string; seq: number; created_at: string; state: string }[]
    for (const row of rows) {
      if (row.state === degradation.normativelyResolvedState) continue
      write(db, stateDir, tenantId, "candidates", {
        tenant_id: tenantId,
        horizon_id: row.horizon_id,
        candidate_id: claimId,
        state: degradation.normativelyResolvedState,
        seq: row.seq,
        created_at: row.created_at,
        updated_at: now,
      })
    }
  }

  // 2. Suspended cells lose graph truth ownership. `last_flip_seq` keeps the sequence of the flip
  // that made the cell graph-owned — the recall suspends the ownership, it does not re-flip it —
  // and `last_flip_by` records which recall case did the suspending.
  const newlySuspended: string[] = []
  for (const rawCell of recallCase.suspendedCells) {
    const cell = canonicalCell(rawCell)
    const existing = db
      .query("SELECT value, last_flip_seq FROM authority WHERE tenant_id = ? AND cell = ?")
      .get(tenantId, cell) as { value: string; last_flip_seq: number | null } | null
    if (existing?.value === "suspended") continue
    write(db, stateDir, tenantId, "authority", {
      tenant_id: tenantId,
      cell,
      value: "suspended",
      last_flip_seq: existing?.last_flip_seq ?? 0,
      last_flip_by: `recall:${recallCase.id}`,
    })
    newlySuspended.push(cell)
  }

  return { suspendedCells: newlySuspended }
}
