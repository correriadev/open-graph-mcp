/**
 * gates.ts — funções PURAS de gate, herdando os módulos determinísticos do graph-core. Operam sobre
 * SNAPSHOTS lidos pelo chamador (nunca tocam SQLite/fs por conta própria além do `readFile` injetado),
 * então rodam idênticas dentro ou fora da transação (INV-1/INV-2). Nada de estado mutável compartilhado.
 *
 * Incremental (§5.2): rápido, por `changeset.claim` — structure + anchor + scope + quick roundtrip local.
 * Final (§5.3): no commit — roundtripScoped AGREGADO por claim-raiz nova (regra 6) + coverage/verify das
 * células β + canFlip por authority.flip. Coverage e verify gateiam só células β (graph=verdade); célula α
 * (código=verdade) recebe claim.add aditivo sem exigir cobertura fechada — ver README/relatório.
 */
import { roundtripScoped, type RoundtripClaim, type RoundtripViolation } from "@open-graph-mcp/graph-core/roundtrip"
import { verifyIntegrity } from "@open-graph-mcp/graph-core/verify"
import { claimCoverage } from "@open-graph-mcp/graph-core/claim-store"
import { canFlip } from "@open-graph-mcp/graph-core/authority"
import { excerptCheck } from "@open-graph-mcp/graph-core/extract"
import { normalizeClaimLevel, type CanonicalClaimLevel } from "./claim-level"

export type ClaimSnapshot = { id: string; subject?: string; domain?: string; level?: CanonicalClaimLevel; refs: string[]; anchor?: string; file?: string }
export type NodeSnapshot = { id: string; domain: string | null; level: number; file: string; anchor: string }
export type Delta = { kind: "claim.add" | "authority.flip"; payload: any }

export const cellOfClaim = (c: { domain?: string | null; level?: number }): string => `${c.domain ?? "?"}:${c.level ?? 5}`
const canonicalCell = (cell: string): string => {
  const cut = cell.lastIndexOf(":")
  return cut < 0 ? cell : `${cell.slice(0, cut)}:${cell.slice(cut + 1).replace(/^P/, "")}`
}
const toRoundtrip = (c: ClaimSnapshot): RoundtripClaim => ({ id: c.id, level: c.level, refs: c.refs ?? [] })

/** Nós da célula "domain:level" (level numérico) — level do nó é "P<n>" no grafo. */
function nodesOfCell(nodes: readonly NodeSnapshot[], cell: string): NodeSnapshot[] {
  const cut = cell.lastIndexOf(":")
  const domain = cell.slice(0, cut)
  const level = cell.slice(cut + 1)
  return nodes.filter((n) => n.domain === domain && String(n.level).replace(/^P/, "") === level)
}
function claimsOfCell(claims: readonly ClaimSnapshot[], cell: string): ClaimSnapshot[] {
  return claims.filter((c) => cellOfClaim(c) === cell)
}

export type IncrementalCtx = {
  lockedCells: string[]
  existingClaims: ClaimSnapshot[]
  readFile: (f: string) => string | undefined
}

export type IncrementalResult = { reasons: string[]; warnings: string[] }

/**
 * Gate incremental (§5.2). BLOQUEIA em structure/scope/anchor; o quick roundtrip é ADVISORY ("avisa
 * dangling cedo" — spec §5.2): vira `warnings`, não `reasons`. O bloqueio duro de integridade da escada
 * é o gate final no commit (§5.3), onde o conjunto inteiro é validado atomicamente.
 */
export function incrementalGate(delta: Delta, ctx: IncrementalCtx): IncrementalResult {
  const reasons: string[] = []
  const warnings: string[] = []
  if (delta.kind === "authority.flip") {
    const cell = delta.payload?.cell
    if (typeof cell !== "string" || !cell.includes(":")) reasons.push("authority.flip: invalid cell")
    else if (!ctx.lockedCells.includes(cell)) reasons.push(`authority.flip out of turn scope: ${cell} not locked by this changeset`)
    return { reasons, warnings }
  }
  // claim.add — refs pode ser vazio (claim-raiz no extremo da escada); o roundtrip valida a integridade.
  const c = delta.payload as ClaimSnapshot
  if (!c || !c.id || !c.subject || !c.domain) {
    reasons.push("claim.add: missing required fields (id/subject/domain)")
    return { reasons, warnings }
  }
  if (!normalizeClaimLevel(c.level).ok || typeof c.level !== "number") {
    reasons.push("claim.add: invalid level")
    return { reasons, warnings }
  }
  c.refs = c.refs ?? []
  const cell = cellOfClaim(c)
  if (!ctx.lockedCells.some((locked) => canonicalCell(locked) === cell)) reasons.push(`claim out of turn scope: ${cell} not locked by this changeset`)
  // anchor check (BLOQUEIA): âncora declarada + arquivo-chão legível → tem que existir verbatim.
  if (c.anchor && c.file) {
    const content = ctx.readFile(c.file)
    if (content === undefined || !excerptCheck(content, c.anchor)) reasons.push(`anchor not found verbatim in ${c.file}`)
  }
  // quick roundtrip local (ADVISORY): nova claim + solera existente, escopo na raiz nova.
  const set = [...ctx.existingClaims.map(toRoundtrip), toRoundtrip(c)]
  for (const v of roundtripScoped(set, c.id).violations) warnings.push(`roundtrip ${v.kind}: ${v.detail}`)
  return { reasons, warnings }
}

export type FinalCtx = {
  existingClaims: ClaimSnapshot[]
  nodes: NodeSnapshot[]
  authorityOf: (cell: string) => "source" | "graph" | "suspended"
  readFile: (f: string) => string | undefined
}

export type FinalResult = { ok: boolean; reasons: string[] }

/** Gate final (§5.3), puro sobre snapshots. */
export function finalGate(deltas: Delta[], ctx: FinalCtx): FinalResult {
  const reasons: string[] = []
  const newClaims = deltas.filter((d) => d.kind === "claim.add").map((d) => d.payload as ClaimSnapshot)
  if (newClaims.some((claim) => !normalizeClaimLevel(claim.level).ok || typeof claim.level !== "number")) {
    return { ok: false, reasons: ["claim.add: invalid level"] }
  }
  const flips = deltas.filter((d) => d.kind === "authority.flip").map((d) => d.payload as { cell: string; to: string })
  const allClaims: ClaimSnapshot[] = [...ctx.existingClaims, ...newClaims]
  const rtSet = allClaims.map(toRoundtrip)

  // 1. roundtripScoped AGREGADO: uma vez por claim-raiz nova, viola dedupada (regra 6).
  const seen = new Set<string>()
  const agg: RoundtripViolation[] = []
  for (const nc of newClaims) {
    for (const v of roundtripScoped(rtSet, nc.id).violations) {
      const key = `${v.id}|${v.kind}|${v.detail}`
      if (!seen.has(key)) {
        seen.add(key)
        agg.push(v)
      }
    }
  }
  for (const v of agg) reasons.push(`roundtrip ${v.kind} @${v.id}: ${v.detail}`)

  // 2/3. células β afetadas: coverage balanced + verify integrity.
  const affected = new Set<string>()
  for (const nc of newClaims) affected.add(cellOfClaim(nc))
  for (const f of flips) affected.add(f.cell)

  const cellChecks = new Map<string, { coverageBalanced: boolean; verifyClean: boolean; roundtripOk: boolean }>()
  const flipCells = new Set(flips.map((f) => f.cell))
  for (const cell of affected) {
    const meta = nodesOfCell(ctx.nodes, cell).map((n) => ({ id: n.id, file: n.file, kind: "Node", responsibility: n.id, exposed: false, deps: [], anchor: n.anchor }))
    const cellClaims = claimsOfCell(allClaims, cell).map((c) => ({ id: c.id, subject: c.subject ?? c.id, domain: c.domain ?? "", refs: c.refs, anchor: c.anchor ?? "" }))
    const coverage = claimCoverage(meta as any, cellClaims as any)
    const verify = verifyIntegrity(meta as any, cellClaims as any, ctx.readFile)
    const rootOk = cellClaims.every((c) => roundtripScoped(rtSet, c.id).ok)
    cellChecks.set(cell, { coverageBalanced: coverage.balanced, verifyClean: verify.clean, roundtripOk: rootOk })

    const isBeta = ctx.authorityOf(cell) === "graph" || flipCells.has(cell)
    if (isBeta) {
      if (!coverage.balanced) reasons.push(`coverage not balanced in β cell ${cell}: ${coverage.missing.length} node(s) without claims`)
      if (!verify.clean) for (const b of verify.breaches) reasons.push(`verify ${b.kind} @${b.id} in ${cell}: ${b.detail}`)
    }
  }

  // 4. canFlip por authority.flip → graph.
  for (const f of flips) {
    if (f.to !== "graph") continue
    const checks = cellChecks.get(f.cell) ?? { coverageBalanced: false, verifyClean: false, roundtripOk: false }
    const flip = canFlip(checks)
    if (!flip.ok) for (const r of flip.reasons) reasons.push(`authority.flip ${f.cell}: ${r}`)
  }

  return { ok: reasons.length === 0, reasons }
}
