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

test("authority.flipped is broadcast to ALL connected SSE sessions regardless of their filter (§10.6: 5 sessions)", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const cell = "broadcastdomain:5"

    // Five sessions with progressively narrower/unrelated filters, none of which mention this cell/domain/event —
    // affinity routing (affinity.ts) must still reach every single one (§6.1: authority.flipped stays ALWAYS_BROADCAST).
    const sseAll = await openSse(s.url)
    const sseOtherDomain = await openSse(s.url, 0, undefined, "domain:some-unrelated-domain")
    const sseOtherEvent = await openSse(s.url, 0, undefined, "event:changeset.opened")
    const sseOtherCell = await openSse(s.url, 0, undefined, "cell:zzz:9")
    const sseOtherChangeset = await openSse(s.url, 0, undefined, "changeset:cs_never_seen")

    const flip = await callTool(s.url, "authority.flip", { token: a.token, cell, to: "graph" })
    expect(flip.ok).toBe(true)

    const isFlip = (e: any) => e.kind === "authority.flipped" && e.target === cell
    const [evtAll, evtOtherDomain, evtOtherEvent, evtOtherCell, evtOtherChangeset] = await Promise.all([
      sseAll.waitFor(isFlip),
      sseOtherDomain.waitFor(isFlip),
      sseOtherEvent.waitFor(isFlip),
      sseOtherCell.waitFor(isFlip),
      sseOtherChangeset.waitFor(isFlip),
    ])

    for (const evt of [evtOtherDomain, evtOtherEvent, evtOtherCell, evtOtherChangeset]) {
      expect(evt.seq).toBe(evtAll.seq)
      expect(evt.payload.cell).toBe(cell)
    }

    sseAll.close()
    sseOtherDomain.close()
    sseOtherEvent.close()
    sseOtherCell.close()
    sseOtherChangeset.close()
  } finally {
    s.stop()
  }
})

test("authority.flip refuses when the caller's own open changeset already locks the cell (no reuse hijack)", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const cell = "reused:5"

    // Alice has an open changeset on the cell with an unrelated staged delta.
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: [cell], intent: "unrelated work" })
    const staged = await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: { kind: "claim.add", payload: { id: "u1", subject: "s", domain: "reused", level: 5, refs: [] } } })
    expect(staged.ok).toBe(true)

    // Flip must refuse instead of reusing (and force-committing/aborting) her changeset.
    const flip = await callTool(s.url, "authority.flip", { token: a.token, cell, to: "graph" })
    expect(flip.ok).toBe(false)
    expect(flip.reasons.join(" ")).toContain(csId)

    // Her changeset is untouched: still open, delta still staged, lock still hers.
    const view = await readResource(s.url, `graph://changeset/${csId}`, a.token)
    expect(view.status).toBe("open")
    expect(view.deltas.length).toBe(1)
    const lock = s.state.db.query("SELECT cs_id FROM locks WHERE tenant_id = ? AND cell = ?").get("default", cell) as { cs_id: string }
    expect(lock.cs_id).toBe(csId)
    // And no authority was written.
    expect(s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", cell)).toBeNull()
  } finally {
    s.stop()
  }
})

test("authority.flip is denied when another user holds the cell — no state change", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const b = await register(s.url, "bob")
    const cell = "contested:5"

    const { csId } = await callTool(s.url, "changeset.open", { token: b.token, cells: [cell], intent: "bob's turn" })

    const flip = await callTool(s.url, "authority.flip", { token: a.token, cell, to: "graph" })
    expect(flip.ok).toBe(false)

    // Bob's lock survives; no authority row; no flipped event in history.
    const lock = s.state.db.query("SELECT cs_id, holder FROM locks WHERE tenant_id = ? AND cell = ?").get("default", cell) as { cs_id: string; holder: string }
    expect(lock.cs_id).toBe(csId)
    expect(lock.holder).toBe(b.userId)
    expect(s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", cell)).toBeNull()
    const history = await readResource(s.url, "graph://history?since=0")
    expect(history.events.some((e: any) => e.kind === "authority.flipped")).toBe(false)
  } finally {
    s.stop()
  }
})

test("authority.flip rejects invalid input cleanly — no dangling lock or changeset", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")

    const badCell = await callTool(s.url, "authority.flip", { token: a.token, cell: "no-colon-here", to: "graph" })
    expect(badCell.ok).toBe(false)
    expect(badCell.reasons[0]).toContain("invalid cell")

    const badTo = await callTool(s.url, "authority.flip", { token: a.token, cell: "ok:5", to: "banana" })
    expect(badTo.ok).toBe(false)
    expect(badTo.reasons[0]).toContain("invalid target")

    // Nothing was created: no locks, no changesets, no authority rows.
    const locks = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ?").get("default") as { c: number }).c
    const changesets = (s.state.db.query("SELECT COUNT(*) AS c FROM changesets WHERE tenant_id = ?").get("default") as { c: number }).c
    const authority = (s.state.db.query("SELECT COUNT(*) AS c FROM authority WHERE tenant_id = ?").get("default") as { c: number }).c
    expect(locks).toBe(0)
    expect(changesets).toBe(0)
    expect(authority).toBe(0)
  } finally {
    s.stop()
  }
})
