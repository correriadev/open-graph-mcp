import { afterEach, beforeEach, expect, test } from "bun:test"
import { readSnapshot, toolCall } from "../src/api"

// ---------------------------------------------------------------------------
// Regression pin for transport.ts's tools/call contract change: a tool
// execution failure now comes back as a normal JSON-RPC *result* shaped
// { content: [...], isError: true } instead of a top-level body.error.
// rpc() in api.ts must translate that into a rejected promise so every
// toolCall() caller (session register, changeset open/claim/commit,
// presence calls, ...) keeps throwing on tool failure exactly as before.
// ---------------------------------------------------------------------------

const origFetch = globalThis.fetch
const origLocation = (globalThis as any).location

beforeEach(() => {
  ;(globalThis as any).location = { search: "" }
})

afterEach(() => {
  globalThis.fetch = origFetch
  if (origLocation === undefined) delete (globalThis as any).location
  else (globalThis as any).location = origLocation
})

function mockFetchOnce(body: unknown) {
  globalThis.fetch = ((_url: string, _opts: any) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)) as unknown as typeof fetch
}

test("toolCall rejects when the mocked /mcp response has result.isError: true", async () => {
  mockFetchOnce({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: "not bootstrapped" }], isError: true },
  })

  await expect(toolCall("graph.query", { terms: ["x"] })).rejects.toThrow(/not bootstrapped/)
})

test("toolCall resolves with the unwrapped structuredContent for a normal successful tool result", async () => {
  const structured = { ok: true, admitSeq: 3, cell: "ui:P4", to: "graph" }
  mockFetchOnce({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured },
  })

  const result = await toolCall("authority.flip", { cell: "ui:P4", to: "graph" })
  expect(result).toEqual(structured)
})

test("toolCall resolves (does not throw) for a normal {ok:false, reasons:[...]} business result — not an error", async () => {
  const structured = { ok: false, reasons: ["authority.flip: invalid cell"] }
  mockFetchOnce({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured },
  })

  const result = await toolCall("authority.flip", { cell: "no-colon-here", to: "graph" })
  expect(result).toEqual(structured)
})

// ---------------------------------------------------------------------------
// Regression pin: graph://snapshot's resources/read result is an envelope
// { graphId, graph, stats }, not the bare Graph — readSnapshot() must unwrap
// `.graph` itself, since callers (main.ts's renderer.setGraph) expect a
// plain Graph. Caught live during INT-3 validation; was silently returning
// the envelope before.
// ---------------------------------------------------------------------------

test("readSnapshot unwraps the graph://snapshot envelope down to the bare Graph", async () => {
  const graph = { nodes: [{ id: "n1" }], edges: [], stats: { nodes: 1 } }
  const envelope = { graphId: "g_123", graph, stats: { nodes: 1 } }
  mockFetchOnce({
    jsonrpc: "2.0",
    id: 1,
    result: { contents: [{ uri: "graph://snapshot", text: JSON.stringify(envelope) }] },
  })

  const result = await readSnapshot()
  expect(result).toEqual(graph as any)
})
