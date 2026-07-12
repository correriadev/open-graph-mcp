/**
 * authority.ts — per-cell truth ownership (β-gradual). A cell (domain, level) is
 * "source" (α: code is truth) by default and EARNS "graph" (β: graph is truth,
 * code is projection) through the flip gate. Drift in a β cell auto-demotes.
 * Pure and deterministic; the tool computes the check inputs.
 *
 * Graded drift (INV-H1-2): demotion severity now tracks HOW a node drifted, not just
 * THAT it drifted. `demoteDrifted` (legacy, verbatim-only) is kept byte-for-byte so every
 * existing caller/test that reasons in terms of a plain stale-id Set keeps working — it
 * always routes straight to "source", which is also the correct legacy-mapping decision
 * (see watch.ts nodeGrade: a legacy anchor-miss grades as "gone", i.e. the same severity
 * demoteDrifted already gives it). `demoteGraded` is the new taxonomy-aware sibling used
 * by the graded pipeline: format-only drift ("lexical") never touches authority, real
 * body/signature drift ("structural") suspends (not source), and only total loss of the
 * symbol ("gone") still reverts to "source".
 */
import type { Graph } from "./build"

export type Authority = "source" | "graph" | "suspended"

/**
 * Graded drift taxonomy (piso graded drift). "renamed" sits between "lexical" and
 * "structural": a symbol moved to a new symbolPath but is still anchored via the
 * rename-stable hash (`renameStableHashOf` in extract.ts), so it's real evidence of
 * movement, not loss — it never demotes a β cell, same as "lexical". Detection of
 * renames (populating this grade) happens in later specs; this taxonomy case just
 * gives the demotion routing somewhere correct to land once it does.
 */
export type DriftGrade = "fresh" | "lexical" | "renamed" | "structural" | "gone"

const gradeSeverity = (g: DriftGrade): number =>
  g === "gone" ? 4 : g === "structural" ? 3 : g === "renamed" ? 2 : g === "lexical" ? 1 : 0

export const cellKey = (domain: string, level: number) => `${domain}:${level}`

export function getAuthority(graph: Graph, key: string): Authority {
  return graph.authority?.[key] ?? "source"
}

/** Returns a NEW graph. "source" removes the key (absent = source, keeps graph.json lean). */
export function setAuthority(graph: Graph, key: string, value: Authority): Graph {
  const authority = { ...(graph.authority ?? {}) }
  if (value === "source") delete authority[key]
  else authority[key] = value
  return { ...graph, authority }
}

export type FlipChecks = { coverageBalanced: boolean; verifyClean: boolean; roundtripOk: boolean }

/** Flip gate (spec §1): every unmet condition is a named reason. Human flips; this only judges. */
export function canFlip(checks: FlipChecks): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (!checks.coverageBalanced) reasons.push("cell coverage not closed — nodes without claims in the cell")
  if (!checks.verifyClean) reasons.push("graphverify red — integrity breaches present")
  if (!checks.roundtripOk) reasons.push("roundtrip red — ladder violations present")
  return { ok: reasons.length === 0, reasons }
}

export type Demotion = { cell: string; files: string[] }

/**
 * LEGACY auto-demotion (spec §1, unchanged): any stale/gone node inside a β cell reverts
 * that cell to "source". Node drift is code-level evidence, so only (domain, 5) cells are
 * demoted; higher-level β cells are untouched. Malformed keys are skipped, never guessed.
 * Kept exactly as-is (byte-for-byte behavior) for backward compat — see module doc.
 */
export function demoteDrifted(graph: Graph, staleNodeIds: ReadonlySet<string>): { graph: Graph; demoted: Demotion[] } {
  const demoted: Demotion[] = []
  let g = graph
  for (const [key, auth] of Object.entries(graph.authority ?? {})) {
    if (auth !== "graph") continue
    const cut = key.lastIndexOf(":")
    if (cut <= 0) continue // malformed key (no "<domain>:<level>") — skip, no guessing
    const domain = key.slice(0, cut)
    const level = key.slice(cut + 1)
    if (!/^\d+$/.test(level)) continue // malformed level — skip
    if (Number(level) !== 5) continue // code drift only demotes code-level cells
    const drifted = graph.nodes.filter((n) => n.domain === domain && staleNodeIds.has(n.id))
    if (drifted.length) {
      g = setAuthority(g, key, "source")
      demoted.push({ cell: key, files: [...new Set(drifted.map((n) => n.file))].sort() })
    }
  }
  return { graph: g, demoted }
}

export type GradedDemotion = { cell: string; files: string[]; grade: DriftGrade }

/**
 * Graded auto-demotion (INV-H1-2): per (domain, 5) β cell, the WORST grade among its
 * drifted nodes decides the route — "gone" reverts to "source" (loud, real loss); "structural"
 * suspends (blocks projection, keeps flip provenance, awaits reconcile); "lexical"/"fresh"
 * never touch authority (formatter noise stops demoting cells). `nodeGrades` is expected to
 * hold ONLY non-fresh grades (mirrors computeNodeStale's convention) — a fresh node simply
 * isn't in the map. Only currently-"graph" cells are considered; "suspended" cells are not
 * re-graded here (they leave via reconcileSuspended/expireSuspended instead).
 */
export function demoteGraded(
  graph: Graph,
  nodeGrades: ReadonlyMap<string, DriftGrade>,
): { graph: Graph; demoted: GradedDemotion[] } {
  const demoted: GradedDemotion[] = []
  let g = graph
  for (const [key, auth] of Object.entries(graph.authority ?? {})) {
    if (auth !== "graph") continue
    const cut = key.lastIndexOf(":")
    if (cut <= 0) continue // malformed key — skip, no guessing
    const domain = key.slice(0, cut)
    const level = key.slice(cut + 1)
    if (!/^\d+$/.test(level)) continue
    if (Number(level) !== 5) continue

    let worst: DriftGrade = "fresh"
    const files: string[] = []
    for (const n of graph.nodes) {
      if (n.domain !== domain) continue
      const grade = nodeGrades.get(n.id)
      if (!grade) continue
      files.push(n.file)
      if (gradeSeverity(grade) > gradeSeverity(worst)) worst = grade
    }
    if (worst === "fresh" || worst === "lexical" || worst === "renamed") continue // no authority transition — INV-H1-2

    const next: Authority = worst === "gone" ? "source" : "suspended"
    g = setAuthority(g, key, next)
    demoted.push({ cell: key, files: [...new Set(files)].sort(), grade: worst })
  }
  return { graph: g, demoted }
}

// ── reconcile fast-path (suspended → graph | suspended → source) ──────────────
// Mirrors canFlip's style: pure, judged, named reasons. The tool/UI computes the boolean
// check inputs (single-diff reconcile pass, human/timeout decision) — this only decides.

export type ReconcileChecks = { singleDiffOk: boolean }

/** suspended → graph fast-path gate: green iff the single-diff reconcile check passes. */
export function canReconcile(checks: ReconcileChecks): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (!checks.singleDiffOk) reasons.push("reconcile check failed — not a single isolated diff, needs human review")
  return { ok: reasons.length === 0, reasons }
}

/** Applies suspended → graph when canReconcile is green; otherwise the cell stays suspended. */
export function reconcileSuspended(
  graph: Graph,
  key: string,
  checks: ReconcileChecks,
): { graph: Graph; ok: boolean; reasons: string[] } {
  const { ok, reasons } = canReconcile(checks)
  if (!ok) return { graph, ok, reasons }
  return { graph: setAuthority(graph, key, "graph"), ok, reasons }
}

/** suspended → source: human call or reconcile timeout. Boolean input, no judgment beyond it. */
export function expireSuspended(graph: Graph, key: string, expire: boolean): Graph {
  if (!expire) return graph
  return setAuthority(graph, key, "source")
}
