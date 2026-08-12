/**
 * dependency-query.ts — the production `DependencyQuery` and `ExecutionContext` for recall.
 *
 * `RecallWorker` traverses a reverse-dependency closure before it degrades anything. Until this
 * file existed the only implementation was `InMemoryDependencyQuery`, which is a test fixture: the
 * reachable recall path computed no closure at all and simply copied the contested claim ids into
 * the "affected" list. A recall that does not traverse is not a recall — an invalidated claim's
 * dependents keep their admitted status and the graph silently keeps asserting knowledge that rests
 * on a retracted premise.
 *
 * The real edges are already in the graph: a claim's `refs` column lists the claims it rests on, so
 * the reverse edge (`ref -> claim`) is exactly "who depends on this". The closure is the transitive
 * set of dependents, computed breadth-first and returned sorted so a resumed recall processes the
 * same claims in the same order as the run it resumes.
 */
import type { Database } from "bun:sqlite"
import type { DependencyQuery, ExecutionContext, TruthOwnership } from "@open-graph-mcp/graph-core/eap/recall"
import { canonicalCell } from "../cell"

/** A stored JSON column written by an earlier version — or replayed from a mirror — may be junk. */
function parseIdArray(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
  } catch {
    return []
  }
}

export class SqliteDependencyQuery implements DependencyQuery {
  constructor(
    private readonly db: Database,
    private readonly tenantId: string,
  ) {}

  reverseClosure(targetClaimIds: string[]): string[] {
    const rows = this.db.query("SELECT id, refs FROM claims WHERE tenant_id = ?").all(this.tenantId) as {
      id: string
      refs: string | null
    }[]

    // dependency -> dependents
    const reverse = new Map<string, string[]>()
    for (const row of rows) {
      for (const ref of parseIdArray(row.refs)) {
        const list = reverse.get(ref)
        if (list) list.push(row.id)
        else reverse.set(ref, [row.id])
      }
    }

    const visited = new Set<string>(targetClaimIds)
    const queue = [...targetClaimIds]
    for (let head = 0; head < queue.length; head++) {
      for (const dependent of reverse.get(queue[head]!) ?? []) {
        if (visited.has(dependent)) continue
        visited.add(dependent)
        queue.push(dependent)
      }
    }
    return [...visited].sort()
  }
}

/**
 * The state recall degrades against: the current status of each claim, the cell it lives in, and
 * who currently owns the truth of that cell. Without this the worker degrades every claim from a
 * hardcoded "admitted" and can never reach a graph-owned cell, so `TruthOwnershipSuspended` is
 * unreachable by construction.
 */
export function buildRecallExecutionContext(db: Database, tenantId: string): ExecutionContext {
  const claimStates = new Map<string, string>()
  const claimCells = new Map<string, string>()
  const cellOwners = new Map<string, TruthOwnership>()

  const claims = db.query("SELECT id, domain, level FROM claims WHERE tenant_id = ?").all(tenantId) as {
    id: string
    domain: string | null
    level: string | null
  }[]
  for (const claim of claims) {
    claimStates.set(claim.id, "admitted")
    if (claim.domain && claim.level !== null) claimCells.set(claim.id, canonicalCell(`${claim.domain}:${claim.level}`))
  }

  // Epistemic-lifecycle candidates carry a real per-candidate state; it is a better "previous
  // state" than the blanket "admitted" the domain falls back to.
  const candidates = db.query("SELECT candidate_id, state FROM candidates WHERE tenant_id = ?").all(tenantId) as {
    candidate_id: string
    state: string
  }[]
  for (const candidate of candidates) claimStates.set(candidate.candidate_id, candidate.state)

  const authority = db.query("SELECT cell, value FROM authority WHERE tenant_id = ?").all(tenantId) as {
    cell: string
    value: string
  }[]
  for (const row of authority) cellOwners.set(canonicalCell(row.cell), row.value as TruthOwnership)

  return { claimStates, claimCells, cellOwners }
}
