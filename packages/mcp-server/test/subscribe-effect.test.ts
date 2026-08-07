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
 * subscribe-effect.test.ts (WS-C) — nenhum teste existente prova que `graph.subscribe` MUDA a entrega
 * de eventos. Aqui: depois de narrowar pra `cell:X`, um evento em Y não chega e um evento em X chega —
 * a ausência é provada por sentinela (o evento de X, emitido DEPOIS do de Y, chegando), nunca por sleep.
 */

test("graph.subscribe narrows delivery: event on Y suppressed, event on X delivered (sentinel)", async () => {
  const s = startServer()
  try {
    const { token } = await register(s.url, "alice")
    const sse = await openSse(s.url, 0, token)
    const created = await sse.waitFor((e) => isSessionCreated(e))
    const sessionId = created.sessionId

    const before = await callTool(s.url, "graph.subscribe", { sessionId, filters: [{ kind: "cell", cell: "cellX" }] })
    expect(before.ok).toBe(true)

    // Y primeiro (deveria ser suprimido), X depois (deveria chegar — é o sentinela: sua chegada prova
    // que o pipeline processou os dois eventos e Y não vazou por race).
    await callTool(s.url, "changeset.open", { token, cells: ["cellY"], intent: "y" })
    await callTool(s.url, "changeset.open", { token, cells: ["cellX"], intent: "x" })

    const evtX = await sse.waitFor((e) => e.kind === "lock.acquired" && e.target === "cellX")
    expect(evtX.payload.cell).toBe("cellX")

    expect(sse.events.some((e) => e.target === "cellY")).toBe(false)
    expect(sse.events.some((e) => e.kind === "changeset.opened" && Array.isArray((e.payload as any).cells) && (e.payload as any).cells.includes("cellY"))).toBe(false)

    sse.close()
  } finally {
    s.stop()
  }
})

test("graph.subscribe replacing filters mid-stream re-narrows subsequent live delivery", async () => {
  const s = startServer()
  try {
    const { token } = await register(s.url, "alice")
    const sse = await openSse(s.url, 0, token) // starts as [{kind:"all"}]
    const created = await sse.waitFor((e) => isSessionCreated(e))
    const sessionId = created.sessionId

    // Before narrowing: default "all" — this event should arrive.
    await callTool(s.url, "changeset.open", { token, cells: ["cellPre"], intent: "pre" })
    await sse.waitFor((e) => e.kind === "lock.acquired" && e.target === "cellPre")

    // Narrow to cellX only.
    await callTool(s.url, "graph.subscribe", { sessionId, filters: [{ kind: "cell", cell: "cellX" }] })

    // Now cellPre-kind events should stop arriving; only cellX should.
    await callTool(s.url, "changeset.open", { token, cells: ["cellPre2"], intent: "pre2" })
    await callTool(s.url, "changeset.open", { token, cells: ["cellX"], intent: "x" })
    await sse.waitFor((e) => e.kind === "lock.acquired" && e.target === "cellX")

    expect(sse.events.some((e) => e.target === "cellPre2")).toBe(false)

    sse.close()
  } finally {
    s.stop()
  }
})
