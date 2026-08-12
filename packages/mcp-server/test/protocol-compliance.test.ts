import { expect, test } from "bun:test"
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js"
import { createState } from "../src/state"
import { handleRpc } from "../src/transport"
import { startServer } from "../src/index"

function freshState() {
  return createState({ stateDir: ":memory:" })
}

test("initialize echoes back a client protocolVersion the server supports", async () => {
  const state = freshState()
  try {
    const wanted = SUPPORTED_PROTOCOL_VERSIONS[1] ?? LATEST_PROTOCOL_VERSION
    const res = await handleRpc(state, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: wanted } })
    expect(res?.result).toMatchObject({ protocolVersion: wanted })
  } finally {
    state.db.close()
  }
})

test("initialize falls back to LATEST_PROTOCOL_VERSION for an unsupported protocolVersion", async () => {
  const state = freshState()
  try {
    const res = await handleRpc(state, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } })
    expect(res?.result).toMatchObject({ protocolVersion: LATEST_PROTOCOL_VERSION })
  } finally {
    state.db.close()
  }
})

test("initialize falls back to LATEST_PROTOCOL_VERSION when protocolVersion is omitted", async () => {
  const state = freshState()
  try {
    const res = await handleRpc(state, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    expect(res?.result).toMatchObject({ protocolVersion: LATEST_PROTOCOL_VERSION })
  } finally {
    state.db.close()
  }
})

test("notifications/initialized round-trips as a no-op notification (no id, no response, no throw)", async () => {
  const state = freshState()
  try {
    const res = await handleRpc(state, { jsonrpc: "2.0", method: "notifications/initialized" })
    expect(res).toBeNull()
  } finally {
    state.db.close()
  }
})

test("tools/call for an unknown tool name is a JSON-RPC protocol error, code -32602", async () => {
  const state = freshState()
  try {
    const res = await handleRpc(state, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "not.a.real.tool", arguments: {} } })
    expect(res?.result).toBeUndefined()
    expect(res?.error).toMatchObject({ code: -32602 })
    expect(res?.error?.message).toContain("not.a.real.tool")
  } finally {
    state.db.close()
  }
})

test("tools/call for a known tool whose implementation throws surfaces as result.isError, not a JSON-RPC error", async () => {
  const state = freshState()
  try {
    // graph.query throws "not bootstrapped" when there's no graph yet for the tenant.
    const res = await handleRpc(state, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "graph.query", arguments: { terms: ["x"] } } })
    expect(res?.error).toBeUndefined()
    expect(res?.result).toMatchObject({ isError: true })
    expect((res?.result as any)?.content?.[0]?.text).toContain("not bootstrapped")
  } finally {
    state.db.close()
  }
})

test("tools/call for a known tool returning a business {ok:false} result is NOT reclassified as isError", async () => {
  const state = freshState()
  try {
    // authority.flip's invalid-cell check runs before token validation, so a bogus token is fine here.
    const res = await handleRpc(state, {
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

test("GET /mcp is 405 Method Not Allowed with an Allow header listing POST", async () => {
  const s = startServer()
  try {
    const res = await fetch(`${s.url}/mcp`, { method: "GET" })
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toContain("POST")
  } finally {
    s.stop()
  }
})

test("POST /mcp initialize with no incoming MCP-Protocol-Version header echoes the negotiated protocolVersion", async () => {
  const s = startServer()
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    })
    const body: any = await res.json()
    expect(body.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
    expect(res.headers.get("mcp-protocol-version")).toBe(LATEST_PROTOCOL_VERSION)
  } finally {
    s.stop()
  }
})

test("POST /mcp non-initialize request with an incoming MCP-Protocol-Version header echoes that same value back", async () => {
  const s = startServer()
  try {
    const wanted = SUPPORTED_PROTOCOL_VERSIONS[1] ?? LATEST_PROTOCOL_VERSION
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "mcp-protocol-version": wanted },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("mcp-protocol-version")).toBe(wanted)
  } finally {
    s.stop()
  }
})

test("POST /mcp non-initialize request with no incoming header and no protocolVersion in the result omits the header", async () => {
  const s = startServer()
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("mcp-protocol-version")).toBeNull()
  } finally {
    s.stop()
  }
})

test("default allowedOrigins (open, D2): any Origin still succeeds, response echoes access-control-allow-origin: *", async () => {
  const s = startServer()
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
  } finally {
    s.stop()
  }
})

test("restrictive allowedOrigins: a request with a disallowed Origin header is rejected 403", async () => {
  const s = startServer({ allowedOrigins: ["https://allowed.example"] })
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://not-allowed.example" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    expect(res.status).toBe(403)
  } finally {
    s.stop()
  }
})

test("restrictive allowedOrigins: a request with the allowed Origin succeeds and the header echoes that exact origin", async () => {
  const s = startServer({ allowedOrigins: ["https://allowed.example"] })
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://allowed.example" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("access-control-allow-origin")).toBe("https://allowed.example")
  } finally {
    s.stop()
  }
})

test("restrictive allowedOrigins: a request with no Origin header at all proceeds normally (non-browser clients unaffected)", async () => {
  const s = startServer({ allowedOrigins: ["https://allowed.example"] })
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    expect(res.status).toBe(200)
  } finally {
    s.stop()
  }
})

test("/mcp response exposes mcp-protocol-version via access-control-allow-headers and access-control-expose-headers", async () => {
  const s = startServer()
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    expect(res.status).toBe(200)
    expect((res.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain("mcp-protocol-version")
    expect((res.headers.get("access-control-expose-headers") ?? "").toLowerCase()).toContain("mcp-protocol-version")
  } finally {
    s.stop()
  }
})

test("restrictive allowedOrigins: /events also rejects a disallowed Origin with 403 (DNS-rebinding guard applies to all routes)", async () => {
  const s = startServer({ allowedOrigins: ["https://allowed.example"] })
  try {
    const res = await fetch(`${s.url}/events`, {
      headers: { origin: "https://not-allowed.example" },
    })
    expect(res.status).toBe(403)
  } finally {
    s.stop()
  }
})

test("restrictive allowedOrigins: /events with the allowed Origin succeeds and echoes it — proves index.ts's header-override actually replaces sse.ts's hardcoded '*'", async () => {
  const s = startServer({ allowedOrigins: ["https://allowed.example"] })
  try {
    const res = await fetch(`${s.url}/events`, {
      headers: { origin: "https://allowed.example" },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("access-control-allow-origin")).toBe("https://allowed.example")
    await res.body?.cancel()
  } finally {
    s.stop()
  }
})

test("restrictive allowedOrigins: /events with no Origin header succeeds with access-control-allow-origin omitted — proves the override's delete branch strips sse.ts's hardcoded '*' too", async () => {
  const s = startServer({ allowedOrigins: ["https://allowed.example"] })
  try {
    const res = await fetch(`${s.url}/events`)
    expect(res.status).toBe(200)
    expect(res.headers.get("access-control-allow-origin")).toBeNull()
    await res.body?.cancel()
  } finally {
    s.stop()
  }
})
