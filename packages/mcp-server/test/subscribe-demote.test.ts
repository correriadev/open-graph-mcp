import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { buildGraph, writeGraph } from "@open-graph-mcp/graph-core/build"
import { setAuthority } from "@open-graph-mcp/graph-core/authority"
import { startServer } from "../src/index"
import { callTool, openSse, tempRepo, bootstrapAs } from "./helpers"

test("breaking the anchor of a β cell emits authority.demoted with grade", async () => {
  const { root, cleanup } = tempRepo("demote")

  // fixture só tem meta; gera graph.json e promove a célula do nó a β (graph = verdade).
  // Chave de autoridade é sempre "<domain>:5" (chão de código) — demoteGraded só demove
  // nível 5 e casa nós por domain, não pelo level classificado do arquivo.
  const g = buildGraph(root)
  const node = g.nodes.find((n) => n.id === "src/app.ts/pay")!
  const cell = `${node.domain}:5`
  writeGraph(root, setAuthority(g, cell, "graph"))

  const s = startServer({ repoPath: root, watch: false })
  try {
    await bootstrapAs(s.url, root)
    const sse = await openSse(s.url)

    writeFileSync(path.join(root, "src", "app.ts"), "export function charge() {}\n")
    await s.tick()

    const evt = await sse.waitFor((e) => e.kind === "authority.demoted" && e.target === cell)
    expect(evt.payload.grade).toBeString()
    expect(evt.payload.cell).toBe(cell)
    sse.close()
  } finally {
    s.stop()
    cleanup()
  }
})
