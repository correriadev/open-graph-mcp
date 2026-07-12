/**
 * sse.ts — GET /events?since=N&filter=... (spec §4.2). Um SSE por sessão. Primeiro frame:
 * `session.created { sessionId, graphId }`. Depois o tail do log desde N (filtrado server-side) e,
 * ao vivo, cada evento novo que casa o filtro da sessão. Filtro inline via query é atalho p/ clientes
 * burros; graph.subscribe (tool) é a via canônica e substitui os filtros desta sessão.
 */
import type { EventEnvelope, Filter, ServerState } from "./state"
import { matches } from "./state"

/** "all" | "cell:<domain:level>" | "domain:<d>" | "event:<k1,k2>" */
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
    case "event":
      return [{ kind: "event", events: val.split(",").filter(Boolean) }]
    default:
      return [{ kind: "all" }]
  }
}

function frame(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export function handleEvents(state: ServerState, url: URL): Response {
  const since = Number(url.searchParams.get("since") ?? 0)
  const filters = parseFilterParam(url.searchParams.get("filter"))
  const id = `s${++state.sessionCounter}`

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (env: EventEnvelope) => {
        try {
          controller.enqueue(frame(env.kind, env))
        } catch {
          /* cliente desconectou entre o match e o enqueue */
        }
      }
      state.sessions.set(id, { id, filters, push })
      state.subscriptions.set(id, filters)

      controller.enqueue(frame("session.created", { sessionId: id, graphId: state.graphId }))
      // tail do log desde `since`, filtrado pelo filtro corrente da sessão
      for (const env of state.log) {
        if (env.seq > since && matches(state.sessions.get(id)!.filters, env)) push(env)
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
