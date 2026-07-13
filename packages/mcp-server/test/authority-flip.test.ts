import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, readResource, register } from "./helpers"

test("authority.flip flips a cell via the changeset pipeline and records authority.flipped in history", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const cell = "flipdomain:5"

    const flip = await callTool(s.url, "authority.flip", { token: a.token, cell, to: "graph" })
    expect(flip.ok).toBe(true)
    expect(flip.cell).toBe(cell)
    expect(flip.to).toBe("graph")
    expect(typeof flip.admitSeq).toBe("number")

    // Persisted in the authoritative SQLite store (same path as changeset.commit's authority.flip).
    const authRow = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", cell) as { value: string }
    expect(authRow.value).toBe("graph")

    // Recorded as authority.flipped in the event history (SQLite + JSONL mirror), replayable via graph://history.
    const history = await readResource(s.url, "graph://history?since=0")
    const evt = history.events.find((e: any) => e.kind === "authority.flipped" && e.target === cell)
    expect(evt).toBeDefined()
    expect(evt.payload.cell).toBe(cell)
    expect(evt.payload.to).toBe("graph")
    expect(evt.payload.byUser).toBe(a.userId)

    // No lock left dangling — the ephemeral changeset committed and released it.
    const lock = s.state.db.query("SELECT cs_id FROM locks WHERE tenant_id = ? AND cell = ?").get("default", cell)
    expect(lock).toBeNull()
  } finally {
    s.stop()
  }
})

test("authority.flipped is broadcast to ALL connected SSE sessions regardless of their filter", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const cell = "broadcastdomain:5"

    // Three sessions with progressively narrower filters, none of which mention this cell/domain/event.
    const sseAll = await openSse(s.url)
    const sseOtherDomain = await openSse(s.url, 0, undefined, "domain:some-unrelated-domain")
    const sseOtherEvent = await openSse(s.url, 0, undefined, "event:changeset.opened")

    const flip = await callTool(s.url, "authority.flip", { token: a.token, cell, to: "graph" })
    expect(flip.ok).toBe(true)

    const isFlip = (e: any) => e.kind === "authority.flipped" && e.target === cell
    const [evtAll, evtOtherDomain, evtOtherEvent] = await Promise.all([sseAll.waitFor(isFlip), sseOtherDomain.waitFor(isFlip), sseOtherEvent.waitFor(isFlip)])

    expect(evtAll.seq).toBe(evtOtherDomain.seq)
    expect(evtAll.seq).toBe(evtOtherEvent.seq)
    expect(evtAll.payload.cell).toBe(cell)

    sseAll.close()
    sseOtherDomain.close()
    sseOtherEvent.close()
  } finally {
    s.stop()
  }
})
