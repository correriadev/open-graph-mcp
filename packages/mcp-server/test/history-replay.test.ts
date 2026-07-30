import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, readResource, tempRepo, bootstrapAs, rebuildAs } from "./helpers"

test("graph://history?since=N returns only the tail after seq N", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false })
  try {
    await bootstrapAs(s.url, root) // seq 1
    for (let i = 0; i < 4; i++) await rebuildAs(s.url) // seq 2..5

    const all = await readResource(s.url, "graph://history?since=0")
    expect(all.events.length).toBe(5)

    const tail = await readResource(s.url, "graph://history?since=3")
    expect(tail.events.length).toBe(2)
    expect(tail.events.map((e: any) => e.seq)).toEqual([4, 5])
  } finally {
    s.stop()
    cleanup()
  }
})
