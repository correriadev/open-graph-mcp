// Uses node:test + node:assert (not bun:test) deliberately — see ../README.md and index.test.ts.
//
// Covers og.call()'s token-injection behavior and the token-resolution precedence documented on
// `resolveToken` in ../src/connect.ts (explicit token > matching cached store creds > register-fresh
// via a name > throw). All network access is a mocked `globalThis.fetch` — no real server involved.
import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { connect } from "../src/connect.ts"
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

// ---- fetch mock: records every JSON-RPC body sent, replies per a caller-supplied responder ----
type Call = { method: string; params: any }
let calls: Call[] = []
let respond: (call: Call) => any = () => ({ result: {} })
const origFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  respond = () => ({ result: {} })
  globalThis.fetch = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body)
    const call: Call = { method: body.method, params: body.params }
    calls.push(call)
    return {
      ok: true,
      status: 200,
      json: async () => respond(call),
    } as Response
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = origFetch
})

test("og.call injects the resolved token into args.token when the caller didn't set one", async () => {
  respond = () => ({ result: { structuredContent: { ok: true } } })
  const og = await connect({ server: "http://x", agentKind: "web", token: "tok-123" })
  await og.call("changeset.open", { cells: ["A1"] })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, "tools/call")
  assert.deepEqual(calls[0].params, { name: "changeset.open", arguments: { cells: ["A1"], token: "tok-123" } })
})

test("og.call does not override an explicitly-passed args.token", async () => {
  respond = () => ({ result: { structuredContent: {} } })
  const og = await connect({ server: "http://x", agentKind: "web", token: "tok-resolved" })
  await og.call("changeset.open", { token: "tok-explicit" })

  assert.equal(calls[0].params.arguments.token, "tok-explicit")
})

test("og.call omits token entirely when none was resolved (no token, no store)", async () => {
  respond = () => ({ result: { structuredContent: {} } })
  const og = await connect({ server: "http://x", agentKind: "web" })
  await og.call("graph.rebuild", {})

  assert.equal("token" in calls[0].params.arguments, false)
})

test("og.call unwraps structuredContent, falls back to content[0].text (JSON-parsed if possible)", async () => {
  const og = await connect({ server: "http://x", agentKind: "web" })

  respond = () => ({ result: { structuredContent: { a: 1 } } })
  assert.deepEqual(await og.call("t1"), { a: 1 })

  respond = () => ({ result: { content: [{ type: "text", text: JSON.stringify({ b: 2 }) }] } })
  assert.deepEqual(await og.call("t2"), { b: 2 })

  respond = () => ({ result: { content: [{ type: "text", text: "plain text" }] } })
  assert.equal(await og.call("t3"), "plain text")
})

test("og.call throws on a top-level JSON-RPC error", async () => {
  respond = () => ({ error: { code: -32601, message: "method not found: bogus" } })
  const og = await connect({ server: "http://x", agentKind: "web" })
  await assert.rejects(() => og.call("bogus"), /method not found: bogus/)
})

test("og.call throws on result.isError, using content[0].text as the message", async () => {
  respond = () => ({ result: { isError: true, content: [{ type: "text", text: "invalid or expired token — call session.register" }] } })
  const og = await connect({ server: "http://x", agentKind: "web", token: "dead" })
  await assert.rejects(() => og.call("changeset.open"), /invalid or expired token/)
})

test("og.close() marks the handle closed — further call()s reject instead of hitting the network", async () => {
  const og = await connect({ server: "http://x", agentKind: "web" })
  og.close()
  await assert.rejects(() => og.call("graph.rebuild"), /closed/)
  assert.equal(calls.length, 0)
})

// ---- token resolution precedence --------------------------------------------------------------

test("connect() prefers an explicit token over a store, and never touches the store", async () => {
  const store = fakeStore({ server: "http://x", token: "from-store", userId: "u1", tenantId: "t1" })
  const og = await connect({ server: "http://x", agentKind: "web", token: "explicit", store })
  respond = () => ({ result: { structuredContent: {} } })
  await og.call("t")
  assert.equal(calls[0].params.arguments.token, "explicit")
})

test("connect() reuses cached store credentials when server matches, without registering", async () => {
  const store = fakeStore({ server: "http://x", token: "cached-tok", userId: "u1", tenantId: "t1" })
  const og = await connect({ server: "http://x", agentKind: "web", store })
  respond = () => ({ result: { structuredContent: {} } })
  await og.call("t")

  assert.equal(calls.length, 1) // only the og.call — no session.register round trip
  assert.equal(calls[0].params.arguments.token, "cached-tok")
})

test("connect() ignores cached credentials for a different server and registers fresh instead", async () => {
  const store = fakeStore({ server: "http://other", token: "stale", userId: "u1", tenantId: "t1" })
  respond = (call) =>
    call.params.name === "session.register"
      ? { result: { structuredContent: { token: "fresh-tok", userId: "u2", tenantId: "t2" } } }
      : { result: { structuredContent: {} } }

  const og = await connect({ server: "http://x", agentKind: "web", name: "Alice", store })
  assert.deepEqual(store.get(), { server: "http://x", token: "fresh-tok", userId: "u2", tenantId: "t2" })

  await og.call("t")
  assert.equal(calls.at(-1)!.params.arguments.token, "fresh-tok")
})

test("connect() registers fresh and persists to the store when nothing is cached yet", async () => {
  const store = fakeStore(null)
  respond = () => ({ result: { structuredContent: { token: "new-tok", userId: "u1", tenantId: "t1" } } })

  await connect({ server: "http://x", agentKind: "claude-code", name: "Bob", store })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, "tools/call")
  assert.deepEqual(calls[0].params, { name: "session.register", arguments: { name: "Bob" } })
  assert.deepEqual(store.get(), { server: "http://x", token: "new-tok", userId: "u1", tenantId: "t1" })
})

test("connect() throws when the store has no matching credentials and no name is given to register with", async () => {
  const store = fakeStore(null)
  await assert.rejects(() => connect({ server: "http://x", agentKind: "web", store }), /no cached credentials/)
  assert.equal(calls.length, 0) // never attempted a network call
})

test("connect() throws if session.register succeeds at the transport level but returns an unusable shape", async () => {
  const store = fakeStore(null)
  respond = () => ({ result: { structuredContent: { token: "only-a-token" } } }) // missing userId/tenantId
  await assert.rejects(() => connect({ server: "http://x", agentKind: "web", name: "Carl", store }), /no usable token/)
})

test("connect() with neither token nor store resolves to a null token (no throw — mirrors api.ts's unauthenticated default)", async () => {
  const og = await connect({ server: "http://x", agentKind: "web" })
  respond = () => ({ result: { structuredContent: { ok: true } } })
  const result = await og.call("graph.rebuild")
  assert.deepEqual(result, { ok: true })
  assert.equal("token" in calls[0].params.arguments, false)
})

test("connect() strips a trailing slash from server before building the /mcp URL", async () => {
  let seenUrl = ""
  globalThis.fetch = (async (url: string, init: any) => {
    seenUrl = url
    return { ok: true, status: 200, json: async () => ({ result: { structuredContent: {} } }) } as Response
  }) as typeof fetch

  const og = await connect({ server: "http://x/", agentKind: "web" })
  await og.call("t")
  assert.equal(seenUrl, "http://x/mcp")
})
