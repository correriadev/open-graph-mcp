import { expect, test } from "bun:test"
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

    bobSse.close()
    carolSse.close()
  } finally {
    s.stop()
  }
})
