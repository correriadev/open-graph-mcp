/**
 * sse.ts — GET /events?token=&since=N&filter=... (spec §4.2 + Fase 2). Um SSE por sessão, escopado
 * por tenant: `token` resolve o tenant; só eventos daquele tenant chegam. Token desconhecido → sessão
 * anônima no tenant "default" (compat Fase 1). Primeiro frame: `session.created { sessionId, graphId }`.
 * Depois o tail do log (SQLite) desde N (filtrado) e, ao vivo, cada evento novo do tenant que casa o filtro.
 */
import { DEFAULT_TENANT, nextSeq, tenantGraph, type EventEnvelope, type Filter, type ServerState } from "./state"
import { isRecipient } from "./affinity"
import { presenceSessionClosed } from "./tools/presence"
import { lookupToken } from "./tokens"

/**
 * "all" | "cell:<domain:level>" | "domain:<d>" | "event:<k1,k2>" | "changeset:<id>"
 *
 * Um `kind` desconhecido continua caindo pra `{kind:"all"}` (permissivo de propósito: o param é o
 * atalho pra cliente burro, e entregar demais é recuperável). Já um kind CONHECIDO com valor vazio
 * (`?filter=cell:`, `?filter=event:`) não: ele produz um filtro que não casa NADA, e uma conexão que
 * fica muda para sempre é indistinguível de um servidor sem eventos — mesma falha silenciosa do
 * `?since=abc`. `null` = inválido, o caller devolve 400. */
function parseFilterParam(raw: string | null): Filter[] | null {
  if (!raw || raw === "all") return [{ kind: "all" }]
  const cut = raw.indexOf(":")
  const kind = cut < 0 ? raw : raw.slice(0, cut)
  const val = cut < 0 ? "" : raw.slice(cut + 1)
  switch (kind) {
    case "cell":
      return val ? [{ kind: "cell", cell: val }] : null
    case "domain":
      return val ? [{ kind: "domain", domain: val }] : null
    case "changeset":
      return val ? [{ kind: "changeset", id: val }] : null
    case "event": {
      const events = val.split(",").filter(Boolean)
      return events.length ? [{ kind: "event", events }] : null
    }
    default:
      return [{ kind: "all" }]
  }
}

function frame(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function tenantOf(state: ServerState, token: string | null): string {
  if (!token) return DEFAULT_TENANT
  return lookupToken(state, token)?.tenantId ?? DEFAULT_TENANT
}

/** `?since=` parsing (SB-0 pre-classificado, Tier 1): `Number("abc")` → `NaN` → `seq > NaN` casa nada
 *  → backlog silenciosamente vazio. Um cliente que perde o backlog em silêncio parece um cliente
 *  funcionando com estado velho — pior que um erro alto. Só um inteiro não-negativo em notação simples
 *  (sem sinal, sem notação científica, sem casas decimais) é aceito; ausência do param continua = 0.
 *  `null` de retorno = inválido, tratado pelo caller como 400 explícito em vez de clamp silencioso. */
function parseSince(raw: string | null): number | null {
  if (raw === null) return 0
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}

export function handleEvents(state: ServerState, url: URL): Response {
  const sinceRaw = url.searchParams.get("since")
  const since = parseSince(sinceRaw)
  if (since === null) {
    return new Response(JSON.stringify({ error: `invalid since query param: ${JSON.stringify(sinceRaw)} — expected a non-negative integer, or omitted` }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })
  }
  const filterRaw = url.searchParams.get("filter")
  const filters = parseFilterParam(filterRaw)
  if (filters === null) {
    return new Response(JSON.stringify({ error: `invalid filter query param: ${JSON.stringify(filterRaw)} — a known filter kind requires a non-empty value (ex.: cell:ui:4, event:lock.acquired)` }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })
  }
  const token = url.searchParams.get("token")
  const tenant = tenantOf(state, token)
  // Fase 3 §6.1: identidade do token (se houver) fica presa à Session p/ o router de afinidade rotear
  // por USUÁRIO (holder, atacante de lock.denied) sem depender de presence.beat/focus ter sido chamado.
  const info = token ? lookupToken(state, token) : undefined
  const userId = info?.userId ?? null
  // Fase 3 §9.1 + D10-lite: "este cliente está reconectando depois de um restart".
  //
  // Era `token && !tokens.has(token)` — funcionava só PORQUE os tokens morriam no restart, e
  // confundia dois casos bem diferentes (o servidor reiniciou / o token é lixo). Com tokens duráveis
  // o token SOBREVIVE, então o sinal certo é `staleBoot`: veio da hidratação, ou seja, foi emitido
  // por um processo anterior. Um token desconhecido continua contando — é o caso de quem tinha um
  // token de antes do SQLite ser apagado, que é restart do mesmo jeito.
  //
  // `staleBoot` é consumido AQUI, na primeira conexão que apresentar o token: as reconexões
  // seguintes deste mesmo processo não são restart nenhum e não devem repetir o aviso.
  const restartPending = !!token && (!info || info.staleBoot === true)
  if (info?.staleBoot) info.staleBoot = false
  // Aleatório (não sequencial): o sessionId é uma capability opaca — só quem recebeu o frame
  // session.created o conhece; um atacante não consegue mais adivinhar nem pré-registrar IDs de
  // presença de vítimas (defense in depth com o binding sessionId→token em tools/presence.ts).
  const id = `s_${crypto.randomUUID().slice(0, 12)}`
  const graphId = tenantGraph(state, tenant).graphId

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (env: EventEnvelope) => {
        try {
          controller.enqueue(frame(env.kind, env))
        } catch {
          /* cliente desconectou entre o match e o enqueue */
        }
      }
      const session = { id, tenant, filters, push, userId, restartPending }
      state.sessions.set(id, session)
      state.subscriptions.set(id, filters)

      controller.enqueue(frame("session.created", { sessionId: id, graphId, tenant }))
      // Fase 3 §9.1: broadcast de restart PRA ESTA sessão (não roteado — é per-connection, calculado
      // acima). Efêmero (reusa o seq durável corrente, igual toda presença): não é replay de histórico,
      // é um aviso "isto é uma conexão nova pós-restart". Web já trata este kind cru (Task 4); a versão
      // texto pra non-web é emitida depois, em presence.ts `touch()`, quando o agentKind é conhecido.
      if (restartPending) {
        push({
          schemaVersion: 1,
          seq: nextSeq(state, tenant) - 1,
          ephemeral: true,
          ts: new Date().toISOString(),
          kind: "server.restarted",
          target: null,
          payload: {},
          graphId,
        })
      }
      // tail do log do tenant desde `since` — roteado pela MESMA afinidade do live (não só o filtro cru):
      // sem isto, um lock.denied histórico vazaria p/ qualquer reconexão cujo filtro casasse por acidente.
      const rows = state.db
        .query("SELECT seq, ts, kind, target_id, payload FROM events WHERE tenant_id = ? AND seq > ? ORDER BY seq")
        .all(tenant, since) as { seq: number; ts: string; kind: string; target_id: string | null; payload: string }[]
      for (const r of rows) {
        const env: EventEnvelope = { schemaVersion: 1, seq: r.seq, ts: r.ts, kind: r.kind, target: r.target_id, payload: JSON.parse(r.payload ?? "{}"), graphId }
        if (isRecipient(env, session, state.presence, tenant)) push(env)
      }
    },
    cancel() {
      state.sessions.delete(id)
      state.subscriptions.delete(id)
      presenceSessionClosed(state, id) // spec §9.2: sessão caiu → user.left reason "left" (se tinha presença)
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    },
  })
}
