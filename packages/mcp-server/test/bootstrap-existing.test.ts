import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { startServer } from "../src/index"
import { readResource, tempRepo, bootstrapAs, register } from "./helpers"

test("reindexar conteúdo inalterado é idempotente: mesmo graphId, mesmas stats", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false })
  try {
    const boot1 = await bootstrapAs(s.url, root)
    const boot2 = await bootstrapAs(s.url, root)
    expect(boot2.graphId).toBe(boot1.graphId)
    expect(boot2.stats.nodes).toBe(boot1.stats.nodes)
  } finally {
    s.stop()
    cleanup()
  }
})

/**
 * Substitui o antigo "bootstrap com .graph/ válido é rápido", que provava que o servidor RELIA um
 * arquivo do repo-alvo — exatamente o que deixou de existir (ADR D1). O invariante que importa
 * agora é o oposto: o grafo vive no MCP, então subir de novo sobre o MESMO stateDir devolve o
 * grafo sem reindexar nada. Antes o estado era 100% em memória e um restart respondia
 * "not bootstrapped" até alguém reindexar na mão.
 */
test("restart sobre o mesmo stateDir hidrata o grafo do banco — sem repoPath, sem bootstrap", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const stateDir = mkdtempSync(path.join(tmpdir(), "og-hydrate-"))
  const first = startServer({ repoPath: root, stateDir, watch: false })
  const boot = await bootstrapAs(first.url, root)
  expect(boot.stats.nodes).toBeGreaterThan(0)
  first.stop()

  // Servidor NOVO, mesmo stateDir, SEM repoPath e SEM autoBootstrap: se o grafo dependesse de
  // memória ou de um arquivo no repo-alvo, aqui não haveria nada.
  const second = startServer({ stateDir, watch: false })
  try {
    const alice = await register(second.url, "alice")
    const snap = await readResource(second.url, "graph://snapshot", alice.token)
    expect(snap.graph.stats.nodes).toBe(boot.stats.nodes)
    expect(snap.graph.stats.edges).toBe(boot.stats.edges)
    expect(snap.graph.nodes.every((n: { anchor: string }) => typeof n.anchor === "string")).toBe(true)
  } finally {
    second.stop()
    rmSync(stateDir, { recursive: true, force: true })
    cleanup()
  }
})
