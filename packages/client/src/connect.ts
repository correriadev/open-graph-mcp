// ---------------------------------------------------------------------------
// connect() — RPC + token plumbing (T3) PLUS the full SSE/presence lifecycle
// (T4): og.on/subscribe/presence.focus/systemMessages, the 15s beat timer,
// reconnect-driven redeclare + reattach (spec §9), and the QA-1 fix — a live
// call that fails with an expired/invalid token auto re-registers (same
// `name` the caller originally connected with), persists the fresh token,
// retries the failed call once, and redeclares presence against the new
// token/session. See `OgHandle` and `resolveToken` below for the exact
// contracts.
// ---------------------------------------------------------------------------

import type { Credentials, TokenStore } from "./store.ts"
import { toolCall } from "./rpc.ts"
import { EventStream, type Envelope } from "./subscribe.ts"

/** Fired by `og`'s QA-1 auto-recovery path, so a caller can observe it happening (or failing) instead of
 * it being fully silent. If omitted, `connect()` falls back to `console.warn`/`console.error` so the
 * recovery is never completely invisible to someone debugging "why did presence blip". */
export type ReauthEvent = { type: "reregistered"; creds: Credentials } | { type: "reregister-failed"; error: unknown }

export type ConnectOptions = {
  /** MCP server base URL, e.g. "http://localhost:8787" (no trailing slash required). */
  server: string
  /** ID5: which kind of agent is connecting (e.g. "web", "claude-code"). Sent on every presence.focus/
   * beat call, matching mcp-web's api.presenceBeat(sessionId, "web") — not just the first. */
  agentKind: string
  /** Display name to register a fresh session under, if no usable token is already available. ALSO the
   * name the QA-1 auto-re-register flow reuses (see `OgHandle.call`'s doc comment) — without this, a
   * dead token cannot be recovered automatically and the triggering error just propagates. */
  name?: string
  /** Tenant to register under (server default: "default" — see session.ts's `session.register {name,
   * tenant?}`). Reused verbatim by the QA-1 re-register flow, same as `name`. */
  tenant?: string
  /** An already-resolved token (e.g. a caller like mcp-web that persists its own way — localStorage —
   * and doesn't want this lib to own storage). Takes priority over `store`. */
  token?: string
  /** Token persistence + lookup. Consulted only if `token` is not given. See `resolveToken`. Also where
   * a freshly auto-re-registered token (QA-1 fix) gets persisted, if given. */
  store?: TokenStore
  /** Fired once per SSE connection opening (mirrors EventStream's onOpen — e.g. drive a "connected" UI
   * indicator). */
  onOpen?: () => void
  /** Fired once per SSE disconnect (a backoff-then-reconnect follows automatically — mirrors onClose). */
  onClose?: () => void
  /** Fired when the SSE stream detects a graphId reset (spec §6) — the server re-bootstrapped and any
   * locally cached snapshot is stale; the caller should refetch it. */
  onReset?: () => void
  /** Fired with the `changeset.list_mine` result after every fresh SSE session id (spec §9 reattach) —
   * lets the caller recover UI state for changesets it still has open. */
  onReattach?: (result: unknown) => void
  /** Fired by the QA-1 auto-re-register recovery path — see `ReauthEvent`. */
  onReauth?: (event: ReauthEvent) => void
}

export type OgHandle = {
  readonly server: string
  readonly agentKind: string
  /** JSON-RPC `tools/call` to `{server}/mcp`. Auto-injects the resolved token into `args.token` if the
   * caller didn't already set one (server ignores it for tools that don't need auth). Throws on
   * `body.error` or `body.result?.isError === true` — see ./rpc.ts.
   *
   * QA-1 auto-recovery: if the call fails with the server's "invalid or expired token" error (thrown by
   * `requireToken`, packages/mcp-server/src/tools/session.ts) AND the token was auto-injected (not an
   * explicit `args.token`) AND `opts.name` is available, this re-registers a fresh session under that
   * SAME name via `registerSession()`, persists it (if a store was given), updates the live token, and
   * retries this ONE call exactly once (never loops — a second failure propagates). With no `name`
   * available (e.g. a bare `token` was passed to `connect()`), there is nothing to re-register with, so
   * the original error just propagates. */
  call(tool: string, args?: Record<string, unknown>): Promise<unknown>
  /** Register a handler for SSE envelope events of `kind` (or `"*"` for all kinds). Returns an
   * unsubscribe function. */
  on(kind: string | "*", handler: (env: Envelope) => void): () => void
  /** `graph.subscribe` for this SSE session — replaces its server-side event filters (default
   * `[{kind:"all"}]`). Requires a live session (a `session.created` frame must have arrived first). */
  subscribe(filters: Array<Record<string, unknown>>): Promise<unknown>
  presence: {
    /** Declare (or clear, if `cell` is null) this session's focus cell. A no-op (besides recording the
     * intent locally) until an SSE session id exists — mirrors mcp-web's `declareFocus` guard. Once a
     * session exists, an automatic `presence.beat` fires every 15s for as long as the connection stays
     * open — no manual timer needed. */
    focus(cell: string | null, opts?: { invisible?: boolean }): Promise<void>
  }
  /** Surfaces `system.message` kind envelopes — text-only presence/notification for non-web agentKinds
   * (spec §8, ID5). Thin wrapper over `on("system.message", handler)`. */
  systemMessages(handler: (env: Envelope) => void): () => void
  /** Tears down the SSE connection and the beat timer, and marks the handle closed (further `call()`s
   * throw). */
  close(): void
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
 * Scope line vs the QA-1 re-register flow below: this function owns *initial* registration only (store
 * empty/mismatched → fresh token). Re-registration after an already-resolved token goes stale (e.g. a
 * server restart wiping in-memory tokens) is handled inside `connect()`'s `call()`/`redeclarePresence()`
 * — it shares this file's `registerSession()` the same way `resolveToken` does, rather than reinventing
 * the RPC call (mirrors stdio-proxy's `resolveCredentials`/`reregisterCredentials` sharing
 * `registerSession`).
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

  const creds = await registerSession(server, opts.name, opts.tenant)
  opts.store.set(creds)
  return creds.token
}

/** Calls `session.register` and returns validated Credentials (throws on an unusable response shape).
 * Exported so both `resolveToken` (initial registration) and `connect()`'s QA-1 re-registration-after-
 * expiry flow can share this instead of reimplementing the validate+shape step — mirrors stdio-proxy's
 * `registerSession()` being shared by both `resolveCredentials()` (initial) and
 * `reregisterCredentials()` (post-expiry) in credentials.ts. Persistence (`store.set()`) is deliberately
 * NOT done here — each caller owns when/whether to persist, same split stdio-proxy uses. */
export async function registerSession(server: string, name: string, tenant?: string): Promise<Credentials> {
  const registered = (await toolCall(server, "session.register", tenant ? { name, tenant } : { name })) as Partial<Credentials> | null
  if (!registered?.token || !registered.userId || !registered.tenantId) {
    throw new Error("session.register returned no usable token")
  }
  return { server, token: registered.token, userId: registered.userId, tenantId: registered.tenantId }
}

/** The exact substring of the server's `requireToken` error (packages/mcp-server/src/tools/session.ts:
 * `"invalid or expired token — call session.register"`) that identifies a dead-token failure, as opposed
 * to a transient/other error. rpc.ts's `rpc()` throws `Error(\`${method} → ${text}\`)` on `isError:true`,
 * so the substring survives into the thrown message regardless of which tool failed. */
function isExpiredTokenError(e: unknown): boolean {
  return e instanceof Error && /invalid or expired token/i.test(e.message)
}

export async function connect(opts: ConnectOptions): Promise<OgHandle> {
  const server = opts.server.replace(/\/$/, "")
  let token = await resolveToken(server, opts)
  let closed = false
  let sessionId: string | null = null
  let focusState: { cell: string | null; invisible: boolean } = { cell: null, invisible: false }
  let reregisterPromise: Promise<void> | null = null

  const handlers = new Map<string, Set<(env: Envelope) => void>>()

  function dispatch(env: Envelope): void {
    handlers.get(env.kind)?.forEach((h) => h(env))
    handlers.get("*")?.forEach((h) => h(env))
  }

  function on(kind: string, handler: (env: Envelope) => void): () => void {
    let set = handlers.get(kind)
    if (!set) handlers.set(kind, (set = new Set()))
    set.add(handler)
    return () => {
      set!.delete(handler)
    }
  }

  async function rawCall(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const withToken = token && args.token === undefined ? { ...args, token } : args
    return toolCall(server, tool, withToken)
  }

  /** doc comment on OgHandle.call above covers the QA-1 retry-once contract this implements. The retry
   * calls `rawCall` directly (not `call`), so it structurally cannot loop — there's no flag to track. */
  async function call(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (closed) throw new Error("connect: this handle is closed")
    try {
      return await rawCall(tool, args)
    } catch (e) {
      if (!isExpiredTokenError(e) || !opts.name || args.token !== undefined) throw e
      await ensureReregistered()
      return rawCall(tool, args) // retry the one failed call, exactly once, using the now-fresh token
    }
  }

  /** Dedupes concurrent re-register attempts (e.g. presence.focus and changeset.list_mine both failing
   * on the same dead token right after a reconnect) into a single `session.register` RPC — every caller
   * awaits the same in-flight promise instead of each firing its own. */
  function ensureReregistered(): Promise<void> {
    if (!reregisterPromise) {
      reregisterPromise = doReregister().finally(() => {
        reregisterPromise = null
      })
    }
    return reregisterPromise
  }

  async function doReregister(): Promise<void> {
    try {
      const creds = await registerSession(server, opts.name!, opts.tenant)
      token = creds.token
      opts.store?.set(creds)
      if (opts.onReauth) opts.onReauth({ type: "reregistered", creds })
      else console.warn(`connect: auto re-registered session for ${server} after an expired/invalid token (QA-1 recovery)`)
    } catch (e) {
      if (opts.onReauth) opts.onReauth({ type: "reregister-failed", error: e })
      else console.error("connect: auto re-register failed", e)
      throw e
    }
    // Force the SSE connection itself to reconnect, rather than just redeclaring presence over the
    // existing one. The existing connection's server-side Session.userId (packages/mcp-server/src/
    // sse.ts) was bound ONCE at connect time from the token that was live then — dead token → bound to
    // null — and affinity routing for user-targeted events (lock.denied always, changeset.aborted/delta's
    // holder fallback — see affinity.ts's `sessionsOfUser`) keys off THAT binding, not off presence
    // records. Redeclaring presence.focus/beat on the same connection would fix the presence ROSTER but
    // leave this session permanently unable to receive its own "you lost the lock" notifications until
    // some other reconnect happened to occur. stop()+start() (not reset() — that would also zero lastSeq
    // and replay the whole log, duplicating sidebar entries/re-toasting old commits) opens a fresh
    // connection with the now-current token, which re-binds Session.userId correctly server-side and
    // naturally triggers onSessionId → redeclarePresence() (the call()-based, retry-capable one) against
    // the new session — no separate redeclare call needed here.
    stream.stop()
    stream.start()
  }

  /**
   * Re-declares focus THEN beat against the current session/token (spec §9.1 order — see the doc comment
   * on mcp-web's old `declarePresence()`, preserved here verbatim: the server only suppresses
   * `user.joined` for invisible users when the very first presence-registering call already carries
   * `invisible:true`; a beat-first order would announce a user who asked not to be shown). Called after
   * every fresh SSE session id (reconnect) — goes through `call()` so a dead token discovered right here
   * (the QA-1 trigger path) still auto-recovers (see `doReregister`'s stream.stop()/start() for why that
   * recovery forces a fresh SSE connection rather than redeclaring on the old one).
   */
  async function redeclarePresence(): Promise<void> {
    if (!sessionId || !token) return
    await call("presence.focus", {
      sessionId,
      cell: focusState.cell,
      invisible: focusState.invisible,
      agentKind: opts.agentKind,
    })
    await call("presence.beat", { sessionId, agentKind: opts.agentKind })
  }

  const presence = {
    async focus(cell: string | null, focusOpts?: { invisible?: boolean }): Promise<void> {
      focusState = { cell, invisible: focusOpts?.invisible ?? focusState.invisible }
      if (!sessionId || !token) return // presence tools need a live SSE session + auth, same as mcp-web's guard
      await call("presence.focus", {
        sessionId,
        cell,
        invisible: focusState.invisible,
        agentKind: opts.agentKind,
      })
    },
  }

  function systemMessages(handler: (env: Envelope) => void): () => void {
    return on("system.message", handler)
  }

  async function subscribe(filters: Array<Record<string, unknown>>): Promise<unknown> {
    if (!sessionId) throw new Error("connect: subscribe() requires a live SSE session (no session.created received yet)")
    return call("graph.subscribe", { sessionId, filters })
  }

  const stream = new EventStream(
    {
      onEvent: dispatch,
      onReset: () => opts.onReset?.(),
      onOpen: () => opts.onOpen?.(),
      onClose: () => opts.onClose?.(),
      // Every (re)connection mints a fresh SSE session id; presence is keyed to it (spec §3.3), so
      // re-declare it each time (spec §9.1), and recover any changesets this session still has open
      // (spec §9 reattach) via changeset.list_mine.
      onSessionId: (id) => {
        sessionId = id
        redeclarePresence().catch((e) => console.error("connect: presence redeclare on reconnect failed", e))
        if (token) {
          call("changeset.list_mine", {})
            .then((result) => opts.onReattach?.(result))
            .catch((e) => console.error("connect: reattach (changeset.list_mine) failed", e))
        }
      },
    },
    { serverBase: () => server, getToken: () => token },
  )

  const beatTimer = setInterval(() => {
    if (sessionId && token) {
      call("presence.beat", { sessionId, agentKind: opts.agentKind }).catch((e) =>
        console.error("connect: presence.beat failed", e),
      )
    }
  }, 15_000)

  function close(): void {
    closed = true
    clearInterval(beatTimer)
    stream.stop()
  }

  stream.start()

  return { server, agentKind: opts.agentKind, call, on, subscribe, presence, systemMessages, close }
}
