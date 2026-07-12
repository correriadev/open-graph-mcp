/**
 * index.ts — HTTP/SSE entrypoint (Bun.serve). Rotas: POST /mcp (JSON-RPC), GET /events (SSE),
 * GET / (health). CORS aberto (single-org trust — D2). Estado 100% em memória.
 *
 * `startServer` é a fábrica testável (porta efêmera, watch loop opcional, tick manual exposto).
 * Rodado direto (`bun dev`), `main` sobe na porta PORT (default 8787) sobre GRAPH_REPO_PATH
 * (default ./dev-repo), auto-bootstrap best-effort e watch loop de 5s.
 */
import type { Server } from "bun"
import { createState, type ServerState } from "./state"
import { handleRpc } from "./transport"
import { handleEvents } from "./sse"
import { bootstrap } from "./tools/graph-bootstrap"
import { startWatchLoop, tick } from "./watch-bridge"

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
}

export type StartOptions = { repoPath: string; port?: number; watch?: boolean; watchIntervalMs?: number; autoBootstrap?: boolean }
export type RunningServer = {
  state: ServerState
  server: Server
  url: string
  tick: () => Promise<unknown>
  stop: () => void
}

export function startServer(opts: StartOptions): RunningServer {
  const state = createState(opts.repoPath)
  if (opts.autoBootstrap) {
    try {
      bootstrap(state, opts.repoPath)
    } catch {
      /* sem .graph/ e sem fonte: sobe vazio, admin chama graph.bootstrap depois */
    }
  }

  const server = Bun.serve({
    port: opts.port ?? 0,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })

      if (url.pathname === "/events" && req.method === "GET") return handleEvents(state, url)

      if (url.pathname === "/mcp" && req.method === "POST") {
        let body: any
        try {
          body = await req.json()
        } catch {
          return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { headers: CORS })
        }
        const res = handleRpc(state, body)
        if (res === null) return new Response(null, { status: 204, headers: CORS })
        return Response.json(res, { headers: CORS })
      }

      if (url.pathname === "/") {
        return Response.json(
          { name: "open-graph-mcp", graphId: state.graphId, pipeline: state.pipeline, lastEventSeq: state.lastEventSeq, sessions: state.sessions.size },
          { headers: CORS },
        )
      }
      return new Response("not found", { status: 404, headers: CORS })
    },
  })

  const stopWatch = opts.watch === false ? () => {} : startWatchLoop(state, opts.watchIntervalMs ?? 5000)
  return {
    state,
    server,
    url: `http://localhost:${server.port}`,
    tick: () => tick(state),
    stop: () => {
      stopWatch()
      server.stop(true)
    },
  }
}

if (import.meta.main) {
  const repoPath = process.env.GRAPH_REPO_PATH ?? "./dev-repo"
  const running = startServer({ repoPath, port: Number(process.env.PORT ?? 8787), autoBootstrap: true })
  console.log(`open-graph MCP server on ${running.url} (repo: ${repoPath}, graphId: ${running.state.graphId || "—"})`)
}
