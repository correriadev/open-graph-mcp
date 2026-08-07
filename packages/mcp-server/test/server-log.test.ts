/**
 * server-log.test.ts — cobre o log estruturado JSONL de log.ts/index.ts (entregável do beta local:
 * o testador devolve este arquivo junto do feedback). Ligado explicitamente via `log: true` em cada
 * `startServer()` — o default de `StartOptions.log` é `false` justamente para não acender isto nos
 * ~290 testes que não pedem.
 */
import { existsSync, readFileSync } from "node:fs"
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, register } from "./helpers"

/** Lê o arquivo de log inteiro e devolve uma linha por objeto JSON parseado (falha se alguma linha
 *  não for JSON válido — é exatamente o que "cada linha é JSON válido" está checando). */
function readLog(file: string): any[] {
  const raw = readFileSync(file, "utf-8")
  return raw
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l))
}

test("o arquivo de log é criado e recebe uma linha por tools/call", async () => {
  const s = startServer({ log: true })
  try {
    const logFile = `${s.state.stateDir}/server.log`
    const a = await register(s.url, "alice")
    await callTool(s.url, "system.pending", { token: a.token })

    expect(existsSync(logFile)).toBe(true)
    const lines = readLog(logFile)
    const calls = lines.filter((l) => l.event === "tools/call")
    expect(calls.length).toBe(2)
    expect(calls.map((c) => c.tool)).toEqual(["session.register", "system.pending"])
  } finally {
    s.stop()
  }
})

test("cada linha é JSON válido com os campos esperados (boot + tools/call)", async () => {
  const s = startServer({ log: true })
  try {
    const logFile = `${s.state.stateDir}/server.log`
    await register(s.url, "bob")

    const lines = readLog(logFile) // já teria lançado se alguma linha não fosse JSON válido
    const boot = lines.find((l) => l.event === "boot")
    expect(boot).toBeTruthy()
    expect(typeof boot.ts).toBe("string")
    expect(typeof boot.port).toBe("number")
    expect(typeof boot.host).toBe("string")
    expect(typeof boot.stateDir).toBe("string")
    expect(typeof boot.version).toBe("string")
    expect(typeof boot.tenantsHydrated).toBe("number")

    const call = lines.find((l) => l.event === "tools/call" && l.tool === "session.register")
    expect(call).toBeTruthy()
    expect(typeof call.ts).toBe("string")
    expect(call.tenant).toBe("default") // session.register roda sem token ainda — tenantOf cai no default
    expect(typeof call.durationMs).toBe("number")
    expect(call.ok).toBe(true)
    expect(call.error).toBeUndefined()
  } finally {
    s.stop()
  }
})

test("um erro de tool é registrado com ok:false e a mensagem do erro", async () => {
  const s = startServer({ log: true })
  try {
    const logFile = `${s.state.stateDir}/server.log`
    const a = await register(s.url, "carol")
    await expect(callTool(s.url, "changeset.open", { token: a.token, cells: [], intent: "empty" })).rejects.toThrow(/cells required/)

    const lines = readLog(logFile)
    const failed = lines.find((l) => l.event === "tools/call" && l.tool === "changeset.open")
    expect(failed).toBeTruthy()
    expect(failed.ok).toBe(false)
    expect(failed.error?.message).toMatch(/cells required/)
  } finally {
    s.stop()
  }
})

test("PRIVACIDADE: token e conteúdo de claim (subject/anchor) nunca aparecem no arquivo de log", async () => {
  const s = startServer({ log: true })
  try {
    const logFile = `${s.state.stateDir}/server.log`
    const a = await register(s.url, "dave")

    const SECRET_SUBJECT = "SECRET_SUBJECT_a1b2c3d4"
    const SECRET_ANCHOR = "SECRET_ANCHOR_e5f6g7h8"
    await callTool(s.url, "changeset.claim", {
      token: a.token,
      delta: {
        kind: "claim.add",
        payload: { id: "leaked-claim-id", subject: SECRET_SUBJECT, domain: "test", level: 5, refs: [], anchor: SECRET_ANCHOR },
      },
    })

    // Confirma que a chamada realmente aconteceu e foi registrada — senão o teste "passaria" mesmo
    // que o call site de log estivesse quebrado e nunca escrevesse nada.
    const lines = readLog(logFile)
    const claimCall = lines.find((l) => l.event === "tools/call" && l.tool === "changeset.claim")
    expect(claimCall).toBeTruthy()
    expect(claimCall.ok).toBe(true)

    const raw = readFileSync(logFile, "utf-8")
    expect(raw).not.toContain(a.token)
    expect(raw).not.toContain(SECRET_SUBJECT)
    expect(raw).not.toContain(SECRET_ANCHOR)
  } finally {
    s.stop()
  }
})

test("log desligado por default: startServer() sem log:true não cria server.log", async () => {
  const s = startServer()
  try {
    await register(s.url, "erin")
    const logFile = `${s.state.stateDir}/server.log`
    expect(existsSync(logFile)).toBe(false)
  } finally {
    s.stop()
  }
})
