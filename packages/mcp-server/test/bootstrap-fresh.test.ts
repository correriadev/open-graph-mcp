import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, readResource, tempRepo } from "./helpers"

test("bootstrap on a repo without .graph/ builds a skeleton graph with nodes", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false })
  try {
    const boot = await callTool(s.url, "graph.bootstrap", { repoPath: root })
    expect(boot.graphId).toBeString()
    expect(boot.stats.pipeline).toBe("skeleton")
    expect(boot.stats.nodes).toBeGreaterThan(0)

    const snap = await readResource(s.url, "graph://snapshot")
    expect(snap.graph.stats.nodes).toBe(boot.stats.nodes)
    expect(snap.graphId).toBe(boot.graphId)
  } finally {
    s.stop()
    cleanup()
  }
})
