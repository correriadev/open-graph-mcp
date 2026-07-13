/**
 * changeset.ts — turno vivo: open/claim/commit/abort/extend/list_mine (contrato fixo do cliente web).
 *
 * INV-2: TODA mutação roda dentro de UMA transação SQLite 100% SÍNCRONA — zero await entre a leitura do
 * snapshot e a escritura. Os gates (gates.ts) são funções puras sobre o snapshot lido dentro da transação.
 * Os eventos são gravados dentro da transação (defer) e só difundidos ao SSE DEPOIS que ela retorna.
 *
 * Lock pessimista por célula β/nova, multi-cell atômico (§4.3): qualquer cell trancada alheia → nada tranca.
 * lock.denied NÃO vai ao SSE (só auditoria na tabela events, spec §6); notificação ao holder é Fase 3.
 */
import { createHash } from "node:crypto"
import { write } from "../db"
import { appendEvent, pushEnvelope, tenantGraph, type EventEnvelope, type ServerState } from "../state"
import { requireToken } from "./session"
import { touchDelta } from "./typing"
import { readClaims, readNodes, authorityOf, makeReadFile, writeClaim, writeAuthority, maxClaimSeq } from "../store"
import { incrementalGate, finalGate, cellOfClaim, type Delta } from "../gates"

const now = () => new Date().toISOString()
const nowMs = () => Date.now()

type CsRow = {
  id: string
  intent: string
  status: string
  opened_by: string
  opened_at: string
  blast_cells: string
  admit_seq: number | null
}

function loadCs(state: ServerState, tenant: string, csId: string): CsRow | null {
  return (state.db.query("SELECT id, intent, status, opened_by, opened_at, blast_cells, admit_seq FROM changesets WHERE tenant_id = ? AND id = ?").get(tenant, csId) as CsRow) ?? null
}

function lockedCells(state: ServerState, tenant: string, csId: string): string[] {
  return (state.db.query("SELECT cell FROM locks WHERE tenant_id = ? AND cs_id = ?").all(tenant, csId) as { cell: string }[]).map((r) => r.cell)
}

function releaseLocks(state: ServerState, tenant: string, csId: string): string[] {
  const cells = lockedCells(state, tenant, csId)
  state.db.query("DELETE FROM locks WHERE tenant_id = ? AND cs_id = ?").run(tenant, csId)
  return cells
}

/** Executa uma mutação numa transação síncrona e difunde os eventos coletados DEPOIS de commitar. */
function inTx<T extends { __tenant?: string }>(state: ServerState, fn: (envs: EventEnvelope[]) => T): T {
  const envs: EventEnvelope[] = []
  const tx = state.db.transaction(() => fn(envs))
  const result = tx() as T
  const tenant = result.__tenant ?? ""
  for (const e of envs) pushEnvelope(state, tenant, e)
  delete result.__tenant
  return result
}

// ── open ──────────────────────────────────────────────────────────────────────
export type OpenResult =
  | { ok: true; csId: string; expiresAt: string; __tenant?: string }
  | { ok: false; reason: "cell_locked"; cell: string; holder: string; csId: string; expiresAt: string; __tenant?: string }

export function changesetOpen(state: ServerState, args: { token: string; cells: string[]; intent: string }): OpenResult {
  const { userId, tenantId: tenant, name } = requireToken(state, args.token)
  const cells = Array.isArray(args.cells) ? [...new Set(args.cells)] : []
  const intent = args.intent ?? ""
  if (!cells.length) throw new Error("changeset.open: cells required")

  return inTx(state, (envs): OpenResult => {
    // Particiona: blocked (alheio) / mine (meu) / free.
    let mineCs: string | null = null
    for (const cell of cells) {
      const lock = state.db.query("SELECT cs_id, holder FROM locks WHERE tenant_id = ? AND cell = ?").get(tenant, cell) as { cs_id: string; holder: string } | null
      if (!lock) continue
      if (lock.holder !== userId) {
        // Fase 3 §6.1: lock.denied roteia SÓ p/ quem tentou (nunca broadcast) — o router de afinidade
        // (affinity.ts) restringe isto por userId; `defer` só adia o push p/ depois do commit da tx,
        // igual todo evento gravado aqui dentro (INV-2).
        envs.push(appendEvent(state, tenant, { kind: "lock.denied", targetKind: "cell", targetId: cell, byUser: userId, payload: { cell, attempted_by: userId, holder: lock.holder, csId: lock.cs_id } }, { defer: true }))
        const exp = (state.db.query("SELECT expires_at FROM locks WHERE tenant_id = ? AND cell = ?").get(tenant, cell) as { expires_at: string }).expires_at
        return { ok: false, reason: "cell_locked", cell, holder: lock.holder, csId: lock.cs_id, expiresAt: exp, __tenant: tenant }
      }
      if (mineCs && mineCs !== lock.cs_id) throw new Error("cells span multiple of your changesets; commit/abort first")
      mineCs = lock.cs_id
    }

    const expiresAt = new Date(nowMs() + state.ttlMs).toISOString()
    const acquiredAt = now()
    // reuse idempotente OU cria novo
    let csId = mineCs
    if (!csId) {
      const count = (state.db.query("SELECT COUNT(*) AS c FROM changesets WHERE tenant_id = ?").get(tenant) as { c: number }).c
      csId = "cs_" + createHash("sha256").update(`${tenant} ${intent} ${count + 1}`).digest("hex").slice(0, 16)
      const baseSeq = (state.db.query("SELECT COALESCE(MAX(seq),0) AS m FROM events WHERE tenant_id = ?").get(tenant) as { m: number }).m
      write(state.db, state.stateDir, tenant, "changesets", {
        tenant_id: tenant, id: csId, intent, parent: null, status: "open", opened_by: userId, opened_at: acquiredAt, closed_at: null, base_seq: baseSeq, admit_seq: null, blast_cells: JSON.stringify(cells.sort()),
      })
      envs.push(appendEvent(state, tenant, { kind: "changeset.opened", targetKind: "changeset", targetId: csId, byUser: userId, payload: { csId, intent, cells, byUser: userId, holder: name, openedAt: acquiredAt, expiresAt } }, { defer: true }))
    }

    // tranca as cells ainda livres sob csId
    for (const cell of cells) {
      const held = state.db.query("SELECT cs_id FROM locks WHERE tenant_id = ? AND cell = ?").get(tenant, cell)
      if (held) continue
      write(state.db, state.stateDir, tenant, "locks", { tenant_id: tenant, cell, cs_id: csId, mode: "pessimistic", acquired_at: acquiredAt, expires_at: expiresAt, holder: userId })
      envs.push(appendEvent(state, tenant, { kind: "lock.acquired", targetKind: "cell", targetId: cell, byUser: userId, payload: { cell, csId, holder: userId, expiresAt } }, { defer: true }))
    }

    return { ok: true, csId, expiresAt, __tenant: tenant }
  })
}

// ── claim ─────────────────────────────────────────────────────────────────────
export type ClaimResult = { ok: true; warnings: string[]; __tenant?: string } | { ok: false; reasons: string[]; __tenant?: string }

export function changesetClaim(state: ServerState, args: { token: string; csId: string; delta: Delta }): ClaimResult {
  const { userId, tenantId: tenant } = requireToken(state, args.token)
  // Fase 3 §5.1: TODA chamada de claim atualiza Presence.lastDeltaAt do user (mesmo se o gate rejeitar
  // depois) — é o sinal de "está mexendo", não um efeito colateral do sucesso da mutação.
  touchDelta(state, tenant, userId)
  return inTx(state, (): ClaimResult => {
    const cs = loadCs(state, tenant, args.csId)
    if (!cs || cs.status !== "open") return { ok: false, reasons: [`changeset ${args.csId} not open`], __tenant: tenant }
    if (cs.opened_by !== userId) return { ok: false, reasons: ["not the holder of this changeset"], __tenant: tenant }
    const delta = args.delta
    if (!delta || (delta.kind !== "claim.add" && delta.kind !== "authority.flip")) return { ok: false, reasons: ["unknown delta kind"], __tenant: tenant }

    const { reasons, warnings } = incrementalGate(delta, { lockedCells: lockedCells(state, tenant, args.csId), existingClaims: readClaims(state, tenant), readFile: makeReadFile(state) })
    if (reasons.length) return { ok: false, reasons, __tenant: tenant }

    const seq = (state.db.query("SELECT COALESCE(MAX(seq),0) AS m FROM cs_deltas WHERE tenant_id = ? AND cs_id = ?").get(tenant, args.csId) as { m: number }).m + 1
    write(state.db, state.stateDir, tenant, "cs_deltas", { tenant_id: tenant, cs_id: args.csId, seq, kind: delta.kind, payload: JSON.stringify(delta.payload), created_at: now() })

    const agg = state.deltaCounts.get(args.csId) ?? { count: 0, tenant, byUser: userId }
    agg.count++
    state.deltaCounts.set(args.csId, agg)
    return { ok: true, warnings, __tenant: tenant }
  })
}

// ── commit ────────────────────────────────────────────────────────────────────
export type CommitResult = { ok: true; admitSeq: number; __tenant?: string } | { ok: false; reasons: string[]; __tenant?: string }

export function changesetCommit(state: ServerState, args: { token: string; csId: string }): CommitResult {
  const { userId, tenantId: tenant } = requireToken(state, args.token)
  return inTx(state, (envs): CommitResult => {
    const cs = loadCs(state, tenant, args.csId)
    if (!cs || cs.status !== "open") return { ok: false, reasons: [`changeset ${args.csId} not open`], __tenant: tenant }
    if (cs.opened_by !== userId) return { ok: false, reasons: ["not the holder of this changeset"], __tenant: tenant }

    const deltas = (state.db.query("SELECT kind, payload FROM cs_deltas WHERE tenant_id = ? AND cs_id = ? ORDER BY seq").all(tenant, args.csId) as { kind: string; payload: string }[]).map(
      (d) => ({ kind: d.kind as Delta["kind"], payload: JSON.parse(d.payload) }),
    )
    const cells: string[] = JSON.parse(cs.blast_cells ?? "[]")
    const final = finalGate(deltas, { existingClaims: readClaims(state, tenant), nodes: readNodes(state, tenant), authorityOf: (c) => authorityOf(state, tenant, c), readFile: makeReadFile(state) })

    if (!final.ok) {
      // vermelho → rollback total: nenhum delta persiste como claim; changeset 'aborted' com reasons.
      write(state.db, state.stateDir, tenant, "changesets", { tenant_id: tenant, id: cs.id, intent: cs.intent, parent: null, status: "aborted", opened_by: cs.opened_by, opened_at: cs.opened_at, closed_at: now(), base_seq: null, admit_seq: null, blast_cells: cs.blast_cells })
      const released = releaseLocks(state, tenant, args.csId)
      // byUser NO PAYLOAD: o router de afinidade (affinity.ts) roteia changeset.aborted p/ o holder por
      // este campo — o EventInput.byUser vai só p/ a coluna de auditoria, não entra no envelope.
      envs.push(appendEvent(state, tenant, { kind: "changeset.aborted", targetKind: "changeset", targetId: cs.id, byUser: userId, payload: { csId: cs.id, reason: "rejected", cells, reasons: final.reasons, byUser: cs.opened_by } }, { defer: true }))
      for (const cell of released) envs.push(appendEvent(state, tenant, { kind: "lock.released", targetKind: "cell", targetId: cell, byUser: userId, payload: { cell, csId: cs.id, reason: "rejected" } }, { defer: true }))
      return { ok: false, reasons: final.reasons, __tenant: tenant }
    }

    // verde → admite atomicamente
    let claimSeq = maxClaimSeq(state, tenant)
    const tg = tenantGraph(state, tenant)
    for (const d of deltas) {
      if (d.kind === "claim.add") {
        writeClaim(state, tenant, ++claimSeq, d.payload)
        if (tg.graph) for (const n of tg.graph.nodes) if (d.payload.refs?.includes(n.id) && !n.claims.includes(d.payload.id)) n.claims.push(d.payload.id)
      }
    }
    const committed = appendEvent(state, tenant, { kind: "changeset.committed", targetKind: "changeset", targetId: cs.id, byUser: userId, payload: { csId: cs.id, cells, blastRadius: cells.length } }, { defer: true })
    const admitSeq = committed.seq
    ;(committed.payload as any).admitSeq = admitSeq
    envs.push(committed)

    for (const d of deltas) {
      if (d.kind === "authority.flip") {
        writeAuthority(state, tenant, d.payload.cell, d.payload.to, admitSeq, userId)
        if (tg.graph) tg.graph.authority = { ...(tg.graph.authority ?? {}), [d.payload.cell]: d.payload.to === "source" ? undefined : d.payload.to } as any
        envs.push(appendEvent(state, tenant, { kind: "authority.flipped", targetKind: "authority", targetId: d.payload.cell, byUser: userId, payload: { cell: d.payload.cell, byUser: userId, viaCsId: cs.id, to: d.payload.to } }, { defer: true }))
      }
    }

    write(state.db, state.stateDir, tenant, "changesets", { tenant_id: tenant, id: cs.id, intent: cs.intent, parent: null, status: "admitted", opened_by: cs.opened_by, opened_at: cs.opened_at, closed_at: now(), base_seq: null, admit_seq: admitSeq, blast_cells: cs.blast_cells })
    const released = releaseLocks(state, tenant, args.csId)
    for (const cell of released) envs.push(appendEvent(state, tenant, { kind: "lock.released", targetKind: "cell", targetId: cell, byUser: userId, payload: { cell, csId: cs.id, reason: "committed" } }, { defer: true }))
    state.deltaCounts.delete(args.csId)
    return { ok: true, admitSeq, __tenant: tenant }
  })
}

// ── abort / extend / list_mine ─────────────────────────────────────────────────
export function changesetAbort(state: ServerState, args: { token: string; csId: string }): { ok: boolean; __tenant?: string } {
  const { userId, tenantId: tenant } = requireToken(state, args.token)
  return inTx(state, (envs) => {
    const cs = loadCs(state, tenant, args.csId)
    if (!cs || cs.status !== "open") return { ok: false, __tenant: tenant }
    if (cs.opened_by !== userId) return { ok: false, __tenant: tenant }
    const cells: string[] = JSON.parse(cs.blast_cells ?? "[]")
    write(state.db, state.stateDir, tenant, "changesets", { tenant_id: tenant, id: cs.id, intent: cs.intent, parent: null, status: "aborted", opened_by: cs.opened_by, opened_at: cs.opened_at, closed_at: now(), base_seq: null, admit_seq: null, blast_cells: cs.blast_cells })
    const released = releaseLocks(state, tenant, args.csId)
    // byUser no payload p/ o router de afinidade rotear ao holder (mesmo padrão do commit rejeitado acima).
    envs.push(appendEvent(state, tenant, { kind: "changeset.aborted", targetKind: "changeset", targetId: cs.id, byUser: userId, payload: { csId: cs.id, reason: "user", cells, byUser: cs.opened_by } }, { defer: true }))
    for (const cell of released) envs.push(appendEvent(state, tenant, { kind: "lock.released", targetKind: "cell", targetId: cell, byUser: userId, payload: { cell, csId: cs.id, reason: "user" } }, { defer: true }))
    state.deltaCounts.delete(args.csId)
    return { ok: true, __tenant: tenant }
  })
}

export function changesetExtend(state: ServerState, args: { token: string; csId: string }): { ok: boolean; expiresAt?: string; __tenant?: string } {
  const { userId, tenantId: tenant } = requireToken(state, args.token)
  return inTx(state, () => {
    const cs = loadCs(state, tenant, args.csId)
    if (!cs || cs.status !== "open" || cs.opened_by !== userId) return { ok: false, __tenant: tenant }
    const expiresAt = new Date(nowMs() + state.ttlMs).toISOString()
    state.db.query("UPDATE locks SET expires_at = ? WHERE tenant_id = ? AND cs_id = ?").run(expiresAt, tenant, args.csId)
    return { ok: true, expiresAt, __tenant: tenant }
  })
}

export function changesetListMine(state: ServerState, args: { token: string }): { changesets: unknown[] } {
  const { userId, tenantId: tenant } = requireToken(state, args.token)
  const rows = state.db.query("SELECT id, intent, blast_cells, opened_at FROM changesets WHERE tenant_id = ? AND opened_by = ? AND status = 'open' ORDER BY opened_at").all(tenant, userId) as {
    id: string
    intent: string
    blast_cells: string
    opened_at: string
  }[]
  return {
    changesets: rows.map((r) => {
      const exp = state.db.query("SELECT MIN(expires_at) AS e FROM locks WHERE tenant_id = ? AND cs_id = ?").get(tenant, r.id) as { e: string | null }
      return { csId: r.id, intent: r.intent, cells: JSON.parse(r.blast_cells ?? "[]"), openedAt: r.opened_at, expiresAt: exp?.e ?? null }
    }),
  }
}
