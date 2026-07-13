/**
 * affinity.ts — Fase 3 §6.1: roteador de afinidade. Fase 2 era "simples": um evento vai a toda sessão
 * cujo filtro casa (`matches()`). Fase 3 generaliza isso por KIND de evento:
 *
 *   changeset.opened     → observadores da cell + admins (Fase 4 — sem roles ainda, D2: todos podem
 *                           tudo; nenhum destinatário extra por enquanto, ver comentário abaixo).
 *   changeset.delta       → observadores da cell + observadores do cs_id + o HOLDER (mesmo sem filtro).
 *   changeset.committed  → idem + todos com PRESENCE.focusCell na cell (mesmo não-inscritos).
 *   changeset.aborted    → SÓ observadores do cs_id + holder (se diferente) — NÃO observadores de cell.
 *   lock.acquired/released → observadores da cell (igual Fase 2).
 *   lock.denied           → RESTRIÇÃO total: só a(s) sessão(ões) do usuário que tentou. Nunca broadcast.
 *   authority.flipped     → todos (já era ALWAYS_BROADCAST em matches() — mantido).
 *   user.focused/typing_state → observadores da cell (igual Fase 2/matches()).
 *   user.left             → observadores da cell + observadores de qualquer cs_id que o user tinha aberto.
 *   user.joined            → todos (já é ALWAYS_BROADCAST em matches() — mantido).
 *
 * `matches()` (a base Fase 2) já cobre a parte "observadores de X" p/ TODOS os kinds acima, porque cada
 * sessão vota independentemente com o SEU (único, na prática) filtro — a união de "quem tem filtro cell"
 * OU "quem tem filtro changeset" emerge naturalmente de iterar todas as sessões. O que muda por kind é
 * só o que se ADICIONA (holder, focus-na-cell) ou se RESTRINGE (aborted exclui cell; lock.denied ignora
 * filtro por completo). `route` é uma função PURA — sem I/O, sem SSE — unit-testável isolada
 * (affinity-router.test.ts).
 */
import { matches, matchOne, type EventEnvelope, type Filter, type Presence, type Session } from "./state"

/** Variante restrita de matches() p/ changeset.aborted (spec §6.1): ignora filtro "cell"/"domain" —
 *  só "changeset"/"event"/"all" contam como "observador do cs_id". Sessão sem filtro (raro, spec §4.4:
 *  filters vazio = tudo) ainda conta. */
function matchesCsIdOnly(filters: Filter[], e: EventEnvelope): boolean {
  if (filters.length === 0) return true
  return filters.every((f) => (f.kind === "changeset" || f.kind === "all" || f.kind === "event" ? matchOne(f, e) : false))
}

function sessionsOfUser(sessions: Map<string, Session>, tenant: string, userId: string | undefined | null): string[] {
  if (!userId) return []
  const out: string[] = []
  for (const s of sessions.values()) if (s.tenant === tenant && s.userId === userId) out.push(s.id)
  return out
}

/**
 * route — calcula o conjunto de sessionIds destinatários de `env` no tenant. PURA: nenhuma chamada
 * depende de I/O ou de tempo de execução além dos mapas passados.
 */
export function route(env: EventEnvelope, sessions: Map<string, Session>, presence: Map<string, Presence>, tenant: string): Set<string> {
  const kind = env.kind

  // lock.denied — spec §6.1: OVERRIDE total, ignora filtros: só o(s) session(s) do usuário que tentou.
  if (kind === "lock.denied") {
    const attempted = env.payload.attempted_by as string | undefined
    return new Set(sessionsOfUser(sessions, tenant, attempted))
  }

  // changeset.aborted — spec §6.1: observadores do cs_id (NÃO de cell) + holder (se diferente).
  if (kind === "changeset.aborted") {
    const out = new Set<string>()
    for (const s of sessions.values()) if (s.tenant === tenant && matchesCsIdOnly(s.filters, env)) out.add(s.id)
    const holder = env.payload.byUser as string | undefined
    for (const id of sessionsOfUser(sessions, tenant, holder)) out.add(id)
    return out
  }

  // Base: mesma semântica de Fase 2 (matches()) — cobre cell/domain/changeset/event/all filters, e os
  // kinds ALWAYS_BROADCAST (authority.flipped, user.joined) que matches() já trata como broadcast total.
  // changeset.opened cai aqui sem extra: "admins" (Fase 4, roles ainda não existem) não adiciona ninguém.
  const out = new Set<string>()
  for (const s of sessions.values()) if (s.tenant === tenant && matches(s.filters, env)) out.add(s.id)

  if (kind === "changeset.delta") {
    const holder = env.payload.byUser as string | undefined
    for (const id of sessionsOfUser(sessions, tenant, holder)) out.add(id)
  }

  if (kind === "changeset.committed") {
    const cells = (env.payload.cells as string[] | undefined) ?? []
    for (const p of presence.values()) {
      if (p.tenant !== tenant || !p.focusCell || !cells.includes(p.focusCell)) continue
      if (sessions.has(p.sessionId)) out.add(p.sessionId)
    }
  }

  if (kind === "user.left") {
    const openCsIds = (env.payload.openCsIds as string[] | undefined) ?? []
    if (openCsIds.length) {
      for (const s of sessions.values()) {
        if (s.tenant !== tenant) continue
        if (s.filters.some((f) => f.kind === "changeset" && openCsIds.includes(f.id))) out.add(s.id)
      }
    }
  }

  return out
}

/** Usado no replay de backlog (sse.ts, reconexão): "esta ÚNICA sessão receberia `env` se ele
 *  acontecesse agora?" — mesma lógica de `route`, sem construir o Set inteiro de destinatários. */
export function isRecipient(env: EventEnvelope, session: Session, presence: Map<string, Presence>, tenant: string): boolean {
  return route(env, new Map([[session.id, session]]), presence, tenant).has(session.id)
}
