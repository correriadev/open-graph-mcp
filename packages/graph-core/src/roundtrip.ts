/**
 * roundtrip.ts — bidirectional ladder-integrity reconciliation.
 *
 * Both ascent (code → ideation) and expand (ideation → code) write into the same claim
 * set. This module proves the rungs actually connect: given the full array of persisted
 * claims, it reports every structural violation that breaks the abstraction ladder.
 * Purely deterministic — no LLM, no filesystem access.
 *
 * Levels: 5=code … 0=ideation. A coherent ladder has every non-root claim adjacent to
 * its refs (|level(claim) - level(ref)| === 1). Roots (no refs) are valid only at the
 * extremes (level 0 or CODE_LEVEL); mid-ladder claims with no refs are orphans.
 */
import { CODE_LEVEL } from "./ascent"

export type RoundtripKind = "dangling-ref" | "level-gap" | "orphan-midladder" | "cycle"

export type RoundtripViolation = {
  id: string
  kind: RoundtripKind
  detail: string
}

/** Minimal claim shape. Compatible with ClaimRecord. Missing level defaults to CODE_LEVEL (5). */
export type RoundtripClaim = {
  id: string
  level?: number
  refs: string[]
}

export type RoundtripResult = {
  violations: RoundtripViolation[]
  ok: boolean
}

/** Options for the scoped variant. Reserved for future extension; currently no fields. */
export type RoundtripScopedOptions = Record<string, never>

/**
 * detectCycles — cycle detection via DFS three-color marking (white=0, gray=1, black=2),
 * using an EXPLICIT stack (no recursion) so deep ref chains cannot overflow the call stack.
 *
 * Semantics are identical to the classic recursive formulation: for every top-level claim
 * that hasn't been visited yet, walk its refs depth-first, tracking the current path. When
 * a gray (in-progress) node is reached again, every node on the path from its first
 * occurrence to the current tip is part of a cycle.
 */
function detectCycles(claims: readonly RoundtripClaim[], byId: Map<string, RoundtripClaim>): Set<string> {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2
  const color = new Map<string, number>()
  const cycleNodes = new Set<string>()

  type Frame = { id: string; refs: string[]; i: number }

  for (const c of claims) {
    if ((color.get(c.id) ?? WHITE) !== WHITE) continue

    const path: string[] = []
    const stack: Frame[] = []

    const enter = (id: string) => {
      color.set(id, GRAY)
      path.push(id)
      const claim = byId.get(id)
      stack.push({ id, refs: claim ? claim.refs : [], i: 0 })
    }

    enter(c.id)

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!
      if (top.i >= top.refs.length) {
        path.pop()
        color.set(top.id, BLACK)
        stack.pop()
        continue
      }
      const ref = top.refs[top.i]!
      top.i++
      const state = color.get(ref) ?? WHITE
      if (state === BLACK) continue
      if (state === GRAY) {
        // back edge: everything on the path from first occurrence of ref is in a cycle
        const start = path.indexOf(ref)
        for (let i = start; i < path.length; i++) cycleNodes.add(path[i]!)
        continue
      }
      enter(ref)
    }
  }

  return cycleNodes
}

/**
 * checkClaims — runs all four ladder-integrity invariants over the given claim subset:
 *  1. dangling-ref: every ref id must exist in the (sub)set.
 *  2. level-gap: every ref must be exactly one level from its referencing claim.
 *  3. orphan-midladder: mid-ladder claims (0 < level < CODE_LEVEL) must have ≥1 ref.
 *  4. cycle: the refs graph must be acyclic.
 *
 * `byId` must be a lookup restricted to the same subset as `claims` — refs pointing
 * outside the subset are treated as dangling.
 */
function checkClaims(claims: readonly RoundtripClaim[], byId: Map<string, RoundtripClaim>): RoundtripViolation[] {
  const violations: RoundtripViolation[] = []

  // 1. dangling-ref: ref points to an id that does not exist in the claim (sub)set
  for (const c of claims) {
    for (const ref of c.refs) {
      if (!byId.has(ref)) {
        violations.push({ id: c.id, kind: "dangling-ref", detail: `ref "${ref}" not found in claim set` })
      }
    }
  }

  // 2. level-gap: each ref must be exactly one level away (adjacent rung on the ladder)
  for (const c of claims) {
    if (c.refs.length === 0) continue
    const cLevel = c.level ?? CODE_LEVEL
    for (const ref of c.refs) {
      const target = byId.get(ref)
      if (!target) continue // already reported as dangling-ref
      const tLevel = target.level ?? CODE_LEVEL
      const dist = Math.abs(cLevel - tLevel)
      if (dist !== 1) {
        violations.push({
          id: c.id,
          kind: "level-gap",
          detail: `ref "${ref}" at level ${tLevel} is ${dist} levels from claim at level ${cLevel} (expected 1)`,
        })
      }
    }
  }

  // 3. orphan-midladder: mid-ladder claim (not top, not floor) with no refs at all
  for (const c of claims) {
    const cLevel = c.level ?? CODE_LEVEL
    if (cLevel > 0 && cLevel < CODE_LEVEL && c.refs.length === 0) {
      violations.push({
        id: c.id,
        kind: "orphan-midladder",
        detail: `claim at level ${cLevel} has no refs (mid-ladder orphan; not connected to any adjacent level)`,
      })
    }
  }

  // 4. cycle detection
  const cycleNodes = detectCycles(claims, byId)
  for (const id of cycleNodes) {
    violations.push({ id, kind: "cycle", detail: "refs graph contains a cycle" })
  }

  return violations
}

/**
 * roundtrip — checks all four ladder-integrity invariants over the full claim set.
 * Returns `ok: true` when there are no violations.
 */
export function roundtrip(claims: readonly RoundtripClaim[]): RoundtripResult {
  const byId = new Map(claims.map((c) => [c.id, c]))
  const violations = checkClaims(claims, byId)
  return { violations, ok: violations.length === 0 }
}

/**
 * roundtripScoped — same four ladder-integrity invariants, but restricted to the
 * connected component reachable from `rootId` via UNDIRECTED reachability over `refs`
 * (edges are followed in both directions). Claims outside that component are entirely
 * invisible: a violation confined to an unrelated component will not appear here, even
 * though it would appear in the global `roundtrip(claims)`.
 *
 * If `rootId` is not present in `claims`, the scope is empty and the result is `ok: true`
 * with no violations.
 */
export function roundtripScoped(
  claims: readonly RoundtripClaim[],
  rootId: string,
  _opts?: RoundtripScopedOptions,
): RoundtripResult {
  const byId = new Map(claims.map((c) => [c.id, c]))
  if (!byId.has(rootId)) return { violations: [], ok: true }

  // Build undirected adjacency: an edge exists between c.id and ref whenever ref
  // resolves to a claim that actually exists (a dangling ref has no node to connect to).
  const adjacency = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    let set = adjacency.get(a)
    if (!set) {
      set = new Set()
      adjacency.set(a, set)
    }
    set.add(b)
  }
  for (const c of claims) {
    for (const ref of c.refs) {
      if (!byId.has(ref)) continue
      link(c.id, ref)
      link(ref, c.id)
    }
  }

  // BFS from rootId over the undirected adjacency to find the connected component.
  const componentIds = new Set<string>([rootId])
  const queue: string[] = [rootId]
  let head = 0
  while (head < queue.length) {
    const id = queue[head++]!
    for (const neighbor of adjacency.get(id) ?? []) {
      if (!componentIds.has(neighbor)) {
        componentIds.add(neighbor)
        queue.push(neighbor)
      }
    }
  }

  const componentClaims = claims.filter((c) => componentIds.has(c.id))
  const componentById = new Map(componentClaims.map((c) => [c.id, c]))
  const violations = checkClaims(componentClaims, componentById)
  return { violations, ok: violations.length === 0 }
}
