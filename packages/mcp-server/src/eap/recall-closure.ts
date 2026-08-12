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
 */
import type { Database } from "bun:sqlite"
import { StoredStateCorruptionError } from "./eap-repositories"

export interface RecallClosureMembership {
  recallId: string
  status: string
  contestationId: string
}

/**
 * The first Recall Case of `tenantId` whose closure contains `claimId`, or null.
 *
 * ACTIVE cases count as well as completed ones: a closure that has been computed and durably
 * recorded already names the claim as resting on a retracted premise, and letting it finish its
 * lifecycle in the window before the last batch lands is the same defect with a smaller window.
 *
 * A closure column that does not parse is NOT read as "no membership" — that would fail open on
 * exactly the gate this exists to hold. It raises `StoredStateCorruptionError`, which the tool
 * boundary maps to a typed Refusal (see `storedStateRefusal` in tools/eap.ts).
 */
export function findRecallClosureMembership(
  db: Database,
  tenantId: string,
  claimId: string,
): RecallClosureMembership | null {
  const rows = db
    .query("SELECT id, status, contestation_id, closure FROM recall_cases WHERE tenant_id = ? ORDER BY created_at, id")
    .all(tenantId) as { id: string; status: string; contestation_id: string; closure: string | null }[]

  for (const row of rows) {
    let closure: unknown
    try {
      closure = JSON.parse(row.closure ?? "[]")
    } catch {
      throw new StoredStateCorruptionError("recall_cases", "closure", row.id)
    }
    if (Array.isArray(closure) && closure.includes(claimId)) {
      return { recallId: row.id, status: row.status, contestationId: row.contestation_id }
    }
  }
  return null
}
