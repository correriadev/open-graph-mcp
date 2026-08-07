/**
 * transport-validation.test.ts — regressão dos três achados de input-validation confirmados por probe
 * ao vivo (ver relatório): envelope JSON-RPC malformado (transport.ts handleRpc), graph.subscribe sem
 * validação/checagem de sessão, e graph.query vazando TypeError cru + tenantOf conflando "sem token"
 * com "token inválido".
 */
import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { startServer } from "../src/index"
import { callTool, openSse, register, tempRepo, bootstrapAs } from "./helpers"

function newStateDir(): string {
  return mkdtempSync(path.join(tmpdir(), "og-validation-"))
}

// ---------------------------------------------------------------------------
// FINDING 1 — envelope JSON-RPC malformado (POST /mcp)
// ---------------------------------------------------------------------------

test("POST /mcp com body `null` retorna -32600 Invalid Request, não 500 cru", async () => {
  const s = startServer({ stateDir: newStateDir(), watch: false })
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    })
    expect(res.status).toBe(200) // erro JSON-RPC viaja em corpo 200, não em status HTTP
    const body: any = await res.json()
    expect(body.jsonrpc).toBe("2.0")
    expect(body.id).toBe(null)
    expect(body.error?.code).toBe(-32600)
  } finally {
    s.stop()
  }
})

test("POST /mcp com um array (batch) retorna -32600 explícito, não 204 silencioso", async () => {
  const s = startServer({ stateDir: newStateDir(), watch: false })
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]),
    })
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.error?.code).toBe(-32600)
  } finally {
    s.stop()
  }
})

test("POST /mcp com method ausente/não-string retorna -32600", async () => {
  const s = startServer({ stateDir: newStateDir(), watch: false })
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7 }),
    })
    const body: any = await res.json()
    expect(body.id).toBe(7) // id válido presente no envelope malformado deve ser ecoado
    expect(body.error?.code).toBe(-32600)
  } finally {
    s.stop()
  }
})

test("POST /mcp com request conforme continua funcionando normalmente", async () => {
  const s = startServer({ stateDir: newStateDir(), watch: false })
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    const body: any = await res.json()
    expect(body.error).toBeUndefined()
    expect(Array.isArray(body.result.tools)).toBe(true)
  } finally {
    s.stop()
  }
})

// ---------------------------------------------------------------------------
// FINDING 2 — graph.subscribe sem validação
// ---------------------------------------------------------------------------

test("graph.subscribe com sessionId forjado (nunca aberto via /events) é rejeitado", async () => {
  const s = startServer({ stateDir: newStateDir(), watch: false })
  try {
    await expect(callTool(s.url, "graph.subscribe", { sessionId: "s_deadbeef0000", filters: [] })).rejects.toThrow(
      /desconhecida ou expirada/,
    )
  } finally {
    s.stop()
  }
})

test("graph.subscribe com sessionId em formato inválido é rejeitado", async () => {
  const s = startServer({ stateDir: newStateDir(), watch: false })
  try {
    await expect(callTool(s.url, "graph.subscribe", { sessionId: "not-a-session", filters: [] })).rejects.toThrow(
      /sessionId inválido/,
    )
  } finally {
    s.stop()
  }
})

test("graph.subscribe com filters que não é array é rejeitado", async () => {
  const s = startServer({ stateDir: newStateDir(), watch: false })
  try {
    const sse = await openSse(s.url)
    const created = await sse.waitFor((e) => e.sessionId !== undefined)
    await expect(callTool(s.url, "graph.subscribe", { sessionId: created.sessionId, filters: "all" })).rejects.toThrow(
      /filters deve ser um array/,
    )
    sse.close()
  } finally {
    s.stop()
  }
})

test("graph.subscribe com sessão real (session.created) funciona normalmente", async () => {
  const s = startServer({ stateDir: newStateDir(), watch: false })
  try {
    const sse = await openSse(s.url)
    const created = await sse.waitFor((e) => e.sessionId !== undefined)
    const result = await callTool(s.url, "graph.subscribe", { sessionId: created.sessionId, filters: [{ kind: "all" }] })
    expect(result).toEqual({ ok: true })
    sse.close()
  } finally {
    s.stop()
  }
})

// ---------------------------------------------------------------------------
// FINDING 3a — graph.query com terms ausente/mal-tipado
// ---------------------------------------------------------------------------

test("graph.query sem terms retorna erro limpo, não TypeError cru", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ stateDir: newStateDir(), watch: false })
  try {
    await bootstrapAs(s.url, root)
    await expect(callTool(s.url, "graph.query", {})).rejects.toThrow(/terms deve ser um array de strings/)
  } finally {
    s.stop()
    cleanup()
  }
})

test("graph.query com terms de tipo errado (string em vez de array) retorna erro limpo", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ stateDir: newStateDir(), watch: false })
  try {
    await bootstrapAs(s.url, root)
    await expect(callTool(s.url, "graph.query", { terms: "not-an-array" })).rejects.toThrow(
      /terms deve ser um array de strings/,
    )
  } finally {
    s.stop()
    cleanup()
  }
})

// ---------------------------------------------------------------------------
// FINDING 3b — tenantOf: "sem token" (anônimo, intencional) vs "token inválido" (erro explícito)
// ---------------------------------------------------------------------------

test("graph.query sem token cai no tenant default (path anônimo continua intencional)", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ stateDir: newStateDir(), watch: false })
  try {
    await bootstrapAs(s.url, root) // publica no tenant default
    const result: any = await callTool(s.url, "graph.query", { terms: ["fresh"] })
    expect(result.candidates).toBeDefined()
  } finally {
    s.stop()
    cleanup()
  }
})

test("graph.query com token inválido/desconhecido retorna erro explícito, não fallback silencioso pro default", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ stateDir: newStateDir(), watch: false })
  try {
    await bootstrapAs(s.url, root)
    await expect(callTool(s.url, "graph.query", { terms: ["fresh"], token: "totally-bogus-token" })).rejects.toThrow(
      /invalid or expired token/,
    )
  } finally {
    s.stop()
    cleanup()
  }
})

test("graph.query com token válido de outro tenant vazio não vaza pro default silenciosamente", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ stateDir: newStateDir(), watch: false })
  try {
    await bootstrapAs(s.url, root, "bootstrapper", "default")
    const other = await register(s.url, "someone", "other-tenant")
    // token é válido (registrado), mas o tenant "other-tenant" nunca foi bootstrapado — deve dar
    // "not bootstrapped", não silenciosamente devolver o grafo do tenant default.
    await expect(callTool(s.url, "graph.query", { terms: ["fresh"], token: other.token })).rejects.toThrow(
      /not bootstrapped/,
    )
  } finally {
    s.stop()
    cleanup()
  }
})
