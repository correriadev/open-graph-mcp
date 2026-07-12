import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, tempRepo } from "./helpers"

test("bootstrap on a repo with valid .graph/ is fast, idempotent and keeps stats", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const first = startServer({ repoPath: root, watch: false })
  const boot1 = await callTool(first.url, "graph.bootstrap", { repoPath: root })
  first.stop()

  const s = startServer({ repoPath: root, watch: false })
  try {
    const t0 = performance.now()
    const boot2 = await callTool(s.url, "graph.bootstrap", { repoPath: root })
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(500)
    expect(boot2.stats.pipeline).toBe("existing")
    expect(boot2.stats.nodes).toBe(boot1.stats.nodes)
    expect(boot2.graphId).toBe(boot1.graphId)

    const again = await callTool(s.url, "graph.bootstrap", { repoPath: root })
    expect(again.graphId).toBe(boot2.graphId)
  } finally {
    s.stop()
    cleanup()
  }
})
