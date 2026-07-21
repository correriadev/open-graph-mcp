import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

test("a session that stops beating expires after presenceTtlMs and broadcasts user.left(heartbeat_expired)", async () => {
  const s = startServer({ presenceTtlMs: 1, focusDebounceMs: 10 }) // 1ms TTL — expires immediately
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")

    const bobSse = await openSse(s.url, 0, bob.token, "cell:ui:7")
    const aliceSse = await openSse(s.url, 0, alice.token)
    const aliceSessionId = aliceSse.events[0].sessionId

    await callTool(s.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell: "ui:7" })
    // let the focus broadcast settle so we don't confuse it with the expiry event below
    await bobSse.waitFor((e) => e.kind === "user.focused" && e.payload.sessionId === aliceSessionId)

    await new Promise((r) => setTimeout(r, 20))
    s.sweepPresenceNow() // deterministic sweep (prod runs this on an interval)

    const left = await bobSse.waitFor((e) => e.kind === "user.left" && e.payload.sessionId === aliceSessionId)
    expect(left.payload.reason).toBe("heartbeat_expired")

    // presence.who no longer lists Alice.
    const who = await callTool(s.url, "presence.who", { token: bob.token })
    expect(who.users.map((u: any) => u.id)).not.toContain(alice.userId)
    expect(s.state.actorSessions.get(alice.tenantId)?.has(alice.userId) ?? false).toBe(false)

    aliceSse.close()
    bobSse.close()
  } finally {
    s.stop()
  }
})
