import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

test("focusing a cell broadcasts user.focused to observers of that cell; disconnecting broadcasts user.left", async () => {
  const s = startServer({ focusDebounceMs: 10 })
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")
    const carol = await register(s.url, "carol")

    // Bob observes [ui:4] explicitly; Carol observes something else; Alice will focus [ui:4].
    const bobSse = await openSse(s.url, 0, bob.token, "cell:ui:4")
    const carolSse = await openSse(s.url, 0, carol.token, "cell:other:9")
    const aliceSse = await openSse(s.url, 0, alice.token)
    const aliceSessionId = aliceSse.events[0].sessionId

    // First presence-registering call announces the session (broadcast geral).
    const joinedForBob = bobSse.waitFor((e) => e.kind === "user.joined" && e.payload.sessionId === aliceSessionId)

    const focusResult = await callTool(s.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell: "ui:4" })
    expect(focusResult.ok).toBe(true)
    await joinedForBob

    const focused = await bobSse.waitFor((e) => e.kind === "user.focused" && e.payload.sessionId === aliceSessionId)
    expect(focused.payload.cell).toBe("ui:4")
    expect(focused.payload.userId).toBe(alice.userId)

    // Carol observes a different cell — must not receive Alice's user.focused.
    expect(carolSse.events.some((e) => e.kind === "user.focused")).toBe(false)

    // presence.who reflects Alice focusing ui:4.
    const who = await callTool(s.url, "presence.who", { token: bob.token, cell: "ui:4" })
    expect(who.users.map((u: any) => u.id)).toContain(alice.userId)

    // Alice disconnects — Bob (observer of ui:4) sees user.left with reason "left".
    aliceSse.close()
    const left = await bobSse.waitFor((e) => e.kind === "user.left" && e.payload.sessionId === aliceSessionId)
    expect(left.payload.reason).toBe("left")

    // Presence is EPHEMERAL (spec §3.1): after joined + focused + left, NOTHING was persisted —
    // neither in the SQLite events table nor in the tenant's events.jsonl mirror (no replay on rebuild).
    const persisted = (s.state.db.query("SELECT COUNT(*) AS c FROM events WHERE kind LIKE 'user.%'").get() as { c: number }).c
    expect(persisted).toBe(0)
    const jsonl = path.join(s.state.stateDir, "tenants", "default", "events.jsonl")
    if (existsSync(jsonl)) expect(readFileSync(jsonl, "utf8")).not.toContain('"user.')

    bobSse.close()
    carolSse.close()
  } finally {
    s.stop()
  }
})

test("focus debounce (§6.3): rapid focus switches broadcast only ONE user.focused, for the last cell", async () => {
  const s = startServer({ focusDebounceMs: 60 })
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")

    const bobSse = await openSse(s.url, 0, bob.token) // no filter: sees every user.focused
    const aliceSse = await openSse(s.url, 0, alice.token)
    const aliceSessionId = aliceSse.events[0].sessionId

    // Three switches well inside the debounce window — only the last one may settle and broadcast.
    await callTool(s.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell: "ui:1" })
    await callTool(s.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell: "ui:2" })
    await callTool(s.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell: "ui:3" })

    const focused = await bobSse.waitFor((e) => e.kind === "user.focused" && e.payload.sessionId === aliceSessionId)
    expect(focused.payload.cell).toBe("ui:3")

    // Wait past another full debounce window: no further (stale intermediate) broadcasts may arrive.
    await new Promise((r) => setTimeout(r, 150))
    const all = bobSse.events.filter((e) => e.kind === "user.focused" && e.payload.sessionId === aliceSessionId)
    expect(all).toHaveLength(1)

    aliceSse.close()
    bobSse.close()
  } finally {
    s.stop()
  }
})
