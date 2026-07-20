/**
 * reverse-index.ts — UI-3 (F002): client-side reverse reference index.
 *
 * Spec 003 §1 derivation Map<claimId, claimId[]>: claim B refs A → A:[B...]. Lazy-built on first
 * OpenClaim of a session; invalidated (discard) on `graph.rebuilt` (next OpenClaim rebuilds).
 *
 * ADAPTATION vs spec 003 §1 (documented in TDD-OUTPUT.notes): production GraphEdge.type is only
 * "depends-on"|"survey" — there is no typed claim→claim edge in graph-core/build.ts:39. So the
 * derivation walks ClaimRecord.refs (O(claims*refs), bounded by snapshot claim volume), not
 * graph.edges. Same lazy + discard semantics; covered by reverse-index.test.ts (004 §1.3).
 *
 * ponytail: pure function, no fs/DOM/store import — unit-testable in isolation; component wiring
 * (useUi.reverseIndex invalidation and rebuild trigger) lives in og.ts and store.ts.
 */
import type { ClaimRecord } from "./store"

export type ReverseIndexMap = Map<string, string[]>

/** Build Map<targetClaimId, sourceClaimId[]> from a list of claims. Single pass O(claims*refs). */
export function buildReverseIndex(claims: ClaimRecord[] | Record<string, ClaimRecord[]>): ReverseIndexMap {
  const out: ReverseIndexMap = new Map()
  const list = Array.isArray(claims) ? claims : Object.values(claims).flat()
  for (const c of list) {
    if (!c || !c.id) continue
    for (const ref of c.refs ?? []) {
      if (!out.has(ref)) out.set(ref, [])
      if (!out.get(ref)!.includes(c.id)) out.get(ref)!.push(c.id)
    }
  }
  return out
}