// ---------------------------------------------------------------------------
// connect() — RPC + token plumbing (T3) PLUS the full SSE/presence lifecycle
// (T4): og.on/subscribe/presence.focus/systemMessages, the 15s beat timer,
// reconnect-driven redeclare + reattach (spec §9), and the QA-1 fix — a live
// call that fails with an expired/invalid token auto re-registers (same
// `name` the caller originally connected with), persists the fresh token,
// retries the failed call once, and redeclares presence against the new
// token/session.
//
// PLUS (T5) `connect({live:false})` — the ID2 polling fallback: same
// `OgHandle` surface, but no SSE connection is ever opened. `on()` events are
// synthesized from polling `graph://history?since=N` (durable graph events)
// and `presence.who` (presence roster diff) on an interval instead of being
// pushed over SSE. A caller writes `og.on(...)`/`og.presence.focus(...)`
// once and it behaves the same regardless of `live` — see the doc comment on
// `ConnectOptions.live` for the exact fidelity tradeoffs this makes, and
// `onFreshSession`/`pollTick` below for where the two modes actually diverge
// (deliberately kept to two small points — "how do I learn about new
// envelopes" and "close() cleanup" — everything else, including the QA-1
// re-register machinery, is shared).
//
// See `OgHandle` and `resolveToken` below for the exact contracts.
// ---------------------------------------------------------------------------

import type { Credentials, TokenStore } from "./store.ts"
import { toolCall, resourceRead } from "./rpc.ts"
import { EventStream, classifyEnvelope, type Envelope } from "./subscribe.ts"

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
  /** `true` (default): open a live SSE connection (`EventStream`) — `on()` handlers and presence updates
   * are pushed in near-real-time. `false` (ID2 — docs/roadmap-integrations/README.md's governing
   * principle: "camada viva NUNCA vira requisito"): no SSE connection is opened at all. Instead:
   *  - `on()` events for durable graph changes are synthesized by polling `graph://history?since=N`
   *    (a resource read, not a tool call) on an interval and diffing against the last-seen seq/graphId
   *    via the same `classifyEnvelope` SSE mode uses for reset/dedup — see `pollHistoryOnce` below.
   *  - `on("user.*", …)` events are synthesized by polling `presence.who` and diffing the roster against
   *    the previous poll's snapshot (join/left/focus-changed) — see `pollWhoOnce` below. This is a
   *    DELIBERATE fidelity tradeoff over just exposing the raw `presence.who` snapshot (which
   *    mcp-web's own `pollWho()` does today, feeding `PresenceStore.mergeWho()` directly): synthesizing
   *    events keeps `og.on("user.joined", …)` / `PresenceStore.apply(env)` consumers working IDENTICALLY
   *    in both modes (the whole point of this flag — a plugin writes `og.on(...)` once), at the cost of
   *    losing `user.typing_state` entirely (presence.who carries no typing signal) and only detecting
   *    joined/left/focus changes at poll granularity (`pollIntervalMs`), not SSE's near-real-time
   *    debounced broadcasts.
   *  - `presence.focus`/`presence.beat` are still plain RPCs via `og.call` (identical to live mode) —
   *    only the locally-scoped session id they're sent against differs: live mode waits for the
   *    server-minted SSE session id (`session.created`), polling mode mints its own opaque local one
   *    immediately at connect() (there is no SSE connection to mint one server-side). Server-side,
   *    `presence.beat`/`.focus` (mcp-server/src/tools/presence.ts `touch()`) key Presence purely off
   *    that sessionId string plus token-derived identity — it doesn't need to correspond to a real SSE
   *    `Session` object, so this works with no server changes.
   *  - `og.subscribe(filters)` is a local no-op (see its doc comment below) — polling mode has no SSE
   *    session for server-side filters to narrow; `graph.history` already delivers everything.
   * Either way, the QA-1 auto-re-register-on-expired-token recovery applies equally (see `call`'s and
   * `readHistory`'s shared `withReregister` wrapper) — a token can go stale in polling mode too (e.g. a
   * server restart wiping in-memory tokens mid-poll-cycle). */
  live?: boolean
  /** Polling-mode-only: interval (ms) between `graph.history`/`presence.who` polls. Default 10_000,
   * matching mcp-web's `pollWho()` reference cadence (packages/mcp-web/src/main.ts). Ignored when `live`
   * is true (or left at its `true` default). Exposed mainly so tests don't have to wait out a real
   * 10-second interval. */
  pollIntervalMs?: number
  /** Fired once per SSE connection opening (mirrors EventStream's onOpen — e.g. drive a "connected" UI
   * indicator). Live mode only — polling mode has no connection to open. */
  onOpen?: () => void
  /** Fired once per SSE disconnect (a backoff-then-reconnect follows automatically — mirrors onClose).
   * Live mode only. */
  onClose?: () => void
  /** Fired when a graphId reset is detected (spec §6) — the server re-bootstrapped and any locally
   * cached snapshot is stale; the caller should refetch it. Fires in both modes: live mode detects it
   * from the SSE stream, polling mode detects it from a `graph.history` poll landing on a different
   * `graphId` than previously seen (see `pollHistoryOnce`). */
  onReset?: () => void
  /** Fired with the `changeset.list_mine` result after every fresh "session" — every SSE reconnect in
   * live mode (spec §9 reattach), or once at connect() in polling mode (a polling handle's session id
   * never changes) — lets the caller recover UI state for changesets it still has open. */
  onReattach?: (result: unknown) => void
  /** Fired by the QA-1 auto-re-register recovery path — see `ReauthEvent`. Shared by both modes. */
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
   * the original error just propagates. Identical in both `live` and polling mode — see `withReregister`. */
  call(tool: string, args?: Record<string, unknown>): Promise<unknown>
  /** Register a handler for envelope events of `kind` (or `"*"` for all kinds) — pushed over SSE in live
   * mode, synthesized from polling in `live:false` mode (see `ConnectOptions.live`). Returns an
   * unsubscribe function. */
  on(kind: string | "*", handler: (env: Envelope) => void): () => void
  /** `graph.subscribe` for this SSE session — replaces its server-side event filters (default
   * `[{kind:"all"}]`). Requires a live session (a `session.created` frame must have arrived first). In
   * `live:false` mode this is a local no-op that resolves `{ok:true}` without an RPC round trip — see
   * `ConnectOptions.live`'s doc comment for why (no SSE session exists for server-side filters to
   * narrow; polling already delivers everything via `graph.history`). */
  subscribe(filters: Array<Record<string, unknown>>): Promise<unknown>
  presence: {
    /** Declare (or clear, if `cell` is null) this session's focus cell. In live mode this is a no-op
     * (besides recording the intent locally) until an SSE session id exists — mirrors mcp-web's
     * `declareFocus` guard; the recorded intent still takes effect once a session forms, via
     * onFreshSession's redeclare. In polling mode a local session id exists immediately at connect(),
     * so this takes effect right away. Once a session id exists, an automatic `presence.beat` fires
     * every 15s for as long as the connection/handle stays open — no manual timer needed, in either
     * mode. Resolves `true` if this call actually reached the server, `false` if it was only recorded
     * locally (no session yet) — most callers can ignore the return value (mcp-web does); it exists for
     * a caller that needs to know whether THIS call landed, not just that the intent is remembered. */
    focus(cell: string | null, opts?: { invisible?: boolean }): Promise<boolean>
    /** Send ONE explicit `presence.beat` immediately, reusing the exact same RPC the automatic 15s
     * timer sends (see `beatOnce` below for the shared implementation and why this THROWS on no session
     * — unlike `focus`'s `false` return — rather than silently no-op'ing). Resolves to the server's raw
     * unwrapped result (e.g. `{ok:true, serverTs}`) rather than discarding it, so a caller relaying this
     * over another transport (the stdio `--live` proxy) can forward genuine server content. */
    beat(): Promise<unknown>
  }
  /** Surfaces `system.message` kind envelopes — text-only presence/notification for non-web agentKinds
   * (spec §8, ID5). Thin wrapper over `on("system.message", handler)`. */
  systemMessages(handler: (env: Envelope) => void): () => void
  /** Tears down the SSE connection and beat timer (live mode), or the poll interval and beat timer
   * (polling mode), and marks the handle closed (further `call()`s throw). */
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
 * server restart wiping in-memory tokens) is handled inside `connect()`'s `withReregister()` — it shares
 * this file's `registerSession()` the same way `resolveToken` does, rather than reinventing the RPC call
 * (mirrors stdio-proxy's `resolveCredentials`/`reregisterCredentials` sharing `registerSession`).
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

/** Mints an opaque, locally-unique session id for polling mode (`live:false`) — there is no SSE
 * connection to mint one server-side (spec §3.3 session ids are UUIDs from mcp-server/src/sse.ts).
 * `presence.beat`/`.focus` (mcp-server/src/tools/presence.ts `touch()`) only need this to be a stable,
 * distinguishing string for the lifetime of the handle — they key Presence off it plus token-derived
 * identity, and reject a mismatched-identity call on the same id (NOT_OWNED) rather than trusting the id
 * alone — so `crypto.randomUUID()`'s collision odds are already generous for this use, not a security
 * boundary the way a real SSE session id is. */
function localSessionId(): string {
  return `poll-${crypto.randomUUID()}`
}

export async function connect(opts: ConnectOptions): Promise<OgHandle> {
  const server = opts.server.replace(/\/$/, "")
  const live = opts.live !== false
  const pollIntervalMs = opts.pollIntervalMs ?? 10_000
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

  async function rawReadHistory(since: number): Promise<{ graphId: string; since: number; events: Envelope[] }> {
    return resourceRead(server, `graph://history?since=${since}`, token ?? undefined)
  }

  /**
   * Shared QA-1 retry-once wrapper: any RPC this handle makes — a `tools/call` (`call`) or a
   * `resources/read` (`readHistory`, polling mode) — routes through here rather than each reimplementing
   * the "expired token → re-register → retry once" dance. `tokenWasExplicit` mirrors `call`'s original
   * `args.token !== undefined` guard (an explicitly-passed token is the caller's problem to refresh, not
   * ours to silently override). The retry calls `exec` again directly (not through this wrapper), so it
   * structurally cannot loop — there's no flag to track.
   */
  async function withReregister<T>(exec: () => Promise<T>, tokenWasExplicit: boolean): Promise<T> {
    try {
      return await exec()
    } catch (e) {
      if (!isExpiredTokenError(e) || !opts.name || tokenWasExplicit) throw e
      await ensureReregistered()
      return exec() // retry the one failed call, exactly once, using the now-fresh token
    }
  }

  async function call(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (closed) throw new Error("connect: this handle is closed")
    return withReregister(() => rawCall(tool, args), args.token !== undefined)
  }

  /** Polling-mode read of `graph://history?since=N` (a resource, not a tool — see rpc.ts's
   * `resourceRead`). Routed through the same `withReregister` machinery `call()` uses: today
   * `resources/read` (mcp-server/src/transport.ts `tenantOf`) silently falls back to the default tenant
   * on a bad/unknown token instead of throwing, so this path doesn't currently exercise the retry — but
   * `presence.who` (a real `call()`, used by `pollWhoOnce` below) already does, and routing history reads
   * the same way keeps both poll paths uniformly recoverable if that server behavior ever tightens. */
  async function readHistory(since: number): Promise<{ graphId: string; since: number; events: Envelope[] }> {
    if (closed) throw new Error("connect: this handle is closed")
    return withReregister(() => rawReadHistory(since), false)
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
    //
    // `stream` is null in polling mode (no SSE connection exists), so this is a no-op there — and
    // rightly so: polling mode has no server-side Session.userId binding to go stale in the first place
    // (presence.beat/.focus resolve identity fresh from the token on every call, see `touch()` in
    // mcp-server/src/tools/presence.ts), so the next poll tick picks up the refreshed `token` closure
    // variable on its own with nothing extra to force.
    stream?.stop()
    stream?.start()
  }

  /**
   * Re-declares focus THEN beat against the current session/token (spec §9.1 order — see the doc comment
   * on mcp-web's old `declarePresence()`, preserved here verbatim: the server only suppresses
   * `user.joined` for invisible users when the very first presence-registering call already carries
   * `invisible:true`; a beat-first order would announce a user who asked not to be shown). Called after
   * every fresh session id — an SSE reconnect in live mode, or once at connect() in polling mode (see
   * `onFreshSession`) — goes through `call()` so a dead token discovered right here (the QA-1 trigger
   * path) still auto-recovers (see `doReregister`'s stream.stop()/start() for why that recovery forces a
   * fresh SSE connection rather than redeclaring on the old one, live mode only).
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

  /** The one place `presence.beat`'s argument shape is built — shared by the automatic 15s timer below
   * and the explicit `presence.beat()` method exposed on `OgHandle` (Design Decision A, INT-2's stdio
   * `--live` proxy). Throws (doesn't silently return) when no session id exists yet: the automatic
   * timer only ever calls this once `sessionId && token` are already known-true (see its own guard), so
   * this throw path is only ever reachable via the explicit method, where a caller with an observable
   * expectation ("did my beat land?") deserves to know it didn't, rather than a lying "ok". */
  async function beatOnce(): Promise<unknown> {
    if (!sessionId || !token) {
      throw new Error("connect: presence.beat() requires a live session (no session id yet)")
    }
    return call("presence.beat", { sessionId, agentKind: opts.agentKind })
  }

  const presence = {
    async focus(cell: string | null, focusOpts?: { invisible?: boolean }): Promise<boolean> {
      focusState = { cell, invisible: focusOpts?.invisible ?? focusState.invisible }
      // presence tools need a live session + auth, same as mcp-web's guard. Deliberately NOT a throw
      // (unlike beat()): the recorded focusState above still takes effect via onFreshSession's
      // redeclarePresence() once a session forms, so "no session yet" isn't a failure for THIS handle —
      // see ConnectOptions.live's doc and connect.test.ts's redeclare-on-fresh-session coverage. The
      // boolean return lets a caller that DOES care whether this specific call reached the server (e.g.
      // cli.ts's stdio --live proxy, relaying an honest result to its own caller) tell the difference,
      // without forcing every caller (mcp-web discards the return value today) to handle a rejection.
      if (!sessionId || !token) return false
      await call("presence.focus", {
        sessionId,
        cell,
        invisible: focusState.invisible,
        agentKind: opts.agentKind,
      })
      return true
    },
    beat: beatOnce,
  }

  function systemMessages(handler: (env: Envelope) => void): () => void {
    return on("system.message", handler)
  }

  async function subscribe(filters: Array<Record<string, unknown>>): Promise<unknown> {
    if (!live) {
      // ID2: polling mode never opens an SSE session, so there is nothing server-side for
      // `graph.subscribe` filters to narrow — `graph.history` polling already delivers every durable
      // event regardless of filters. A local no-op success (no RPC at all) keeps this callable
      // identically in both modes without a caller having to branch on `live`.
      return { ok: true }
    }
    if (!sessionId) throw new Error("connect: subscribe() requires a live SSE session (no session.created received yet)")
    return call("graph.subscribe", { sessionId, filters })
  }

  /**
   * Shared "a fresh session now exists" hook: a real SSE `session.created` frame in live mode (may fire
   * again on every reconnect), or invoked once synchronously below at connect() in polling mode (a
   * polling handle's local session id never changes for its lifetime). Either way: redeclare presence
   * against the new session id, and reattach any changesets this identity still has open.
   */
  function onFreshSession(id: string): void {
    sessionId = id
    redeclarePresence().catch((e) => console.error("connect: presence redeclare on reconnect failed", e))
    if (token) {
      call("changeset.list_mine", {})
        .then((result) => opts.onReattach?.(result))
        .catch((e) => console.error("connect: reattach (changeset.list_mine) failed", e))
    }
  }

  let stream: EventStream | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  // ---- polling-mode-only state: local cursors for the two poll loops ------------------------------
  let historyGraphId: string | null = null
  let historyLastSeq = 0
  const whoSnapshot = new Map<string, { name: string; agentKind: string; focusCell: string | null }>()

  /** Polls `graph://history?since=N`, diffs against the local cursor via the SAME `classifyEnvelope`
   * SSE mode uses (subscribe.ts) — reset detection (graphId changed → server re-bootstrapped, drop the
   * cursor and let the next tick re-poll from since=0) and duplicate-skip come for free, no second parser. */
  async function pollHistoryOnce(): Promise<void> {
    const result = await readHistory(historyLastSeq)
    for (const env of result.events ?? []) {
      switch (classifyEnvelope(env, historyGraphId, historyLastSeq)) {
        case "reset":
          opts.onReset?.()
          historyGraphId = null
          historyLastSeq = 0
          return // drop the rest of this batch; it was read against the now-stale graphId
        case "duplicate":
          continue
        case "apply":
          historyGraphId = env.graphId
          if (!env.ephemeral) historyLastSeq = env.seq
          dispatch(env)
      }
    }
  }

  /** Synthesizes a `user.*`-kind Envelope from a `presence.who` snapshot diff — see the doc comment on
   * `ConnectOptions.live` for the design tradeoff. `seq`/`graphId` reuse the history cursor (ephemeral
   * events are exempt from seq dedup per the `Envelope` contract, so this is just for shape-consistency
   * with real SSE presence envelopes, not for any dedup logic of its own). */
  function synthUserEnvelope(kind: string, userId: string, payload: Record<string, unknown>): Envelope {
    // ISO 8601 p/ casar o formato do fio (Envelope.ts) — `Date.now()` daria epoch ms aqui e um
    // consumidor não teria como distinguir um envelope sintetizado de um real pelo tipo de `ts`.
    return { schemaVersion: 1, seq: historyLastSeq, ts: new Date().toISOString(), kind, target: userId, payload, graphId: historyGraphId ?? "", ephemeral: true }
  }

  /** Polls `presence.who` (a tool call — goes through `call()`, so QA-1 re-register applies) and diffs
   * the roster against the previous poll's snapshot, dispatching synthesized `user.joined`/
   * `user.focused`/`user.left` envelopes for what changed. No `user.typing_state` — `presence.who`
   * carries no typing signal (documented tradeoff, see `ConnectOptions.live`). */
  async function pollWhoOnce(): Promise<void> {
    const result = (await call("presence.who", {})) as {
      users?: Array<{ id: string; name: string; agentKind: string; focusCell: string | null; lastSeen?: number }>
    }
    const users = result?.users ?? []
    const seen = new Set<string>()
    for (const u of users) {
      seen.add(u.id)
      const prev = whoSnapshot.get(u.id)
      if (!prev) {
        dispatch(synthUserEnvelope("user.joined", u.id, { userId: u.id, name: u.name, agentKind: u.agentKind, lastSeen: u.lastSeen }))
        // A user.joined payload carries no cell (PresenceStore.apply's "user.joined" case doesn't set
        // focusCell — mirrors the live SSE payload shape, presence.ts's emitJoined). If this user already
        // had a focus cell the FIRST time we ever saw them (we connected mid-session, so there was no
        // earlier poll to diff a change against), that focus would otherwise never be communicated at
        // all — only a SUBSEQUENT change would hit the `prev.focusCell !== u.focusCell` branch below. So
        // also emit an initial user.focused whenever a newly-seen user already has a non-null cell.
        if (u.focusCell !== null) dispatch(synthUserEnvelope("user.focused", u.id, { userId: u.id, cell: u.focusCell, lastSeen: u.lastSeen }))
      } else if (prev.focusCell !== u.focusCell) {
        dispatch(synthUserEnvelope("user.focused", u.id, { userId: u.id, cell: u.focusCell, lastSeen: u.lastSeen }))
      }
      whoSnapshot.set(u.id, { name: u.name, agentKind: u.agentKind, focusCell: u.focusCell })
    }
    for (const id of [...whoSnapshot.keys()]) {
      if (seen.has(id)) continue
      dispatch(synthUserEnvelope("user.left", id, { userId: id }))
      whoSnapshot.delete(id)
    }
  }

  /** One polling tick: history and who are independent failure domains — one failing (e.g. a transient
   * network blip) must not skip the other. */
  async function pollTick(): Promise<void> {
    try {
      await pollHistoryOnce()
    } catch (e) {
      console.error("connect: graph.history poll failed", e)
    }
    try {
      await pollWhoOnce()
    } catch (e) {
      console.error("connect: presence.who poll failed", e)
    }
  }

  if (live) {
    stream = new EventStream(
      {
        onEvent: dispatch,
        onReset: () => opts.onReset?.(),
        onOpen: () => opts.onOpen?.(),
        onClose: () => opts.onClose?.(),
        // Every (re)connection mints a fresh SSE session id; presence is keyed to it (spec §3.3), so
        // re-declare it each time (spec §9.1), and recover any changesets this session still has open
        // (spec §9 reattach) via changeset.list_mine — both handled by the shared `onFreshSession`.
        onSessionId: (id) => onFreshSession(id),
      },
      { serverBase: () => server, getToken: () => token },
    )
    stream.start()
  } else {
    // Polling mode: mint a local session id immediately (no SSE handshake to wait for — see
    // `localSessionId`'s doc comment), declare it via the same `onFreshSession` live mode uses on
    // `session.created`, then start polling. The first tick fires immediately (not after waiting a full
    // `pollIntervalMs`) so `on()` consumers see data promptly — mirrors mcp-web's `pollWho()` calling
    // itself once before its `setInterval` (packages/mcp-web/src/main.ts).
    onFreshSession(localSessionId())
    pollTick().catch((e) => console.error("connect: initial poll tick failed", e))
    pollTimer = setInterval(() => {
      pollTick().catch((e) => console.error("connect: poll tick failed", e))
    }, pollIntervalMs)
  }

  const beatTimer = setInterval(() => {
    if (sessionId && token) {
      beatOnce().catch((e) => console.error("connect: presence.beat failed", e))
    }
  }, 15_000)

  function close(): void {
    closed = true
    clearInterval(beatTimer)
    if (pollTimer) clearInterval(pollTimer)
    stream?.stop()
  }

  return { server, agentKind: opts.agentKind, call, on, subscribe, presence, systemMessages, close }
}
