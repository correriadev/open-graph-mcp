/**
 * index.ts — HTTP/SSE entrypoint (Bun.serve). Rotas: POST /mcp (JSON-RPC), GET /events (SSE),
 * GET / (health). CORS aberto por padrão (`ALLOWED_ORIGINS` não setado → `*`, decisão D2 single-org
 * trust); configurável via `ALLOWED_ORIGINS` (lista separada por vírgula) para restringir Origin. Além
 * dos headers CORS (que só controlam se o JS de um browser pode LER a resposta), o servidor também
 * valida ativamente o header `Origin` em toda conexão (spec MCP: anti DNS-rebinding) — um `fetch()`
 * cross-origin ainda alcançaria e executaria a chamada mesmo sem CORS, então origins fora da allowlist
 * levam 403 antes de qualquer lógica de rota.
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
import { sweepPresence } from "./tools/presence"
import { sweepTyping } from "./tools/typing"

/** Exact-match only — no wildcard/subdomain matching (that would be too permissive for the check below).
 * A literal empty `Origin: ""` header is folded into the same "treat as absent" path as no header at
 * all — deliberate, not an oversight: browsers never send an empty Origin, so this only ever matters
 * for non-browser callers, which this check isn't concerned with either way. */
function isOriginAllowed(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) return true // non-browser clients (curl, SDKs) don't send Origin — not what this check is for
  if (allowedOrigins.includes("*")) return true
  return allowedOrigins.includes(origin)
}

/**
 * CORS response headers, computed per-request. `access-control-allow-origin` is `"*"` when the
 * allowlist is wildcard-open, echoes back the exact matched Origin when a specific allowlist is
 * configured, or is omitted entirely when the request has no Origin header at all (there's no browser
 * origin to authorize, and non-browser clients don't care about the header).
 *
 * Safe by construction, not by caller convention: this re-runs `isOriginAllowed` itself rather than
 * trusting that the caller already rejected disallowed origins before reaching here. A future call site
 * that calls this directly — skipping the 403 guard — still cannot get an unauthorized Origin echoed
 * back; it just silently omits the header instead, same as the no-Origin case.
 */
function corsHeaders(origin: string | null, allowedOrigins: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, mcp-protocol-version",
    "access-control-expose-headers": "MCP-Protocol-Version",
  }
  if (allowedOrigins.includes("*")) headers["access-control-allow-origin"] = "*"
  else if (origin && isOriginAllowed(origin, allowedOrigins)) headers["access-control-allow-origin"] = origin
  return headers
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
  presenceTtlMs?: number
  presenceSweepIntervalMs?: number
  focusDebounceMs?: number
  typingMs?: number
  idleMs?: number
  typingIntervalMs?: number
  /** Origin allowlist for the active DNS-rebinding check (spec: "MUST validate the Origin header on
   * all incoming connections"), exact-match only. Default `["*"]` preserves today's fully-open,
   * single-org-trust behavior (D2) — pass a specific list to restrict which browser Origins may reach
   * this server at all (not just which ones can read the response). */
  allowedOrigins?: string[]
}
export type RunningServer = {
  state: ServerState
  server: Server
  url: string
  tick: () => Promise<unknown>
  sweep: () => void
  flush: () => void
  sweepPresenceNow: () => void
  tickTypingNow: () => void
  stop: () => void
}

export function startServer(opts: StartOptions = {}): RunningServer {
  const stateDir = opts.stateDir ?? mkdtempSync(path.join(tmpdir(), "og-state-"))
  const state = createState({
    repoPath: opts.repoPath,
    stateDir,
    ttlMs: opts.ttlMs,
    presenceTtlMs: opts.presenceTtlMs,
    focusDebounceMs: opts.focusDebounceMs,
    typingMs: opts.typingMs,
    idleMs: opts.idleMs,
  })
  const watchTenant = opts.watchTenant ?? DEFAULT_TENANT
  const allowedOrigins = opts.allowedOrigins ?? ["*"]

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
      const origin = req.headers.get("origin")

      // Active DNS-rebinding guard (spec: "MUST validate the Origin header on all incoming
      // connections"). CORS headers alone only stop a browser from READING a cross-origin response —
      // they don't stop the request from reaching here and running. Reject before any route logic.
      // No Origin header at all (curl, the MCP SDK over Node, CLI clients) → not a browser, proceed.
      if (!isOriginAllowed(origin, allowedOrigins)) {
        return new Response("origin not allowed", { status: 403 })
      }

      const headers = corsHeaders(origin, allowedOrigins)
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers })

      if (url.pathname === "/events" && req.method === "GET") {
        // sse.ts hardcodes its own access-control-allow-origin: "*" on the Response it builds;
        // override it here (rather than touching that file — scope containment) so /events gets the
        // same computed, allowlist-aware CORS headers as every other route.
        const res = handleEvents(state, url)
        for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
        if (!("access-control-allow-origin" in headers)) res.headers.delete("access-control-allow-origin")
        return res
      }

      if (url.pathname === "/mcp" && req.method === "GET") {
        return new Response("method not allowed", { status: 405, headers: { ...headers, allow: "POST" } })
      }

      if (url.pathname === "/mcp" && req.method === "POST") {
        let body: any
        try {
          body = await req.json()
        } catch {
          return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { headers })
        }
        const res = handleRpc(state, body)
        if (res === null) return new Response(null, { status: 204, headers })

        // Stateless server (no Mcp-Session-Id — token lives in tool args, per D2): echo the
        // negotiated protocol version rather than tracking it per-session. A well-behaved client
        // sends MCP-Protocol-Version on every request after its initial `initialize` call, so echo
        // that back. The `initialize` call itself has no such header yet (that's what it's
        // negotiating) — for that one response, use the protocolVersion just negotiated in the
        // result body. Otherwise omit the header rather than send a garbage/empty value.
        const incomingVersion = req.headers.get("mcp-protocol-version")
        const negotiatedVersion = (res?.result as { protocolVersion?: string } | undefined)?.protocolVersion
        const protocolVersion = incomingVersion ?? negotiatedVersion
        const rpcHeaders = protocolVersion ? { ...headers, "mcp-protocol-version": protocolVersion } : headers
        return Response.json(res, { headers: rpcHeaders })
      }

      if (url.pathname === "/") {
        return Response.json({ name: "open-graph-mcp", stateDir, sessions: state.sessions.size, tenants: state.graphs.size }, { headers })
      }
      return new Response("not found", { status: 404, headers })
    },
  })

  const stopWatch = opts.watch === true && opts.repoPath ? startWatchLoop(state, opts.watchIntervalMs ?? 5000, watchTenant) : () => {}
  const stopSweeper = startSweeper(state, {
    sweepIntervalMs: opts.sweepIntervalMs,
    aggIntervalMs: opts.aggIntervalMs,
    presenceSweepIntervalMs: opts.presenceSweepIntervalMs,
    typingIntervalMs: opts.typingIntervalMs,
  })

  return {
    state,
    server,
    url: `http://localhost:${server.port}`,
    tick: () => tick(state, watchTenant),
    sweep: () => sweepTtl(state),
    flush: () => flushDeltas(state),
    sweepPresenceNow: () => sweepPresence(state),
    tickTypingNow: () => sweepTyping(state),
    stop: () => {
      stopWatch()
      stopSweeper()
      for (const t of state.focusDebounce.values()) clearTimeout(t)
      state.focusDebounce.clear()
      server.stop(true)
      state.db.close()
    },
  }
}

if (import.meta.main) {
  const repoPath = process.env.GRAPH_REPO_PATH ?? process.env.WATCH_REPO_PATH
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const running = startServer({
    repoPath,
    stateDir: process.env.STATE_DIR ?? ".graph-server",
    port: Number(process.env.PORT ?? 8787),
    autoBootstrap: !!repoPath,
    watch: !!process.env.WATCH_REPO_PATH,
    watchTenant: process.env.WATCH_TENANT ?? DEFAULT_TENANT,
    allowedOrigins,
  })
  console.log(`open-graph MCP server on ${running.url} (repo: ${repoPath ?? "— pure-knowledge"}, state: ${process.env.STATE_DIR ?? ".graph-server"})`)
}
