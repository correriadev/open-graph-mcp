/**
 * index.ts — HTTP/SSE entrypoint (Bun.serve). Rotas: POST /mcp (JSON-RPC), GET /events (SSE),
 * GET / (health). CORS aberto (single-org trust — D2).
 *
 * Fase 2: o estado durável vive em STATE_DIR (SQLite `state.sqlite` + espelho JSONL por tenant). O grafo
 * de conhecimento (query/watch) segue em memória por tenant. `startServer` é a fábrica testável: porta
 * efêmera, stateDir isolado (temp por padrão nos testes), tick/sweep/flush manuais expostos, intervalos
 * overridáveis. Rodado direto (`bun dev`), sobe na PORT (default 8787) sobre GRAPH_REPO_PATH + STATE_DIR.
 */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Server } from "bun"
import { createState, DEFAULT_TENANT, type ServerState } from "./state"
import { handleRpc } from "./transport"
import { handleEvents } from "./sse"
import { bootstrap } from "./tools/graph-bootstrap"
import { startWatchLoop, tick } from "./watch-bridge"
import { startSweeper, sweepTtl, flushDeltas } from "./sweeper"

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
}

export type StartOptions = {
  repoPath?: string
  stateDir?: string
  port?: number
  watch?: boolean
  watchIntervalMs?: number
  watchTenant?: string
  autoBootstrap?: boolean
  ttlMs?: number
  sweepIntervalMs?: number
  aggIntervalMs?: number
}
export type RunningServer = {
  state: ServerState
  server: Server
  url: string
  tick: () => Promise<unknown>
  sweep: () => void
  flush: () => void
  stop: () => void
}

export function startServer(opts: StartOptions = {}): RunningServer {
  const stateDir = opts.stateDir ?? mkdtempSync(path.join(tmpdir(), "og-state-"))
  const state = createState({ repoPath: opts.repoPath, stateDir, ttlMs: opts.ttlMs })
  const watchTenant = opts.watchTenant ?? DEFAULT_TENANT

  if (opts.autoBootstrap && opts.repoPath) {
    try {
      bootstrap(state, opts.repoPath)
    } catch {
      /* sem .graph/ e sem fonte: sobe vazio, admin chama graph.bootstrap/import depois */
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
        return Response.json({ name: "open-graph-mcp", stateDir, sessions: state.sessions.size, tenants: state.graphs.size }, { headers: CORS })
      }
      return new Response("not found", { status: 404, headers: CORS })
    },
  })

  const stopWatch = opts.watch === true && opts.repoPath ? startWatchLoop(state, opts.watchIntervalMs ?? 5000, watchTenant) : () => {}
  const stopSweeper = startSweeper(state, { sweepIntervalMs: opts.sweepIntervalMs, aggIntervalMs: opts.aggIntervalMs })

  return {
    state,
    server,
    url: `http://localhost:${server.port}`,
    tick: () => tick(state, watchTenant),
    sweep: () => sweepTtl(state),
    flush: () => flushDeltas(state),
    stop: () => {
      stopWatch()
      stopSweeper()
      server.stop(true)
      state.db.close()
    },
  }
}

if (import.meta.main) {
  const repoPath = process.env.GRAPH_REPO_PATH ?? process.env.WATCH_REPO_PATH
  const running = startServer({
    repoPath,
    stateDir: process.env.STATE_DIR ?? ".graph-server",
    port: Number(process.env.PORT ?? 8787),
    autoBootstrap: !!repoPath,
    watch: !!process.env.WATCH_REPO_PATH,
    watchTenant: process.env.WATCH_TENANT ?? DEFAULT_TENANT,
  })
  console.log(`open-graph MCP server on ${running.url} (repo: ${repoPath ?? "— pure-knowledge"}, state: ${process.env.STATE_DIR ?? ".graph-server"})`)
}
