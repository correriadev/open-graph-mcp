/**
 * presence.ts — Fase 3 §3/§4: presença viva EM MEMÓRIA (não persistida — restart esquece tudo).
 * Uma Presence por sessionId (SSE session = 1 janela, spec §3.3). Tools:
 *  - `presence.beat {token, sessionId, agentKind?}` → heartbeat, atualiza lastSeen.
 *  - `presence.focus {token, sessionId, cell?, invisible?, agentKind?}` → declara focus; broadcast
 *    `user.focused` debounced (§6.3: só o settle > focusDebounceMs conta, trocas rápidas são engolidas).
 *  - `presence.who {token, cell?, cs_id?}` → lista presentes visíveis (invisible excluído), filtrável.
 *
 * `user.joined` dispara na primeira chamada presence-registering de uma sessão (beat OU focus) — exceto
 * se a própria chamada já chega com `invisible:true` (stalker mode nasce silencioso, §9.4). `user.left`
 * dispara na saída explícita (SSE cancel, `presenceSessionClosed`) ou no heartbeat expirado (sweeper).
 *
 * `openCsIds` é derivado do SQLite (changesets abertos pelo user) a cada touch/consulta — "cached in-mem"
 * só no sentido de viver no objeto Presence entre chamadas; a fonte da verdade continua sendo o SQLite.
 */
import { broadcastEphemeral, type Presence, type ServerState } from "../state"
import { requireToken } from "./session"
import { forceQuiet } from "./typing"
import { pushSystemMessage } from "../system-message"

const now = () => Date.now()

function openCsIdsFor(state: ServerState, tenant: string, userId: string): string[] {
  const rows = state.db.query("SELECT id FROM changesets WHERE tenant_id = ? AND opened_by = ? AND status = 'open'").all(tenant, userId) as { id: string }[]
  return rows.map((r) => r.id)
}

function userName(state: ServerState, tenant: string, userId: string): string {
  const row = state.db.query("SELECT name FROM users WHERE tenant_id = ? AND id = ?").get(tenant, userId) as { name: string } | null
  return row?.name ?? userId
}

function emitJoined(state: ServerState, p: Presence): void {
  broadcastEphemeral(state, p.tenant, {
    kind: "user.joined",
    targetKind: "session",
    targetId: p.sessionId,
    byUser: p.userId,
    // lastSeen (Fase 3 review Task 4): server ms timestamp — o cliente web usa isto (em vez de um `now`
    // local) pro dotColor de staleness (30s/60s, presence-state.ts) refletir o relógio do SERVER, não
    // "quando meu browser recebeu o frame" (que já é quase a mesma coisa em SSE ao vivo, mas diverge no
    // replay do tail e evita drift de relógio entre abas).
    payload: { sessionId: p.sessionId, userId: p.userId, name: userName(state, p.tenant, p.userId), agentKind: p.agentKind, lastSeen: p.lastSeen },
  })
}

function emitLeft(state: ServerState, p: Presence, reason: "left" | "heartbeat_expired"): void {
  if (p.invisible) return
  broadcastEphemeral(state, p.tenant, {
    kind: "user.left",
    targetKind: "cell",
    targetId: p.focusCell,
    byUser: p.userId,
    // openCsIds: spec §6.1 — user.left roteia tb p/ observadores de qualquer cs_id que o user tinha
    // aberto (affinity.ts lê isto do payload; sem depender de Presence, que já foi deletada no caller).
    payload: { sessionId: p.sessionId, userId: p.userId, cell: p.focusCell, reason, openCsIds: p.openCsIds },
  })
}

function clearDebounce(state: ServerState, sessionId: string): void {
  const t = state.focusDebounce.get(sessionId)
  if (t) {
    clearTimeout(t)
    state.focusDebounce.delete(sessionId)
  }
}

const NOT_OWNED = { ok: false as const, reasons: ["session not owned by caller"] }

/**
 * Cria (se ausente) ou toca a Presence da sessão. `isNew` sinaliza a primeira chamada
 * presence-registering. SEGURANÇA: sessionIds são aleatórios (UUID, sse.ts) — capability opaca que
 * só o dono do stream conhece; adivinhar/pré-registrar IDs de vítimas não é mais viável. Este
 * binding sessionId→identidade do token na primeira chamada é defense in depth p/ a janela residual
 * (ID vazado/compartilhado): chamada posterior com identidade divergente (outro user OU outro
 * tenant) retorna null e o caller rejeita, sem tocar o estado da vítima nem emitir broadcast.
 */
function touch(state: ServerState, sessionId: string, tenant: string, userId: string, agentKind?: string): { presence: Presence; isNew: boolean } | null {
  let p = state.presence.get(sessionId)
  const isNew = !p
  if (p && (p.userId !== userId || p.tenant !== tenant)) return null
  if (!p) {
    p = {
      sessionId,
      tenant,
      userId,
      agentKind: agentKind ?? "web",
      lastSeen: now(),
      focusCell: null,
      openCsIds: openCsIdsFor(state, tenant, userId),
      invisible: false,
      lastDeltaAt: 0,
      typingState: "quiet",
    }
    state.presence.set(sessionId, p)
  } else {
    p.lastSeen = now()
    if (agentKind) p.agentKind = agentKind
    p.openCsIds = openCsIdsFor(state, tenant, userId)
  }
  // Fase 3 §8/§9.1: consome o sinal de restart da Session (sse.ts) assim que o agentKind é conhecido —
  // primeira chamada presence-registering desta sessão desde a reconexão. Só non-web recebe a versão
  // texto (web já trata o envelope `server.restarted` cru — Task 4); consumido uma vez (flag limpa)
  // pra não repetir em beats subsequentes.
  const session = state.sessions.get(sessionId)
  if (session?.restartPending) {
    session.restartPending = false
    if (p.agentKind !== "web") {
      pushSystemMessage(state, tenant, session, "[open-graph] Servidor reiniciou — sua presença foi resetada; redeclare foco.")
    }
  }
  return { presence: p, isNew }
}

export function presenceBeat(
  state: ServerState,
  args: { token: string; sessionId: string; agentKind?: string },
): { ok: true; serverTs: number } | { ok: false; reasons: string[] } {
  const { userId, tenantId: tenant } = requireToken(state, args.token)
  if (!args.sessionId || typeof args.sessionId !== "string") throw new Error("presence.beat: sessionId required")
  const touched = touch(state, args.sessionId, tenant, userId, args.agentKind)
  if (!touched) return NOT_OWNED
  const { presence, isNew } = touched
  if (isNew && !presence.invisible) emitJoined(state, presence)
  return { ok: true, serverTs: now() }
}

export function presenceFocus(
  state: ServerState,
  args: { token: string; sessionId: string; cell?: string | null; invisible?: boolean; agentKind?: string },
): { ok: true } | { ok: false; reasons: string[] } {
  const { userId, tenantId: tenant } = requireToken(state, args.token)
  if (!args.sessionId || typeof args.sessionId !== "string") throw new Error("presence.focus: sessionId required")
  const touched = touch(state, args.sessionId, tenant, userId, args.agentKind)
  if (!touched) return NOT_OWNED
  const { presence, isNew } = touched
  if (typeof args.invisible === "boolean") {
    // Transição visível→invisível ENQUANTO typing/idle: sweepTyping pula invisíveis, então sem uma
    // transição final → quiet o indicador "digitando" congelaria pra sempre nos observadores da cell
    // antiga. Emitida ANTES de esconder e ANTES do focusCell mudar (roteia p/ quem via o indicador).
    if (args.invisible && !presence.invisible) forceQuiet(state, presence)
    presence.invisible = args.invisible
  }
  if (isNew && !presence.invisible) emitJoined(state, presence)

  // Atualização imediata do estado (presence.who reflete na hora); o BROADCAST de user.focused é
  // debounced (§6.3: só conta se ficar > focusDebounceMs — trocas rápidas intermediárias são engolidas).
  presence.focusCell = args.cell === undefined ? null : args.cell

  clearDebounce(state, args.sessionId)
  if (presence.invisible) return { ok: true }

  const sessionId = args.sessionId
  const timer = setTimeout(() => {
    state.focusDebounce.delete(sessionId)
    const cur = state.presence.get(sessionId)
    if (!cur || cur.invisible) return
    broadcastEphemeral(state, cur.tenant, {
      kind: "user.focused",
      targetKind: "cell",
      targetId: cur.focusCell,
      byUser: cur.userId,
      payload: { sessionId, userId: cur.userId, cell: cur.focusCell, lastSeen: cur.lastSeen },
    })
  }, state.focusDebounceMs)
  state.focusDebounce.set(sessionId, timer)
  return { ok: true }
}

export function presenceWho(
  state: ServerState,
  args: { token: string; cell?: string; cs_id?: string },
): { users: { id: string; name: string; agentKind: string; focusCell: string | null; openCount: number; lastSeen: number }[] } {
  const { tenantId: tenant } = requireToken(state, args.token)
  const users: { id: string; name: string; agentKind: string; focusCell: string | null; openCount: number; lastSeen: number }[] = []
  // ponytail: N+1 — uma query de openCsIds (e uma de name) por presença. Teto: ~50 sessões (DoD Fase 3)
  // sobre SQLite local em memória de página — irrelevante. Se o teto subir, trocar por 1 query agregada.
  for (const p of state.presence.values()) {
    if (p.tenant !== tenant || p.invisible) continue
    p.openCsIds = openCsIdsFor(state, tenant, p.userId)
    if (args.cell && p.focusCell !== args.cell) continue
    if (args.cs_id && !p.openCsIds.includes(args.cs_id)) continue
    // lastSeen (Task 4 review): server ms timestamp p/ o cliente web calcular o dotColor de staleness
    // (30s/60s) a partir do relógio do server, não de um `now()` local do poll.
    users.push({ id: p.userId, name: userName(state, tenant, p.userId), agentKind: p.agentKind, focusCell: p.focusCell, openCount: p.openCsIds.length, lastSeen: p.lastSeen })
  }
  return { users }
}

/** Chamado pelo cancel() do SSE (spec §9.2): sessão caiu explicitamente → user.left reason "left". */
export function presenceSessionClosed(state: ServerState, sessionId: string): void {
  const p = state.presence.get(sessionId)
  if (!p) return
  state.presence.delete(sessionId)
  clearDebounce(state, sessionId)
  emitLeft(state, p, "left")
}

/** Sweeper (spec §4): sem beat por presenceTtlMs → expira → user.left reason "heartbeat_expired". */
export function sweepPresence(state: ServerState): void {
  const cutoff = now() - state.presenceTtlMs
  for (const [sessionId, p] of [...state.presence.entries()]) {
    if (p.lastSeen > cutoff) continue
    state.presence.delete(sessionId)
    clearDebounce(state, sessionId)
    emitLeft(state, p, "heartbeat_expired")
  }
}
