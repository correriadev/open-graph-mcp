import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

test("100 rapid changeset.claim calls in one window produce exactly ONE quiet→typing transition, none in between", async () => {
  const s = startServer({ focusDebounceMs: 10 })
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")
    const cell = "ui:4"

    const { csId } = await callTool(s.url, "changeset.open", { token: alice.token, cells: [cell], intent: "typing" })

    // Bob observes the cell alice is focused on — the only channel user.typing_state routes through (§6.1).
    const bobSse = await openSse(s.url, 0, bob.token, `cell:${cell}`)
    const aliceSse = await openSse(s.url, 0, alice.token)
    const aliceSessionId = aliceSse.events[0].sessionId
    await callTool(s.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell })
    await bobSse.waitFor((e) => e.kind === "user.focused" && e.payload.sessionId === aliceSessionId)

    // Sanity: nothing has claimed yet — presence starts "quiet" (lastDeltaAt=0), sweeping now emits no transition
    // (quiet→quiet is not a transition).
    s.tickTypingNow()
    expect(bobSse.events.some((e) => e.kind === "user.typing_state")).toBe(false)

    // 100 rapid claims, all within the typing window (well under the default 2s typingMs threshold).
    for (let i = 0; i < 100; i++) {
      const claim = await callTool(s.url, "changeset.claim", {
        token: alice.token,
        csId,
        delta: { kind: "claim.add", payload: { id: `c${i}`, subject: "s", domain: "ui", level: 4, refs: [] } },
      })
      expect(claim.ok).toBe(true)
      // Simulate the 500ms server-side scan racing with rapid claims: tick after every claim.
      s.tickTypingNow()
    }

    const typingEvents = bobSse.events.filter((e) => e.kind === "user.typing_state")
    expect(typingEvents).toHaveLength(1)
    expect(typingEvents[0].payload.state).toBe("typing")
    expect(typingEvents[0].payload.prev).toBe("quiet")
    expect(typingEvents[0].payload.userId).toBe(alice.userId)
    expect(typingEvents[0].payload.cell).toBe(cell)

    aliceSse.close()
    bobSse.close()
  } finally {
    s.stop()
  }
})

test("typing_state is ephemeral: never persisted to SQLite events or the JSONL mirror", async () => {
  const s = startServer({ focusDebounceMs: 10 })
  try {
    const alice = await register(s.url, "alice")
    const cell = "ui:5"
    const { csId } = await callTool(s.url, "changeset.open", { token: alice.token, cells: [cell], intent: "typing2" })
    const aliceSse = await openSse(s.url, 0, alice.token)
    const aliceSessionId = aliceSse.events[0].sessionId
    await callTool(s.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell })
    await new Promise((r) => setTimeout(r, 20))

    await callTool(s.url, "changeset.claim", { token: alice.token, csId, delta: { kind: "claim.add", payload: { id: "cx", subject: "s", domain: "ui", level: 5, refs: [] } } })
    s.tickTypingNow()
    await aliceSse.waitFor((e) => e.kind === "user.typing_state")

    const persisted = (s.state.db.query("SELECT COUNT(*) AS c FROM events WHERE kind = 'user.typing_state'").get() as { c: number }).c
    expect(persisted).toBe(0)

    aliceSse.close()
  } finally {
    s.stop()
  }
})

test("invisible users emit no typing_state", async () => {
  const s = startServer({ focusDebounceMs: 10 })
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")
    const cell = "ui:6"
    const { csId } = await callTool(s.url, "changeset.open", { token: alice.token, cells: [cell], intent: "typing3" })

    const bobSse = await openSse(s.url, 0, bob.token, `cell:${cell}`)
    const aliceSse = await openSse(s.url, 0, alice.token)
    const aliceSessionId = aliceSse.events[0].sessionId
    await callTool(s.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell, invisible: true })
    await new Promise((r) => setTimeout(r, 20))

    await callTool(s.url, "changeset.claim", { token: alice.token, csId, delta: { kind: "claim.add", payload: { id: "cy", subject: "s", domain: "ui", level: 6, refs: [] } } })
    s.tickTypingNow()
    await new Promise((r) => setTimeout(r, 20))

    expect(bobSse.events.some((e) => e.kind === "user.typing_state")).toBe(false)

    aliceSse.close()
    bobSse.close()
  } finally {
    s.stop()
  }
})
