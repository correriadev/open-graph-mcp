/**
 * graph-subscribe.ts — registra/substitui os filtros de uma sessão SSE (spec §4.2). Sem chamada,
 * a sessão nasce com [{ kind: "all" }]. A tool é a via canônica; /events?filter= é atalho p/ clientes burros.
 */
import type { Filter, ServerState } from "../state"

export function subscribe(state: ServerState, sessionId: string, filters: Filter[]): { ok: true } {
  const f = filters.length ? filters : [{ kind: "all" as const }]
  state.subscriptions.set(sessionId, f)
  const live = state.sessions.get(sessionId)
  if (live) live.filters = f
  return { ok: true }
}
