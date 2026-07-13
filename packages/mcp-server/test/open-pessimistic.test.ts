import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, register } from "./helpers"

test("two users cannot open a turn on the same β cell; re-open by holder reuses the cs", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const b = await register(s.url, "bob")

    const openA = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:4"], intent: "cpf validation" })
    expect(openA.ok).toBe(true)
    expect(openA.csId).toBeString()

    const openB = await callTool(s.url, "changeset.open", { token: b.token, cells: ["ui:4"], intent: "collision" })
    expect(openB.ok).toBe(false)
    expect(openB.reason).toBe("cell_locked")
    expect(openB.cell).toBe("ui:4")
    expect(openB.holder).toBe(a.userId)
    expect(openB.csId).toBe(openA.csId)

    // idempotent re-open by the holder reuses the same csId
    const reopen = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:4"], intent: "cpf validation" })
    expect(reopen.ok).toBe(true)
    expect(reopen.csId).toBe(openA.csId)
  } finally {
    s.stop()
  }
})
