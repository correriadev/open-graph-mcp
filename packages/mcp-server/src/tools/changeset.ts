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
import { durableTransaction, write } from "../db"
import { abortedPayload, appendEvent, pushEnvelope, tenantGraph, type EventEnvelope, type ServerState } from "../state"
import { requireToken } from "./session"
import { touchDelta } from "./typing"
import { readClaims, readNodes, authorityOf, makeReadFile, writeClaim, writeAuthority, maxClaimSeq, holderNameOf } from "../store"
import { incrementalGate, finalGate, cellOfClaim, blastRadius, nodesOfCell, type Delta } from "../gates"
import { normalizeClaimLevel } from "../claim-level"

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
  const graphs = structuredClone(state.graphs)
  const claimsCache = structuredClone(state.claimsCache)
  const deltaCounts = structuredClone(state.deltaCounts)
  let result: T
  try {
    result = durableTransaction(state.db, () => fn(envs)) as T
  } catch (error) {
    state.graphs = graphs
    state.claimsCache = claimsCache
    state.deltaCounts = deltaCounts
    throw error
  }
  const tenant = result.__tenant ?? ""
  for (const e of envs) pushEnvelope(state, tenant, e)
  delete result.__tenant
  return result
}

// ── open (explícito) / claim-or-open (implícito, F1) ────────────────────────────
export type OpenResult =
  | { ok: true; csId: string; expiresAt: string; __tenant?: string }
  | { ok: false; reason: "cell_locked"; cell: string; holder: string; csId: string; expiresAt: string; __tenant?: string }

/** Emite o par de projeção node.editing/node.idle (F1) ao lado do lock.acquired/lock.released de
 *  auditoria — este último NÃO some (afinidade/auditoria dependem dele); o par novo é só a leitura
 *  "amigável" por nó que a UI passa a mostrar em vez do vocabulário de lock. */
function emitNodeEditing(state: ServerState, tenant: string, envs: EventEnvelope[], cell: string, csId: string, byUser: string): void {
  const nodeIds = nodesOfCell(readNodes(state, tenant), cell).map((n) => n.id)
  envs.push(appendEvent(state, tenant, { kind: "node.editing", targetKind: "cell", targetId: cell, byUser, payload: { cell, nodes: nodeIds, byUser, holderName: holderNameOf(state, tenant, byUser), csId } }, { defer: true }))
}
function emitNodeIdle(state: ServerState, tenant: string, envs: EventEnvelope[], cell: string, csId: string, byUser: string): void {
  const nodeIds = nodesOfCell(readNodes(state, tenant), cell).map((n) => n.id)
  envs.push(appendEvent(state, tenant, { kind: "node.idle", targetKind: "cell", targetId: cell, byUser, payload: { cell, nodes: nodeIds, byUser, holderName: holderNameOf(state, tenant, byUser), csId } }, { defer: true }))
}

/**
 * Núcleo de "abre ou reusa o turno das `cells` p/ `userId`", DENTRO da tx corrente do chamador
 * (`envs` acumula os eventos, difundidos só depois do commit da tx — INV-2). Extraído de
 * `changesetOpen` p/ ser reusado pelos dois caminhos implícitos do F1 (lock some do vocabulário,
 * mas o mecanismo — changeset/lock/gate — não muda):
 *   - `changeset.claim` sem `csId`: 1ª mutação vira o gatilho, célula derivada do delta.
 *   - `node.edit`: gatilho da UI ao entrar em edição, ANTES de existir delta.
 * `changeset.open` continua chamando isto também — é o caminho explícito p/ agente que quer turno
 * multi-célula deliberado (decisão 3 do plano F1: o changeset não some).
 */
export function claimOrOpenCs(state: ServerState, tenant: string, userId: string, name: string, cells: string[], intent: string, envs: EventEnvelope[]): OpenResult {
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
    emitNodeEditing(state, tenant, envs, cell, csId, userId)
  }

  return { ok: true, csId, expiresAt, __tenant: tenant }
}

export function changesetOpen(state: ServerState, args: { token: string; cells: string[]; intent: string }): OpenResult {
  const { userId, tenantId: tenant, name } = requireToken(state, args.token)
  const cells = Array.isArray(args.cells) ? [...new Set(args.cells)] : []
  const intent = args.intent ?? ""
  if (!cells.length) throw new Error("changeset.open: cells required")

  return inTx(state, (envs): OpenResult => claimOrOpenCs(state, tenant, userId, name, cells, intent, envs))
}

// ── claim ─────────────────────────────────────────────────────────────────────
export type ClaimResult = { ok: true; warnings: string[]; csId: string; __tenant?: string } | { ok: false; reasons: string[]; __tenant?: string }

/**
 * F1 — lock implícito: `csId` passa a ser OPCIONAL. Sem turno aberto do chamador na célula do delta,
 * abre um implicitamente (intent vazio — decisão 2 do plano: intent migrou pro commit) reusando
 * `claimOrOpenCs`, a MESMA lógica de `changeset.open`. Agentes que preferem o caminho explícito
 * continuam podendo chamar `changeset.open` antes e passar `csId` — nada quebra pra quem já faz isso.
 */
export function changesetClaim(state: ServerState, args: { token: string; csId?: string; delta: Delta }): ClaimResult {
  const { userId, tenantId: tenant, name } = requireToken(state, args.token)
  return inTx(state, (envs): ClaimResult => {
    let delta = args.delta
    if (!delta || (delta.kind !== "claim.add" && delta.kind !== "authority.flip")) return { ok: false, reasons: ["unknown delta kind"], __tenant: tenant }
    if (delta.kind === "claim.add") {
      const normalized = normalizeClaimLevel(delta.payload?.level)
      if (!normalized.ok) return { ok: false, reasons: [normalized.reason], __tenant: tenant }
      delta = { kind: "claim.add", payload: { ...delta.payload, level: normalized.numeric } }
    }

    let csId = args.csId
    if (!csId) {
      const cell = delta.kind === "authority.flip" ? delta.payload?.cell : cellOfClaim(delta.payload ?? {})
      if (typeof cell !== "string" || !cell.includes(":")) return { ok: false, reasons: ["cannot derive cell for implicit open"], __tenant: tenant }
      const opened = claimOrOpenCs(state, tenant, userId, name, [cell], "", envs)
      if (!opened.ok) return { ok: false, reasons: [`cell ${opened.cell} locked by ${opened.holder}`], __tenant: tenant }
      csId = opened.csId
    }

    const cs = loadCs(state, tenant, csId)
    if (!cs || cs.status !== "open") return { ok: false, reasons: [`changeset ${csId} not open`], __tenant: tenant }
    if (cs.opened_by !== userId) return { ok: false, reasons: ["not the holder of this changeset"], __tenant: tenant }

    const { reasons, warnings } = incrementalGate(delta, { lockedCells: lockedCells(state, tenant, csId), existingClaims: readClaims(state, tenant), readFile: makeReadFile(state) })
    if (reasons.length) return { ok: false, reasons, __tenant: tenant }

    const seq = (state.db.query("SELECT COALESCE(MAX(seq),0) AS m FROM cs_deltas WHERE tenant_id = ? AND cs_id = ?").get(tenant, csId) as { m: number }).m + 1
    write(state.db, state.stateDir, tenant, "cs_deltas", { tenant_id: tenant, cs_id: csId, seq, kind: delta.kind, payload: JSON.stringify(delta.payload), created_at: now() })

    const agg = state.deltaCounts.get(csId) ?? { count: 0, tenant, byUser: userId }
    agg.count++
    state.deltaCounts.set(csId, agg)
    touchDelta(state, tenant, userId)
    return { ok: true, warnings, csId, __tenant: tenant }
  })
}

// ── commit ────────────────────────────────────────────────────────────────────
export type CommitResult = { ok: true; admitSeq: number; __tenant?: string } | { ok: false; reasons: string[]; __tenant?: string }

/**
 * F1 — `intent` migra da abertura pro commit (decisão 2 do plano): pedi-lo na abertura era exatamente
 * o modal "Abrir turno" que estamos removendo. Aqui vira OBRIGATÓRIO — sem ele o commit é recusado
 * (reasons, turno continua aberto p/ o autor tentar de novo com o intent preenchido).
 */
export function changesetCommit(state: ServerState, args: { token: string; csId: string; intent?: string }): CommitResult {
  const { userId, tenantId: tenant } = requireToken(state, args.token)
  const intent = typeof args.intent === "string" ? args.intent.trim() : ""
  return inTx(state, (envs): CommitResult => {
    const cs = loadCs(state, tenant, args.csId)
    if (!cs || cs.status !== "open") return { ok: false, reasons: [`changeset ${args.csId} not open`], __tenant: tenant }
    if (cs.opened_by !== userId) return { ok: false, reasons: ["not the holder of this changeset"], __tenant: tenant }
    if (!intent) return { ok: false, reasons: ["intent required to commit"], __tenant: tenant }
    cs.intent = intent // grava o intent do commit no registro persistido abaixo (sucesso ou rollback)

    const deltas = (state.db.query("SELECT kind, payload FROM cs_deltas WHERE tenant_id = ? AND cs_id = ? ORDER BY seq").all(tenant, args.csId) as { kind: string; payload: string }[]).map(
      (d) => ({ kind: d.kind as Delta["kind"], payload: JSON.parse(d.payload) }),
    )
    // `cells` = as células TRANCADAS (o que o open pediu): é sobre elas que os locks são liberados.
    // `blast` = o que os deltas realmente tocaram, união com as trancadas — o registro de auditoria.
    // Os dois coincidem no caso comum; divergem quando uma claim cai fora do lock declarado.
    const cells: string[] = JSON.parse(cs.blast_cells ?? "[]")
    const blast = blastRadius(deltas, cells)
    const final = finalGate(deltas, { existingClaims: readClaims(state, tenant), nodes: readNodes(state, tenant), authorityOf: (c) => authorityOf(state, tenant, c), readFile: makeReadFile(state) })

    if (!final.ok) {
      // vermelho → rollback total: nenhum delta persiste como claim; changeset 'aborted' com reasons.
      write(state.db, state.stateDir, tenant, "changesets", { tenant_id: tenant, id: cs.id, intent: cs.intent, parent: null, status: "aborted", opened_by: cs.opened_by, opened_at: cs.opened_at, closed_at: now(), base_seq: null, admit_seq: null, blast_cells: cs.blast_cells })
      const released = releaseLocks(state, tenant, args.csId)
      envs.push(appendEvent(state, tenant, { kind: "changeset.aborted", targetKind: "changeset", targetId: cs.id, byUser: userId, payload: abortedPayload(cs, "rejected", cells, { reasons: final.reasons }) }, { defer: true }))
      for (const cell of released) {
        envs.push(appendEvent(state, tenant, { kind: "lock.released", targetKind: "cell", targetId: cell, byUser: userId, payload: { cell, csId: cs.id, reason: "rejected" } }, { defer: true }))
        emitNodeIdle(state, tenant, envs, cell, cs.id, userId)
      }
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
    // `blastRadius` no payload passa a ser o raio REAL (antes era `cells.length`, só o declarado);
    // `blastCells` nomeia quais são — um número sozinho não é revisável.
    const committed = appendEvent(
      state,
      tenant,
      { kind: "changeset.committed", targetKind: "changeset", targetId: cs.id, byUser: userId, payload: { csId: cs.id, cells, blastCells: blast.cells, blastRadius: blast.cells.length, claimCount: blast.claimCount } },
      { defer: true },
    )
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

    // persiste o raio REAL no registro admitido (era `cs.blast_cells`, o declarado no open)
    write(state.db, state.stateDir, tenant, "changesets", { tenant_id: tenant, id: cs.id, intent: cs.intent, parent: null, status: "admitted", opened_by: cs.opened_by, opened_at: cs.opened_at, closed_at: now(), base_seq: null, admit_seq: admitSeq, blast_cells: JSON.stringify(blast.cells) })
    const released = releaseLocks(state, tenant, args.csId)
    for (const cell of released) {
      envs.push(appendEvent(state, tenant, { kind: "lock.released", targetKind: "cell", targetId: cell, byUser: userId, payload: { cell, csId: cs.id, reason: "committed" } }, { defer: true }))
      emitNodeIdle(state, tenant, envs, cell, cs.id, userId)
    }
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
    envs.push(appendEvent(state, tenant, { kind: "changeset.aborted", targetKind: "changeset", targetId: cs.id, byUser: userId, payload: abortedPayload(cs, "user", cells) }, { defer: true }))
    for (const cell of released) {
      envs.push(appendEvent(state, tenant, { kind: "lock.released", targetKind: "cell", targetId: cell, byUser: userId, payload: { cell, csId: cs.id, reason: "user" } }, { defer: true }))
      emitNodeIdle(state, tenant, envs, cell, cs.id, userId)
    }
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

// ── node.edit (F1 — gatilho da transição LEITURA → EDIÇÃO) ──────────────────────
export type NodeEditResult =
  | { ok: true; csId: string; cell: string; expiresAt: string; __tenant?: string }
  | { ok: false; editingBy: string; holderName: string; since: string | null; __tenant?: string }

/**
 * node.edit — gatilho da UI ao ENTRAR em edição num nó, antes de existir qualquer delta (spec F1).
 * Abre/reusa o turno da CÉLULA do nó (granularidade continua por célula — decisão 1 do plano; o nó só
 * herda/exibe). Corrida (risco nomeado no plano): dois usuários entram em edição no mesmo instante —
 * quem perde recebe `editingBy`/`holderName`/`since` e a UI volta pra leitura, sem banner de erro.
 *
 * AUDITORIA (achado 1): a atomicidade multi-célula é o PORQUÊ do changeset não sumir (decisão 3 do
 * plano — "um pivot que toca 40 células é UMA aprovação, não 160"). Célula nova NÃO pode virar
 * changeset novo: aqui achamos o turno JÁ aberto do chamador (se houver) e o ESTENDEMOS com a célula
 * do nó — `claimOrOpenCs` recebe as células JUNTAS (as já trancadas por mim + a nova), exatamente
 * como `changeset.open` multi-cell já fazia; reuso, não duplicação. As células "já minhas" vêm de
 * `lockedCells` (o que está REALMENTE trancado sob aquele csId agora), não de `blast_cells` (frozen
 * na criação — ver comentário de `blastRadius` em gates.ts).
 */
export function nodeEdit(state: ServerState, args: { token: string; nodeId: string }): NodeEditResult {
  const { userId, tenantId: tenant, name } = requireToken(state, args.token)
  return inTx(state, (envs): NodeEditResult => {
    const node = readNodes(state, tenant).find((n) => n.id === args.nodeId)
    if (!node) throw new Error(`node.edit: node ${args.nodeId} not found`)
    const cell = cellOfClaim({ domain: node.domain, level: node.level })
    const existing = state.db
      .query("SELECT id FROM changesets WHERE tenant_id = ? AND opened_by = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1")
      .get(tenant, userId) as { id: string } | null
    const cells = existing ? [...new Set([...lockedCells(state, tenant, existing.id), cell])] : [cell]
    const r = claimOrOpenCs(state, tenant, userId, name, cells, "", envs)
    if (!r.ok) {
      const since = (state.db.query("SELECT acquired_at FROM locks WHERE tenant_id = ? AND cell = ?").get(tenant, r.cell) as { acquired_at: string } | null)?.acquired_at ?? null
      return { ok: false, editingBy: r.holder, holderName: holderNameOf(state, tenant, r.holder), since, __tenant: tenant }
    }
    return { ok: true, csId: r.csId, cell, expiresAt: r.expiresAt, __tenant: tenant }
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
