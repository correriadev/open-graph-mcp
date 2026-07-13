/**
 * sse.ts — GET /events?token=&since=N&filter=... (spec §4.2 + Fase 2). Um SSE por sessão, escopado
 * por tenant: `token` resolve o tenant; só eventos daquele tenant chegam. Token desconhecido → sessão
 * anônima no tenant "default" (compat Fase 1). Primeiro frame: `session.created { sessionId, graphId }`.
 * Depois o tail do log (SQLite) desde N (filtrado) e, ao vivo, cada evento novo do tenant que casa o filtro.
 */
import { DEFAULT_TENANT, matches, tenantGraph, type EventEnvelope, type Filter, type ServerState } from "./state"

/** "all" | "cell:<domain:level>" | "domain:<d>" | "event:<k1,k2>" | "changeset:<id>" */
function parseFilterParam(raw: string | null): Filter[] {
  if (!raw || raw === "all") return [{ kind: "all" }]
  const cut = raw.indexOf(":")
  const kind = cut < 0 ? raw : raw.slice(0, cut)
  const val = cut < 0 ? "" : raw.slice(cut + 1)
  switch (kind) {
    case "cell":
      return [{ kind: "cell", cell: val }]
    case "domain":
      return [{ kind: "domain", domain: val }]
    case "changeset":
      return [{ kind: "changeset", id: val }]
    case "event":
      return [{ kind: "event", events: val.split(",").filter(Boolean) }]
    default:
      return [{ kind: "all" }]
  }
}

function frame(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function tenantOf(state: ServerState, token: string | null): string {
  if (!token) return DEFAULT_TENANT
  return state.tokens.get(token)?.tenantId ?? DEFAULT_TENANT
}

export function handleEvents(state: ServerState, url: URL): Response {
  const since = Number(url.searchParams.get("since") ?? 0)
  const filters = parseFilterParam(url.searchParams.get("filter"))
  const tenant = tenantOf(state, url.searchParams.get("token"))
  const id = `s${++state.sessionCounter}`
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
      state.sessions.set(id, { id, tenant, filters, push })
      state.subscriptions.set(id, filters)

      controller.enqueue(frame("session.created", { sessionId: id, graphId, tenant }))
      // tail do log do tenant desde `since`, filtrado pelo filtro corrente da sessão
      const rows = state.db
        .query("SELECT seq, ts, kind, target_id, payload FROM events WHERE tenant_id = ? AND seq > ? ORDER BY seq")
        .all(tenant, since) as { seq: number; ts: string; kind: string; target_id: string | null; payload: string }[]
      for (const r of rows) {
        const env: EventEnvelope = { schemaVersion: 1, seq: r.seq, ts: r.ts, kind: r.kind, target: r.target_id, payload: JSON.parse(r.payload ?? "{}"), graphId }
        if (matches(filters, env)) push(env)
      }
    },
    cancel() {
      state.sessions.delete(id)
      state.subscriptions.delete(id)
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
