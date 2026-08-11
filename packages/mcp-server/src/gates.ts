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
import { canonicalCell } from "./cell"

export type ClaimSnapshot = { id: string; subject?: string; domain?: string; level?: CanonicalClaimLevel; refs: string[]; covers?: string[]; anchor?: string; file?: string }
export type NodeSnapshot = { id: string; domain: string | null; level: number; file: string; anchor: string }
export type Delta = { kind: "claim.add" | "authority.flip"; payload: any }

export const cellOfClaim = (c: { domain?: string | null; level?: number }): string => `${c.domain ?? "?"}:${c.level ?? 5}`

/**
 * Raio de impacto REAL de um changeset: as células que os deltas de fato tocam (domínio:nível de
 * cada claim + cada célula de authority.flip), unidas às células declaradas no lock.
 *
 * Reimplementa `blastRadius` do `changeset-store.ts` vendorado (deletado: era file-based, sem
 * tenant/token/lock/transação — ver docs/CHANGELOG.md). A diferença é
 * que aquele operava sobre um Changeset em memória e este sobre os deltas persistidos.
 *
 * Por que importa: `blast_cells` é gravado UMA vez, na CRIAÇÃO do changeset, e nunca recalculado.
 * Um turno aberto pode ser EXPANDIDO — `changeset.open` com uma célula já trancada por mim mais
 * uma nova reusa o mesmo csId e tranca a nova (ver changesetOpen, caminho `mineCs`), mas não
 * reescreve `blast_cells`. O gate de escopo passa a aceitar claims na célula nova (ele lê a tabela
 * `locks`, não `blast_cells`), e o registro de auditoria fica subdeclarado: quem lê o histórico vê
 * menos células do que o changeset realmente tocou. Recalcular no commit fecha isso.
 *
 * NÃO é o caso de uma claim "fora do lock": essa o gate incremental bloqueia, para claim.add E para
 * authority.flip. A união com `declaredCells` existe porque uma célula pode ter sido trancada sem
 * receber delta nenhum — ela foi reservada, e isso é parte do raio revisável.
 */
export function blastRadius(deltas: readonly Delta[], declaredCells: readonly string[] = []): { cells: string[]; claimCount: number } {
  const cells = new Set<string>(declaredCells.map(canonicalCell))
  let claimCount = 0
  for (const d of deltas) {
    if (d.kind === "claim.add") {
      claimCount++
      cells.add(canonicalCell(cellOfClaim(d.payload)))
    } else if (d.kind === "authority.flip" && d.payload?.cell) {
      cells.add(canonicalCell(d.payload.cell))
    }
  }
  return { cells: [...cells].sort(), claimCount }
}
/**
 * Reexport da canonicalização de célula (F1/F7). A implementação mudou de casa para `./cell` — módulo
 * folha, sem imports — porque `db.ts` precisa dela na migração de boot e `db.ts -> gates.ts` seria
 * import para cima, reabrindo o risco de ciclo. Todo `import { canonicalCell } from "./gates"` que já
 * existia segue funcionando; continua havendo UMA implementação.
 */
export { canonicalCell } from "./cell"
const toRoundtrip = (c: ClaimSnapshot): RoundtripClaim => ({ id: c.id, level: c.level, refs: c.refs ?? [] })

/** Nós da célula "domain:level" (level numérico) — level do nó é "P<n>" no grafo.
 *  Exportado: node.editing/node.idle (changeset.ts/sweeper.ts) precisam listar os nós de uma
 *  célula trancada/destrancada pra projeção "em edição por X" no nível do nó (F1). */
export function nodesOfCell(nodes: readonly NodeSnapshot[], cell: string): NodeSnapshot[] {
  // Canonicaliza a CÉLULA (aceita "domain:P4" e "domain:4") antes de comparar — reusa o mesmo
  // canonicalCell usado por blastRadius/finalGate, pra não divergir de grafia. Sem isso, uma célula
  // escrita como "domain:P4" nunca batia com o nível do nó (já sem o "P") e devolvia [] em silêncio
  // (F1 no relatório de evidências: authority.flip aprovado sem cobertura nenhuma).
  const canon = canonicalCell(cell)
  const cut = canon.lastIndexOf(":")
  const domain = canon.slice(0, cut)
  const level = canon.slice(cut + 1)
  return nodes.filter((n) => n.domain === domain && String(n.level).replace(/^P/, "") === level)
}
/** Mesma canonicalização de `nodesOfCell`: `cellOfClaim` sempre produz "domain:<number>" (claims têm
 *  level numérico normalizado — normalizeClaimLevel), então um `cell` chamador escrito "domain:P4"
 *  (ex.: literal de authority.flip) nunca batia aqui por comparação de string crua. Sem isto, mesmo
 *  com o nó certo achado por `nodesOfCell`, a cobertura de um flip "domain:P4" via claims genuínas
 *  em "domain:4" ficava invisível (claimed=0), quebrando o caminho feliz na grafia com "P". */
function claimsOfCell(claims: readonly ClaimSnapshot[], cell: string): ClaimSnapshot[] {
  const canon = canonicalCell(cell)
  return claims.filter((c) => cellOfClaim(c) === canon)
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
    // Comparação CANÔNICA dos dois lados, igual o caminho de `claim.add` logo abaixo já fazia. Era o
    // único ponto do gate que ainda usava `includes` cru: com as travas agora canonicalizadas na
    // borda (F7), um flip pedido como "auth:P4" sobre um lock guardado como "auth:4" era recusado
    // como "out of turn scope" — o caller tinha a trava e ouvia que não tinha.
    else if (!ctx.lockedCells.some((locked) => canonicalCell(locked) === canonicalCell(cell)))
      reasons.push(`authority.flip out of turn scope: ${cell} not locked by this changeset`)
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
    const cellClaims = claimsOfCell(allClaims, cell).map((c) => ({ id: c.id, subject: c.subject ?? c.id, domain: c.domain ?? "", refs: c.refs, covers: c.covers, anchor: c.anchor ?? "" }))
    const coverage = claimCoverage(meta as any, cellClaims as any)
    // F8: `cellClaims` é O QUE se revisa (a célula); o universo de resolução de refs tem que ser
    // GLOBAL (`allClaims`, existentes + novas do changeset) — a escada exige nível adjacente, e
    // célula = (domínio, nível), então uma ref válida de meio-escada aponta pra OUTRA célula. Sem
    // o 4º parâmetro, toda claim de meio-escada "danglaria" por construção mesmo com a escada íntegra.
    const verify = verifyIntegrity(
      meta as any,
      cellClaims as any,
      ctx.readFile,
      new Set(allClaims.map((c) => c.id)),
    )
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
