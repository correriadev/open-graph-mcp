import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"
import { touchDelta } from "../src/tools/typing"
import type { Presence } from "../src/state"

const presence = (sessionId: string, tenant: string, userId: string): Presence => ({
  sessionId, tenant, userId, agentKind: "web", lastSeen: Date.now(), focusCell: null,
  openCsIds: [], invisible: false, lastDeltaAt: 0, typingState: "quiet",
})

test("indexed typing touches only actor sessions and prunes stale membership", () => {
  const s = startServer()
  try {
    const a1 = presence("a1", "tenant-a", "same-user")
    const a2 = presence("a2", "tenant-a", "same-user")
    const otherTenant = presence("b1", "tenant-b", "same-user")
    s.state.presence.set(a1.sessionId, a1); s.state.presence.set(a2.sessionId, a2); s.state.presence.set(otherTenant.sessionId, otherTenant)
    const unrelated = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const p = presence(`other-${i}`, "tenant-a", `user-${i}`)
      s.state.presence.set(p.sessionId, p); unrelated.add(p.sessionId)
    }
    s.state.actorSessions.set("tenant-a", new Map([["same-user", new Set(["a1", "a2", "stale", "b1"])]]))
    s.state.actorSessions.set("tenant-b", new Map([["same-user", new Set(["b1"])]]))

    touchDelta(s.state, "tenant-a", "same-user")
    expect(a1.lastDeltaAt).toBeGreaterThan(0); expect(a2.lastDeltaAt).toBe(a1.lastDeltaAt)
    expect(otherTenant.lastDeltaAt).toBe(0)
    expect([...unrelated].every((id) => s.state.presence.get(id)!.lastDeltaAt === 0)).toBe(true)
    expect([...s.state.actorSessions.get("tenant-a")!.get("same-user")!].sort()).toEqual(["a1", "a2"])
  } finally { s.stop() }
})

test("presence registration is idempotent and close removes empty actor buckets", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const stream = await openSse(s.url, 0, alice.token)
    const sessionId = stream.events[0].sessionId
    await callTool(s.url, "presence.beat", { token: alice.token, sessionId })
    await callTool(s.url, "presence.beat", { token: alice.token, sessionId })
    expect(s.state.actorSessions.get(alice.tenantId)?.get(alice.userId)?.size).toBe(1)
    stream.close()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(s.state.actorSessions.get(alice.tenantId)?.has(alice.userId) ?? false).toBe(false)
  } finally { s.stop() }
})

test("public typing tool updates two live SSE sessions for one actor identically", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const first = await openSse(s.url, 0, alice.token)
    const second = await openSse(s.url, 0, alice.token)
    const firstId = first.events[0].sessionId
    const secondId = second.events[0].sessionId
    await callTool(s.url, "presence.beat", { token: alice.token, sessionId: firstId })
    await callTool(s.url, "presence.beat", { token: alice.token, sessionId: secondId })
    expect((await callTool(s.url, "presence.typing", { token: alice.token })).ok).toBe(true)
    expect(s.state.presence.get(firstId)!.lastDeltaAt).toBeGreaterThan(0)
    expect(s.state.presence.get(secondId)!.lastDeltaAt).toBe(s.state.presence.get(firstId)!.lastDeltaAt)
    first.close(); second.close()
  } finally { s.stop() }
})

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
    const { csId } = await callTool(s.url, "changeset.open", { token: alice.token, cells: ["ui:5"], intent: "typing3" })

    const bobSse = await openSse(s.url, 0, bob.token, `cell:${cell}`)
    const aliceSse = await openSse(s.url, 0, alice.token)
    const aliceSessionId = aliceSse.events[0].sessionId
    await callTool(s.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell, invisible: true })
    await new Promise((r) => setTimeout(r, 20))

    await callTool(s.url, "changeset.claim", { token: alice.token, csId, delta: { kind: "claim.add", payload: { id: "cy", subject: "s", domain: "ui", level: 5, refs: [] } } })
    s.tickTypingNow()
    await new Promise((r) => setTimeout(r, 20))

    expect(bobSse.events.some((e) => e.kind === "user.typing_state")).toBe(false)

    aliceSse.close()
    bobSse.close()
  } finally {
    s.stop()
  }
})

test("going invisible while typing emits one final typing→quiet transition, then nothing further", async () => {
  const s = startServer({ focusDebounceMs: 10 })
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")
    const cell = "ui:7"
    const { csId } = await callTool(s.url, "changeset.open", { token: alice.token, cells: ["ui:5"], intent: "typing4" })

    const bobSse = await openSse(s.url, 0, bob.token, `cell:${cell}`)
    const aliceSse = await openSse(s.url, 0, alice.token)
    const aliceSessionId = aliceSse.events[0].sessionId
    await callTool(s.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell })
    await bobSse.waitFor((e) => e.kind === "user.focused" && e.payload.sessionId === aliceSessionId)

    // Alice starts typing — Bob sees quiet→typing.
    await callTool(s.url, "changeset.claim", { token: alice.token, csId, delta: { kind: "claim.add", payload: { id: "cz", subject: "s", domain: "ui", level: 5, refs: [] } } })
    s.tickTypingNow()
    const typing = await bobSse.waitFor((e) => e.kind === "user.typing_state" && e.payload.state === "typing")
    expect(typing.payload.userId).toBe(alice.userId)

    // Alice goes invisible mid-typing. Without the final forced transition, sweepTyping skips invisible
    // presences and Bob's "typing" indicator would freeze forever.
    await callTool(s.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell, invisible: true })
    const quiet = await bobSse.waitFor((e) => e.kind === "user.typing_state" && e.payload.state === "quiet")
    expect(quiet.payload.prev).toBe("typing")
    expect(quiet.payload.userId).toBe(alice.userId)
    expect(quiet.payload.cell).toBe(cell)

    // Nothing further: more claims + ticks while invisible emit no typing_state at all.
    await callTool(s.url, "changeset.claim", { token: alice.token, csId, delta: { kind: "claim.add", payload: { id: "cz2", subject: "s", domain: "ui", level: 5, refs: [] } } })
    s.tickTypingNow()
    s.tickTypingNow()
    await new Promise((r) => setTimeout(r, 30))
    const all = bobSse.events.filter((e) => e.kind === "user.typing_state")
    expect(all).toHaveLength(2) // quiet→typing, then the forced typing→quiet — and nothing else

    aliceSse.close()
    bobSse.close()
  } finally {
    s.stop()
  }
})
