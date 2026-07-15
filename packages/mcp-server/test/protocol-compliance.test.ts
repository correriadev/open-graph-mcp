import { expect, test } from "bun:test"
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js"
import { createState } from "../src/state"
import { handleRpc } from "../src/transport"

function freshState() {
  return createState({ stateDir: ":memory:" })
}

test("initialize echoes back a client protocolVersion the server supports", () => {
  const state = freshState()
  try {
    const wanted = SUPPORTED_PROTOCOL_VERSIONS[1] ?? LATEST_PROTOCOL_VERSION
    const res = handleRpc(state, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: wanted } })
    expect(res?.result).toMatchObject({ protocolVersion: wanted })
  } finally {
    state.db.close()
  }
})

test("initialize falls back to LATEST_PROTOCOL_VERSION for an unsupported protocolVersion", () => {
  const state = freshState()
  try {
    const res = handleRpc(state, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } })
    expect(res?.result).toMatchObject({ protocolVersion: LATEST_PROTOCOL_VERSION })
  } finally {
    state.db.close()
  }
})

test("initialize falls back to LATEST_PROTOCOL_VERSION when protocolVersion is omitted", () => {
  const state = freshState()
  try {
    const res = handleRpc(state, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    expect(res?.result).toMatchObject({ protocolVersion: LATEST_PROTOCOL_VERSION })
  } finally {
    state.db.close()
  }
})

test("notifications/initialized round-trips as a no-op notification (no id, no response, no throw)", () => {
  const state = freshState()
  try {
    const res = handleRpc(state, { jsonrpc: "2.0", method: "notifications/initialized" })
    expect(res).toBeNull()
  } finally {
    state.db.close()
  }
})

test("tools/call for an unknown tool name is a JSON-RPC protocol error, code -32602", () => {
  const state = freshState()
  try {
    const res = handleRpc(state, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "not.a.real.tool", arguments: {} } })
    expect(res?.result).toBeUndefined()
    expect(res?.error).toMatchObject({ code: -32602 })
    expect(res?.error?.message).toContain("not.a.real.tool")
  } finally {
    state.db.close()
  }
})

test("tools/call for a known tool whose implementation throws surfaces as result.isError, not a JSON-RPC error", () => {
  const state = freshState()
  try {
    // graph.query throws "not bootstrapped" when there's no graph yet for the tenant.
    const res = handleRpc(state, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "graph.query", arguments: { terms: ["x"] } } })
    expect(res?.error).toBeUndefined()
    expect(res?.result).toMatchObject({ isError: true })
    expect((res?.result as any)?.content?.[0]?.text).toContain("not bootstrapped")
  } finally {
    state.db.close()
  }
})

test("tools/call for a known tool returning a business {ok:false} result is NOT reclassified as isError", () => {
  const state = freshState()
  try {
    // authority.flip's invalid-cell check runs before token validation, so a bogus token is fine here.
    const res = handleRpc(state, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "authority.flip", arguments: { token: "bogus", cell: "not-a-valid-cell", to: "graph" } },
    })
    expect(res?.error).toBeUndefined()
    expect((res?.result as any)?.isError).toBeUndefined()
    expect(res?.result).toMatchObject({ structuredContent: { ok: false } })
  } finally {
    state.db.close()
  }
})
