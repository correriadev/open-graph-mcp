// Uses node:test + node:assert (not bun:test) deliberately — see ../README.md and index.test.ts.
//
// Covers og.call()'s token-injection behavior, the token-resolution precedence documented on
// `resolveToken` in ../src/connect.ts (explicit token > matching cached store creds > register-fresh
// via a name > throw), the T4 SSE lifecycle (on/subscribe/presence.focus/systemMessages/close), and the
// QA-1 auto-re-register-on-expired-token recovery flow. All network access is a mocked `globalThis.fetch`
// — no real server involved.
//
// connect() now auto-starts an internal EventStream (T4), so the fetch mock below has to answer BOTH
// kinds of request: the JSON-RPC `POST {server}/mcp` calls (toolCall) and the `GET {server}/events?...`
// SSE connection (EventStream.open). Every test that calls `connect()` goes through `make()`, which
// tracks the returned handle and `close()`s it in `afterEach` — otherwise the SSE fetch's pending
// `reader.read()` and the 15s beat `setInterval` would leak across tests (and, for tests that install a
// broken/non-SSE-aware fetch mock, a leaked reconnect timer could fire after `afterEach` restores the
// REAL `fetch`, making a live network call from the test suite).
import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { connect, type ConnectOptions, type OgHandle, type ReauthEvent } from "../src/connect.ts"
import type { Credentials, TokenStore } from "../src/store.ts"

// ---- fake TokenStore (in-memory) — also doubles as the TokenStore-interface-shape test: anything
// implementing get()/set() satisfies the type, no fs involved. -------------------------------------
function fakeStore(initial: Credentials | null = null): TokenStore {
  let creds = initial
  return {
    get: () => creds,
    set: (c) => {
      creds = c
    },
  }
}

// ---- fetch mock: records every JSON-RPC body sent, replies per a caller-supplied responder; also
// answers EventStream's SSE GET with a controllable never-closes-by-default stream. -----------------
type Call = { method: string; params: any }
let calls: Call[] = []
let respond: (call: Call) => any = () => ({ result: {} })
type StreamConn = { push: (frame: string) => void; aborted: () => boolean }
let streamConns: StreamConn[] = []
const enc = new TextEncoder()
const origFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  streamConns = []
  respond = () => ({ result: {} })
  globalThis.fetch = (async (_url: string, init: any = {}) => {
    if (init.method === "POST") {
      const body = JSON.parse(init.body)
      const call: Call = { method: body.method, params: body.params }
      calls.push(call)
      return { ok: true, status: 200, json: async () => respond(call) } as Response
    }
    // EventStream's SSE GET — return a controllable stream; tests that care push frames onto it via
    // streamConns[n].push(...). Aborting (og.close()) rejects the pending reader.read(), same as a real
    // fetch abort — mirrors eventstream.test.ts's mock.
    const signal: AbortSignal | undefined = init.signal
    let ctrl: ReadableStreamDefaultController<Uint8Array>
    const streamBody = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c
        signal?.addEventListener("abort", () => {
          try {
            ctrl.error(new Error("aborted"))
          } catch {
            /* already closed */
          }
        })
      },
    })
    streamConns.push({ push: (f: string) => ctrl.enqueue(enc.encode(f)), aborted: () => !!signal?.aborted })
    return { ok: true, status: 200, body: streamBody } as Response
  }) as typeof fetch
})

let handles: OgHandle[] = []
async function make(o: ConnectOptions): Promise<OgHandle> {
  const og = await connect(o)
  handles.push(og)
  return og
}

afterEach(() => {
  for (const og of handles) og.close()
  handles = []
  globalThis.fetch = origFetch
})

const tick = (n = 4) =>
  new Promise<void>((r) => {
    let i = 0
    const step = () => (++i >= n ? r() : setTimeout(step, 0))
    setTimeout(step, 0)
  })

const sessionCreatedFrame = (id: string) => `event: session.created\ndata: ${JSON.stringify({ sessionId: id })}\n\n`

test("og.call injects the resolved token into args.token when the caller didn't set one", async () => {
  respond = () => ({ result: { structuredContent: { ok: true } } })
  const og = await make({ server: "http://x", agentKind: "web", token: "tok-123" })
  await og.call("changeset.open", { cells: ["A1"] })

  const rpcCalls = calls.filter((c) => c.method === "tools/call")
  assert.equal(rpcCalls.length, 1)
  assert.deepEqual(rpcCalls[0].params, { name: "changeset.open", arguments: { cells: ["A1"], token: "tok-123" } })
})

test("og.call does not override an explicitly-passed args.token", async () => {
  respond = () => ({ result: { structuredContent: {} } })
  const og = await make({ server: "http://x", agentKind: "web", token: "tok-resolved" })
  await og.call("changeset.open", { token: "tok-explicit" })

  const rpcCalls = calls.filter((c) => c.method === "tools/call")
  assert.equal(rpcCalls[0].params.arguments.token, "tok-explicit")
})

test("og.call omits token entirely when none was resolved (no token, no store)", async () => {
  respond = () => ({ result: { structuredContent: {} } })
  const og = await make({ server: "http://x", agentKind: "web" })
  await og.call("graph.rebuild", {})

  const rpcCalls = calls.filter((c) => c.method === "tools/call")
  assert.equal("token" in rpcCalls[0].params.arguments, false)
})

test("og.call unwraps structuredContent, falls back to content[0].text (JSON-parsed if possible)", async () => {
  const og = await make({ server: "http://x", agentKind: "web" })

  respond = () => ({ result: { structuredContent: { a: 1 } } })
  assert.deepEqual(await og.call("t1"), { a: 1 })

  respond = () => ({ result: { content: [{ type: "text", text: JSON.stringify({ b: 2 }) }] } })
  assert.deepEqual(await og.call("t2"), { b: 2 })

  respond = () => ({ result: { content: [{ type: "text", text: "plain text" }] } })
  assert.equal(await og.call("t3"), "plain text")
})

test("og.call throws on a top-level JSON-RPC error", async () => {
  respond = () => ({ error: { code: -32601, message: "method not found: bogus" } })
  const og = await make({ server: "http://x", agentKind: "web" })
  await assert.rejects(() => og.call("bogus"), /method not found: bogus/)
})

test("og.call throws on result.isError, using content[0].text as the message", async () => {
  respond = () => ({ result: { isError: true, content: [{ type: "text", text: "some other tool error" } ] } })
  const og = await make({ server: "http://x", agentKind: "web", token: "dead" })
  await assert.rejects(() => og.call("changeset.open"), /some other tool error/)
})

test("og.close() marks the handle closed — further call()s reject instead of hitting the network", async () => {
  const og = await make({ server: "http://x", agentKind: "web" })
  const rpcCallsBefore = calls.filter((c) => c.method === "tools/call").length
  og.close()
  await assert.rejects(() => og.call("graph.rebuild"), /closed/)
  assert.equal(calls.filter((c) => c.method === "tools/call").length, rpcCallsBefore)
})

test("og.close() tears down the underlying EventStream (aborts the SSE connection)", async () => {
  const og = await make({ server: "http://x", agentKind: "web" })
  await tick()
  assert.equal(streamConns.length, 1)
  assert.equal(streamConns[0].aborted(), false)
  og.close()
  assert.equal(streamConns[0].aborted(), true)
})

// ---- token resolution precedence --------------------------------------------------------------

test("connect() prefers an explicit token over a store, and never touches the store", async () => {
  const store = fakeStore({ server: "http://x", token: "from-store", userId: "u1", tenantId: "t1" })
  const og = await make({ server: "http://x", agentKind: "web", token: "explicit", store })
  respond = () => ({ result: { structuredContent: {} } })
  await og.call("t")
  assert.equal(calls.filter((c) => c.method === "tools/call").at(-1)!.params.arguments.token, "explicit")
})

test("connect() reuses cached store credentials when server matches, without registering", async () => {
  const store = fakeStore({ server: "http://x", token: "cached-tok", userId: "u1", tenantId: "t1" })
  const og = await make({ server: "http://x", agentKind: "web", store })
  respond = () => ({ result: { structuredContent: {} } })
  await og.call("t")

  const registerCalls = calls.filter((c) => c.method === "tools/call" && c.params.name === "session.register")
  assert.equal(registerCalls.length, 0) // no session.register round trip
  assert.equal(calls.filter((c) => c.method === "tools/call").at(-1)!.params.arguments.token, "cached-tok")
})

test("connect() ignores cached credentials for a different server and registers fresh instead", async () => {
  const store = fakeStore({ server: "http://other", token: "stale", userId: "u1", tenantId: "t1" })
  respond = (call) =>
    call.params?.name === "session.register"
      ? { result: { structuredContent: { token: "fresh-tok", userId: "u2", tenantId: "t2" } } }
      : { result: { structuredContent: {} } }

  const og = await make({ server: "http://x", agentKind: "web", name: "Alice", store })
  assert.deepEqual(store.get(), { server: "http://x", token: "fresh-tok", userId: "u2", tenantId: "t2" })

  await og.call("t")
  assert.equal(calls.filter((c) => c.method === "tools/call").at(-1)!.params.arguments.token, "fresh-tok")
})

test("connect() registers fresh and persists to the store when nothing is cached yet", async () => {
  const store = fakeStore(null)
  respond = () => ({ result: { structuredContent: { token: "new-tok", userId: "u1", tenantId: "t1" } } })

  await make({ server: "http://x", agentKind: "claude-code", name: "Bob", store })

  const rpcCalls = calls.filter((c) => c.method === "tools/call")
  assert.equal(rpcCalls.length, 1)
  assert.deepEqual(rpcCalls[0].params, { name: "session.register", arguments: { name: "Bob" } })
  assert.deepEqual(store.get(), { server: "http://x", token: "new-tok", userId: "u1", tenantId: "t1" })
})

test("connect() throws when the store has no matching credentials and no name is given to register with", async () => {
  const store = fakeStore(null)
  await assert.rejects(() => connect({ server: "http://x", agentKind: "web", store }), /no cached credentials/)
  assert.equal(calls.filter((c) => c.method === "tools/call").length, 0) // never attempted a network call
})

test("connect() throws if session.register succeeds at the transport level but returns an unusable shape", async () => {
  const store = fakeStore(null)
  respond = () => ({ result: { structuredContent: { token: "only-a-token" } } }) // missing userId/tenantId
  await assert.rejects(() => connect({ server: "http://x", agentKind: "web", name: "Carl", store }), /no usable token/)
})

test("connect() with neither token nor store resolves to a null token (no throw — mirrors api.ts's unauthenticated default)", async () => {
  const og = await make({ server: "http://x", agentKind: "web" })
  respond = () => ({ result: { structuredContent: { ok: true } } })
  const result = await og.call("graph.rebuild")
  assert.deepEqual(result, { ok: true })
  assert.equal("token" in calls.filter((c) => c.method === "tools/call").at(-1)!.params.arguments, false)
})

test("connect() strips a trailing slash from server before building the /mcp URL", async () => {
  let seenUrl = ""
  globalThis.fetch = (async (url: string, init: any) => {
    if (init.method === "POST") seenUrl = url
    return { ok: true, status: 200, json: async () => ({ result: { structuredContent: {} } }) } as Response
  }) as typeof fetch

  const og = await make({ server: "http://x/", agentKind: "web" })
  await og.call("t")
  assert.equal(seenUrl, "http://x/mcp")
})

// ---- T4: og.on() event dispatch -----------------------------------------------------------------

test("og.on(kind) dispatches only matching envelopes; og.on('*') gets everything", async () => {
  const og = await make({ server: "http://x", agentKind: "web" })
  await tick()
  const drift: any[] = []
  const all: any[] = []
  og.on("drift.node", (env) => drift.push(env))
  og.on("*", (env) => all.push(env))

  const frame = (o: any) => `data: ${JSON.stringify(o)}\n\n`
  const base = { schemaVersion: 1, seq: 1, ts: 0, target: "auth:P4", payload: {}, graphId: "g1" }
  streamConns[0].push(frame({ ...base, kind: "drift.node" }))
  streamConns[0].push(frame({ ...base, kind: "changeset.opened", seq: 2 }))
  await tick(8)

  assert.equal(drift.length, 1)
  assert.equal(drift[0].kind, "drift.node")
  assert.equal(all.length, 2)
})

test("og.systemMessages() surfaces only system.message envelopes", async () => {
  const og = await make({ server: "http://x", agentKind: "claude-code" })
  await tick()
  const msgs: any[] = []
  og.systemMessages((env) => msgs.push(env))

  const frame = (o: any) => `data: ${JSON.stringify(o)}\n\n`
  const base = { schemaVersion: 1, seq: 1, ts: 0, target: null, graphId: "g1", ephemeral: true }
  streamConns[0].push(frame({ ...base, kind: "system.message", payload: { text: "hi" } }))
  streamConns[0].push(frame({ ...base, kind: "drift.node", payload: {}, seq: 2 }))
  await tick(8)

  assert.equal(msgs.length, 1)
  assert.equal(msgs[0].payload.text, "hi")
})

// ---- T4: presence.focus + auto beat + focus-before-beat ordering ---------------------------------

test("og.presence.focus() before any SSE session is a local no-op (no network call) — mirrors mcp-web's declareFocus guard", async () => {
  const og = await make({ server: "http://x", agentKind: "web", token: "tok" })
  const rpcCallsBefore = calls.filter((c) => c.method === "tools/call").length
  await og.presence.focus("auth:P4")
  assert.equal(calls.filter((c) => c.method === "tools/call").length, rpcCallsBefore)
})

test("a fresh SSE session id (connect/reconnect) redeclares presence.focus BEFORE presence.beat (order matters for invisible mode)", async () => {
  respond = () => ({ result: { structuredContent: { ok: true } } })
  const og = await make({ server: "http://x", agentKind: "web", token: "tok" })
  await tick()
  await og.presence.focus("auth:P4") // no session yet — just records local focus state

  streamConns[0].push(sessionCreatedFrame("s1"))
  await tick(8)

  const order = calls
    .filter((c) => c.method === "tools/call" && (c.params.name === "presence.focus" || c.params.name === "presence.beat"))
    .map((c) => c.params.name)
  assert.deepEqual(order, ["presence.focus", "presence.beat"])
  const focusCall = calls.find((c) => c.params?.name === "presence.focus")!
  assert.equal(focusCall.params.arguments.cell, "auth:P4")
  assert.equal(focusCall.params.arguments.sessionId, "s1")
})

test("reattach: a fresh SSE session id calls changeset.list_mine and forwards the result via onReattach", async () => {
  respond = (call) =>
    call.params?.name === "changeset.list_mine"
      ? { result: { structuredContent: { changesets: [{ csId: "cs_1" }] } } }
      : { result: { structuredContent: { ok: true } } }

  let reattached: any = null
  const og = await make({
    server: "http://x",
    agentKind: "web",
    token: "tok",
    onReattach: (r) => (reattached = r),
  })
  await tick()
  streamConns[0].push(sessionCreatedFrame("s1"))
  await tick(8)

  assert.deepEqual(reattached, { changesets: [{ csId: "cs_1" }] })
})

// ---- QA-1: auto re-register on expired/invalid token, retry-once, not looped ---------------------

test("an expired-token error on a live-layer call triggers exactly one re-register RPC, then recovers (not looped)", async () => {
  let registerCalls = 0
  let focusAttempts = 0
  const reauthEvents: ReauthEvent[] = []
  respond = (call) => {
    if (call.params?.name === "session.register") {
      registerCalls++
      return { result: { structuredContent: { token: "fresh-tok", userId: "u1", tenantId: "t1" } } }
    }
    if (call.params?.name === "presence.focus") {
      focusAttempts++
      if (focusAttempts === 1) {
        return {
          result: { isError: true, content: [{ type: "text", text: "invalid or expired token — call session.register" }] },
        }
      }
      return { result: { structuredContent: { ok: true } } }
    }
    return { result: { structuredContent: { ok: true } } }
  }

  const store = fakeStore({ server: "http://x", token: "dead-tok", userId: "u0", tenantId: "t0" })
  const og = await make({
    server: "http://x",
    agentKind: "web",
    name: "Alice",
    store,
    onReauth: (e) => reauthEvents.push(e),
  })
  await tick()

  // Simulates the QA-1 scenario: server restarted, SSE reconnects with a fresh session id, but the
  // (now dead) token is still what's cached — the automatic presence redeclare hits it first.
  streamConns[0].push(sessionCreatedFrame("s1"))
  await tick(10)

  assert.equal(registerCalls, 1, "session.register must fire exactly once, not looped")
  assert.ok(focusAttempts >= 2, "presence.focus must have failed once and been retried")
  assert.deepEqual(store.get(), { server: "http://x", token: "fresh-tok", userId: "u1", tenantId: "t1" })
  assert.deepEqual(
    reauthEvents.find((e) => e.type === "reregistered"),
    { type: "reregistered", creds: { server: "http://x", token: "fresh-tok", userId: "u1", tenantId: "t1" } },
  )

  // Subsequent calls use the fresh token without any further re-register.
  await og.call("graph.rebuild")
  assert.equal(registerCalls, 1)
  assert.equal(calls.filter((c) => c.method === "tools/call").at(-1)!.params.arguments.token, "fresh-tok")
})

test("expired-token failure with no `name` available propagates the error instead of looping or swallowing it", async () => {
  respond = (call) =>
    call.params?.name === "presence.focus"
      ? { result: { isError: true, content: [{ type: "text", text: "invalid or expired token — call session.register" }] } }
      : { result: { structuredContent: { ok: true } } }

  // token passed directly, no `name`, no `store` — nothing to re-register with (degenerate case).
  const og = await make({ server: "http://x", agentKind: "web", token: "dead-tok" })
  await tick()
  streamConns[0].push(sessionCreatedFrame("s1"))
  await tick(8)

  // The redeclare-on-reconnect swallows this internally (console.error, best-effort) rather than
  // crashing the connect() lifecycle — but a DIRECT call must surface the error to the caller.
  await assert.rejects(() => og.call("presence.focus", { sessionId: "s1", cell: null }), /invalid or expired token/)
  const registerCalls = calls.filter((c) => c.method === "tools/call" && c.params.name === "session.register")
  assert.equal(registerCalls.length, 0)
})

test("connect() threads `tenant` through to session.register (initial registration requires a `store` to trigger)", async () => {
  const seenTenants: any[] = []
  respond = (call) => {
    if (call.params?.name === "session.register") {
      seenTenants.push(call.params.arguments.tenant)
      return { result: { structuredContent: { token: "tok", userId: "u1", tenantId: "acme" } } }
    }
    return { result: { structuredContent: { ok: true } } }
  }
  const store = fakeStore(null)
  await make({ server: "http://x", agentKind: "web", name: "Alice", tenant: "acme", store })
  assert.deepEqual(seenTenants, ["acme"])
})

test(
  "a live-layer call that keeps failing even AFTER a successful re-register does not deadlock " +
    "ensureReregistered (registerSession still fires exactly once, not looped)",
  async () => {
    let registerCalls = 0
    respond = (call) => {
      if (call.params?.name === "session.register") {
        registerCalls++
        return { result: { structuredContent: { token: "fresh-tok", userId: "u1", tenantId: "t1" } } }
      }
      if (call.params?.name === "presence.focus") {
        // ALWAYS fails with an expired-token error, even after re-registering — simulates some other
        // persistent problem, and exercises doReregister()'s tail: it no longer redeclares presence over
        // `call()` at all (that would risk re-entering ensureReregistered() while still awaiting its own
        // in-flight promise — see the stream-restart test below for what it does instead), so this must
        // settle rather than hang regardless of how badly presence.focus keeps failing afterward.
        return {
          result: { isError: true, content: [{ type: "text", text: "invalid or expired token — call session.register" }] },
        }
      }
      return { result: { structuredContent: { ok: true } } }
    }

    const store = fakeStore({ server: "http://x", token: "dead-tok", userId: "u0", tenantId: "t0" })
    await make({ server: "http://x", agentKind: "web", name: "Alice", store })
    await tick()
    streamConns[0].push(sessionCreatedFrame("s1"))
    await tick(12) // generous — this test's whole point is proving it settles instead of hanging

    assert.equal(registerCalls, 1, "still exactly one register attempt, even though redeclare kept failing")
  },
)

test(
  "a successful QA-1 re-register forces the SSE connection itself to reconnect (fixes the stale " +
    "server-side Session.userId binding that dead-token affinity routing would otherwise leave behind)",
  async () => {
    let focusCalls = 0
    respond = (call) => {
      if (call.params?.name === "session.register") return { result: { structuredContent: { token: "fresh-tok", userId: "u1", tenantId: "t1" } } }
      if (call.params?.name === "presence.focus" && ++focusCalls === 1) {
        return {
          result: { isError: true, content: [{ type: "text", text: "invalid or expired token — call session.register" }] },
        }
      }
      return { result: { structuredContent: { ok: true } } }
    }

    const store = fakeStore({ server: "http://x", token: "dead-tok", userId: "u0", tenantId: "t0" })
    await make({ server: "http://x", agentKind: "web", name: "Alice", store })
    await tick()
    assert.equal(streamConns.length, 1)

    streamConns[0].push(sessionCreatedFrame("s1")) // first connection, dead token still bound server-side
    await tick(10)

    // doReregister() calls stream.stop() (aborts the FIRST connection) then stream.start() (opens a
    // second) — NOT a redeclare over the same, now-permanently-userId-null connection.
    assert.equal(streamConns[0].aborted(), true)
    assert.equal(streamConns.length, 2)
    assert.equal(streamConns[1].aborted(), false)
  },
)
