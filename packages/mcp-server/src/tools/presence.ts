/**
 * presence.ts — Fase 3 §3/§4: presença viva EM MEMÓRIA (não persistida — restart esquece tudo).
 * Uma Presence por sessionId (SSE session = 1 janela, spec §3.3). Tools:
 *  - `presence.beat {token, sessionId?, agentKind?}` → heartbeat, atualiza lastSeen.
 *  - `presence.focus {token, sessionId?, cell?, invisible?, agentKind?}` → declara focus; broadcast
 *    `user.focused` debounced (§6.3: só o settle > focusDebounceMs conta, trocas rápidas são engolidas).
 *  - `presence.who {token, cell?, cs_id?}` → lista presentes visíveis (invisible excluído), filtrável.
 *
 * `user.joined` dispara na primeira chamada presence-registering de uma sessão (beat OU focus) — exceto
 * se a própria chamada já chega com `invisible:true` (stalker mode nasce silencioso, §9.4). `user.left`
 * dispara na saída explícita (SSE cancel, `presenceSessionClosed`) ou no heartbeat expirado (sweeper).
 *
 * `openCsIds` é derivado do SQLite (changesets abertos pelo user) a cada touch/consulta — "cached in-mem"
 * só no sentido de viver no objeto Presence entre chamadas; a fonte da verdade continua sendo o SQLite.
 *
 * MP-1 (achado: presença é invisível pra um cliente que nunca abre SSE — `POST /mcp` puro, o caso
 * `claude mcp add --transport http`): `sessionId` agora é OPCIONAL em beat/focus. Quando ausente,
 * `touch()` resolve/cria uma Session SINTÉTICA sem canal de push (`ensureNoSseSession` abaixo), keyed
 * deterministicamente por (tenant, userId) — não aleatória como a SSE (sse.ts), porque não há stream
 * nenhum cujo dono precise provar posse por capability opaca; a identidade já vem do token
 * (`requireToken`), e `touch()` (inalterado nesta parte) seguе gating todo acesso por ela. Ver
 * `ensureNoSseSession` pra a análise completa de por que um id PREVISÍVEL continua seguro aqui.
 * O caminho SSE (sessionId fornecido) é bit-a-bit o mesmo de antes.
 */
import { createHash } from "node:crypto"
import { broadcastEphemeral, type Presence, type ServerState, type Session } from "../state"
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

/** MP-1: sessão sintética sem SSE — nada a empurrar. Restrição #2: o resto do servidor (affinity.ts,
 *  state.ts::pushEnvelope, sweeper) itera `state.sessions` sem saber que algumas não têm canal nenhum;
 *  este no-op é o que torna essa suposição segura em vez de assumida. */
const NO_PUSH: Session["push"] = () => {}

/**
 * Deriva um sessionId ESTÁVEL (não aleatório) pra um caller sem stream SSE nenhum a que amarrar um id —
 * MP-1. Determinístico em (tenant, userId): beats repetidos sem sessionId caem na MESMA Presence, em vez
 * de um `user.joined` novo por chamada.
 *
 * Restrição #4 (segurança): o sessionId de uma sessão SSE (sse.ts) é aleatório porque sua SECRECY é a
 * única coisa entre ele e um sequestro — é uma capability opaca. Aqui não: `touch()` (abaixo, inalterado
 * nesta parte) sempre reconfirma `session.userId === identidade derivada do token via requireToken`
 * antes de tocar qualquer estado. Um atacante que CALCULE o id sintético de outro user e o apresente
 * junto do PRÓPRIO token cai no mesmo `NOT_OWNED` que hoje protege um sessionId SSE vazado
 * (presence-ownership.test.ts) — sem o token da vítima (infalsificável, session.ts), saber o id não abre
 * porta nenhuma. Previsibilidade aqui é uma escolha, não uma fraqueza: sem ela, todo POST /mcp sem
 * sessionId criaria uma Presence nova (spam de user.joined/left a cada beat).
 */
function noSseSessionId(tenant: string, userId: string): string {
  const h = createHash("sha256").update(`${tenant}:${userId}`).digest("hex").slice(0, 12)
  return `s_${h}`
}

/**
 * Acha ou cria (lazy) a Session sintética por trás da presença de um caller sem SSE. Inserida direto em
 * `state.sessions` — o MESMO mapa que sse.ts popula — pra que affinity.ts/pushEnvelope a tratem como
 * uma Session de primeira classe sem nenhum caso especial: um caller sem SSE passa a ser destinatário
 * válido de `lock.denied` etc. (route()/sessionsOfUser, affinity.ts, olha só `s.userId`) e, com um
 * `agentKind` não-"web", começa a acumular `system.message` que `system.pending` drena depois (INT-3).
 * `restartPending:false` — não houve reconexão nenhuma pra sinalizar; `filters:[]` — mesmo default de
 * "all" do SSE (sse.ts `parseFilterParam`/`matches()`: filters vazio = tudo).
 */
function ensureNoSseSession(state: ServerState, tenant: string, userId: string): string {
  const sid = noSseSessionId(tenant, userId)
  if (!state.sessions.has(sid)) {
    state.sessions.set(sid, { id: sid, tenant, filters: [], push: NO_PUSH, userId, restartPending: false })
  }
  return sid
}

export function registerActorSession(state: ServerState, p: Presence): void {
  let tenant = state.actorSessions.get(p.tenant)
  if (!tenant) state.actorSessions.set(p.tenant, tenant = new Map())
  let actor = tenant.get(p.userId)
  if (!actor) tenant.set(p.userId, actor = new Set())
  actor.add(p.sessionId)
}

export function unregisterActorSession(state: ServerState, p: Presence): void {
  const tenant = state.actorSessions.get(p.tenant)
  const actor = tenant?.get(p.userId)
  actor?.delete(p.sessionId)
  if (actor?.size === 0) tenant!.delete(p.userId)
  if (tenant?.size === 0) state.actorSessions.delete(p.tenant)
}

/**
 * Cria (se ausente) ou toca a Presence da sessão. `isNew` sinaliza a primeira chamada
 * presence-registering. SEGURANÇA: sessionIds são aleatórios (UUID, sse.ts) — capability opaca que
 * só o dono do stream conhece; adivinhar/pré-registrar IDs de vítimas não é mais viável. Este
 * binding sessionId→identidade do token na primeira chamada é defense in depth p/ a janela residual
 * (ID vazado/compartilhado): chamada posterior com identidade divergente (outro user OU outro
 * tenant) retorna null e o caller rejeita, sem tocar o estado da vítima nem emitir broadcast.
 */
function touch(state: ServerState, sessionIdArg: string | undefined, tenant: string, userId: string, agentKind?: string): { presence: Presence; isNew: boolean } | null {
  let sessionId: string
  if (sessionIdArg === undefined) {
    // MP-1: sem SSE, sem sessionId a oferecer — resolve/cria a Session sintética (ver noSseSessionId
    // acima pra a análise de segurança do id previsível).
    sessionId = ensureNoSseSession(state, tenant, userId)
  } else {
    if (!/^s_[0-9a-f-]{12}$/i.test(sessionIdArg)) return null
    sessionId = sessionIdArg
  }
  const session = state.sessions.get(sessionId)
  if (!session || session.tenant !== tenant || (session.userId !== null && session.userId !== userId)) return null
  // A post-restart SSE may begin with an unknown old token; once the client re-registers, bind its
  // opaque live session capability to the newly authenticated actor exactly once.
  if (session.userId === null) session.userId = userId
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
  registerActorSession(state, p)
  // Fase 3 §8/§9.1: consome o sinal de restart da Session (sse.ts) assim que o agentKind é conhecido —
  // primeira chamada presence-registering desta sessão desde a reconexão. Só non-web recebe a versão
  // texto (web já trata o envelope `server.restarted` cru — Task 4); consumido uma vez (flag limpa)
  // pra não repetir em beats subsequentes.
  if (session?.restartPending) {
    session.restartPending = false
    if (p.agentKind !== "web") {
      pushSystemMessage(state, tenant, session, "[open-graph] Servidor reiniciou — sua presença foi resetada; redeclare foco.")
    }
  }
  return { presence: p, isNew }
}

/** `sessionId`, quando fornecido, precisa ser uma string não-vazia — omitido (MP-1, sem SSE) é
 *  diferente de "vazio por engano" e não deve ser confundido com um erro silencioso. */
function validateOptionalSessionId(sessionId: unknown, toolName: string): asserts sessionId is string | undefined {
  if (sessionId !== undefined && (typeof sessionId !== "string" || sessionId === "")) {
    throw new Error(`${toolName}: sessionId, when provided, must be a non-empty string`)
  }
}

export function presenceBeat(
  state: ServerState,
  args: { token: string; sessionId?: string; agentKind?: string },
): { ok: true; serverTs: number; sessionId: string } | { ok: false; reasons: string[] } {
  const { userId, tenantId: tenant } = requireToken(state, args.token)
  validateOptionalSessionId(args.sessionId, "presence.beat")
  const touched = touch(state, args.sessionId, tenant, userId, args.agentKind)
  if (!touched) return NOT_OWNED
  const { presence, isNew } = touched
  if (isNew && !presence.invisible) emitJoined(state, presence)
  return { ok: true, serverTs: now(), sessionId: presence.sessionId }
}

export function presenceFocus(
  state: ServerState,
  args: { token: string; sessionId?: string; cell?: string | null; invisible?: boolean; agentKind?: string },
): { ok: true; sessionId: string } | { ok: false; reasons: string[] } {
  const { userId, tenantId: tenant } = requireToken(state, args.token)
  validateOptionalSessionId(args.sessionId, "presence.focus")
  const touched = touch(state, args.sessionId, tenant, userId, args.agentKind)
  if (!touched) return NOT_OWNED
  const { presence, isNew } = touched
  const sessionId = presence.sessionId
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

  clearDebounce(state, sessionId)
  if (presence.invisible) return { ok: true, sessionId }

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
  return { ok: true, sessionId }
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
  unregisterActorSession(state, p)
  clearDebounce(state, sessionId)
  emitLeft(state, p, "left")
}

/** Sweeper (spec §4): sem beat por presenceTtlMs → expira → user.left reason "heartbeat_expired". */
export function sweepPresence(state: ServerState): void {
  const cutoff = now() - state.presenceTtlMs
  for (const [sessionId, p] of [...state.presence.entries()]) {
    if (p.lastSeen > cutoff) continue
    state.presence.delete(sessionId)
    unregisterActorSession(state, p)
    clearDebounce(state, sessionId)
    emitLeft(state, p, "heartbeat_expired")
  }
}
