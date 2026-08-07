/**
 * graph-subscribe.ts — registra/substitui os filtros de uma sessão SSE (spec §4.2). Sem chamada,
 * a sessão nasce com [{ kind: "all" }]. A tool é a via canônica; /events?filter= é atalho p/ clientes burros.
 *
 * SB-0 §5 (correção coordenada): até aqui a tool não recebia token — quem soubesse um sessionId
 * (capability opaca, mas potencialmente vazada/compartilhada) reescrevia os filtros de OUTRA sessão,
 * mudando o que ela recebe. `token` agora é OPCIONAL no 4º parâmetro — sem breaking change: um caller
 * que não manda token (o único caminho possível hoje, porque `inputSchema`/dispatch em transport.ts
 * ainda não o encaminham) continua exatamente como antes (regex de formato `s_<12 hex>` + sessão viva
 * em `state.sessions`, sem checar identidade). Quando um token CHEGA, valida o binding sessionId→token
 * com a MESMA vara de medir que presence.ts `touch()` usa: a sessão tem que existir, pertencer ao mesmo
 * tenant do token, e (se já tiver um userId vinculado) esse userId tem que bater com o do token — do
 * contrário, rejeita sem tocar em `state.subscriptions`/`session.filters`. Sessão sem userId vinculado
 * ainda (SSE anônimo que nunca autenticou) aceita o primeiro token que aparecer, igual `touch()` faz
 * (`session.userId === null` → aceita e o presence.ts é quem persiste esse bind na sessão; subscribe()
 * não precisa persistir nada além de validar, porque o bind real de `Session.userId` é feito em sse.ts
 * no momento da conexão ou por presence.ts no primeiro beat/focus).
 *
 * O fio ainda não entrega esse token: `inputSchema`/dispatch de `graph.subscribe` moram em
 * transport.ts (fora da posse deste stream — ver docs/roadmap-server-beta/00-scope-sb-0-hardening-
 * servidor.md §3/§5). Fechar o buraco de ponta a ponta requer, lá: (1) acrescentar `token: {type:
 * "string"}` a `inputSchema.properties` SEM entrar em `required` (opcional, spec §5.3 — não quebra
 * quem não manda), e (2) trocar `subscribe(state, args.sessionId, args.filters)` por
 * `subscribe(state, args.sessionId, args.filters, args.token)`. Ver subscribe-authz.test.ts para o
 * teste de ataque que reproduz o sequestro e o teste unitário que prova a guarda abaixo.
 */
import type { Filter, ServerState } from "../state"
import { lookupToken } from "../tokens"

const SESSION_ID_RE = /^s_[0-9a-f-]{12}$/i

export function subscribe(state: ServerState, sessionId: unknown, filters: unknown, token?: unknown): { ok: true } {
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    throw new Error("graph.subscribe: sessionId inválido — esperado o formato de sessão SSE (s_<12 hex>) devolvido por session.created")
  }
  const session = state.sessions.get(sessionId)
  if (!session) {
    throw new Error("graph.subscribe: sessão desconhecida ou expirada — abra /events antes de chamar subscribe")
  }
  if (!Array.isArray(filters)) {
    throw new Error("graph.subscribe: filters deve ser um array (ex.: [] ou [{kind:'all'}])")
  }
  // Binding sessionId→token (SB-0 §5): só validado quando um token É fornecido — ausência preserva o
  // comportamento pré-existente (sem breaking change, ver doc comment acima). Mesma vara de medir do
  // `touch()` de presence.ts: sessão tem que ser do mesmo tenant do token, e se já tiver um userId
  // vinculado, tem que ser o MESMO userId do token — outro usuário (mesmo com o sessionId em mãos) é
  // rejeitado sem tocar no estado da sessão alheia.
  if (token !== undefined && token !== null) {
    if (typeof token !== "string" || !token) {
      throw new Error("graph.subscribe: token inválido")
    }
    const info = lookupToken(state, token)
    if (!info) {
      throw new Error("graph.subscribe: invalid or expired token — call session.register")
    }
    if (session.tenant !== info.tenantId || (session.userId !== null && session.userId !== info.userId)) {
      throw new Error("graph.subscribe: session not owned by caller")
    }
  }
  const f = (filters.length ? filters : [{ kind: "all" as const }]) as Filter[]
  state.subscriptions.set(sessionId, f)
  session.filters = f
  return { ok: true }
}
