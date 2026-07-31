import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { startServer } from "../src/index"
import { write } from "../src/db"
import { tenantGraph } from "../src/state"
import { callTool, openSse, tempRepo, bootstrapAs } from "./helpers"

test("breaking the anchor of a β cell emits authority.demoted with grade", async () => {
  const { root, cleanup } = tempRepo("demote")
  const s = startServer({ repoPath: root, watch: false })
  try {
    await bootstrapAs(s.url, root)

    // Promove a célula a β (graph = verdade). Antes isto era feito gravando authority dentro do
    // `.graph/graph.json` do repo-alvo; com o grafo vivendo no MCP, a precondição é semeada no
    // banco — que é onde a autoridade mora agora.
    const graph = tenantGraph(s.state, "default").graph!
    const node = graph.nodes.find((n) => n.file.startsWith("src/app.ts"))!
    const cell = `${node.domain ?? "(unassigned)"}:${String(node.level).replace(/^P/, "")}`
    write(s.state.db, s.state.stateDir, "default", "authority", { tenant_id: "default", cell, value: "graph", last_flip_seq: 0, last_flip_by: "test" })
    graph.authority = { ...(graph.authority ?? {}), [cell]: "graph" }

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
