import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, tempRepo, bootstrapAs } from "./helpers"

test("query returns candidates for known terms and gaps for unknown ones", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false })
  try {
    await bootstrapAs(s.url, root)

    const hit = await callTool(s.url, "graph.query", { terms: ["audit"] })
    expect(hit.candidates.length).toBeGreaterThan(0)
    expect(hit.candidates.some((c: any) => c.id.includes("audit"))).toBe(true)

    const miss = await callTool(s.url, "graph.query", { terms: ["zzznope"] })
    expect(miss.candidates.length).toBe(0)
    expect(miss.gaps).toContain("zzznope")
  } finally {
    s.stop()
    cleanup()
  }
})
