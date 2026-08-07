import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

test("invisible mode: session is absent from presence.who and emits no user.focused/user.joined to others", async () => {
  const s = startServer({ focusDebounceMs: 10 })
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")

    const bobSse = await openSse(s.url, 0, bob.token, "cell:ui:9")
    const aliceSse = await openSse(s.url, 0, alice.token)
    const aliceSessionId = aliceSse.events[0].sessionId
    const bobSessionId = bobSse.events[0].sessionId

    // Alice's very first presence-registering call already marks her invisible.
    const focusResult = await callTool(s.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell: "ui:9", invisible: true })
    expect(focusResult.ok).toBe(true)

    // Sentinel instead of a sleep: Bob (visible) focuses the same cell right after Alice. His OWN
    // user.focused only fires after the debounced settle (focusDebounceMs) — by the time it lands, any
    // broadcast Alice's invisible call would have scheduled (it schedules none — presence.focus returns
    // early for invisible presences, presence.ts) has provably not arrived either, no clock needed.
    await callTool(s.url, "presence.focus", { token: bob.token, sessionId: bobSessionId, cell: "ui:9" })
    await bobSse.waitFor((e) => e.kind === "user.focused" && e.payload.sessionId === bobSessionId)
    expect(bobSse.events.some((e) => e.kind === "user.focused" && e.payload.sessionId === aliceSessionId)).toBe(false)
    expect(bobSse.events.some((e) => e.kind === "user.joined" && e.payload.sessionId === aliceSessionId)).toBe(false)

    const who = await callTool(s.url, "presence.who", { token: bob.token })
    expect(who.users.map((u: any) => u.id)).not.toContain(alice.userId)
    const whoByCell = await callTool(s.url, "presence.who", { token: bob.token, cell: "ui:9" })
    expect(whoByCell.users.map((u: any) => u.id)).not.toContain(alice.userId)

    // Bob (visible) already shows up normally, from the sentinel focus above.
    const who2 = await callTool(s.url, "presence.who", { token: bob.token, cell: "ui:9" })
    expect(who2.users.map((u: any) => u.id)).toEqual([bob.userId])

    aliceSse.close()
    bobSse.close()
  } finally {
    s.stop()
  }
})
