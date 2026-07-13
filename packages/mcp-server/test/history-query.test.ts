import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, readResource, register } from "./helpers"

test("graph://history returns admitted changeset.committed events ordered by seq", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    for (let i = 1; i <= 5; i++) {
      const cell = `d${i}:5`
      const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: [cell], intent: `turn ${i}` })
      await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: { kind: "claim.add", payload: { id: `c${i}`, subject: "s", domain: `d${i}`, level: 5, refs: [] } } })
      const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId })
      expect(commit.ok).toBe(true)
    }

    const hist = await readResource(s.url, "graph://history?since=0", a.token)
    const committed = hist.events.filter((e: any) => e.kind === "changeset.committed")
    expect(committed.length).toBe(5)
    const seqs = committed.map((e: any) => e.seq)
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y)) // monotonic
  } finally {
    s.stop()
  }
})
