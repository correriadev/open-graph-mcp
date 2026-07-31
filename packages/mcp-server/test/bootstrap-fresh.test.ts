import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { existsSync } from "node:fs"
import path from "node:path"
import { callTool, readResource, tempRepo, bootstrapAs } from "./helpers"

test("bootstrap indexa o repo e publica o grafo no tenant (nada é escrito no repo)", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false })
  try {
    const boot = await bootstrapAs(s.url, root)
    expect(boot.graphId).toBeString()
    expect(boot.stats.pipeline).toBe("indexed")
    expect(boot.stats.nodes).toBeGreaterThan(0)

    const snap = await readResource(s.url, "graph://snapshot")
    expect(snap.graph.stats.nodes).toBe(boot.stats.nodes)
    expect(snap.graphId).toBe(boot.graphId)

    // QA-7 P2: id de nó é sempre POSIX (`/`), mesmo no Windows — a fixture tem `src/*.ts`, então
    // pelo menos um id atravessa um diretório; se o separador vazasse cru, casaria com `\` aqui.
    const ids: string[] = snap.graph.nodes.map((n: { id: string }) => n.id)
    expect(ids.some((id) => id.includes("/"))).toBe(true)
    expect(ids.every((id) => !id.includes("\\"))).toBe(true)
  } finally {
    s.stop()
    cleanup()
  }
})
