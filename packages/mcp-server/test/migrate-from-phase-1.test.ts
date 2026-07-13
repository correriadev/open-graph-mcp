import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { buildPhase1Graph, callTool, register, tempRepo } from "./helpers"

test("graph.import migrates a Phase-1 .graph/ into SQLite and is idempotent", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root })
  try {
    await buildPhase1Graph(s.url, root) // writes .graph/graph.json (skeleton) to migrate from
    const { token } = await register(s.url, "alice")

    const first = await callTool(s.url, "graph.import", { token, repoPath: root })
    expect(first.imported).toBe(true)
    expect(first.nodes).toBeGreaterThan(0)

    const second = await callTool(s.url, "graph.import", { token, repoPath: root })
    expect(second.imported).toBe(false) // no-op
    expect(second.nodes).toBe(first.nodes)
    expect(second.claims).toBe(first.claims)

    const nodesInDb = (s.state.db.query("SELECT COUNT(*) AS c FROM nodes WHERE tenant_id = ?").get("default") as { c: number }).c
    expect(nodesInDb).toBe(first.nodes)
  } finally {
    s.stop()
    cleanup()
  }
})
