/**
 * graph-subscribe.ts — registra/substitui os filtros de uma sessão SSE (spec §4.2). Sem chamada,
 * a sessão nasce com [{ kind: "all" }]. A tool é a via canônica; /events?filter= é atalho p/ clientes burros.
 *
 * SEM auth por token de propósito, ao contrário de presence.ts: inputSchema desta tool NUNCA teve
 * `token` (graph.subscribe existe desde antes de session.register), e packages/client/src/connect.ts
 * `subscribe()` chama `graph.subscribe({ sessionId, filters })` sem token nenhum — adicionar um token
 * OBRIGATÓRIO agora quebraria esse caller em produção. O que dava pra fechar sem quebrar contrato:
 * mesma vara de medir que presence.ts `touch()` usa pra sessionId — regex de formato (`s_<12 hex>`,
 * igual ao que sse.ts gera) MAIS a sessão precisar EXISTIR de fato em `state.sessions` (antes: qualquer
 * string virava uma entrada nova em `state.subscriptions`, sessionId forjado incluído, e devolvia
 * `{ok:true}` do mesmo jeito). Isso fecha o buraco de "assinar filtros pra uma sessão que não existe"
 * sem exigir identidade — o sessionId em si já é uma capability opaca (UUID, spec/presence.ts comment),
 * então validar que ele é uma sessão viva é o análogo ao que presence.ts faz antes de vincular a um
 * userId. Binding sessionId→token fica de fora: não dá pra fazer sem quebrar o caller atual.
 */
import type { Filter, ServerState } from "../state"

const SESSION_ID_RE = /^s_[0-9a-f-]{12}$/i

export function subscribe(state: ServerState, sessionId: unknown, filters: unknown): { ok: true } {
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    throw new Error("graph.subscribe: sessionId inválido — esperado o formato de sessão SSE (s_<12 hex>) devolvido por session.created")
  }
  if (!state.sessions.has(sessionId)) {
    throw new Error("graph.subscribe: sessão desconhecida ou expirada — abra /events antes de chamar subscribe")
  }
  if (!Array.isArray(filters)) {
    throw new Error("graph.subscribe: filters deve ser um array (ex.: [] ou [{kind:'all'}])")
  }
  const f = (filters.length ? filters : [{ kind: "all" as const }]) as Filter[]
  state.subscriptions.set(sessionId, f)
  const live = state.sessions.get(sessionId)
  if (live) live.filters = f
  return { ok: true }
}
