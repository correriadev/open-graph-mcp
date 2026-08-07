import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

// sessionIds are random (UUID) capabilities only the stream owner knows, but the first
// presence-registering call additionally BINDS the sessionId to the token's identity (defense in depth
// for a leaked/shared ID): any later call with a different user (or a user from another tenant) is
// rejected without touching the victim's presence.
test("presence.beat/focus with someone else's sessionId is rejected and leaves the victim untouched", async () => {
  const s = startServer({ focusDebounceMs: 10 })
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")
    const eve = await register(s.url, "eve", "other-tenant")

    const bobSse = await openSse(s.url, 0, bob.token) // unfiltered observer in Alice's tenant
    const aliceSse = await openSse(s.url, 0, alice.token)
    const aliceSessionId = aliceSse.events[0].sessionId

    // Alice registers her presence and focuses ui:4.
    await callTool(s.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell: "ui:4" })
    await bobSse.waitFor((e) => e.kind === "user.focused" && e.payload.sessionId === aliceSessionId)
    const broadcastsBefore = bobSse.events.length
    const aliceLastSeen = s.state.presence.get(aliceSessionId)!.lastSeen

    // Same-tenant attacker (Bob) tries to hijack Alice's session: set invisible, move focus, keep alive.
    const hijackFocus = await callTool(s.url, "presence.focus", { token: bob.token, sessionId: aliceSessionId, cell: "evil:1", invisible: true })
    expect(hijackFocus.ok).toBe(false)
    expect(hijackFocus.reasons).toEqual(["session not owned by caller"])
    const hijackBeat = await callTool(s.url, "presence.beat", { token: bob.token, sessionId: aliceSessionId })
    expect(hijackBeat.ok).toBe(false)

    // Cross-tenant attacker (Eve) — same rejection.
    const crossTenant = await callTool(s.url, "presence.focus", { token: eve.token, sessionId: aliceSessionId, cell: "evil:2" })
    expect(crossTenant.ok).toBe(false)
    expect(crossTenant.reasons).toEqual(["session not owned by caller"])

    // Victim's presence is untouched: focus, visibility and lastSeen unchanged.
    const p = s.state.presence.get(aliceSessionId)!
    expect(p.userId).toBe(alice.userId)
    expect(p.focusCell).toBe("ui:4")
    expect(p.invisible).toBe(false)
    expect(p.lastSeen).toBe(aliceLastSeen)

    // Sentinel instead of a sleep: Bob registers his OWN (legitimate) presence and focus right after the
    // rejected hijack attempts. His genuine debounced user.focused settling is deterministic proof that
    // any debounce the hijack attempts might have scheduled — they schedule none, `touch()` returns null
    // before ever reaching the debounce logic (presence.ts) — has already had its window pass.
    const bobSessionId = bobSse.events[0].sessionId
    await callTool(s.url, "presence.focus", { token: bob.token, sessionId: bobSessionId, cell: "bobcell:1" })
    await bobSse.waitFor((e) => e.kind === "user.focused" && e.payload.sessionId === bobSessionId)
    const hijackBroadcasts = bobSse.events.slice(broadcastsBefore).filter((e) => e.kind === "user.focused" && e.payload.sessionId === aliceSessionId)
    expect(hijackBroadcasts).toEqual([])
    expect(bobSse.events.some((e) => e.kind === "user.focused" && e.payload.cell?.startsWith?.("evil"))).toBe(false)

    // presence.who still shows Alice exactly as she was.
    const who = await callTool(s.url, "presence.who", { token: bob.token, cell: "ui:4" })
    expect(who.users.map((u: any) => u.id)).toContain(alice.userId)

    aliceSse.close()
    bobSse.close()
  } finally {
    s.stop()
  }
})

test("fabricated and malformed session IDs cannot create presence or actor-index state", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const beforePresence = s.state.presence.size
    const beforeActors = s.state.actorSessions.size
    for (const sessionId of ["fabricated", "s_000000000000"]) {
      const result = await callTool(s.url, "presence.beat", { token: alice.token, sessionId })
      expect(result.ok).toBe(false)
    }
    await expect(callTool(s.url, "presence.beat", { token: alice.token, sessionId: "" })).rejects.toThrow()
    await expect(callTool(s.url, "presence.focus", { token: "invalid", sessionId: "s_000000000000", cell: "ui:4" })).rejects.toThrow()
    expect(s.state.presence.size).toBe(beforePresence)
    expect(s.state.actorSessions.size).toBe(beforeActors)
  } finally { s.stop() }
})
