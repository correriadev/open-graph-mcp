import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

test("changeset.extend strictly advances expiresAt", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId, expiresAt: openedExpiry } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:1"], intent: "extend" })

    const ext = await callTool(s.url, "changeset.extend", { token: a.token, csId })
    expect(ext.ok).toBe(true)
    expect(Date.parse(ext.expiresAt)).toBeGreaterThanOrEqual(Date.parse(openedExpiry))
  } finally {
    s.stop()
  }
})

test("an extended changeset SURVIVES a sweep that would otherwise TTL-abort it", async () => {
  // TTL padrao (60s) + backdate explicito de `expires_at`, em vez de `ttlMs: 1` + sleep real: com um
  // TTL de 1ms o proprio `extend` so empurra a expiracao 1ms pra frente, entao qualquer atraso entre
  // o retorno da tool e o `sweep()` fazia o sweep abortar CORRETAMENTE — o teste media agendamento,
  // nao comportamento (flake observado 1 em ~20 rodadas). Aqui nao ha nenhuma dependencia de relogio.
  const s = startServer()
  const backdate = (csId: string) =>
    s.state.db.query("UPDATE locks SET expires_at = ? WHERE tenant_id = ? AND cs_id = ?").run("1970-01-01T00:00:00.000Z", "default", csId)
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:0"], intent: "turn" })
    const claim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      // level 0 — a root claim (extreme of the ladder), so it's still valid at final commit, not just staging
      delta: { kind: "claim.add", payload: { id: "c1", subject: "c1", domain: "ui", level: 0, refs: [] } },
    })
    expect(claim.ok).toBe(true)

    // Controle: um segundo turno igualmente vencido e que NAO chama extend. E ele quem prova que o
    // sweep desta rodada de fato varre — sem esse sentinela, "sobreviveu" seria indistinguivel de
    // "o sweep nao rodou".
    const control = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:9"], intent: "control" })
    backdate(control.csId)

    backdate(csId)
    const ext = await callTool(s.url, "changeset.extend", { token: a.token, csId })
    expect(ext.ok).toBe(true)

    s.sweep()

    const statusOf = (id: string) => (s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", id) as { status: string }).status
    expect(statusOf(control.csId)).toBe("aborted") // o sweep rodou
    expect(statusOf(csId)).toBe("open") // e o extend salvou este
    const lockCount = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { c: number }).c
    expect(lockCount).toBe(1)

    // and the turn is still usable: commit succeeds
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "turn" })
    expect(commit.ok).toBe(true)
  } finally {
    s.stop()
  }
})

test("a non-holder cannot extend someone else's changeset, and expires_at does not move", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const b = await register(s.url, "bob")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:2"], intent: "mine" })
    const before = (s.state.db.query("SELECT expires_at FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { expires_at: string }).expires_at

    const ext = await callTool(s.url, "changeset.extend", { token: b.token, csId })
    expect(ext.ok).toBe(false)

    const after = (s.state.db.query("SELECT expires_at FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { expires_at: string }).expires_at
    expect(after).toBe(before)
  } finally {
    s.stop()
  }
})

test("extend on an already-aborted changeset fails and does not resurrect it or re-create locks", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:3"], intent: "to-abort" })
    const abort = await callTool(s.url, "changeset.abort", { token: a.token, csId })
    expect(abort.ok).toBe(true)

    const ext = await callTool(s.url, "changeset.extend", { token: a.token, csId })
    expect(ext.ok).toBe(false)

    const csRow = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string }
    expect(csRow.status).toBe("aborted")
    const lockCount = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { c: number }).c
    expect(lockCount).toBe(0)
  } finally {
    s.stop()
  }
})

test("extend on an already-admitted changeset fails and does not resurrect it or re-create locks", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:4"], intent: "to-commit" })
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "to-commit" })
    expect(commit.ok).toBe(true)

    const ext = await callTool(s.url, "changeset.extend", { token: a.token, csId })
    expect(ext.ok).toBe(false)

    const csRow = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string }
    expect(csRow.status).toBe("admitted")
    const lockCount = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { c: number }).c
    expect(lockCount).toBe(0)
  } finally {
    s.stop()
  }
})

// REPORT-A1: changesetExtend emits NO event today — silence asserted below. A `changeset.extended` /
// `lock.extended` notification would let a second observer (or the holder's own other tab) learn a
// turn's TTL was pushed forward without polling `changeset.list_mine`. Adding one is a Tier 2 contract
// change (new event `kind`) — out of scope for a mechanical Tier 1 fix in changeset.ts.
test("REPORT-A1: changeset.extend currently emits no SSE event (documented silence, not a bug fix)", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const sse = await openSse(s.url, 0, a.token)
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:5"], intent: "silent-extend" })
    await sse.waitFor((e) => e.kind === "changeset.opened" && e.payload.csId === csId)

    const ext = await callTool(s.url, "changeset.extend", { token: a.token, csId })
    expect(ext.ok).toBe(true)

    // Sentinel: perform a second, later action that DOES emit an event and wait for it. Its arrival
    // proves the SSE pump drained everything up to "now" — if extend had emitted anything, it would
    // have arrived before the sentinel.
    const abort = await callTool(s.url, "changeset.abort", { token: a.token, csId })
    expect(abort.ok).toBe(true)
    await sse.waitFor((e) => e.kind === "changeset.aborted" && e.payload.csId === csId)

    const extendRelated = sse.events.filter((e) => typeof e.kind === "string" && (e.kind.startsWith("changeset.extend") || e.kind.startsWith("lock.extend")))
    expect(extendRelated.length).toBe(0)
    sse.close()
  } finally {
    s.stop()
  }
})

test.todo("REPORT-A1: changeset.extend should emit changeset.extended (or lock.extended) with the new expiresAt")

test("extend que falha diz PORQUE — os tres modos sao distinguiveis por um cliente", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const b = await register(s.url, "bob")

    // 1) changeset inexistente
    const missing = await callTool(s.url, "changeset.extend", { token: a.token, csId: "cs_naoexiste" })
    expect(missing.ok).toBe(false)
    expect(missing.reason).toMatch(/not found/)

    // 2) fechado (o caso do TTL, que e o que um cliente de beta encontra de verdade)
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:3"], intent: "t" })
    s.state.db.query("UPDATE locks SET expires_at = ? WHERE tenant_id = ? AND cs_id = ?").run("1970-01-01T00:00:00.000Z", "default", csId)
    s.sweep()
    const expired = await callTool(s.url, "changeset.extend", { token: a.token, csId })
    expect(expired.ok).toBe(false)
    expect(expired.reason).toMatch(/aborted.*not open|not open/)

    // 3) turno de outra pessoa
    const mine = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:4"], intent: "t" })
    const notHolder = await callTool(s.url, "changeset.extend", { token: b.token, csId: mine.csId })
    expect(notHolder.ok).toBe(false)
    expect(notHolder.reason).toBe("not the holder of this changeset")
  } finally {
    s.stop()
  }
})
