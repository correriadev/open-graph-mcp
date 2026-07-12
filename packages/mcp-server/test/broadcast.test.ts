import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { startServer } from "../src/index"
import { callTool, openSse, tempRepo } from "./helpers"

test("two connected clients receive the same drift event in the same tick", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false })
  try {
    await callTool(s.url, "graph.bootstrap", { repoPath: root })
    const a = await openSse(s.url)
    const b = await openSse(s.url)

    writeFileSync(path.join(root, "src", "refine.ts"), "export function refinedTwice(x) { return x }\n")
    await s.tick()

    const isDrift = (e: any) => e.kind === "drift.node" && e.target === "src/refine.ts"
    const [evtA, evtB] = await Promise.all([a.waitFor(isDrift), b.waitFor(isDrift)])
    expect(evtA.seq).toBe(evtB.seq)
    expect(evtA.ts).toBe(evtB.ts)
    a.close()
    b.close()
  } finally {
    s.stop()
    cleanup()
  }
})
