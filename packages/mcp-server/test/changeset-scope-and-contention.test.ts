/**
 * changeset-scope-and-contention.test.ts — dois achados do exercício multiplayer, ambos em
 * tools/changeset.ts:
 *
 * MP-3: um turno EXPANDIDO (open em A, depois open em B reusando o mesmo csId) mentia no registro de
 * auditoria — `blast_cells` era gravado só na criação e nunca recalculado, então o histórico mostrava
 * menos células do que o turno realmente trancava. Corrigido reescrevendo `blast_cells` a partir da
 * tabela `locks` (verdade real) na MESMA transação que grava a trava nova, em `claimOrOpenCs` —
 * cobre tanto o caminho de commit quanto o de TTL (que nunca passa pelo commit).
 *
 * MP-2: a recusa por trava (`cell_locked` / node.edit em contenção) devolvia um `holder` opaco (hash)
 * e nada de acionável — o agente bloqueado não sabia quem segurava a célula nem o que fazer. Corrigido
 * com campos ADITIVOS (`holderName`, `retryAfterMs`, `hint`) nos dois caminhos de contenção, mantidos
 * coerentes entre si (node.edit ecoa literalmente o que claimOrOpenCs já calculou).
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, readResource, register, openSse, tempRepo, bootstrapAs } from "./helpers"

const claim = (id: string, domain: string, level: number, refs: string[] = []) => ({
  kind: "claim.add" as const,
  payload: { id, subject: id, domain, level, refs },
})

test("turno EXPANDIDO: blast_cells reflete A e B depois do commit, e graph://changeset/{id} mostra as duas", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["docs:5"], intent: "turno" })

    // expande o MESMO turno: célula já trancada + uma nova → reusa o csId
    const again = await callTool(s.url, "changeset.open", { token: a.token, cells: ["docs:5", "docs:0"], intent: "turno" })
    expect(again.csId).toBe(csId)

    // já ENQUANTO ABERTO (antes do commit) o registro persistido reflete as duas — a reescrita acontece
    // na expansão, não só no commit (MP-3: o commit sozinho não alcança o caminho de TTL).
    const rowOpen = s.state.db.query("SELECT blast_cells FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { blast_cells: string }
    expect(JSON.parse(rowOpen.blast_cells).sort()).toEqual(["docs:0", "docs:5"])

    // e um delta só em uma delas ainda é aceito (célula reservada, sem claim, também é raio revisável)
    // — nível 5 é extremo da escada (CODE_LEVEL), não exige refs.
    expect((await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: claim("d1", "docs", 5) })).ok).toBe(true)

    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "turno" })
    expect(commit.ok).toBe(true)

    const rowClosed = s.state.db.query("SELECT blast_cells FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { blast_cells: string }
    expect(JSON.parse(rowClosed.blast_cells).sort()).toEqual(["docs:0", "docs:5"])

    const view = await readResource(s.url, `graph://changeset/${csId}`, a.token)
    expect(view.cells.sort()).toEqual(["docs:0", "docs:5"])
  } finally {
    s.stop()
  }
})

test("turno EXPANDIDO que expira por TTL: changeset.aborted declara as DUAS células, coerente com os lock.released emitidos", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const sse = await openSse(s.url, 0, a.token)
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["docs:5"], intent: "turno" })
    const again = await callTool(s.url, "changeset.open", { token: a.token, cells: ["docs:5", "docs:0"], intent: "turno" })
    expect(again.csId).toBe(csId)

    // backdate determinístico de expires_at (padrão da casa — nunca setTimeout) + sweep manual
    s.state.db.query("UPDATE locks SET expires_at = ? WHERE tenant_id = ? AND cs_id = ?").run("1970-01-01T00:00:00.000Z", "default", csId)
    s.sweep()

    const csRow = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string }
    expect(csRow.status).toBe("aborted")

    await sse.waitFor((e: any) => e.kind === "changeset.aborted" && e.payload.csId === csId)
    const aborted = sse.events.find((e: any) => e.kind === "changeset.aborted" && e.payload.csId === csId)
    expect(aborted.payload.cells.sort()).toEqual(["docs:0", "docs:5"])
    expect(aborted.payload.reason).toBe("ttl_expired")

    // coerência: os lock.released emitidos na MESMA varredura cobrem exatamente as mesmas células que
    // o changeset.aborted declara — antes da correção, o aborted subdeclarava (só a original).
    const released = sse.events.filter((e: any) => e.kind === "lock.released" && e.payload.csId === csId).map((e: any) => e.payload.cell)
    expect(released.sort()).toEqual(["docs:0", "docs:5"])
    sse.close()
  } finally {
    s.stop()
  }
})

test("turno implícito (claim sem csId): intent fica vazio enquanto aberto — não inventado — e o commit exige um intent real", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const claimResult = await callTool(s.url, "changeset.claim", { token: a.token, delta: claim("i1", "docs", 5) })
    expect(claimResult.ok).toBe(true)
    const csId = claimResult.csId

    const view = await readResource(s.url, `graph://changeset/${csId}`, a.token)
    expect(view.intent).toBe("") // honesto: nada foi declarado ainda, não um texto sintético

    // commit sem intent é recusado — o turno continua aberto, não fica "anônimo" para sempre
    const noIntent = await callTool(s.url, "changeset.commit", { token: a.token, csId })
    expect(noIntent.ok).toBe(false)
    expect(noIntent.reasons.some((r: string) => r.includes("intent required"))).toBe(true)

    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "adicionar nota" })
    expect(commit.ok).toBe(true)
    const viewAfter = await readResource(s.url, `graph://changeset/${csId}`, a.token)
    expect(viewAfter.intent).toBe("adicionar nota") // o intent REAL do autor cobre o vazio no fechamento
  } finally {
    s.stop()
  }
})

test("cell_locked traz o nome do holder e dado acionável (holderName, retryAfterMs, hint) — não só o hash", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")
    await callTool(s.url, "changeset.open", { token: alice.token, cells: ["docs:5"], intent: "turno" })

    const denied = await callTool(s.url, "changeset.open", { token: bob.token, cells: ["docs:5"], intent: "outro turno" })
    expect(denied.ok).toBe(false)
    expect(denied.reason).toBe("cell_locked")
    expect(denied.holder).toBe(alice.userId) // hash cru continua disponível p/ quem já dependia dele
    expect(denied.holderName).toBe("alice") // NOVO: nome legível, não hash
    expect(typeof denied.retryAfterMs).toBe("number")
    expect(denied.retryAfterMs).toBeGreaterThan(0)
    expect(denied.hint).toContain("alice")
    expect(denied.hint.toLowerCase()).toMatch(/retry|commit|abort/) // diz O QUE FAZER, não só o estado
  } finally {
    s.stop()
  }
})

test("node.edit em contenção é coerente com cell_locked: mesmos campos, mesmos valores", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false })
  try {
    await bootstrapAs(s.url, root)
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")
    const snap = await readResource(s.url, "graph://snapshot")
    const node = snap.graph.nodes[0]
    expect(node).toBeDefined()
    const cell = `${node.domain ?? "?"}:${String(node.level).replace(/^P/, "")}`

    const editAlice = await callTool(s.url, "node.edit", { token: alice.token, nodeId: node.id })
    expect(editAlice.ok).toBe(true)

    const editBob = await callTool(s.url, "node.edit", { token: bob.token, nodeId: node.id })
    expect(editBob.ok).toBe(false)
    expect(editBob.editingBy).toBe(alice.userId)
    expect(editBob.holderName).toBe("alice") // já existia — a correção não regrediu isto
    expect(typeof editBob.since).toBe("string")
    // NOVO (MP-2): coerente com o cell_locked de changeset.open — mesmos campos, mesma frase acionável.
    expect(editBob.cell).toBe(cell)
    expect(editBob.csId).toBe(editAlice.csId)
    expect(typeof editBob.expiresAt).toBe("string")
    expect(typeof editBob.retryAfterMs).toBe("number")
    expect(editBob.retryAfterMs).toBeGreaterThan(0)
    expect(editBob.hint).toContain("alice")
    expect(editBob.hint.toLowerCase()).toMatch(/retry|commit|abort/)
  } finally {
    s.stop()
    cleanup()
  }
})

test("guarda: as correções de MP-3/MP-2 não mudam o veredito dos gates — escopo continua bloqueando fora do turno", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["docs:5"], intent: "turno" })

    // expande o turno (exercita o novo código de reescrita de blast_cells)...
    await callTool(s.url, "changeset.open", { token: a.token, cells: ["docs:5", "docs:0"], intent: "turno" })

    // ...mas uma claim numa célula NUNCA trancada continua fora de escopo — o gate não afrouxou.
    const fora = await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: claim("x1", "billing", 2) })
    expect(fora.ok).toBe(false)
    expect(fora.reasons.some((r: string) => r.includes("out of turn scope"))).toBe(true)

    // e uma trava alheia continua recusada normalmente (cell_locked), só que agora legível.
    const bob = await register(s.url, "bob")
    const denied = await callTool(s.url, "changeset.open", { token: bob.token, cells: ["docs:0"], intent: "outro" })
    expect(denied.ok).toBe(false)
    expect(denied.reason).toBe("cell_locked")
  } finally {
    s.stop()
  }
})
