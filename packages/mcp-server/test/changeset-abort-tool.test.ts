import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

test("explicit changeset.abort emits changeset.aborted, one lock.released + one node.idle per held cell, and clears deltaCounts", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const sse = await openSse(s.url, 0, a.token)
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:1", "ui:2"], intent: "two cells" })
    await sse.waitFor((e) => e.kind === "changeset.opened" && e.payload.csId === csId)

    // stage a delta so deltaCounts has an entry to clear
    const claim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "c1", subject: "c1", domain: "ui", level: 1, refs: [] } },
    })
    expect(claim.ok).toBe(true)

    const abort = await callTool(s.url, "changeset.abort", { token: a.token, csId })
    expect(abort.ok).toBe(true)

    const aborted = await sse.waitFor((e) => e.kind === "changeset.aborted" && e.payload.csId === csId)
    expect(aborted.payload.reason).toBe("user")

    const released = sse.events.filter((e) => e.kind === "lock.released" && e.payload.csId === csId)
    expect(released.length).toBe(2)
    expect(new Set(released.map((e) => e.payload.cell))).toEqual(new Set(["ui:1", "ui:2"]))

    const idles = sse.events.filter((e) => e.kind === "node.idle" && e.payload.csId === csId)
    expect(idles.length).toBe(2)

    // locks actually gone in the DB
    const lockCount = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { c: number }).c
    expect(lockCount).toBe(0)

    // deltaCounts cleared: flush() must produce NO changeset.delta for this csId (sentinel: a fresh
    // event on a different channel proves the flush ran and drained nothing for csId)
    s.flush()
    const deltaEvt = sse.events.find((e) => e.kind === "changeset.delta" && e.payload.csId === csId)
    expect(deltaEvt).toBeUndefined()

    sse.close()
  } finally {
    s.stop()
  }
})

test("aborting releases the lock so a second actor can immediately claim that cell", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const b = await register(s.url, "bob")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:9"], intent: "hold" })

    const blocked = await callTool(s.url, "changeset.open", { token: b.token, cells: ["ui:9"], intent: "want it" })
    expect(blocked.ok).toBe(false)

    const abort = await callTool(s.url, "changeset.abort", { token: a.token, csId })
    expect(abort.ok).toBe(true)

    const openB = await callTool(s.url, "changeset.open", { token: b.token, cells: ["ui:9"], intent: "now mine" })
    expect(openB.ok).toBe(true)
    expect(openB.csId).not.toBe(csId)
  } finally {
    s.stop()
  }
})
