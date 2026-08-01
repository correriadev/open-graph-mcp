/**
 * authority.ts — tool `authority.flip` (fecha gap Fase 2): flip de autoridade de uma cell
 * (code-authoritative "source" ↔ graph-authoritative "graph") num único round-trip de tool call.
 * Reaproveita open/claim/commit de changeset.ts por dentro, então o flip passa pelos MESMOS
 * gates/eventos/persistência (INV-2) de qualquer outra mutação: o delta vira `authority.flip` em
 * cs_deltas, o commit roda o gate final (canFlip p/ →graph) e grava `authority.flipped` no
 * SQLite `events` + espelho JSONL. Se qualquer etapa falhar, aborta o changeset efêmero (libera o
 * lock) e devolve as reasons — nada fica pendurado.
 */
import { changesetOpen, changesetClaim, changesetCommit, changesetAbort } from "./changeset"
import { requireToken } from "./session"
import type { ServerState } from "../state"

export type FlipResult = { ok: true; admitSeq: number; cell: string; to: "source" | "graph" } | { ok: false; reasons: string[] }

export function authorityFlip(state: ServerState, args: { token: string; cell: string; to: "source" | "graph" }): FlipResult {
  const cell = args.cell
  const to = args.to
  if (typeof cell !== "string" || !cell.includes(":")) return { ok: false, reasons: ["authority.flip: invalid cell"] }
  if (to !== "source" && to !== "graph") return { ok: false, reasons: [`authority.flip: invalid target "${to}" (must be "source" or "graph")`] }

  // Guarda de reuse: changesetOpen REUSA o changeset aberto do caller quando ele já tranca a cell.
  // Nesse caso o commit/abort do flip arrastaria os deltas/cells já staged desse changeset
  // pré-existente (commit forçado ou rollback total alheios ao flip). Recusa: o caller fecha o
  // turno dele (commit/abort) antes de flipar autoridade.
  const { userId, tenantId: tenant } = requireToken(state, args.token)
  const held = state.db.query("SELECT cs_id, holder FROM locks WHERE tenant_id = ? AND cell = ?").get(tenant, cell) as { cs_id: string; holder: string } | null
  if (held && held.holder === userId) {
    return { ok: false, reasons: [`cell ${cell} is locked by your open changeset ${held.cs_id}; commit or abort it before flipping authority`] }
  }

  const open = changesetOpen(state, { token: args.token, cells: [cell], intent: `authority.flip ${cell} -> ${to}` })
  if (!open.ok) return { ok: false, reasons: [`cell ${cell} locked by ${open.holder}`] }

  const claim = changesetClaim(state, { token: args.token, csId: open.csId, delta: { kind: "authority.flip", payload: { cell, to } } })
  if (!claim.ok) {
    changesetAbort(state, { token: args.token, csId: open.csId })
    return { ok: false, reasons: claim.reasons }
  }

  // Assimetria intencional com o branch de claim: quando o gate final reprova, changesetCommit já
  // se auto-aborta dentro da MESMA transação (cs 'aborted', locks liberados, eventos emitidos) —
  // chamar changesetAbort aqui seria no-op (status já não é 'open').
  // F1: commit agora exige intent — reusa o mesmo texto do open efêmero acima (não há um "intent do
  // usuário" separado aqui; authority.flip é uma mutação de um passo só, sem draft).
  const commit = changesetCommit(state, { token: args.token, csId: open.csId, intent: `authority.flip ${cell} -> ${to}` })
  if (!commit.ok) return { ok: false, reasons: commit.reasons }
  return { ok: true, admitSeq: commit.admitSeq, cell, to }
}
