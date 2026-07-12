/**
 * project.ts — projection admission core (graph → code, v1). Deterministic:
 * the agent proposes file contents; this module decides. Mirrors the ascent
 * gate inverted — an intent is realized iff every code-level leaf derived from
 * it lands its anchor VERBATIM in the proposed source (floorStatus semantics),
 * and the whole ladder stays structurally sound (roundtrip).
 */
import { CODE_LEVEL } from "./ascent"
import type { ClaimRecord } from "./claim-store"
import { excerptCheck } from "./extract"
import { roundtripScoped } from "./roundtrip"

export type IntentLeaf = { id: string; file: string; anchor: string }

/**
 * Walk the descent DAG downward from `intentId`. Descent claims' `refs` point UP
 * (derives_from), so children are claims whose refs land in the collected set.
 */
export function collectLeaves(
  intentId: string,
  claims: readonly ClaimRecord[],
): { leaves: IntentLeaf[]; gaps: string[] } {
  const collected = new Set([intentId])
  let grew = true
  while (grew) {
    grew = false
    for (const c of claims) {
      if (!collected.has(c.id) && c.refs.some((r) => collected.has(r))) {
        collected.add(c.id)
        grew = true
      }
    }
  }
  const leaves: IntentLeaf[] = []
  const gaps: string[] = []
  for (const c of claims) {
    if (!collected.has(c.id) || c.id === intentId) continue
    if ((c.level ?? CODE_LEVEL) === CODE_LEVEL) {
      if (c.file) leaves.push({ id: c.id, file: c.file, anchor: c.anchor })
      else gaps.push(`${c.id}: code-level claim without a target file`)
    }
  }
  if (leaves.length === 0) gaps.push(`no code-level leaves derived from ${intentId} — expand first`)
  return { leaves, gaps }
}

export type AdmissionResult = { admitted: boolean; failures: string[] }

/**
 * The roundtrip gate (spec §3): reject naming which intent node the code failed to realize.
 *
 * The ladder-integrity check is SCOPED to the connected component of `intentId` (roundtripScoped),
 * not the whole claim store: an orphaned/broken claim in an unrelated, abandoned domain must not
 * block a projection it has nothing to do with (blind spot 2.1 — global roundtrip converted local
 * mess into repo-wide paralysis). Whole-store integrity remains a separate CI-boundary check
 * (graphverify --global), never an inline admission blocker.
 */
export function admitProjection(
  leaves: readonly IntentLeaf[],
  readFile: (f: string) => string | undefined,
  claims: readonly ClaimRecord[],
  intentId: string,
): AdmissionResult {
  const failures: string[] = []
  for (const l of leaves) {
    const content = readFile(l.file)
    if (content === undefined) failures.push(`${l.id}: proposed set missing file ${l.file}`)
    else if (!excerptCheck(content, l.anchor)) failures.push(`${l.id}: anchor not realized in ${l.file}`)
  }
  const rt = roundtripScoped(claims, intentId)
  if (!rt.ok) failures.push(...rt.violations.map((v) => `${v.id}: ${v.kind} — ${v.detail}`))
  return { admitted: failures.length === 0, failures }
}
