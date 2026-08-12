/**
 * recall-closure.ts — membership of a claim in a durable Recall Case's closure.
 *
 * WHY THIS FILE EXISTS (retry #7, TL + QA top finding)
 * ---------------------------------------------------
 * `graph-core/eap/recall.ts` assigns `normativelyResolvedState = 'recalled'` to EVERY claim in the
 * reverse closure and durably records that in `recall_cases.state` and in the scar. The read-model
 * projection deliberately writes a destination status only for the contestation's DIRECT targets,
 * because 003 §Explicitly Deferred Decisions defers "the exact destination status of indirect
 * dependents in a Recall cascade" and the projection refuses to invent one.
 *
 * The deferral covers the STATUS. It does not cover the existence of a GATE. Without one, QA drove
 * an indirect dependent — a claim the domain itself had recorded as recalled, resting on a premise
 * that was retracted — through CONCRETIZE and VERIFY and promoted it into a parent horizon. So the
 * gate is here and the status stays undecided: a candidate inside any recall closure cannot COMPLETE
 * its lifecycle (`VERIFY`) and cannot be distilled into a parent horizon (`cognitive.promote`).
 * Where it finally lands is still the ADR's question to answer.
 *
 * The refusal code is the spec's own: `REHAB_WITHOUT_PROOF` ("reabilitação de célula suspensa sem
 * prova nova — percorrer o caminho normal de verificação", ADR §Correção / PRD FR-C4). Re-verifying
 * or promoting knowledge the closure swept up IS rehabilitation, and it has presented no new proof.
 *
 * HOW IT IS READ (retry #8, TL Tier 3 / QA RESOURCE_EXHAUSTION)
 * ------------------------------------------------------------
 * The first implementation answered "is this claim in any closure?" by SELECTing every
 * `recall_cases` row of the tenant — a table with no index at all, so a scan plus a filesort — and
 * JSON.parsing every `closure` blob until it found the claim. It ran once per VERIFY and once PER
 * CANDIDATE inside the promotion transaction, which holds the tenant's write lock: QA measured
 * ~13ms per lookup at 2000 cases x 50 closure ids, i.e. ~650ms of serialized write lock for a
 * 50-candidate promote, growing without bound because `recall_cases` is append-only.
 *
 * Membership is now a DERIVED, INDEXED table (`recall_closure_members`), one row per (claim, case),
 * maintained by the repository inside the same transaction that writes the case. It is a live index
 * in the `db.ts` sense — SQLite only, no JSONL mirror — because it is a projection of
 * `recall_cases.closure`, which IS mirrored. Two consequences are handled explicitly:
 *
 *  - A `rebuildFromJsonl` (or any writer that reaches the table behind the repository) leaves the
 *    index stale. `ensureRecallClosureIndex` compares a durable case COUNT against the count the
 *    index was built from and re-derives the difference before every lookup, so the gate is
 *    self-healing rather than silently failing OPEN.
 *  - A closure blob that does not parse is not read as "no membership" — that would fail open on
 *    exactly the gate this exists to hold. Indexing records a sentinel member row for it, and every
 *    lookup asks for that sentinel too, raising `StoredStateCorruptionError` (which the tool
 *    boundary maps to a typed Refusal) exactly as the scanning implementation did.
 */
import type { Database } from "bun:sqlite"
import { serialTransaction } from "../db"
import { StoredStateCorruptionError } from "./stored-state"

export interface RecallClosureMembership {
  recallId: string
  status: string
  contestationId: string
}

/**
 * Reserved `claim_id` values. NUL cannot appear in an identifier that reached a governed
 * boundary (`validateIdentifier` rejects control characters), so neither can collide with a claim.
 */
const UNREADABLE_CLOSURE = "\u0000unreadable-closure"
const EMPTY_CLOSURE = "\u0000empty-closure"

/**
 * (Re)derives the index rows for ONE case. Must run inside the caller's transaction — for a live
 * case that is the same unit of work that writes `recall_cases`, so the index cannot outlive a
 * rolled-back case or lag a committed one.
 *
 * `closureJson` is the column as stored, not a parsed array, so that the backfill path and the
 * write path agree byte for byte on what "the stored closure" means — including when it is garbage.
 */
export function indexRecallClosure(db: Database, tenantId: string, recallId: string, closureJson: string | null): void {
  db.query("DELETE FROM recall_closure_members WHERE tenant_id = ? AND recall_id = ?").run(tenantId, recallId)
  let claimIds: string[]
  try {
    const parsed: unknown = JSON.parse(closureJson ?? "[]")
    if (!Array.isArray(parsed)) throw new Error("closure is not an array")
    claimIds = parsed.filter((id): id is string => typeof id === "string")
    if (claimIds.length === 0) claimIds = [EMPTY_CLOSURE]
  } catch {
    claimIds = [UNREADABLE_CLOSURE]
  }
  const insert = db.query(
    "INSERT OR REPLACE INTO recall_closure_members (tenant_id, claim_id, recall_id) VALUES (?, ?, ?)",
  )
  for (const claimId of claimIds) insert.run(tenantId, claimId, recallId)
}

/** Records how many cases the index currently covers, so staleness is one COUNT away. */
export function markRecallClosureIndexed(db: Database, tenantId: string): void {
  const total = countCases(db, tenantId)
  db.query(
    `INSERT INTO recall_closure_index (tenant_id, indexed_cases) VALUES (?, ?)
     ON CONFLICT(tenant_id) DO UPDATE SET indexed_cases = excluded.indexed_cases`,
  ).run(tenantId, total)
}

function countCases(db: Database, tenantId: string): number {
  const row = db.query("SELECT COUNT(*) AS n FROM recall_cases WHERE tenant_id = ?").get(tenantId) as { n: number }
  return Number(row.n)
}

/**
 * Brings the derived index level with `recall_cases` if anything wrote the table behind the
 * repository: a `rebuildFromJsonl`, a restore of a state directory produced before this index
 * existed, or a direct SQL edit. On the normal path this is a single indexed COUNT and returns.
 */
export function ensureRecallClosureIndex(db: Database, tenantId: string): void {
  const actual = countCases(db, tenantId)
  const marker = db.query("SELECT indexed_cases FROM recall_closure_index WHERE tenant_id = ?").get(tenantId) as
    | { indexed_cases: number }
    | null
  if (marker && Number(marker.indexed_cases) === actual) return

  serialTransaction(db, () => {
    // Fewer cases than the index was built from means rows were REMOVED (a rebuild deletes the
    // tenant's tables before replaying the mirror), so the surviving member rows may name cases that
    // no longer exist. Derive that tenant from scratch rather than trusting the difference.
    if (marker && Number(marker.indexed_cases) > actual) {
      db.query("DELETE FROM recall_closure_members WHERE tenant_id = ?").run(tenantId)
    }
    const missing = db
      .query(
        `SELECT rc.id AS id, rc.closure AS closure FROM recall_cases rc
          WHERE rc.tenant_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM recall_closure_members m WHERE m.tenant_id = rc.tenant_id AND m.recall_id = rc.id
            )`,
      )
      .all(tenantId) as { id: string; closure: string | null }[]
    for (const row of missing) indexRecallClosure(db, tenantId, row.id, row.closure)
    markRecallClosureIndexed(db, tenantId)
  })
}

/**
 * Resolves closure membership for a WHOLE candidate set in one indexed query.
 *
 * The promotion loop used to call the single-claim lookup once per candidate, inside the promote
 * transaction. Membership does not change during that loop — the transaction holds the write lock —
 * so it is resolved once, for every candidate, before the loop runs.
 *
 * ACTIVE cases count as well as completed ones: a closure that has been computed and durably
 * recorded already names the claim as resting on a retracted premise, and letting it finish its
 * lifecycle in the window before the last batch lands is the same defect with a smaller window.
 */
export function findRecallClosureMemberships(
  db: Database,
  tenantId: string,
  claimIds: string[],
): Map<string, RecallClosureMembership> {
  ensureRecallClosureIndex(db, tenantId)

  const wanted = [...new Set(claimIds)]
  // The corruption sentinel is asked for on EVERY lookup, including one with no candidates: a
  // closure that cannot be read must halt the gate whoever is asking.
  const keys = [...wanted, UNREADABLE_CLOSURE]
  const placeholders = keys.map(() => "?").join(", ")
  const rows = db
    .query(
      `SELECT m.claim_id AS claim_id, rc.id AS recall_id, rc.status AS status, rc.contestation_id AS contestation_id
         FROM recall_closure_members m
         JOIN recall_cases rc ON rc.tenant_id = m.tenant_id AND rc.id = m.recall_id
        WHERE m.tenant_id = ? AND m.claim_id IN (${placeholders})
        ORDER BY rc.created_at, rc.id`,
    )
    .all(tenantId, ...keys) as { claim_id: string; recall_id: string; status: string; contestation_id: string }[]

  const found = new Map<string, RecallClosureMembership>()
  for (const row of rows) {
    if (row.claim_id === UNREADABLE_CLOSURE) {
      throw new StoredStateCorruptionError("recall_cases", "closure", row.recall_id)
    }
    // Ordered by (created_at, id): the FIRST case that swept the claim up is the one reported, which
    // is the case the scanning implementation reported too.
    if (!found.has(row.claim_id)) {
      found.set(row.claim_id, {
        recallId: row.recall_id,
        status: row.status,
        contestationId: row.contestation_id,
      })
    }
  }
  return found
}

/** The first Recall Case of `tenantId` whose closure contains `claimId`, or null. */
export function findRecallClosureMembership(
  db: Database,
  tenantId: string,
  claimId: string,
): RecallClosureMembership | null {
  return findRecallClosureMemberships(db, tenantId, [claimId]).get(claimId) ?? null
}
