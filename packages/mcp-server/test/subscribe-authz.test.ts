import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { subscribe } from "../src/tools/graph-subscribe"
import { callTool, openSse, register } from "./helpers"

/**
 * O frame `session.created` do /events NAO carrega `kind`: o `data` e o objeto cru
 * `{ sessionId, graphId, tenant }` (ver `frame()` em src/sse.ts, que passa o nome do evento no campo
 * `event:` do SSE e o payload cru no `data:`). Esperar por `e.kind === "session.created"` trava ate o
 * timeout — o helper `openSse` so guarda o `data:` parseado.
 */
const isSessionCreated = (e: any) => e.kind === undefined && typeof e.sessionId === "string" && typeof e.graphId === "string"

/**
 * subscribe-authz.test.ts (WS-C, SB-0 §5 — a correção coordenada do graph.subscribe).
 *
 * Sequência obrigatória do escopo: primeiro provar o sequestro, DEPOIS corrigir. Os dois primeiros
 * testes abaixo rodam contra o `/mcp` real (`callTool`, mesmo caminho que um cliente de produção usa)
 * e devem REPRODUZIR o ataque tal como o servidor está hoje — se não reproduzirem, é pra parar e
 * reportar, não corrigir o que não foi demonstrado.
 *
 * ACHADO DE ESCOPO (ver REPORT-C3 no fim deste arquivo): `subscribe()` (src/tools/graph-subscribe.ts,
 * arquivo desta posse) agora ACEITA um 4º parâmetro `token` opcional e valida o binding sessionId→token
 * com a mesma vara de medir do `touch()` de presence.ts — mas o FIO até ele mora em transport.ts
 * (`inputSchema` + o dispatch de `graph.subscribe`), que é posse de WS-D e este stream NÃO tem
 * autorização pra editar. Por isso os dois testes de ataque via `/mcp` real continuam reproduzindo o
 * sequestro (nada muda no caminho HTTP até transport.ts ser cabeado) — e os dois testes seguintes
 * provam, chamando `subscribe()` diretamente (mesma função, sem o transport no meio), que a guarda em
 * si funciona corretamente quando um token de fato chega até ela.
 */

test("REPRODUCED: Bob hijacks Alice's SSE filters using only her sessionId — no auth today", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")
    expect(alice.userId).not.toBe(bob.userId)

    const aliceSse = await openSse(s.url, 0, alice.token) // Alice's session starts as [{kind:"all"}]
    const created = await aliceSse.waitFor((e) => isSessionCreated(e))
    const aliceSessionId = created.sessionId as string

    // Bob learned Alice's sessionId (leaked in a shared log, a proxy, whatever) and, with only THAT —
    // no token of Alice's, not even his own — rewrites what her live connection receives.
    const hijack = await callTool(s.url, "graph.subscribe", { sessionId: aliceSessionId, filters: [{ kind: "cell", cell: "decoy" }] })
    expect(hijack.ok).toBe(true) // the call is accepted — proves no ownership check exists on this path

    // An event Alice should have received under her original [{kind:"all"}] filter...
    await callTool(s.url, "changeset.open", { token: alice.token, cells: ["victim-cell"], intent: "alice-works" })
    // ...sentinel: a LATER event that matches Bob's imposed filter, on a connection that IS still alive
    // and receiving — its arrival proves the pipeline ran and "victim-cell" is genuinely missing, not a
    // race.
    await callTool(s.url, "changeset.open", { token: alice.token, cells: ["decoy"], intent: "sentinel" })
    await aliceSse.waitFor((e) => e.kind === "lock.acquired" && e.target === "decoy")

    expect(aliceSse.events.some((e) => e.target === "victim-cell")).toBe(false) // hijack worked: Alice lost her own event

    aliceSse.close()
  } finally {
    s.stop()
  }
})

test("FECHADO ponta a ponta: Bob mandando o PROPRIO token contra a sessao da Alice e recusado pelo /mcp", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")

    const aliceSse = await openSse(s.url, 0, alice.token)
    const created = await aliceSse.waitFor((e) => isSessionCreated(e))
    const aliceSessionId = created.sessionId as string

    // transport.ts agora encaminha args.token pro 4o parametro de subscribe() (SB-0 §5, passo 1).
    // Todo cliente real manda token — packages/client `call()` injeta o token resolvido em args.token
    // automaticamente — entao este e o caminho que producao de fato exercita.
    await expect(
      callTool(s.url, "graph.subscribe", { sessionId: aliceSessionId, filters: [{ kind: "cell", cell: "decoy2" }], token: bob.token }),
    ).rejects.toThrow(/not owned by caller/)

    // Alice continua com o filtro dela e recebendo o proprio evento.
    expect(s.state.sessions.get(aliceSessionId)?.filters).toEqual([{ kind: "all" }])
    await callTool(s.url, "changeset.open", { token: alice.token, cells: ["victim-cell-2"], intent: "alice-works" })
    await aliceSse.waitFor((e) => e.kind === "lock.acquired" && e.target === "victim-cell-2")

    aliceSse.close()
  } finally {
    s.stop()
  }
})

test("sem breaking change: graph.subscribe SEM token continua aceito pelo /mcp", async () => {
  const s = startServer()
  try {
    const { token } = await register(s.url, "alice")
    const sse = await openSse(s.url, 0, token)
    const created = await sse.waitFor((e) => isSessionCreated(e))
    const sessionId = created.sessionId as string

    // packages/client so injeta token quando ele existe; um caller Fase-1 sem identidade nenhuma
    // continua podendo narrar os proprios filtros. E o residual conhecido de SB-0 §5: tornar o token
    // obrigatorio e decisao do dono depois, nao desta campanha.
    const r = await callTool(s.url, "graph.subscribe", { sessionId, filters: [{ kind: "cell", cell: "mine" }] })
    expect(r.ok).toBe(true)
    expect(s.state.sessions.get(sessionId)?.filters).toEqual([{ kind: "cell", cell: "mine" }])

    sse.close()
  } finally {
    s.stop()
  }
})

test("FIX (unit-level, bypassing transport): subscribe() rejects a token that doesn't own the session", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")

    const aliceSse = await openSse(s.url, 0, alice.token)
    const created = await aliceSse.waitFor((e) => isSessionCreated(e))
    const aliceSessionId = created.sessionId as string

    // Calling subscribe() directly (as transport.ts WOULD, once wired) with Bob's token against
    // Alice's session — same yardstick presence.ts touch() uses: session.userId !== token's userId.
    expect(() => subscribe(s.state, aliceSessionId, [{ kind: "cell", cell: "decoy" }], bob.token)).toThrow(/not owned by caller/)

    // State untouched by the rejected call: Alice's filters remain what they were (still default "all").
    expect(s.state.sessions.get(aliceSessionId)?.filters).toEqual([{ kind: "all" }])

    aliceSse.close()
  } finally {
    s.stop()
  }
})

test("FIX (unit-level): subscribe() accepts the owning token, and still works with no token at all (no breaking change)", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")

    const aliceSse = await openSse(s.url, 0, alice.token)
    const created = await aliceSse.waitFor((e) => isSessionCreated(e))
    const aliceSessionId = created.sessionId as string

    // Alice's own token narrows her own session — accepted.
    const withToken = subscribe(s.state, aliceSessionId, [{ kind: "cell", cell: "mine" }], alice.token)
    expect(withToken).toEqual({ ok: true })
    expect(s.state.sessions.get(aliceSessionId)?.filters).toEqual([{ kind: "cell", cell: "mine" }])

    // No token at all — pre-existing behavior preserved (this is the ONLY path production traffic
    // exercises today, since transport.ts doesn't forward args.token yet).
    const noToken = subscribe(s.state, aliceSessionId, [{ kind: "cell", cell: "still-mine" }])
    expect(noToken).toEqual({ ok: true })
    expect(s.state.sessions.get(aliceSessionId)?.filters).toEqual([{ kind: "cell", cell: "still-mine" }])

    aliceSse.close()
  } finally {
    s.stop()
  }
})

test("FIX (unit-level): subscribe() rejects a garbage/expired token even against an anonymous (never-authenticated) session", async () => {
  const s = startServer()
  try {
    // No token at all when opening — anonymous SSE session (session.userId === null).
    const anonSse = await openSse(s.url, 0)
    const created = await anonSse.waitFor((e) => isSessionCreated(e))
    const anonSessionId = created.sessionId as string

    expect(() => subscribe(s.state, anonSessionId, [{ kind: "all" }], "not-a-real-token")).toThrow(/invalid or expired token/)

    anonSse.close()
  } finally {
    s.stop()
  }
})

// REPORT-C3 (RESOLVIDO na integracao): o fio em transport.ts — `token` como propriedade OPCIONAL do
// inputSchema e `args.token` como 4o argumento de subscribe() — foi aplicado serialmente pelo
// integrador, que e quem tem posse de transport.ts (SB-0 §3). Coberto pelos dois testes acima. O
// residual aceito e o primeiro teste deste arquivo: chamada SEM token nenhum continua passando.
// Torna-lo obrigatorio e decisao explicita do dono, fora desta campanha (SB-0 §5).
