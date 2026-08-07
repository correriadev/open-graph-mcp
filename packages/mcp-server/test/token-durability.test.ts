/**
 * token-durability.test.ts — D10-lite. Antes disto, um token vivia só num `Map` do processo: reiniciar
 * o servidor invalidava silenciosamente todo token já emitido, e num beta LOCAL (o testador roda o
 * próprio servidor e vai reiniciá-lo o tempo todo) isso é o papercut mais frequente que existe.
 *
 * Cobre, nesta ordem: a promessa central (sobreviver ao restart), o formato em repouso (hash, e fora
 * do JSONL), a expiração nos dois caminhos (boot e lookup), o sinal de restart que o `staleBoot`
 * substitui, e o isolamento (tenant, stateDir).
 */
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { startServer } from "../src/index"
import { hashToken } from "../src/tokens"
import { callTool, openSse, register } from "./helpers"

const isSessionCreated = (e: any) => e.kind === undefined && typeof e.sessionId === "string" && typeof e.graphId === "string"

/** Um stateDir descartável + cleanup garantido. Um `startServer` por vez dentro do corpo: o ponto
 *  destes testes é justamente que dois processos SUCESSIVOS compartilham o diretório. */
function withStateDir(fn: (stateDir: string) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "og-token-"))
    try {
      await fn(stateDir)
    } finally {
      cleanupStateDir(stateDir)
    }
  }
}

/**
 * `stop()` fecha o SQLite (index.ts), mas no Windows o handle do WAL pode demorar alguns
 * milissegundos a mais para ser liberado pelo SO, e o `rmSync` imediato leva EBUSY. Isso é limpeza de
 * diretório temporário: uma falha aqui não é um resultado de teste, e deixar propagar transformaria
 * um teste verde num vermelho por motivo nenhum. Tenta algumas vezes e desiste em silêncio — é
 * `tmpdir()`, o SO recolhe.
 */
function cleanupStateDir(dir: string): void {
  for (let i = 0; i < 20; i++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      /* ainda travado — tenta de novo */
    }
  }
}

// ── A promessa central ───────────────────────────────────────────────────────

test(
  "o MESMO token continua valendo depois de um restart — sem re-registrar",
  withStateDir(async (stateDir) => {
    const s1 = startServer({ stateDir })
    const alice = await register(s1.url, "alice")
    const { csId } = await callTool(s1.url, "changeset.open", { token: alice.token, cells: ["ui:9"], intent: "antes do restart" })
    s1.stop()

    const s2 = startServer({ stateDir })
    try {
      // Nenhum session.register aqui: é o token velho, apresentado tal e qual, num processo novo.
      const who = await callTool(s2.url, "presence.who", { token: alice.token })
      expect(who.users).toEqual([])

      // E a identidade é a mesma, então o turno aberto antes do restart continua sendo dele.
      const mine = await callTool(s2.url, "changeset.list_mine", { token: alice.token })
      expect(mine.changesets.map((c: any) => c.csId)).toContain(csId)

      // ...e ele consegue de fato terminar o trabalho, que é o que importa pro usuário.
      const commit = await callTool(s2.url, "changeset.commit", { token: alice.token, csId, intent: "depois do restart" })
      expect(commit.ok).toBe(true)
    } finally {
      s2.stop()
    }
  }),
)

test(
  "sobrevive a restarts sucessivos, nao so ao primeiro",
  withStateDir(async (stateDir) => {
    const s1 = startServer({ stateDir })
    const alice = await register(s1.url, "alice")
    s1.stop()

    for (let i = 0; i < 3; i++) {
      const s = startServer({ stateDir })
      try {
        const r = await callTool(s.url, "presence.who", { token: alice.token })
        expect(r.users).toEqual([])
      } finally {
        s.stop()
      }
    }
  }),
)

test(
  "o tenant do token sobrevive ao restart — nao cai pro default",
  withStateDir(async (stateDir) => {
    const s1 = startServer({ stateDir })
    const acme = await register(s1.url, "alice", "acme")
    expect(acme.tenantId).toBe("acme")
    await callTool(s1.url, "changeset.open", { token: acme.token, cells: ["ui:1"], intent: "acme" })
    s1.stop()

    const s2 = startServer({ stateDir })
    try {
      // Se o token caísse pro tenant default, `list_mine` viria vazio — o changeset é do acme.
      const mine = await callTool(s2.url, "changeset.list_mine", { token: acme.token })
      expect(mine.changesets).toHaveLength(1)

      // E o SSE resolve o mesmo tenant a partir do token persistido.
      const sse = await openSse(s2.url, 0, acme.token)
      const created = await sse.waitFor(isSessionCreated)
      expect(created.tenant).toBe("acme")
      sse.close()
    } finally {
      s2.stop()
    }
  }),
)

// ── Formato em repouso ───────────────────────────────────────────────────────

test(
  "o token NAO e gravado em claro: o SQLite guarda so o sha256",
  withStateDir(async (stateDir) => {
    const s = startServer({ stateDir })
    try {
      const alice = await register(s.url, "alice")
      const rows = s.state.db.query("SELECT token_hash, user_id, name FROM tokens").all() as { token_hash: string; user_id: string; name: string }[]
      expect(rows).toHaveLength(1)
      expect(rows[0].token_hash).toBe(hashToken(alice.token))
      expect(rows[0].token_hash).not.toBe(alice.token)
      expect(rows[0].user_id).toBe(alice.userId)

      // Nenhuma coluna da linha contém o token em claro (pega uma coluna extra acrescentada sem cuidado).
      const all = s.state.db.query("SELECT * FROM tokens").all() as Record<string, unknown>[]
      for (const v of Object.values(all[0])) expect(String(v)).not.toContain(alice.token)
    } finally {
      s.stop()
    }
  }),
)

test(
  "o token NAO vai pro espelho JSONL — nem em claro, nem hasheado",
  withStateDir(async (stateDir) => {
    const s = startServer({ stateDir })
    try {
      const alice = await register(s.url, "alice")
      await callTool(s.url, "changeset.open", { token: alice.token, cells: ["ui:1"], intent: "gera JSONL" })

      const tenantDir = path.join(stateDir, "tenants", "default")
      expect(existsSync(path.join(tenantDir, "users.jsonl"))).toBe(true) // o user VAI (é durável)
      expect(existsSync(path.join(tenantDir, "tokens.jsonl"))).toBe(false) // o token NÃO

      // E nenhum outro JSONL vazou o token de carona (ex.: um payload de evento).
      for (const f of ["users.jsonl", "changesets.jsonl", "events.jsonl"]) {
        const p = path.join(tenantDir, f)
        if (!existsSync(p)) continue
        const body = readFileSync(p, "utf8")
        expect(body).not.toContain(alice.token)
        expect(body).not.toContain(hashToken(alice.token))
      }
    } finally {
      s.stop()
    }
  }),
)

// ── Expiração ────────────────────────────────────────────────────────────────

test(
  "session.register devolve expiresAt no futuro, coerente com o TTL configurado",
  withStateDir(async (stateDir) => {
    const s = startServer({ stateDir, tokenTtlMs: 60_000 })
    try {
      const before = Date.now()
      const alice = (await callTool(s.url, "session.register", { name: "alice" })) as any
      const exp = Date.parse(alice.expiresAt)
      expect(Number.isNaN(exp)).toBe(false)
      expect(exp).toBeGreaterThanOrEqual(before + 60_000)
      expect(exp).toBeLessThanOrEqual(Date.now() + 60_000)
    } finally {
      s.stop()
    }
  }),
)

test(
  "token vencido e recusado NO LOOKUP, sem depender da varredura de boot",
  withStateDir(async (stateDir) => {
    const s = startServer({ stateDir })
    try {
      const alice = await register(s.url, "alice")
      // Vence o token por baixo, no banco E no Map quente — é o que o relógio faria num processo que
      // ficou meses de pé, sem nunca reexecutar a varredura de boot.
      const past = new Date(Date.now() - 1000).toISOString()
      s.state.db.query("UPDATE tokens SET expires_at = ?").run(past)
      const info = s.state.tokens.get(hashToken(alice.token))!
      info.expiresAt = Date.parse(past)

      await expect(callTool(s.url, "presence.who", { token: alice.token })).rejects.toThrow(/invalid or expired token/)

      // E o lookup que recusou também LIMPOU — nem no Map nem no banco sobra lixo vencido.
      expect(s.state.tokens.has(hashToken(alice.token))).toBe(false)
      expect((s.state.db.query("SELECT COUNT(*) AS c FROM tokens").get() as { c: number }).c).toBe(0)
    } finally {
      s.stop()
    }
  }),
)

test(
  "token vencido nao ressuscita no restart — a varredura de boot apaga",
  withStateDir(async (stateDir) => {
    const s1 = startServer({ stateDir })
    const alice = await register(s1.url, "alice")
    const bob = await register(s1.url, "bob")
    // Só o token da alice vence.
    s1.state.db.query("UPDATE tokens SET expires_at = ? WHERE token_hash = ?").run(new Date(Date.now() - 1000).toISOString(), hashToken(alice.token))
    s1.stop()

    const s2 = startServer({ stateDir })
    try {
      expect((s2.state.db.query("SELECT COUNT(*) AS c FROM tokens").get() as { c: number }).c).toBe(1)
      await expect(callTool(s2.url, "presence.who", { token: alice.token })).rejects.toThrow(/invalid or expired token/)
      const who = await callTool(s2.url, "presence.who", { token: bob.token }) // o do bob continua bom
      expect(who.users).toEqual([])
    } finally {
      s2.stop()
    }
  }),
)

// ── O sinal de restart (o que `staleBoot` substitui) ─────────────────────────

test(
  "server.restarted chega na PRIMEIRA conexao pos-restart e NAO se repete na segunda",
  withStateDir(async (stateDir) => {
    const s1 = startServer({ stateDir })
    const alice = await register(s1.url, "alice")
    const sse0 = await openSse(s1.url, 0, alice.token)
    await sse0.waitFor(isSessionCreated)
    // No processo que EMITIU o token não há restart nenhum.
    expect(sse0.events.some((e) => e.kind === "server.restarted")).toBe(false)
    sse0.close()
    s1.stop()

    const s2 = startServer({ stateDir })
    try {
      const sse1 = await openSse(s2.url, 0, alice.token)
      await sse1.waitFor((e) => e.kind === "server.restarted") // presença foi zerada — o cliente precisa saber
      sse1.close()

      // Segunda conexão do MESMO processo: já não é restart, e repetir o aviso faria o cliente
      // rezerar presença sem motivo.
      const sse2 = await openSse(s2.url, 0, alice.token)
      await sse2.waitFor(isSessionCreated)
      const sentinel = await callTool(s2.url, "changeset.open", { token: alice.token, cells: ["ui:2"], intent: "sentinela" })
      await sse2.waitFor((e) => e.kind === "lock.acquired" && e.payload.csId === sentinel.csId)
      expect(sse2.events.some((e) => e.kind === "server.restarted")).toBe(false)
      sse2.close()
    } finally {
      s2.stop()
    }
  }),
)

test(
  "token desconhecido/lixo continua marcando restart (compat) e cai no tenant default",
  withStateDir(async (stateDir) => {
    const s = startServer({ stateDir })
    try {
      const sse = await openSse(s.url, 0, "nao-e-um-token-de-verdade")
      const created = await sse.waitFor(isSessionCreated)
      expect(created.tenant).toBe("default")
      await sse.waitFor((e) => e.kind === "server.restarted")
      sse.close()
    } finally {
      s.stop()
    }
  }),
)

// ── Isolamento ───────────────────────────────────────────────────────────────

test(
  "stateDirs diferentes nao compartilham token",
  withStateDir(async (dirA) => {
    const sA = startServer({ stateDir: dirA })
    const alice = await register(sA.url, "alice")
    sA.stop()

    const dirB = mkdtempSync(path.join(tmpdir(), "og-token-b-"))
    const sB = startServer({ stateDir: dirB })
    try {
      await expect(callTool(sB.url, "presence.who", { token: alice.token })).rejects.toThrow(/invalid or expired token/)
    } finally {
      sB.stop()
      cleanupStateDir(dirB)
    }
  }),
)

test(
  "re-registrar o mesmo nome emite token novo SEM invalidar o antigo (duas maquinas, uma identidade)",
  withStateDir(async (stateDir) => {
    const s1 = startServer({ stateDir })
    const first = await register(s1.url, "alice")
    s1.stop()

    const s2 = startServer({ stateDir })
    try {
      const second = await register(s2.url, "alice")
      expect(second.token).not.toBe(first.token)
      expect(second.userId).toBe(first.userId) // userId é determinístico por (tenant, name)

      // Os dois valem ao mesmo tempo e são a MESMA pessoa — um turno aberto com um fecha com o outro.
      const { csId } = await callTool(s2.url, "changeset.open", { token: first.token, cells: ["ui:3"], intent: "com o token velho" })
      const commit = await callTool(s2.url, "changeset.commit", { token: second.token, csId, intent: "com o token novo" })
      expect(commit.ok).toBe(true)
      expect((s2.state.db.query("SELECT COUNT(*) AS c FROM tokens").get() as { c: number }).c).toBe(2)
    } finally {
      s2.stop()
    }
  }),
)

test(
  "token persistido de um tenant nao alcanca outro tenant depois do restart",
  withStateDir(async (stateDir) => {
    const s1 = startServer({ stateDir })
    const acme = await register(s1.url, "alice", "acme")
    const globex = await register(s1.url, "bob", "globex")
    await callTool(s1.url, "changeset.open", { token: globex.token, cells: ["ui:1"], intent: "do globex" })
    s1.stop()

    const s2 = startServer({ stateDir })
    try {
      // O token do acme não enxerga o turno do globex — o escopo por tenant sobrevive à hidratação.
      const mine = await callTool(s2.url, "changeset.list_mine", { token: acme.token })
      expect(mine.changesets).toHaveLength(0)

      // E a mesma célula continua livre pro acme: as travas são por tenant.
      const open = await callTool(s2.url, "changeset.open", { token: acme.token, cells: ["ui:1"], intent: "do acme" })
      expect(open.csId).toBeTruthy()
    } finally {
      s2.stop()
    }
  }),
)

test(
  "graph.subscribe continua recusando token de outro dono depois do restart",
  withStateDir(async (stateDir) => {
    const s1 = startServer({ stateDir })
    await register(s1.url, "alice")
    await register(s1.url, "bob")
    s1.stop()

    const s2 = startServer({ stateDir })
    try {
      // Tokens novos no processo 2, mas a hidratação trouxe os antigos: o que importa é o binding.
      const alice = await register(s2.url, "alice")
      const bob = await register(s2.url, "bob")
      const sse = await openSse(s2.url, 0, alice.token)
      const created = await sse.waitFor(isSessionCreated)

      await expect(
        callTool(s2.url, "graph.subscribe", { sessionId: created.sessionId, filters: [{ kind: "all" }], token: bob.token }),
      ).rejects.toThrow(/not owned by caller/)
      const ok = await callTool(s2.url, "graph.subscribe", { sessionId: created.sessionId, filters: [{ kind: "all" }], token: alice.token })
      expect(ok.ok).toBe(true)
      sse.close()
    } finally {
      s2.stop()
    }
  }),
)
