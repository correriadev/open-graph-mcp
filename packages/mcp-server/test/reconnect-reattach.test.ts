import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

test("after an SSE drop, the same token reattaches to its still-open changeset", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const sse1 = await openSse(s.url, 0, a.token)
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:5"], intent: "reattach" })
    sse1.close() // tab close

    // reconnect with the same token
    const sse2 = await openSse(s.url, 0, a.token)
    const mine = await callTool(s.url, "changeset.list_mine", { token: a.token })
    expect(mine.changesets.map((c: any) => c.csId)).toContain(csId)
    expect(mine.changesets.find((c: any) => c.csId === csId).cells).toEqual(["ui:5"])
    sse2.close()
  } finally {
    s.stop()
  }
})
