import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { startServer } from "../src/index"
import { callTool, openSse, tempRepo, bootstrapAs } from "./helpers"

test("editing an anchored source file emits drift.node to a subscribed client", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false })
  try {
    await bootstrapAs(s.url, root)
    const sse = await openSse(s.url)

    writeFileSync(
      path.join(root, "src", "audit.ts"),
      "export function renamedAudit(input) {\n  return refinement(input)\n}\n",
    )
    await s.tick()

    const evt = await sse.waitFor((e) => e.kind === "drift.node" && e.target === "src/audit.ts")
    expect(evt.schemaVersion).toBe(1)
    expect(evt.seq).toBeGreaterThan(0)
    expect(evt.graphId).toBeString()
    sse.close()
  } finally {
    s.stop()
    cleanup()
  }
})
