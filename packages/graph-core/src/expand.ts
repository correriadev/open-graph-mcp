/**
 * expand.ts — governed descent engine (expander). Derives child claims ONE level down from
 * resolved parent claims. Deterministic, no LLM (the LLM proposes; the gate decides).
 *
 * Principle (from the expander paradigm): deriving is not inventing freely. Every child carries
 * the trace of how much the parent sustains it (`derivation`). Descent is born from ideation:
 * children are grounded against the PARENT'S TEXT, never against code below.
 *
 * Integrity rule: only `[Implied]` must prove the parent forces it, via a verbatim anchor in the
 * parent's text. `[Compatible]` (coherent proposal) and `[Speculative]` (declared invention) are
 * admitted without an anchor — they are honest, and a human approves them downstream. This gate
 * exists to stop inflated `[Implied]` (claiming the parent forces what it does not).
 */
import { excerptCheck } from "./extract"

export const DERIVATIONS = ["[Implied]", "[Compatible]", "[Speculative]"] as const
export type Derivation = (typeof DERIVATIONS)[number]

/** Minimal parent shape: a child grounds against the parent's own text (subject + anchor). */
export type Parent = { subject: string; anchor: string; forbids?: string[]; score?: number; status?: string; level?: number; provisional?: boolean }

/** A claim is settled once resolved. pending-verification / contradicts-floor are NOT — a child
 *  derived from such a parent is born provisional (light), but never blocked.
 *  test-spec IS resolved — test code que será escrito é um contrato válido, não uma contradição. */
export const isResolved = (status?: string): boolean => status !== "pending-verification" && status !== "contradicts-floor"

export type ExpandClaim = {
  id: string
  subject: string
  domain: string
  derives_from: string[] // ids of parent claims this child derives from (carries score inheritance)
  derivation: Derivation
  parent_constraint: string | null // the concrete restriction the parent imposes on its OWN children (human-readable)
  forbids?: string[] // machine-checkable twin of parent_constraint: terms a descendant must NOT contain verbatim
  anchor: string // verbatim line from a parent's text; required only for [Implied]
  file?: string // source file a code-level child lands in (optional; non-floor levels leave it absent)
}

export type ExpandAdmitted = ExpandClaim & { status: "pending-verification"; provisional: boolean }

export type ExpandBlocked = {
  id: string
  cause: "dangling-parent" | "forward-reference" | "invalid-derivation" | "unproven-implication" | "violates-constraint"
  detail: string
}

export const EXPAND_POLICIES = ["provisional", "strict", "force"] as const
export type ExpandPolicy = (typeof EXPAND_POLICIES)[number]

export type ExpandDecision = { allowed: boolean; admitted: number; blocked: number; policy: string; reason: string }
export type ExpandResult = { admitted: ExpandAdmitted[]; blocked: ExpandBlocked[]; decision: ExpandDecision }

const parentText = (p: Parent): string => `${p.subject}\n${p.anchor}`

/**
 * Descent gate. `parentById` maps a parent id to its text. A claim is admitted unless:
 *  - `derives_from` points to an unknown parent (dangling-parent),
 *  - `derivation` is not one of DERIVATIONS (invalid-derivation),
 *  - it is `[Implied]` but no parent's text contains its anchor verbatim (unproven-implication).
 */
export function expandGate(
  proposed: readonly ExpandClaim[],
  parentById: Map<string, Parent>,
  childLevel?: number,
  policy: ExpandPolicy = "provisional",
): ExpandResult {
  if (!EXPAND_POLICIES.includes(policy)) throw new Error(`unknown policy: ${policy} (use ${EXPAND_POLICIES.join("|")})`)
  const admitted: ExpandAdmitted[] = []
  const blocked: ExpandBlocked[] = []

  for (const c of proposed) {
    const dangling = c.derives_from.filter((id) => !parentById.has(id))
    if (dangling.length) {
      blocked.push({ id: c.id, cause: "dangling-parent", detail: `parents not found: ${dangling.join(", ")}` })
      continue
    }

    // forward/inverted reference: derives_from must point strictly UP (parent.level < child.level).
    // Self-ref or a ref to the same/lower level breaks the DAG (BMAD: Epic N cannot need Epic N+1).
    if (childLevel !== undefined && Number.isFinite(childLevel)) {
      const forward = c.derives_from.filter((id) => {
        if (id === c.id) return true
        const lv = parentById.get(id)!.level
        return lv !== undefined && lv >= childLevel
      })
      if (forward.length) {
        blocked.push({ id: c.id, cause: "forward-reference", detail: `parents not strictly above level ${childLevel}: ${forward.join(", ")}` })
        continue
      }
    }

    // resolution does NOT block. A child MAY descend from an unresolved parent — it is just born
    // LIGHT: marked provisional, resting on ground that is not yet settled. provisional propagates
    // transitively up the derives_from chain (a child of a provisional parent is provisional too).
    // The lightness also shows in the score, which inherits the unresolved parent's lower weight.
    const provisional = c.derives_from.some((id) => {
      const p = parentById.get(id)!
      return !isResolved(p.status) || p.provisional === true
    })

    if (!(DERIVATIONS as readonly string[]).includes(c.derivation)) {
      blocked.push({ id: c.id, cause: "invalid-derivation", detail: `derivation must be one of ${DERIVATIONS.join("|")}` })
      continue
    }

    // contradiction: the inverse of grounding. A child must NOT contain verbatim any term a parent
    // forbids. Applies to ALL derivations — even a [Speculative] cannot violate a hard constraint.
    const childText = `${c.subject}\n${c.anchor}`
    const violated = c.derives_from
      .flatMap((id) => (parentById.get(id)?.forbids ?? []).map((term) => ({ id, term })))
      .find(({ term }) => term && excerptCheck(childText, term))
    if (violated) {
      blocked.push({ id: c.id, cause: "violates-constraint", detail: `contains forbidden "${violated.term}" from ${violated.id}` })
      continue
    }

    if (c.derivation === "[Implied]") {
      const grounded = c.derives_from.some((id) => excerptCheck(parentText(parentById.get(id)!), c.anchor))
      if (!grounded) {
        blocked.push({ id: c.id, cause: "unproven-implication", detail: "[Implied] anchor not verbatim in any parent" })
        continue
      }
    }

    admitted.push({ ...c, status: "pending-verification", provisional })
  }

  let allowed: boolean
  let reason: string
  if (policy === "force") {
    allowed = true
    reason = "force: descends (hard-blocks still never admitted)"
  } else if (policy === "strict") {
    const anyProvisional = admitted.some((a) => a.provisional)
    allowed = blocked.length === 0 && !anyProvisional
    reason = allowed
      ? "all children grounded and settled"
      : blocked.length > 0
        ? `${blocked.length} blocked (strict)`
        : "provisional children present (strict)"
  } else {
    // provisional (default): current behavior
    allowed = blocked.length === 0
    reason = allowed ? `${admitted.length} children derived; all grounded` : `${blocked.length} blocked`
  }

  return {
    admitted,
    blocked,
    decision: {
      allowed,
      admitted: admitted.length,
      blocked: blocked.length,
      policy,
      reason,
    },
  }
}

export type CoverageRow = { parentId: string; children: string[] }
export type ExpandCoverage = { parentCount: number; covered: number; uncovered: string[]; balanced: boolean; rows: CoverageRow[] }

/**
 * Downward coverage invariant: every parent is carried down by ≥1 admitted child. A parent that
 * no admitted child derives from is a branch the descent dropped silently — a breach. Mirrors
 * claimCoverage (upward) and BMAD's FR→Story traceability matrix (`rows`): one line per parent,
 * its admitted children, Covered/MISSING. Computed over the gate's admitted set (a blocked-only
 * parent stays uncovered, which is correct: its derivation failed).
 */
export function expandCoverage(parentIds: readonly string[], admitted: readonly ExpandAdmitted[]): ExpandCoverage {
  const rows: CoverageRow[] = parentIds.map((id) => ({
    parentId: id,
    children: admitted.filter((a) => a.derives_from.includes(id)).map((a) => a.id),
  }))
  const uncovered = rows.filter((r) => r.children.length === 0).map((r) => r.parentId)
  return { parentCount: parentIds.length, covered: parentIds.length - uncovered.length, uncovered, balanced: uncovered.length === 0, rows }
}

/**
 * Readiness verdict (stolen from BMAD's READY/NEEDS WORK/NOT READY). Folds the hard gate
 * (grounding/constraints — `allowed`) and the soft invariant (coverage — `balanced`) into one
 * three-state status: a hard block is NOT READY; a clean-but-dropped descent is NEEDS WORK.
 */
export type Readiness = "READY" | "NEEDS WORK" | "NOT READY"
export function readiness(allowed: boolean, balanced: boolean): Readiness {
  if (!allowed) return "NOT READY"
  return balanced ? "READY" : "NEEDS WORK"
}

/** A parent is "already expanded" to childLevel if some claim at childLevel lists it in refs.
 *  Used to make re-running expand idempotent: such parents are skipped, not re-derived. */
export function alreadyExpanded(parentIds: readonly string[], claims: readonly { level?: number; refs: string[] }[], childLevel: number): Set<string> {
  const parentSet = new Set(parentIds)
  const expanded = new Set<string>()
  for (const c of claims) {
    if ((c.level ?? 5) === childLevel) {
      for (const ref of c.refs) {
        if (parentSet.has(ref)) expanded.add(ref)
      }
    }
  }
  return expanded
}

/**
 * Score inheritance (the expander's "translation with loss" as a number). Weights are knobs —
 * a heuristic, not a law. Tune them; the invariants below are what matter:
 *  - a child is never MORE resolved than its weakest parent (base = min parent score),
 *  - a child only sinks BELOW the parent by its own open issues (derivation doubt + unverified).
 * ponytail: linear penalties; swap for a curve if the ranking ever feels wrong.
 */
export type ScoreWeights = { compatible: number; speculative: number; pending: number }
export const DEFAULT_WEIGHTS: ScoreWeights = { compatible: 0.1, speculative: 0.3, pending: 0.1 }

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/** A claim's own open issues: invention doubt ([Compatible]/[Speculative]) + unverified status. */
export function issuePenalty(
  claim: Pick<ExpandClaim, "derivation"> & { status?: string },
  w: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  let p = 0
  if (claim.derivation === "[Compatible]") p += w.compatible
  if (claim.derivation === "[Speculative]") p += w.speculative
  if (claim.status === "pending-verification") p += w.pending
  return p
}

/** Born inheriting the weakest parent, then sinks by its own issues. Root (no parents) = 1. */
export function expandScore(
  claim: Pick<ExpandClaim, "derivation"> & { status?: string },
  parentScores: readonly number[],
  w: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  const base = parentScores.length ? Math.min(...parentScores) : 1
  return clamp01(base - issuePenalty(claim, w))
}

/** Floor handoff: a code-level (level 5) child must land on real code — its `file` must exist and
 *  contain its `anchor` verbatim. Otherwise it claims code that is not there:
 *  - if the parent level is 4 (tests) → "test-spec" (test code to be written is EXPECTED, not a contradiction)
 *  - otherwise → "contradicts-floor"
 *  readFile is injected (returns undefined for a missing file) so this stays pure and testable. */
export function floorStatus(
  child: { anchor: string; file?: string },
  readFile: (f: string) => string | undefined,
  parentLevel?: number,
): "pending-verification" | "contradicts-floor" | "test-spec" {
  if (!child.file) return parentLevel === 4 ? "test-spec" : "contradicts-floor"
  const content = readFile(child.file)
  if (content === undefined) return parentLevel === 4 ? "test-spec" : "contradicts-floor"
  if (!excerptCheck(content, child.anchor)) {
    // C2: test specs from test-level parents are expected to not exist in production code
    if (parentLevel === 4) return "test-spec"
    return "contradicts-floor"
  }
  return "pending-verification"
}

/** Minimal claim shape required by reconcile. Compatible with ClaimRecord. */
export type ReconcilableClaim = {
  id: string
  refs: string[]
  status?: string
  derivation?: Derivation
  score?: number
  provisional?: boolean
}

/**
 * reconcile — the unmark/lift half of the provisional loop.
 *
 * Recomputes `provisional` and `score` for every claim top-down over the
 * derives_from DAG (parents identified by `refs`). Call after a human flips
 * a claim's status to "verified" so descendants whose only unresolved ancestor
 * was that claim become non-provisional again, and their scores are refreshed.
 *
 * Rules:
 *  - A claim is provisional iff ANY parent (id in refs) is unresolved
 *    (!isResolved(parent.status)) OR is itself provisional (transitive).
 *  - Roots (no refs, or all refs point to unknown ids) are provisional iff
 *    their own status is unresolved.
 *  - score = expandScore(claim, parentScores) with freshly-recomputed parent
 *    scores. Roots: parentScores = [].
 *  - Unknown refs are ignored (treated as no constraint).
 *
 * Accepts readonly input, returns a NEW array (no mutation).
 */
export function reconcile<T extends ReconcilableClaim>(claims: readonly T[]): T[] {
  const byId = new Map(claims.map((c) => [c.id, c]))

  // Topological sort via DFS: visit parents before children.
  const sorted: T[] = []
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    const claim = byId.get(id)
    if (!claim) return
    for (const ref of claim.refs) visit(ref)
    sorted.push(claim)
  }
  for (const c of claims) visit(c.id)

  // Process in dependency order, tracking freshly-recomputed provisional/score.
  const newProvisional = new Map<string, boolean>()
  const newScore = new Map<string, number>()

  for (const claim of sorted) {
    const knownParents = claim.refs.map((ref) => byId.get(ref)).filter((p): p is T => p !== undefined)

    const provisional =
      knownParents.length === 0
        ? !isResolved(claim.status)
        : knownParents.some((p) => !isResolved(p.status) || (newProvisional.get(p.id) ?? p.provisional ?? false))

    const parentScores = knownParents.map((p) => newScore.get(p.id) ?? p.score ?? 1)
    const score = expandScore({ derivation: claim.derivation ?? "[Implied]", status: claim.status }, parentScores)

    newProvisional.set(claim.id, provisional)
    newScore.set(claim.id, score)
  }

  return claims.map((c) => ({
    ...c,
    provisional: newProvisional.get(c.id) ?? c.provisional,
    score: newScore.get(c.id) ?? c.score,
  }))
}
