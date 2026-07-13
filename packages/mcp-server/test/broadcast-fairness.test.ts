import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

test("all connected clients receive changeset.committed in the same broadcast tick", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const clients = await Promise.all([openSse(s.url), openSse(s.url), openSse(s.url)])

    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:5"], intent: "fairness" })
    await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: { kind: "claim.add", payload: { id: "c1", subject: "s", domain: "ui", level: 5, refs: [] } } })
    await callTool(s.url, "changeset.commit", { token: a.token, csId })

    const isCommit = (e: any) => e.kind === "changeset.committed" && e.payload.csId === csId
    const evts = await Promise.all(clients.map((c) => c.waitFor(isCommit)))
    expect(evts[1].seq).toBe(evts[0].seq)
    expect(evts[2].seq).toBe(evts[0].seq)
    expect(evts[1].ts).toBe(evts[0].ts)
    for (const c of clients) c.close()
  } finally {
    s.stop()
  }
})
