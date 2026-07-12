/**
 * ascent.ts — gate de SUBIDA governada (código → ideação). Fecha o paradigma bidirecional.
 * Reconstrói UM nível acima por vez; a mesma regra de âncora universal vale: uma abstração
 * reconstruída só é admitida se ancorada no CHÃO (nível abaixo). Afirmar além = hard-block
 * CONTRADIZ-CODIGO-ABAIXO (não bypassável, nem por política). Espelha _gate_core/ascent.py da POC,
 * mas o hard-block é COMPUTADO deterministicamente (âncora não-verbatim), não veredito LLM.
 *
 * Níveis: 5=código … 0=ideação. Subir = nº decresce. Determinístico, sem LLM (a LLM propõe; o gate decide).
 */
import { excerptCheck } from "./extract"

export const LEVELS = ["ideação", "concepção", "arquitetura", "cenários", "testes", "código"] as const
export const CODE_LEVEL = 5
export const levelName = (n: number) => LEVELS[n] ?? `nível ${n}`

export type AscentClaim = {
  id: string
  subject: string
  domain: string
  level: number // nível reconstruído (= floorLevel - 1)
  refs: string[] // ids no chão (nível abaixo): meta nodes ou claims já admitidos
  anchor: string // linha verbatim de um arquivo-chão de um dos refs
}

export type Admitted = AscentClaim & { status: "pending-verification"; file: string }
export type Blocked = { id: string; cause: "CONTRADIZ-CODIGO-ABAIXO" | "dangling-ref"; detail: string }

export type AscentDecision = {
  allowed: boolean
  level: number
  policy: string
  admitted: number
  blocked: number
  reason: string
}

export type AscentResult = { admitted: Admitted[]; blocked: Blocked[]; decision: AscentDecision }

export const POLICIES = ["provisional", "strict", "force"] as const
export type Policy = (typeof POLICIES)[number]

/**
 * Gate de subida. `fileOf(id)` resolve um ref do chão pro seu arquivo-fonte (nodes têm file;
 * claims admitidos também). `readFile` lê o conteúdo. Hard-block (âncora não ancora no chão)
 * NUNCA é admitido, em qualquer política — garantia CA-8.
 */
export function ascentGate(
  reconstructed: readonly AscentClaim[],
  fileOf: (id: string) => string | undefined,
  readFile: (f: string) => string | undefined,
  policy: Policy = "provisional",
): AscentResult {
  if (!POLICIES.includes(policy)) throw new Error(`unknown policy: ${policy} (use ${POLICIES.join("|")})`)
  const admitted: Admitted[] = []
  const blocked: Blocked[] = []
  const level = reconstructed.length ? reconstructed[0].level : NaN

  for (const rc of reconstructed) {
    const unknown = rc.refs.filter((r) => !fileOf(r))
    if (unknown.length) {
      blocked.push({ id: rc.id, cause: "dangling-ref", detail: `refs not in floor: ${unknown.join(", ")}` })
      continue
    }
    // grounding: âncora verbatim em algum arquivo-chão de um ref
    let groundFile: string | undefined
    for (const r of rc.refs) {
      const f = fileOf(r)
      const content = f ? readFile(f) : undefined
      if (content !== undefined && excerptCheck(content, rc.anchor)) {
        groundFile = f
        break
      }
    }
    if (!groundFile) {
      // afirma além do que o chão sustenta — hard-block, nunca admitido
      blocked.push({ id: rc.id, cause: "CONTRADIZ-CODIGO-ABAIXO", detail: "anchor not verbatim in any floor ref" })
      continue
    }
    admitted.push({ ...rc, status: "pending-verification", file: groundFile })
  }

  // política decide se o NÍVEL fecha; hard-block já tirou os incoerentes do admitted (CA-8)
  const hardBlocks = blocked.filter((b) => b.cause === "CONTRADIZ-CODIGO-ABAIXO").length
  let allowed: boolean
  let reason: string
  if (hardBlocks > 0 && policy !== "force") {
    allowed = false
    reason = `${hardBlocks} CONTRADIZ-CODIGO-ABAIXO — incoherent; not bypassable`
  } else if (policy === "strict") {
    allowed = blocked.length === 0
    reason = allowed ? "all reconstructed claims grounded" : "blocked claims present (strict)"
  } else {
    allowed = true
    reason = policy === "force" ? "force: ascends (hard-blocks still never admitted)" : "ascends; admitted born pending-verification"
  }

  return {
    admitted,
    blocked,
    decision: { allowed, level, policy, admitted: admitted.length, blocked: blocked.length, reason },
  }
}

/** Nível-topo atual = menor `level` presente (meta-claims sem level = código=5). */
export function topLevel(claims: readonly { level?: number }[]): number {
  let top = CODE_LEVEL
  for (const c of claims) top = Math.min(top, c.level ?? CODE_LEVEL)
  return top
}
