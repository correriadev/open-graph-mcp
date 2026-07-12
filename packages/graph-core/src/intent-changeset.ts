/**
 * intent-changeset.ts — the seam between the intent-writing tools and the changeset primitive.
 *
 * Today graphexpand / graphascend / graphreconcile call `appendClaims` directly, one tool-call
 * at a time, so a multi-cell pivot becomes N separate approvals (the pivot avalanche). This wraps
 * a batch of intent deltas into ONE atomic changeset (changeset-store, INV-H2-1) whose admission
 * is gated by the SCOPED ladder-integrity check (roundtripScoped, blind spot 2.1) — an orphan in
 * an unrelated component never blocks the intent, and the whole batch lands or none of it does.
 * The result carries the changeset id and its blast radius, so the human approves one reviewable
 * object instead of N tool calls.
 *
 * Pure orchestration over existing merged pieces — no new persistence format. The Effect-based
 * intent tools call this instead of raw appendClaims; wiring each tool is a mechanical follow-up.
 */
import { openChangeset, addToChangeset, admitChangeset, blastRadius, type AuthorityDelta } from "./changeset-store"
import { roundtripScoped } from "./roundtrip"
import type { ClaimRecord } from "./claim-store"
import type { Graph } from "./build"

export type CommitIntentOpts = {
  /** Human sentence describing the intent (the changeset's reviewable label). */
  intent: string
  /** Claim id the ladder-integrity check scopes to — the connected component being touched. */
  scopeId: string
  parent?: string | null
  claims?: ClaimRecord[]
  authority?: AuthorityDelta[]
  /** Current graph (for authority transitions) and the existing claim store (for the scoped check). */
  graph: Graph
  existingClaims: readonly ClaimRecord[]
}

export type CommitIntentResult = {
  ok: boolean
  changesetId: string
  graph: Graph
  reasons: string[]
  blast: { cells: string[]; claimCount: number }
}

/**
 * Opens a changeset for `intent`, stages the claim/authority deltas, and admits it atomically:
 * the gate runs `roundtripScoped` over (existing claims + the changeset's new claims) restricted to
 * `scopeId`'s component. Pass → deltas append via the changeset's seq-stamped path and authority
 * transitions apply to the returned graph; fail → nothing lands and the reasons name the ladder
 * violations. Either way the blast radius is reported for review.
 */
export function commitIntent(root: string, opts: CommitIntentOpts): CommitIntentResult {
  let cs = openChangeset(root, opts.intent, opts.parent ?? null)
  cs = addToChangeset(cs, { claims: opts.claims, authority: opts.authority })

  const validate = (candidate: typeof cs) => {
    const merged = [...opts.existingClaims, ...candidate.claims]
    const rt = roundtripScoped(merged, opts.scopeId)
    return { ok: rt.ok, reasons: rt.violations.map((v) => `${v.id}: ${v.kind} — ${v.detail}`) }
  }

  const res = admitChangeset(root, cs, opts.graph, validate)
  return { ok: res.ok, changesetId: cs.id, graph: res.graph, reasons: res.reasons, blast: blastRadius(cs) }
}
