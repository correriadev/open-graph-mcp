/**
 * session-register-negative.test.ts — WS-D. `session.register { name, tenant? }` has zero negative
 * coverage today: no test asserts the `"session.register: name required"` throw (src/tools/session.ts:12),
 * nor the shape of what happens when `name`/`tenant` are malformed. Also covers the double-register
 * case: same name registered twice must reuse the SAME deterministic userId (id is a hash of
 * tenant+name, session.ts:14) but mint a DIFFERENT token each time, and BOTH tokens must remain valid
 * simultaneously (token is a bearer credential per registration, not per user).
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, register } from "./helpers"

// rpc() throws on both body.error and result.isError === true, collapsing the distinction the spec
// cares about here (protocol-level -32602 vs. a normal tool-execution failure). Local raw helper to
// inspect the envelope directly where that distinction matters.
async function rpcRaw(base: string, method: string, params?: unknown): Promise<any> {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  return res.json()
}

test("session.register sem name: rejeitado com a mensagem exata do throw", async () => {
  const s = startServer()
  try {
    await expect(callTool(s.url, "session.register", {})).rejects.toThrow("session.register: name required")
  } finally {
    s.stop()
  }
})

test("session.register com name número: rejeitado", async () => {
  const s = startServer()
  try {
    await expect(callTool(s.url, "session.register", { name: 42 })).rejects.toThrow("session.register: name required")
  } finally {
    s.stop()
  }
})

test("session.register com name objeto: rejeitado", async () => {
  const s = startServer()
  try {
    await expect(callTool(s.url, "session.register", { name: { nested: true } })).rejects.toThrow(
      "session.register: name required",
    )
  } finally {
    s.stop()
  }
})

test("session.register com name null: rejeitado", async () => {
  const s = startServer()
  try {
    await expect(callTool(s.url, "session.register", { name: null })).rejects.toThrow("session.register: name required")
  } finally {
    s.stop()
  }
})

test("session.register com name string vazia: rejeitado (string vazia é falsy)", async () => {
  const s = startServer()
  try {
    await expect(callTool(s.url, "session.register", { name: "" })).rejects.toThrow("session.register: name required")
  } finally {
    s.stop()
  }
})

test("session.register com name muito longo: aceito (sem limite documentado, não deve travar)", async () => {
  const s = startServer()
  try {
    const longName = "a".repeat(5000)
    const result = await register(s.url, longName)
    expect(result.token).toMatch(/^[0-9a-f]{32}$/)
    expect(result.userId).toStartWith("u_")
  } finally {
    s.stop()
  }
})

test("session.register com tenant não-string: cai no tenant default em vez de travar", async () => {
  const s = startServer()
  try {
    // tenant só é usado se `typeof args.tenant === "string"` (session.ts:13); qualquer outro tipo cai
    // no mesmo fallback que "tenant ausente" — não é um caso de erro.
    const result = await callTool(s.url, "session.register", { name: "alice", tenant: 123 })
    expect((result as any).tenantId).toBe("default")
  } finally {
    s.stop()
  }
})

test("session.register com tenant string vazia: cai no tenant default (string vazia é falsy)", async () => {
  const s = startServer()
  try {
    const result = await callTool(s.url, "session.register", { name: "alice", tenant: "" })
    expect((result as any).tenantId).toBe("default")
  } finally {
    s.stop()
  }
})

test("registrar o MESMO name duas vezes: mesmo userId determinístico, tokens DIFERENTES, ambos válidos", async () => {
  const s = startServer()
  try {
    const first = await register(s.url, "alice", "acme")
    const second = await register(s.url, "alice", "acme")

    expect(second.userId).toBe(first.userId)
    expect(second.tenantId).toBe(first.tenantId)
    expect(second.token).not.toBe(first.token)

    // Both tokens are independently valid bearer credentials — proven by exercising a
    // requireToken-gated tool (system.pending) with each.
    const p1 = await callTool(s.url, "system.pending", { token: first.token })
    const p2 = await callTool(s.url, "system.pending", { token: second.token })
    expect(p1).toEqual({ messages: [] })
    expect(p2).toEqual({ messages: [] })
  } finally {
    s.stop()
  }
})

test("session.register malformado devolve isError:true (execução de tool), não um erro de protocolo -32602", async () => {
  const s = startServer()
  try {
    const body = await rpcRaw(s.url, "tools/call", { name: "session.register", arguments: {} })
    expect(body.error).toBeUndefined()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toBe("session.register: name required")
  } finally {
    s.stop()
  }
})
