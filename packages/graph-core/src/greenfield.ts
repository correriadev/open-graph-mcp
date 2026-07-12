/**
 * greenfield.ts — subida governada SEM chão de código (ideação/concepção/arquitetura antes do
 * nível 5). Brownfield ancora âncoras verbatim num arquivo-chão; greenfield não tem arquivo abaixo
 * do topo, então a regra GENERALIZA: uma claim reconstruída ancora no TEXTO da claim-pai (nível
 * abaixo), não num arquivo. Mesma regra universal de âncora, um nível acima — implementada
 * reusando `ascentGate` (não modificado) via adapters `fileOf`/`readFile` que resolvem um ref pra
 * um handle sintético "claim:<id>" e esse handle pro texto da claim-pai.
 *
 * Aceitação greenfield (INV-H4-3): ascent(project(intent)) reproduz intent — ponto fixo mecânico,
 * verificado por `isFixedPoint`, não por julgamento de LLM.
 */
import { ascentGate, type AscentClaim, type AscentResult, type Policy } from "./ascent"
import type { ClaimRecord } from "./claim-store"

const CLAIM_HANDLE_PREFIX = "claim:"

const claimHandle = (id: string): string => `${CLAIM_HANDLE_PREFIX}${id}`

/**
 * Texto-chão de uma claim-pai: subject + qualquer campo de corpo/responsabilidade disponível
 * (ClaimRecord não tipa esses campos extras — greenfield claims podem carregá-los à parte).
 */
function parentClaimText(claim: ClaimRecord): string {
  const extra = (claim as Record<string, unknown>)["responsibility"] ?? (claim as Record<string, unknown>)["body"]
  return extra ? `${claim.subject} ${String(extra)}` : claim.subject
}

/**
 * Gate de subida greenfield: `reconstructed` ancora na claim-pai (um nível abaixo), resolvida por
 * `parentClaimsById`. Sem parent na tabela => dangling-ref (mesma semântica de `ascentGate`).
 * Âncora que não aparece verbatim no texto da claim-pai => hard-block CONTRADIZ-CODIGO-ABAIXO,
 * idêntico ao brownfield — a regra universal de âncora não muda, só a fonte do chão.
 */
export function greenfieldAscent(
  reconstructed: readonly AscentClaim[],
  parentClaimsById: ReadonlyMap<string, ClaimRecord>,
  policy?: Policy,
): AscentResult {
  const fileOf = (id: string): string | undefined => (parentClaimsById.has(id) ? claimHandle(id) : undefined)
  const readFile = (handle: string): string | undefined => {
    if (!handle.startsWith(CLAIM_HANDLE_PREFIX)) return undefined
    const claim = parentClaimsById.get(handle.slice(CLAIM_HANDLE_PREFIX.length))
    return claim ? parentClaimText(claim) : undefined
  }
  return policy === undefined ? ascentGate(reconstructed, fileOf, readFile) : ascentGate(reconstructed, fileOf, readFile, policy)
}

export type FixedPointCheck = { ok: boolean; missing: string[]; extra: string[] }

/** Identidade canônica de uma claim pro roundtrip: id + subject (não usa refs/anchor/level). */
const claimIdentity = (c: { id: string; subject: string }): string => `${c.id}:${c.subject}`

/**
 * Ponto fixo greenfield (INV-H4-3): o conjunto de claims de `intentClaims` deve igualar o que
 * `roundtrippedClaims` (ascent(project(intent))) reproduz. Comparação de conjuntos determinística,
 * por identidade canônica ordenada — não depende da ordem de entrada.
 */
export function isFixedPoint(
  intentClaims: readonly { id: string; subject: string }[],
  roundtrippedClaims: readonly { id: string; subject: string }[],
): FixedPointCheck {
  const intentSet = new Set(intentClaims.map(claimIdentity))
  const roundtrippedSet = new Set(roundtrippedClaims.map(claimIdentity))
  const missing = [...intentSet].filter((k) => !roundtrippedSet.has(k)).sort()
  const extra = [...roundtrippedSet].filter((k) => !intentSet.has(k)).sort()
  return { ok: missing.length === 0 && extra.length === 0, missing, extra }
}

export type GreenfieldReport = { ascent: AscentResult; fixedPoint: FixedPointCheck; ok: boolean }

/**
 * Veredito único de aceitação greenfield: combina o gate de subida (`greenfieldAscent`) com o
 * ponto fixo (`isFixedPoint`). Composição pura — nenhuma lógica nova, nenhum I/O, nenhuma LLM.
 */
export function greenfieldReport(
  reconstructed: readonly AscentClaim[],
  parentClaimsById: ReadonlyMap<string, ClaimRecord>,
  intentClaims: readonly { id: string; subject: string }[],
  roundtrippedClaims: readonly { id: string; subject: string }[],
  policy?: Policy,
): GreenfieldReport {
  const ascent = greenfieldAscent(reconstructed, parentClaimsById, policy)
  const fixedPoint = isFixedPoint(intentClaims, roundtrippedClaims)
  return { ascent, fixedPoint, ok: ascent.decision.allowed && fixedPoint.ok }
}
