import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, readResource, register, tempRepo, bootstrapAs } from "./helpers"

// F1 (docs/roadmap-mcp/07-plano-lock-implicito-e-greenfield.md §F1) — o lock some do vocabulário: o
// gatilho passa a ser a transição LEITURA → EDIÇÃO (changeset.claim sem csId / node.edit), não mais
// um "Abrir turno" declarado antes. Estes testes cobrem os três pontos que o plano nomeia
// explicitamente: abertura implícita no claim, node.edit feliz, e a corrida de node.edit.

test("changeset.claim sem csId abre o turno implicitamente (intent vazio) e devolve o csId", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const claim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      delta: { kind: "claim.add", payload: { id: "c1", subject: "s", domain: "auth", level: "P5", refs: [] } },
    })
    expect(claim.ok).toBe(true)
    expect(claim.csId).toMatch(/^cs_/)

    // o registro persistido tem intent vazio — decisão 2 do plano: intent migrou pro commit.
    const row = s.state.db.query("SELECT intent, status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", claim.csId) as { intent: string; status: string }
    expect(row.intent).toBe("")
    expect(row.status).toBe("open")

    // uma 2ª claim NA MESMA célula reusa o turno implícito (mesmo csId) em vez de abrir outro.
    const claim2 = await callTool(s.url, "changeset.claim", {
      token: a.token,
      delta: { kind: "claim.add", payload: { id: "c2", subject: "s2", domain: "auth", level: "P5", refs: [] } },
    })
    expect(claim2.ok).toBe(true)
    expect(claim2.csId).toBe(claim.csId)

    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId: claim.csId, intent: "cadeia via claim implícito" })
    expect(commit.ok).toBe(true)
  } finally {
    s.stop()
  }
})

test("changeset.claim implícito nega quando a célula já está trancada por outro (mesmo formato de reason que changeset.open)", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const b = await register(s.url, "bob")
    const openA = await callTool(s.url, "changeset.open", { token: a.token, cells: ["contested:5"], intent: "alice primeiro" })
    expect(openA.ok).toBe(true)

    const claimB = await callTool(s.url, "changeset.claim", {
      token: b.token,
      delta: { kind: "claim.add", payload: { id: "cb", subject: "s", domain: "contested", level: 5, refs: [] } },
    })
    expect(claimB.ok).toBe(false)
    expect(claimB.reasons[0]).toContain("contested:5")
    expect(claimB.reasons[0]).toContain(a.userId)
  } finally {
    s.stop()
  }
})

test("changeset.commit exige intent — sem ele o commit é recusado e o turno segue aberto", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["intent-test:5"], intent: "" })
    await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: { kind: "claim.add", payload: { id: "ci", subject: "s", domain: "intent-test", level: 5, refs: [] } } })

    const noIntent = await callTool(s.url, "changeset.commit", { token: a.token, csId })
    expect(noIntent.ok).toBe(false)
    expect(noIntent.reasons).toContain("intent required to commit")

    // turno continua aberto (não abortou por essa recusa) — retry com intent funciona.
    const withIntent = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "validar CPF no login" })
    expect(withIntent.ok).toBe(true)

    const row = s.state.db.query("SELECT intent FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { intent: string }
    expect(row.intent).toBe("validar CPF no login")
  } finally {
    s.stop()
  }
})

test("node.edit feliz: abre/reusa o turno da célula do nó e devolve { ok, csId, cell }", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false })
  try {
    const boot = await bootstrapAs(s.url, root)
    const a = await register(s.url, "alice")
    const snap = await readResource(s.url, "graph://snapshot")
    const node = snap.graph.nodes[0]
    expect(node).toBeDefined()
    const cell = `${node.domain ?? "?"}:${String(node.level).replace(/^P/, "")}`

    const edit = await callTool(s.url, "node.edit", { token: a.token, nodeId: node.id })
    expect(edit.ok).toBe(true)
    expect(edit.csId).toMatch(/^cs_/)
    expect(edit.cell).toBe(cell)

    // reentrar em edição no MESMO nó reusa o turno (idempotente) — não duplica o lock.
    const again = await callTool(s.url, "node.edit", { token: a.token, nodeId: node.id })
    expect(again.ok).toBe(true)
    expect(again.csId).toBe(edit.csId)

    const locks = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ? AND cell = ?").get("default", cell) as { c: number }).c
    expect(locks).toBe(1)
    void boot
  } finally {
    s.stop()
    cleanup()
  }
})

test("node.edit em contenção: o 2º usuário recebe { ok:false, editingBy, holderName, since } — sem duplicar o lock", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false })
  try {
    await bootstrapAs(s.url, root)
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")
    const snap = await readResource(s.url, "graph://snapshot")
    const node = snap.graph.nodes[0]

    const editAlice = await callTool(s.url, "node.edit", { token: alice.token, nodeId: node.id })
    expect(editAlice.ok).toBe(true)

    const editBob = await callTool(s.url, "node.edit", { token: bob.token, nodeId: node.id })
    expect(editBob.ok).toBe(false)
    expect(editBob.editingBy).toBe(alice.userId)
    expect(editBob.holderName).toBe("alice")
    expect(typeof editBob.since).toBe("string")
  } finally {
    s.stop()
    cleanup()
  }
})

test("node.edit: nó inexistente lança erro (tool error, não um resultado ok:false silencioso)", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    await expect(callTool(s.url, "node.edit", { token: a.token, nodeId: "nao-existe" })).rejects.toThrow()
  } finally {
    s.stop()
  }
})

test("node.editing/node.idle são gravados na auditoria (events) ao lado de lock.acquired/lock.released — F1 não os remove", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["proj-events:5"], intent: "verificar eventos" })
    await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: { kind: "claim.add", payload: { id: "pe1", subject: "s", domain: "proj-events", level: 5, refs: [] } } })
    await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "verificar eventos" })

    const kinds = (s.state.db.query("SELECT kind FROM events WHERE tenant_id = ? ORDER BY seq").all("default") as { kind: string }[]).map((r) => r.kind)
    expect(kinds).toContain("lock.acquired")
    expect(kinds).toContain("lock.released")
    expect(kinds).toContain("node.editing")
    expect(kinds).toContain("node.idle")
  } finally {
    s.stop()
  }
})
