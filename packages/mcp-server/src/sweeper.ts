/**
 * sweeper.ts — dois setInterval (padrão Fase 1, sem Effect), intervalos overridáveis p/ teste:
 *  - TTL sweeper (default 60s): varre locks expirados; o changeset vira 'aborted' reason 'ttl_expired',
 *    locks liberados, broadcast changeset.aborted + lock.released (spec §4.2).
 *  - Agregador de deltas (default 100ms): emite `changeset.delta` com SÓ o count acumulado por janela
 *    (não por lance, spec §6), e zera o contador.
 */
import { write } from "./db"
import { appendEvent, pushEnvelope, type EventEnvelope, type ServerState } from "./state"

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
      envs.push(appendEvent(state, tenant, { kind: "changeset.aborted", targetKind: "changeset", targetId: cs.id, byUser: cs.opened_by, payload: { csId: cs.id, reason: "ttl_expired", cells } }, { defer: true }))
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

export function startSweeper(state: ServerState, opts: { sweepIntervalMs?: number; aggIntervalMs?: number } = {}): () => void {
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
  return () => {
    clearInterval(ttl)
    clearInterval(agg)
  }
}
