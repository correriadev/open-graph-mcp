// ---------------------------------------------------------------------------
// connect() — RPC + token plumbing (INT-2 T3). Deliberately does NOT wire any
// SSE lifecycle (session.created / presence beat / reattach / restart-recovery
// re-registration) — that's INT-2 T4, which extends the `OgHandle` this
// function returns rather than wrapping it. See the doc comments below on
// `OgHandle` and `resolveToken` for the exact scope line and why it sits
// where it does.
// ---------------------------------------------------------------------------

import type { Credentials, TokenStore } from "./store.ts"
import { toolCall } from "./rpc.ts"

export type ConnectOptions = {
  /** MCP server base URL, e.g. "http://localhost:8787" (no trailing slash required). */
  server: string
  /** ID5: which kind of agent is connecting (e.g. "web", "claude-code"). Unused by T3 — carried on
   * the handle for T4's presence.beat/focus wiring, which needs it. */
  agentKind: string
  /** Display name to register a fresh session under, if no usable token is already available. */
  name?: string
  /** An already-resolved token (e.g. a caller like mcp-web that persists its own way — localStorage —
   * and doesn't want this lib to own storage). Takes priority over `store`. */
  token?: string
  /** Token persistence + lookup. Consulted only if `token` is not given. See `resolveToken`. */
  store?: TokenStore
}

export type OgHandle = {
  readonly server: string
  readonly agentKind: string
  /** JSON-RPC `tools/call` to `{server}/mcp`. Auto-injects the resolved token into `args.token` if
   * the caller didn't already set one (server ignores it for tools that don't need auth). Throws on
   * `body.error` or `body.result?.isError === true` — see ./rpc.ts. */
  call(tool: string, args?: Record<string, unknown>): Promise<unknown>
  /** T3: no SSE connection exists yet, so this just marks the handle closed (further `call()`s throw).
   * T4 will extend this to also tear down the EventStream once it wires one up here. */
  close(): void
  // TODO(T4): og.on(kind | "*", handler) — SSE event dispatch.
  // TODO(T4): og.subscribe(filters) — graph.subscribe for this session.
  // TODO(T4): og.presence — presence.focus/beat wrapper with an automatic 15s beat timer.
  // TODO(T4): og.systemMessages(handler) — non-web agentKind system message channel (spec §8).
}

/**
 * Resolve the token to use for this connection, per the following precedence:
 *
 *  1. `opts.token` given → use it verbatim. No store read/write.
 *  2. `opts.store` given, `store.get()` returns credentials matching `server` → use that token.
 *  3. `opts.store` given, no matching cached credentials, `opts.name` given → register a fresh
 *     session (`tools/call session.register {name}`), persist the result via `store.set()`, use the
 *     new token. This is the direct equivalent of stdio-proxy's `resolveCredentials` (credentials.ts)
 *     MINUS its module-level in-process memoization — the store itself already serves that role here,
 *     and this function is called once per `connect()`, so there's no repeat-call cost to memoize
 *     away.
 *  4. `opts.store` given, no matching cached credentials, no `opts.name` → throw. There is nothing
 *     usable to authenticate with and nothing to register a fresh session under.
 *  5. Neither `token` nor `store` given → resolve to `null`. This is intentionally NOT an error:
 *     mirroring mcp-web's api.ts (which starts with `token = null` and works fine for Phase-1 tools
 *     that don't require auth), a caller that only ever calls unauthenticated tools has no reason to
 *     be forced into token plumbing. A Phase-2 tool call with no token fails naturally on the first
 *     `og.call()` with the server's own "invalid or expired token" message.
 *
 * Scope line vs T4: this function owns *initial* registration only (store empty/mismatched → fresh
 * token). It deliberately does NOT own re-registration after an already-resolved token goes stale
 * (e.g. the QA-1 gap: server restarts, in-memory tokens are wiped, a previously-valid on-disk token is
 * now dead) — detecting that requires inspecting a live SSE session / the result of an in-flight
 * og.call() and re-declaring presence afterward, which is squarely T4/T5's SSE-lifecycle territory
 * (this is also why EventStream.open()'s onClose() has no failure-reason argument yet — see subscribe.ts
 * review note; T4 is expected to thread one through). The two flows share the same underlying
 * primitive though (`tools/call session.register`), exactly like stdio-proxy's `reregisterCredentials`
 * shares `registerSession` with `resolveCredentials` — T4 shares this file's own `registerSession`
 * below the same way, rather than reinventing the RPC call.
 */
async function resolveToken(server: string, opts: ConnectOptions): Promise<string | null> {
  if (opts.token) return opts.token
  if (!opts.store) return null

  const existing = opts.store.get()
  if (existing && existing.server === server) return existing.token

  if (!opts.name) {
    throw new Error(
      `connect: no cached credentials for ${server} and no \`name\` provided to register a new session`,
    )
  }

  const creds = await registerSession(server, opts.name)
  opts.store.set(creds)
  return creds.token
}

/** Calls `session.register` and returns validated Credentials (throws on an unusable response shape).
 * Exported so T4's re-registration-after-expiry flow can share this instead of reimplementing the
 * validate+shape step — mirrors stdio-proxy's `registerSession()` being shared by both
 * `resolveCredentials()` (initial) and `reregisterCredentials()` (post-expiry) in credentials.ts.
 * Persistence (`store.set()`) is deliberately NOT done here — each caller owns when/whether to persist,
 * same split stdio-proxy uses. */
export async function registerSession(server: string, name: string): Promise<Credentials> {
  const registered = (await toolCall(server, "session.register", { name })) as Partial<Credentials> | null
  if (!registered?.token || !registered.userId || !registered.tenantId) {
    throw new Error("session.register returned no usable token")
  }
  return { server, token: registered.token, userId: registered.userId, tenantId: registered.tenantId }
}

export async function connect(opts: ConnectOptions): Promise<OgHandle> {
  const server = opts.server.replace(/\/$/, "")
  const token = await resolveToken(server, opts)
  let closed = false

  async function call(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (closed) throw new Error("connect: this handle is closed")
    const withToken = token && args.token === undefined ? { ...args, token } : args
    return toolCall(server, tool, withToken)
  }

  function close(): void {
    closed = true
  }

  return { server, agentKind: opts.agentKind, call, close }
}
