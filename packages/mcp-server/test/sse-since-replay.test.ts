import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

/**
 * O frame `session.created` do /events NAO carrega `kind`: o `data` e o objeto cru
 * `{ sessionId, graphId, tenant }` (ver `frame()` em src/sse.ts, que passa o nome do evento no campo
 * `event:` do SSE e o payload cru no `data:`). Esperar por `e.kind === "session.created"` trava ate o
 * timeout — o helper `openSse` so guarda o `data:` parseado.
 */
const isSessionCreated = (e: any) => e.kind === undefined && typeof e.sessionId === "string" && typeof e.graphId === "string"

/**
 * sse-since-replay.test.ts (WS-C, SB-0 §5/pré-classificados) — todo teste de SSE existente abre em
 * since=0. Este arquivo cobre o caminho de reconexão com cursor N≠0:
 *  - backlog exato (sem duplicata, sem gap) a partir de N+1;
 *  - o guard de privacidade de `lock.denied` (affinity.ts `isRecipient`, reaplicado por linha no
 *    replay de sse.ts) — nunca exercitado em N≠0 antes;
 *  - o fix Tier 1 de `?since=` malformado (NaN silencioso → 400 explícito).
 */

test("reconnect at since=N replays exactly seq>N, contiguous, no duplicates", async () => {
  const s = startServer()
  try {
    const { token } = await register(s.url, "alice")

    // Observador desde o início: aprende TODOS os seqs duráveis emitidos, pra comparar contra o
    // backlog do reconnect depois.
    const observer = await openSse(s.url, 0, token)
    await observer.waitFor((e) => isSessionCreated(e))

    for (let i = 0; i < 5; i++) {
      await callTool(s.url, "changeset.open", { token, cells: [`cell${i}`], intent: `intent${i}` })
    }
    await observer.waitFor((e) => e.kind === "lock.acquired" && e.target === "cell4")

    const allDurable = observer.events.filter((e) => !isSessionCreated(e) && !e.ephemeral)
    const allSeqs = allDurable.map((e) => e.seq).sort((a, b) => a - b)
    expect(allSeqs.length).toBeGreaterThanOrEqual(10) // changeset.opened + lock.acquired × 5
    observer.close()

    // Reconecta no meio do log — since = o seq do 3o evento (índice 2).
    const midSeq = allSeqs[2]
    const sse = await openSse(s.url, midSeq, token)
    await sse.waitFor((e) => isSessionCreated(e))

    // Sentinela: mais um evento conhecido, emitido DEPOIS da reconexão — sua chegada prova que o
    // backlog inteiro já foi processado (sem precisar de sleep).
    await callTool(s.url, "changeset.open", { token, cells: ["cell-sentinel"], intent: "sentinel" })
    await sse.waitFor((e) => e.kind === "lock.acquired" && e.target === "cell-sentinel")

    const backlog = sse.events.filter((e) => !isSessionCreated(e) && !e.ephemeral)
    const backlogSeqs = backlog.map((e) => e.seq).sort((a, b) => a - b)

    // Começa exatamente em N+1.
    expect(backlogSeqs[0]).toBe(midSeq + 1)
    // Sem duplicata.
    expect(new Set(backlogSeqs).size).toBe(backlogSeqs.length)
    // Sem gap: contíguo de midSeq+1 até o último.
    for (let i = 1; i < backlogSeqs.length; i++) {
      expect(backlogSeqs[i]).toBe(backlogSeqs[i - 1] + 1)
    }
    // E bate exatamente com o que o observador viu > midSeq, mais o sentinela.
    const expectedFromObserver = allSeqs.filter((sq) => sq > midSeq)
    expect(backlogSeqs.slice(0, expectedFromObserver.length)).toEqual(expectedFromObserver)

    sse.close()
  } finally {
    s.stop()
  }
})

test("lock.denied stays private to the attempted user across backlog replay, since=0 AND since=N", async () => {
  const s = startServer()
  try {
    const bob = await register(s.url, "bob")
    const alice = await register(s.url, "alice")

    // Bob tranca a cell primeiro (2 eventos duráveis: changeset.opened, lock.acquired — seq 1,2).
    const bobOpen = await callTool(s.url, "changeset.open", { token: bob.token, cells: ["secret"], intent: "bob-holds" })
    expect(bobOpen.ok).toBe(true)

    // Alice tenta a MESMA cell → nega, emite lock.denied privado (attempted_by = Alice), seq 3.
    // affinity.ts: lock.denied ignora filtro por completo, só vai pra sessão(ões) do próprio Alice.
    const aliceAttempt = await callTool(s.url, "changeset.open", { token: alice.token, cells: ["secret"], intent: "alice-tries" })
    expect(aliceAttempt.ok).toBe(false)
    expect(aliceAttempt.reason).toBe("cell_locked")

    // Sentinela pós-lock.denied, numa cell diferente, que Bob VAI receber (prova replay aconteceu).
    const bobDecoy = await callTool(s.url, "changeset.open", { token: bob.token, cells: ["decoy"], intent: "bob-decoy" })
    expect(bobDecoy.ok).toBe(true)

    // Caso A: Bob reconecta em since=0 — filtro "all" é o mais permissivo possível (casaria
    // lock.denied por matches() cru; só o override de affinity.ts o barra).
    const bobSince0 = await openSse(s.url, 0, bob.token, "all")
    await bobSince0.waitFor((e) => isSessionCreated(e))
    await bobSince0.waitFor((e) => e.kind === "lock.acquired" && e.target === "decoy")
    expect(bobSince0.events.some((e) => e.kind === "lock.denied")).toBe(false)
    bobSince0.close()

    // Caso B: Bob reconecta em since=N (antes do lock.denied, depois do lock de Bob em "secret") com
    // filter=cell:secret — casaria lock.denied via matches() cru (target === "secret"), MAS
    // isRecipient() reaplica o override de affinity.ts por linha no replay, então ainda não vaza.
    const bobSinceN = await openSse(s.url, 2, bob.token, "cell:secret")
    await bobSinceN.waitFor((e) => isSessionCreated(e))
    // Sentinela adicional: outro lock.denied genérico não existe pra "secret" endereçado a Bob; em vez
    // disso confirmamos que o backlog terminou observando o lock.released que a Bob mesmo vai emitir.
    const bobAbort = await callTool(s.url, "changeset.abort", { token: bob.token, csId: bobOpen.csId })
    expect(bobAbort.ok).toBe(true)
    await bobSinceN.waitFor((e) => e.kind === "lock.released" && e.target === "secret")
    expect(bobSinceN.events.some((e) => e.kind === "lock.denied")).toBe(false)
    bobSinceN.close()
  } finally {
    s.stop()
  }
})

test("?since=abc | -1 | (empty) | 1e9 are rejected explicitly (400), never a silent empty backlog", async () => {
  const s = startServer()
  try {
    for (const badSince of ["abc", "-1", "", "1e9", "1.5", "+1", " 1"]) {
      const res = await fetch(`${s.url}/events?since=${encodeURIComponent(badSince)}`)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBeString()
      expect(body.error).toContain("since")
    }
  } finally {
    s.stop()
  }
})

test("?since= omitted defaults to 0 (not rejected)", async () => {
  const s = startServer()
  try {
    const res = await fetch(`${s.url}/events`)
    expect(res.status).toBe(200)
    await res.body?.cancel()
  } finally {
    s.stop()
  }
})

test("?filter=<kind desconhecido> cai pra {kind:'all'} (permissivo, inalterado)", async () => {
  const s = startServer()
  try {
    const { token } = await register(s.url, "alice")

    const garbage = await openSse(s.url, 0, token, "totally-not-a-kind")
    await garbage.waitFor((e) => isSessionCreated(e))

    await callTool(s.url, "changeset.open", { token, cells: ["any-cell"], intent: "probe" })
    await garbage.waitFor((e) => e.kind === "lock.acquired" && e.target === "any-cell")

    garbage.close()
  } finally {
    s.stop()
  }
})

test("?filter=<kind conhecido com valor vazio> e 400, nao uma conexao muda pra sempre", async () => {
  const s = startServer()
  try {
    for (const bad of ["cell:", "domain:", "changeset:", "event:", "event:,,"]) {
      const res = await fetch(`${s.url}/events?filter=${encodeURIComponent(bad)}`)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain("filter")
    }
  } finally {
    s.stop()
  }
})
