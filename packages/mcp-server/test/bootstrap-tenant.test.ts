/**
 * bootstrap-tenant.test.ts — graph.bootstrap/graph.rebuild sob D13 (multi-tenant).
 *
 * Buraco fechado: `bootstrap()` gravava sempre em `tenantGraph(state, DEFAULT_TENANT)` e a tool não
 * pedia token. Com o resto do servidor já multi-tenant, isso significava (a) publicar grafo sem
 * autenticação nenhuma e (b) dois tenants disputando o MESMO slot — o segundo sobrescrevia o grafo
 * do primeiro e o evento ia para o log do tenant errado.
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, readResource, register, tempRepo } from "./helpers"

test("graph.bootstrap exige token — sem token, ou com token inválido, não publica nada", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false })
  try {
    await expect(callTool(s.url, "graph.bootstrap", { repoPath: root })).rejects.toThrow(/token/i)
    await expect(callTool(s.url, "graph.bootstrap", { token: "nao-existe", repoPath: root })).rejects.toThrow(/token/i)
    await expect(callTool(s.url, "graph.rebuild", {})).rejects.toThrow(/token/i)
  } finally {
    s.stop()
    cleanup()
  }
})

test("dois tenants publicam o MESMO repo sem se sobrescrever: graphIds distintos e um snapshot por tenant", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false })
  try {
    const alice = await register(s.url, "alice", "acme")
    const bob = await register(s.url, "bob", "globex")
    expect(alice.tenantId).toBe("acme")
    expect(bob.tenantId).toBe("globex")

    const bootA = await callTool(s.url, "graph.bootstrap", { token: alice.token, repoPath: root })
    const bootB = await callTool(s.url, "graph.bootstrap", { token: bob.token, repoPath: root })

    // mesmo repo, mesmo conteúdo — mas o tenant entra no hash, então são dois grafos distintos.
    // Antes: mesmo graphId E mesmo slot; o 2o bootstrap era um no-op silencioso "idempotente".
    expect(bootA.graphId).not.toBe(bootB.graphId)
    expect(bootA.stats.nodes).toBe(bootB.stats.nodes) // mesmo repo => mesma estrutura

    // cada tenant enxerga o SEU snapshot
    const snapA = await readResource(s.url, "graph://snapshot", alice.token)
    const snapB = await readResource(s.url, "graph://snapshot", bob.token)
    expect(snapA.graphId).toBe(bootA.graphId)
    expect(snapB.graphId).toBe(bootB.graphId)

    // e o evento graph.bootstrapped foi para o log de CADA tenant, não os dois no "default"
    const histA = await readResource(s.url, "graph://history?limit=100", alice.token)
    const histB = await readResource(s.url, "graph://history?limit=100", bob.token)
    expect(histA.events.filter((e: { kind: string }) => e.kind === "graph.bootstrapped")).toHaveLength(1)
    expect(histB.events.filter((e: { kind: string }) => e.kind === "graph.bootstrapped")).toHaveLength(1)
  } finally {
    s.stop()
    cleanup()
  }
})

test("idempotência é POR TENANT: rebootstrap do mesmo tenant mantém graphId; rebuild só reemite p/ o tenant do chamador", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false })
  try {
    const alice = await register(s.url, "alice", "acme")
    const bob = await register(s.url, "bob", "globex")

    const first = await callTool(s.url, "graph.bootstrap", { token: alice.token, repoPath: root })
    const again = await callTool(s.url, "graph.bootstrap", { token: alice.token, repoPath: root })
    expect(again.graphId).toBe(first.graphId) // idempotente dentro do tenant

    await callTool(s.url, "graph.bootstrap", { token: bob.token, repoPath: root })
    await callTool(s.url, "graph.rebuild", { token: bob.token })

    // o rebuild do bob não pode aparecer no log da alice
    const histA = await readResource(s.url, "graph://history?limit=100", alice.token)
    const histB = await readResource(s.url, "graph://history?limit=100", bob.token)
    expect(histA.events.filter((e: { kind: string }) => e.kind === "graph.rebuilt")).toHaveLength(0)
    expect(histB.events.filter((e: { kind: string }) => e.kind === "graph.rebuilt")).toHaveLength(1)
  } finally {
    s.stop()
    cleanup()
  }
})
