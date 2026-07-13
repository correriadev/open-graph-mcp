import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, readResource, register } from "./helpers"

test("lock.denied reaches ONLY the attempting session — the holder and a bystander get nothing", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")
    const carol = await register(s.url, "carol")
    const cell = "ui:4"

    // Alice holds the lock on the cell — subscribe her unfiltered so she'd see any lock.* broadcast.
    const { csId } = await callTool(s.url, "changeset.open", { token: alice.token, cells: [cell], intent: "alice's turn" })
    const aliceSse = await openSse(s.url, 0, alice.token)
    // Carol observes the cell explicitly — she would receive lock.acquired/released but must NOT receive lock.denied.
    const carolSse = await openSse(s.url, 0, carol.token, `cell:${cell}`)
    const bobSse = await openSse(s.url, 0, bob.token)

    // Bob attempts to open a changeset on the same cell — denied.
    const attempt = await callTool(s.url, "changeset.open", { token: bob.token, cells: [cell], intent: "bob tries" })
    expect(attempt.ok).toBe(false)
    expect(attempt.reason).toBe("cell_locked")
    expect(attempt.holder).toBe(alice.userId)

    // Bob (the attempter) receives the lock.denied.
    const denied = await bobSse.waitFor((e) => e.kind === "lock.denied")
    expect(denied.payload.cell).toBe(cell)
    expect(denied.payload.attempted_by).toBe(bob.userId)
    expect(denied.payload.holder).toBe(alice.userId)
    expect(denied.payload.csId).toBe(csId)

    // Give any stray broadcast time to land, then assert Alice and Carol got NOTHING of the kind.
    await new Promise((r) => setTimeout(r, 100))
    expect(aliceSse.events.some((e) => e.kind === "lock.denied")).toBe(false)
    expect(carolSse.events.some((e) => e.kind === "lock.denied")).toBe(false)

    // Persisted for audit (SQLite), even though only Bob was pushed the SSE frame.
    const row = s.state.db.query("SELECT COUNT(*) AS c FROM events WHERE tenant_id = 'default' AND kind = 'lock.denied'").get() as { c: number }
    expect(row.c).toBe(1)

    // graph://history is SHARED (any tenant token reads it) — lock.denied must not leak through it for
    // ANY caller, attempter included (deliberate decision: private event, audit stays SQLite-only).
    for (const who of [alice, bob, carol]) {
      const hist = await readResource(s.url, "graph://history?since=0", who.token)
      expect(hist.events.some((e: any) => e.kind === "lock.denied")).toBe(false)
    }

    aliceSse.close()
    carolSse.close()
    bobSse.close()
  } finally {
    s.stop()
  }
})
