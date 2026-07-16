// Uses node:test + node:assert (not bun:test) deliberately — see ../README.md and index.test.ts.
// Moved from packages/mcp-web/test/eventstream.test.ts (INT-2 T2 extraction). Only two things changed
// from the original: (1) bun:test's expect() → node:assert/strict, and (2) EventStream now takes an
// explicit `EventStreamOptions` (serverBase/getToken) instead of importing them from mcp-web's local
// `./api` module — see the EventStreamOptions doc comment in ../src/subscribe.ts for why. That removes
// the need to mock `globalThis.location` (serverBase is just a passed-in function now); everything else
// — the fetch mock, the abort/generation assertions — is unchanged.
import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { EventStream } from "../src/subscribe.ts"

// ---------------------------------------------------------------------------
// Regression: a graphId reset must not leak an SSE connection. reset() aborts
// the in-flight fetch; the still-running read loop's reader.read() then rejects.
// Its catch is guarded on `gen === this.generation`, and reconnect() bumps
// generation AT ABORT TIME, so the stale loop cannot fire a SECOND
// onDisconnect → reconnect (which would open a duplicate connection whose
// controller silently overwrites this.abort, orphaning the first).
// A leak therefore shows up as an EXTRA fetch call.
// ---------------------------------------------------------------------------

type Conn = { push: (frame: string) => void; aborted: () => boolean }
let fetchCalls = 0
let conns: Conn[] = []
const enc = new TextEncoder()

const origFetch = globalThis.fetch

beforeEach(() => {
  fetchCalls = 0
  conns = []
  globalThis.fetch = ((_url: string, opts: any) => {
    fetchCalls++
    const signal: AbortSignal = opts.signal
    let ctrl: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c
        // aborting the fetch must reject the pending reader.read() — mirror real fetch semantics
        signal.addEventListener("abort", () => {
          try {
            ctrl.error(new Error("aborted"))
          } catch {
            /* already closed */
          }
        })
      },
    })
    conns.push({ push: (f) => ctrl.enqueue(enc.encode(f)), aborted: () => signal.aborted })
    return Promise.resolve({ ok: true, body: stream } as Response)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = origFetch
})

const tick = (n = 4) =>
  new Promise<void>((r) => {
    let i = 0
    const step = () => (++i >= n ? r() : setTimeout(step, 0))
    setTimeout(step, 0)
  })

test("a graphId reset reconnects once without the stale loop firing onClose (no leak)", async () => {
  let resets = 0
  let closes = 0
  const stream = new EventStream(
    {
      onEvent: () => {},
      onReset: () => resets++,
      onOpen: () => {},
      onClose: () => closes++,
    },
    { serverBase: () => "http://localhost:8787" },
  )
  stream.start()
  await tick()
  assert.equal(fetchCalls, 1)

  // establish graphId g1, then send a g2 envelope → classifyEnvelope returns "reset"
  const frame = (o: any) => `data: ${JSON.stringify(o)}\n\n`
  const base = { schemaVersion: 1, ts: 0, kind: "drift.node", target: "ui:P4", payload: {} }
  conns[0].push(frame({ ...base, seq: 1, graphId: "g1" }))
  conns[0].push(frame({ ...base, seq: 2, graphId: "g2" }))
  await tick(8)

  assert.equal(resets, 1)
  assert.equal(conns[0].aborted(), true) // old connection was aborted
  assert.equal(fetchCalls, 2) // the single reconnect from reset()
  // The discriminator: onDisconnect() (→ onClose) must NOT fire on a reset. Without the abort-time
  // generation bump, the aborted read loop's catch passes its stale gen check and fires onClose,
  // scheduling a SECOND (backoff-delayed) reconnect that orphans a connection.
  assert.equal(closes, 0)

  stream.stop()
})

test("stop() suppresses the aborted read loop's reconnect", async () => {
  let closes = 0
  const stream = new EventStream(
    { onEvent: () => {}, onReset: () => {}, onOpen: () => {}, onClose: () => closes++ },
    { serverBase: () => "http://localhost:8787" },
  )
  stream.start()
  await tick()
  assert.equal(fetchCalls, 1)
  stream.stop()
  await tick(8)
  assert.equal(fetchCalls, 1) // no reconnect after an explicit stop
  assert.equal(closes, 0) // the aborted loop's catch is suppressed by the generation bump in stop()
})
