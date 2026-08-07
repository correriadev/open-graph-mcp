import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { insertRow } from "../src/db"
import { callTool, openSse, register } from "./helpers"

test("orphan lock whose changeset is already closed is deleted by the sweep, with no duplicate changeset.aborted", async () => {
  const s = startServer({ ttlMs: 1 })
  try {
    const a = await register(s.url, "alice")
    const sse = await openSse(s.url, 0, a.token)

    // cs1: opened and committed normally — commit already released its real lock.
    const cs1 = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:10"], intent: "will-commit" })
    const commit1 = await callTool(s.url, "changeset.commit", { token: a.token, csId: cs1.csId, intent: "will-commit" })
    expect(commit1.ok).toBe(true)

    // Simulate an orphan lock row left pointing at that already-'admitted' cs (the pathological state
    // the sweeper must tolerate) — inserted directly, past its expiry, since the normal API surface
    // has no way to produce it.
    insertRow(s.state.db, "locks", {
      tenant_id: "default",
      cell: "ui:11",
      cs_id: cs1.csId,
      mode: "pessimistic",
      acquired_at: new Date(0).toISOString(),
      expires_at: new Date(0).toISOString(),
      holder: a.userId,
    })

    // cs2: a genuinely live, TTL-eligible changeset — swept in the SAME sweep() call, so its
    // changeset.aborted is the sentinel that proves the sweep ran and orphan handling didn't also fire.
    const cs2 = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:12"], intent: "will-ttl" })
    await sse.waitFor((e) => e.kind === "changeset.opened" && e.payload.csId === cs2.csId)

    await new Promise((r) => setTimeout(r, 20)) // move real wall clock past the 1ms TTL
    s.sweep()

    await sse.waitFor((e) => e.kind === "changeset.aborted" && e.payload.csId === cs2.csId)

    // orphan lock gone
    const orphanCount = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ? AND cell = ?").get("default", "ui:11") as { c: number }).c
    expect(orphanCount).toBe(0)

    // no changeset.aborted was ever emitted for the already-admitted cs1
    const cs1Aborts = sse.events.filter((e) => e.kind === "changeset.aborted" && e.payload.csId === cs1.csId)
    expect(cs1Aborts.length).toBe(0)
    // and cs1 status is untouched — still admitted, not resurrected/re-aborted
    const cs1Row = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", cs1.csId) as { status: string }
    expect(cs1Row.status).toBe("admitted")

    sse.close()
  } finally {
    s.stop()
  }
})

test("a multi-cell TTL expiry releases every cell and emits node.idle per cell", async () => {
  const s = startServer({ ttlMs: 1 })
  try {
    const a = await register(s.url, "alice")
    const sse = await openSse(s.url, 0, a.token)
    const cells = ["ui:20", "ui:21", "ui:22"]
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells, intent: "multi-cell" })
    await sse.waitFor((e) => e.kind === "changeset.opened" && e.payload.csId === csId)

    await new Promise((r) => setTimeout(r, 20))
    s.sweep()

    await sse.waitFor((e) => e.kind === "changeset.aborted" && e.payload.csId === csId)

    const released = sse.events.filter((e) => e.kind === "lock.released" && e.payload.csId === csId)
    expect(released.length).toBe(cells.length)
    expect(new Set(released.map((e) => e.payload.cell))).toEqual(new Set(cells))

    const idles = sse.events.filter((e) => e.kind === "node.idle" && e.payload.csId === csId)
    expect(idles.length).toBe(cells.length)

    const lockCount = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { c: number }).c
    expect(lockCount).toBe(0)

    sse.close()
  } finally {
    s.stop()
  }
})

test("a changeset with zero deltas still aborts cleanly on TTL", async () => {
  const s = startServer({ ttlMs: 1 })
  try {
    const a = await register(s.url, "alice")
    const sse = await openSse(s.url, 0, a.token)
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:30"], intent: "never-claimed" })
    await sse.waitFor((e) => e.kind === "changeset.opened" && e.payload.csId === csId)

    const deltaCountBefore = (s.state.db.query("SELECT COUNT(*) AS c FROM cs_deltas WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { c: number }).c
    expect(deltaCountBefore).toBe(0)

    await new Promise((r) => setTimeout(r, 20))
    s.sweep()

    const evt = await sse.waitFor((e) => e.kind === "changeset.aborted" && e.payload.csId === csId)
    expect(evt.payload.reason).toBe("ttl_expired")

    const csRow = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string }
    expect(csRow.status).toBe("aborted")
    sse.close()
  } finally {
    s.stop()
  }
})
