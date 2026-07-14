/**
 * sweeper.ts — dois setInterval (padrão Fase 1, sem Effect), intervalos overridáveis p/ teste:
 *  - TTL sweeper (default 60s): varre locks expirados; o changeset vira 'aborted' reason 'ttl_expired',
 *    locks liberados, broadcast changeset.aborted + lock.released (spec §4.2).
 *  - Agregador de deltas (default 100ms): emite `changeset.delta` com SÓ o count acumulado por janela
 *    (não por lance, spec §6), e zera o contador.
 */
import { write } from "./db"
import { abortedPayload, appendEvent, pushEnvelope, type EventEnvelope, type ServerState } from "./state"
import { sweepPresence } from "./tools/presence"
import { sweepTyping } from "./tools/typing"

const now = () => new Date().toISOString()

export function sweepTtl(state: ServerState): void {
  const expired = state.db.query("SELECT DISTINCT tenant_id, cs_id FROM locks WHERE expires_at < ?").all(now()) as { tenant_id: string; cs_id: string }[]
  for (const { tenant_id: tenant, cs_id: csId } of expired) {
    const envs: EventEnvelope[] = []
    const tx = state.db.transaction(() => {
      const cs = state.db.query("SELECT id, intent, status, opened_by, opened_at, blast_cells FROM changesets WHERE tenant_id = ? AND id = ?").get(tenant, csId) as
        | { id: string; intent: string; status: string; opened_by: string; opened_at: string; blast_cells: string }
        | null
      if (!cs || cs.status !== "open") {
        state.db.query("DELETE FROM locks WHERE tenant_id = ? AND cs_id = ?").run(tenant, csId)
        return
      }
      const cells: string[] = JSON.parse(cs.blast_cells ?? "[]")
      write(state.db, state.stateDir, tenant, "changesets", { tenant_id: tenant, id: cs.id, intent: cs.intent, parent: null, status: "aborted", opened_by: cs.opened_by, opened_at: cs.opened_at, closed_at: now(), base_seq: null, admit_seq: null, blast_cells: cs.blast_cells })
      const held = (state.db.query("SELECT cell FROM locks WHERE tenant_id = ? AND cs_id = ?").all(tenant, csId) as { cell: string }[]).map((r) => r.cell)
      state.db.query("DELETE FROM locks WHERE tenant_id = ? AND cs_id = ?").run(tenant, csId)
      // abortedPayload carrega byUser (holder) — crítico no TTL expiry: o router de afinidade roteia
      // por ele e o holder precisa saber que perdeu o turno mesmo sem filtro que case.
      envs.push(appendEvent(state, tenant, { kind: "changeset.aborted", targetKind: "changeset", targetId: cs.id, byUser: cs.opened_by, payload: abortedPayload(cs, "ttl_expired", cells) }, { defer: true }))
      for (const cell of held) envs.push(appendEvent(state, tenant, { kind: "lock.released", targetKind: "cell", targetId: cell, byUser: cs.opened_by, payload: { cell, csId: cs.id, reason: "ttl_expired" } }, { defer: true }))
      state.deltaCounts.delete(csId)
    })
    tx()
    for (const e of envs) pushEnvelope(state, tenant, e)
  }
}

export function flushDeltas(state: ServerState): void {
  for (const [csId, agg] of [...state.deltaCounts.entries()]) {
    state.deltaCounts.delete(csId)
    if (agg.count <= 0) continue
    // `cells` acompanha o payload só p/ o roteamento por subscription affinity (§6 "delta p/ cs abertos em X");
    // o dado de interesse do cliente segue sendo só o count agregado da janela.
    const row = state.db.query("SELECT blast_cells FROM changesets WHERE tenant_id = ? AND id = ?").get(agg.tenant, csId) as { blast_cells: string } | null
    const cells = row ? JSON.parse(row.blast_cells ?? "[]") : []
    appendEvent(state, agg.tenant, { kind: "changeset.delta", targetKind: "changeset", targetId: csId, byUser: agg.byUser, payload: { csId, delta_count_since_last: agg.count, byUser: agg.byUser, cells } })
  }
}

export function startSweeper(
  state: ServerState,
  opts: { sweepIntervalMs?: number; aggIntervalMs?: number; presenceSweepIntervalMs?: number; typingIntervalMs?: number } = {},
): () => void {
  const ttl = setInterval(() => {
    try {
      sweepTtl(state)
    } catch {
      /* um ciclo que falha não derruba o loop */
    }
  }, opts.sweepIntervalMs ?? 60_000)
  const agg = setInterval(() => {
    try {
      flushDeltas(state)
    } catch {
      /* idem */
    }
  }, opts.aggIntervalMs ?? 100)
  // Cadência mais curta que o TTL padrão (60s) — bate ~15s, alinhado ao heartbeat de cliente (spec §4).
  const presence = setInterval(() => {
    try {
      sweepPresence(state)
    } catch {
      /* idem */
    }
  }, opts.presenceSweepIntervalMs ?? 15_000)
  // Fase 3 §5.1: scan de "digitando" — default 500ms, configurável p/ teste.
  const typing = setInterval(() => {
    try {
      sweepTyping(state)
    } catch {
      /* idem */
    }
  }, opts.typingIntervalMs ?? 500)
  return () => {
    clearInterval(ttl)
    clearInterval(agg)
    clearInterval(presence)
    clearInterval(typing)
  }
}
