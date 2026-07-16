// Uses node:test + node:assert (not bun:test) deliberately — see ../README.md and index.test.ts.
//
// Covers T5's `connect({live:false})` — the ID2 polling fallback: no SSE connection is ever opened;
// `on()` events are synthesized by polling `graph://history?since=N` (a resources/read call) and
// `presence.who` (a tools/call) on an interval instead. All network access is a mocked `globalThis.fetch`
// — no real server involved. This file deliberately does NOT re-test everything connect.test.ts already
// covers (token resolution precedence, call() unwrap behavior, etc — those are mode-agnostic and shared
// code, already proven there); it focuses on what's actually different in polling mode: no SSE fetch,
// history/who poll-diffing driving the same og.on(), close() stopping the poll timer, and QA-1 recovery
// reached via a polling-mode code path instead of an SSE-redeclare one.
import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { connect, type ConnectOptions, type OgHandle } from "../src/connect.ts"
import type { Envelope } from "../src/subscribe.ts"
import type { Credentials, TokenStore } from "../src/store.ts"

function fakeStore(initial: Credentials | null = null): TokenStore {
  let creds = initial
  return {
    get: () => creds,
    set: (c) => {
      creds = c
    },
  }
}

// ---- fetch mock ------------------------------------------------------------------------------------
// Answers both request shapes this handle can make: POST {server}/mcp (tools/call AND resources/read —
// both go over the same JSON-RPC envelope) and, in live mode (used only by the cross-mode regression
// test below), the GET {server}/events SSE connection. `requests` records EVERY call (method + url) so
// tests can assert live-mode-only requests (the SSE GET) never happen in polling mode.
type Call = { method: string; params: any }
type Req = { kind: "POST" | "GET"; url: string; method?: string; params?: any }
let requests: Req[] = []
let respond: (call: Call) => any = () => ({ result: { structuredContent: { ok: true } } })
type StreamConn = { push: (frame: string) => void; aborted: () => boolean }
let streamConns: StreamConn[] = []
const enc = new TextEncoder()
const origFetch = globalThis.fetch

beforeEach(() => {
  requests = []
  streamConns = []
  respond = () => ({ result: { structuredContent: { ok: true } } })
  globalThis.fetch = (async (url: string, init: any = {}) => {
    if (init.method === "POST") {
      const body = JSON.parse(init.body)
      const call: Call = { method: body.method, params: body.params }
      requests.push({ kind: "POST", url, method: body.method, params: body.params })
      return { ok: true, status: 200, json: async () => respond(call) } as Response
    }
    // GET — only ever hit by EventStream's SSE connection (live mode).
    requests.push({ kind: "GET", url })
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
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** `graph.history` resource-read response, matching resources.ts's `resolveResource` "history" shape:
 * `{graphId, since, events}` where each event is already Envelope-shaped (server does this natively —
 * see packages/mcp-server/src/resources.ts's `historyEnvelopes`). */
function historyPayload(graphId: string, since: number, events: Envelope[]) {
  return { graphId, since, events }
}
function historyResourceResponse(call: Call, graphId: string, allEvents: Envelope[]) {
  const since = Number(new URL(call.params.uri.replace("graph://", "http://x/"), "http://x").searchParams.get("since") ?? 0)
  const events = allEvents.filter((e) => e.seq > since)
  return { result: { contents: [{ uri: call.params.uri, mimeType: "application/json", text: JSON.stringify(historyPayload(graphId, since, events)) }] } }
}

const env = (over: Partial<Envelope>): Envelope => ({
  schemaVersion: 1,
  seq: 1,
  ts: 0,
  kind: "drift.node",
  target: "auth:P4",
  payload: {},
  graphId: "g1",
  ...over,
})

// ---- 1. polling mode never opens an SSE connection --------------------------------------------------

test("connect({live:false}) never opens an EventStream — no GET /events request occurs", async () => {
  const og = await make({ server: "http://x", agentKind: "web", live: false, pollIntervalMs: 20 })
  await tick(10)
  await delay(45)
  await tick(10)

  assert.equal(streamConns.length, 0, "no SSE connection was opened")
  assert.equal(
    requests.some((r) => r.kind === "GET"),
    false,
    "no GET request (the SSE endpoint) was ever made in polling mode",
  )
  assert.ok(
    requests.some((r) => r.kind === "POST" && r.method === "resources/read"),
    "sanity: polling mode DID make resources/read calls",
  )
  og.close()
})

// ---- 2. basic scenario: history-poll-driven events reach og.on() ------------------------------------

test("og.on('*') receives events synthesized from graph.history polling across two ticks", async () => {
  let historyEvents: Envelope[] = [env({ seq: 1, kind: "drift.node" })]
  respond = (call) => {
    if (call.method === "resources/read") return historyResourceResponse(call, "g1", historyEvents)
    return { result: { structuredContent: { ok: true, users: [] } } }
  }

  const og = await make({ server: "http://x", agentKind: "web", live: false, pollIntervalMs: 20 })
  const received: Envelope[] = []
  og.on("*", (e) => received.push(e))

  await tick(10) // first (immediate) poll tick
  assert.equal(received.length, 1)
  assert.equal(received[0].seq, 1)

  // simulate a new durable event landing server-side between poll ticks
  historyEvents = [...historyEvents, env({ seq: 2, kind: "changeset.opened" })]
  await delay(45) // let the 20ms poll interval fire again
  await tick(10)

  assert.equal(received.length, 2)
  assert.deepEqual(
    received.map((e) => e.kind),
    ["drift.node", "changeset.opened"],
  )
})

// ---- 3. the SAME scenario replayed with live:true (SSE) drives og.on() the same way -----------------

test("live:true (SSE) and live:false (polling) dispatch the equivalent event sequence through the SAME og.on()", async () => {
  // --- live:true leg: two events pushed as SSE frames ---
  const liveOg = await make({ server: "http://x", agentKind: "web" })
  const frame = (o: any) => `data: ${JSON.stringify(o)}\n\n`
  const liveReceived: Envelope[] = []
  await tick()
  liveOg.on("*", (e) => liveReceived.push(e))
  streamConns[0].push(frame(env({ seq: 1, kind: "drift.node" })))
  streamConns[0].push(frame(env({ seq: 2, kind: "changeset.opened" })))
  await tick(8)
  liveOg.close()

  // --- live:false leg: the same two events served via graph.history polling ---
  requests = []
  streamConns = []
  const events: Envelope[] = [env({ seq: 1, kind: "drift.node" }), env({ seq: 2, kind: "changeset.opened" })]
  respond = (call) => {
    if (call.method === "resources/read") return historyResourceResponse(call, "g1", events)
    return { result: { structuredContent: { ok: true, users: [] } } }
  }
  const pollOg = await make({ server: "http://x", agentKind: "web", live: false, pollIntervalMs: 15 })
  const pollReceived: Envelope[] = []
  pollOg.on("*", (e) => pollReceived.push(e))
  await tick(10)
  pollOg.close()

  const shape = (list: Envelope[]) => list.map((e) => ({ kind: e.kind, seq: e.seq, graphId: e.graphId }))
  assert.deepEqual(shape(pollReceived), shape(liveReceived), "both modes drove og.on() with the same events")
})

// ---- 4. close() stops the poll interval --------------------------------------------------------------

test("og.close() stops the poll interval — no further fetch calls after close", async () => {
  let historyEvents: Envelope[] = [env({ seq: 1 })]
  respond = (call) => {
    if (call.method === "resources/read") return historyResourceResponse(call, "g1", historyEvents)
    return { result: { structuredContent: { ok: true, users: [] } } }
  }
  const og = await make({ server: "http://x", agentKind: "web", live: false, pollIntervalMs: 15 })
  await tick(10)
  await delay(40)
  await tick(10)

  const countBeforeClose = requests.length
  assert.ok(countBeforeClose > 0, "sanity: some polling requests happened before close")
  og.close()

  await delay(60) // well past a couple more would-be poll intervals
  await tick(10)

  assert.equal(requests.length, countBeforeClose, "no new requests fired after close()")
  handles = handles.filter((h) => h !== og) // already closed; afterEach shouldn't double-close
})

// ---- presence.who diffing synthesizes user.joined/user.focused/user.left through the same og.on() ---

test("presence.who polling synthesizes user.joined/user.focused/user.left as the roster changes across ticks", async () => {
  type Who = { id: string; name: string; agentKind: string; focusCell: string | null; lastSeen?: number }
  let who: Who[] = [{ id: "u1", name: "Alice", agentKind: "web", focusCell: "auth:P4", lastSeen: 1 }]
  respond = (call) => {
    if (call.method === "resources/read") return historyResourceResponse(call, "g1", [])
    if (call.params?.name === "presence.who") return { result: { structuredContent: { users: who } } }
    return { result: { structuredContent: { ok: true } } }
  }

  const og = await make({ server: "http://x", agentKind: "web", live: false, pollIntervalMs: 20 })
  const joined: Envelope[] = []
  const focused: Envelope[] = []
  const left: Envelope[] = []
  og.on("user.joined", (e) => joined.push(e))
  og.on("user.focused", (e) => focused.push(e))
  og.on("user.left", (e) => left.push(e))

  await tick(10) // first poll: u1 appears — already focused on a cell (mid-session join)
  assert.equal(joined.length, 1)
  assert.equal(joined[0].payload.userId, "u1")
  assert.equal(joined[0].payload.name, "Alice")
  // a brand-new user's initial focus cell must still be communicated (not just on later CHANGES) —
  // otherwise polling mode would silently lose focus state for anyone who joined mid-poll-cycle already
  // looking at a cell, which live SSE mode never loses (user.joined + a near-immediate user.focused).
  assert.equal(focused.length, 1)
  assert.equal(focused[0].payload.userId, "u1")
  assert.equal(focused[0].payload.cell, "auth:P4")

  // second poll: u1 changes cell, u2 joins with no focus yet
  who = [
    { id: "u1", name: "Alice", agentKind: "web", focusCell: "billing:P2", lastSeen: 2 },
    { id: "u2", name: "Bob", agentKind: "claude-code", focusCell: null, lastSeen: 2 },
  ]
  await delay(45)
  await tick(10)

  assert.equal(joined.length, 2)
  assert.equal(joined[1].payload.userId, "u2")
  assert.equal(focused.length, 2, "u1's cell change dispatched exactly one more user.focused")
  assert.equal(focused[1].payload.userId, "u1")
  assert.equal(focused[1].payload.cell, "billing:P2")
  assert.equal(left.length, 0)

  // third poll: u1 leaves
  who = [{ id: "u2", name: "Bob", agentKind: "claude-code", focusCell: null, lastSeen: 3 }]
  await delay(45)
  await tick(10)

  assert.equal(left.length, 1)
  assert.equal(left[0].payload.userId, "u1")
})

// ---- 5b. a graphId change mid-poll-cycle triggers onReset, no stale-graphId events leak -------------

test("pollHistoryOnce detects a graphId change (server re-bootstrapped) and fires onReset, dropping the stale batch", async () => {
  // historyResourceResponse filters by `e.seq > since` using the client's own last-seen seq — which
  // is stale/meaningless across a graphId change (the client's g1 cursor has no relationship to g2's
  // seq numbering). Giving the post-rebuild event a seq well past any leftover `since` the client might
  // still be sending avoids that filter accidentally hiding the very event this test needs to arrive —
  // same as a real server having accumulated a few events under the new graphId before this poll lands.
  let historyEvents: Envelope[] = [env({ seq: 1, kind: "drift.node", graphId: "g1" })]
  let graphId = "g1"
  respond = (call) => {
    if (call.method === "resources/read") return historyResourceResponse(call, graphId, historyEvents)
    return { result: { structuredContent: { ok: true, users: [] } } }
  }

  let resetCount = 0
  const og = await make({ server: "http://x", agentKind: "web", live: false, pollIntervalMs: 20, onReset: () => resetCount++ })
  const received: Envelope[] = []
  og.on("*", (e) => received.push(e))

  await tick(10) // first poll: seq 1 under g1, applied normally
  assert.equal(received.length, 1)
  assert.equal(resetCount, 0)

  // server re-bootstrapped: fresh graphId, seq well past the client's stale g1 cursor (see comment above).
  // NOTE: the poll interval (20ms) can fire more than once during the waits below, so this deliberately
  // does NOT assert an exact received.length at any intermediate instant — the tick right after the
  // reset is detected and the tick that re-polls the now-realigned cursor can legitimately land in either
  // one wait window or the next depending on scheduler jitter. What must hold regardless of exactly which
  // poll fire caught which event is the durable guarantee below: onReset fires exactly once (not once per
  // extra fire against the same stale batch — classifyEnvelope only reports "reset" while the cursor is
  // still misaligned), and each post-reset event is dispatched exactly once (no duplicate redelivery once
  // the cursor catches up), never dropped for good.
  graphId = "g2"
  historyEvents = [env({ seq: 100, kind: "graph.rebuilt", graphId: "g2" }), env({ seq: 101, kind: "drift.node", graphId: "g2" })]
  await delay(45)
  await tick(10)
  await delay(45)
  await tick(10)

  assert.equal(resetCount, 1, "onReset fired exactly once for the graphId change, not once per extra poll fire")
  assert.equal(
    received.filter((e) => e.kind === "graph.rebuilt").length,
    1,
    "graph.rebuilt dispatched exactly once, not redelivered",
  )
  assert.equal(
    received.filter((e) => e.kind === "drift.node" && e.graphId === "g2").length,
    1,
    "the g2 drift.node dispatched exactly once, not redelivered",
  )
})

// ---- 6. QA-1 re-register also recovers a polling-mode call ------------------------------------------

test("an expired-token error on the polling-mode redeclare-on-connect triggers exactly one re-register RPC (shared QA-1 machinery, not reimplemented)", async () => {
  let registerCalls = 0
  let focusAttempts = 0
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
    if (call.method === "resources/read") return historyResourceResponse(call, "g1", [])
    return { result: { structuredContent: { ok: true, users: [] } } }
  }

  const store = fakeStore({ server: "http://x", token: "dead-tok", userId: "u0", tenantId: "t0" })
  // Large pollIntervalMs: this test only cares about the redeclare-on-connect path (fires synchronously
  // at connect() via `onFreshSession`, before any poll timer would fire), not the poll loop itself.
  const og = await make({ server: "http://x", agentKind: "web", name: "Alice", store, live: false, pollIntervalMs: 1_000_000 })
  await tick(10)

  assert.equal(registerCalls, 1, "session.register must fire exactly once, not looped")
  assert.ok(focusAttempts >= 2, "presence.focus must have failed once and been retried")
  assert.deepEqual(store.get(), { server: "http://x", token: "fresh-tok", userId: "u1", tenantId: "t1" })

  // Subsequent calls use the fresh token without any further re-register.
  await og.call("graph.rebuild")
  assert.equal(registerCalls, 1)
  const lastToolCall = [...requests].reverse().find((r) => r.method === "tools/call" && r.params?.name === "graph.rebuild")!
  assert.equal(lastToolCall.params.arguments.token, "fresh-tok")
})
