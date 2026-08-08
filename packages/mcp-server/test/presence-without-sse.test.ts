import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, register } from "./helpers"

/**
 * MP-1 — presença é invisível pra um cliente que fala só JSON-RPC em POST /mcp e nunca abre GET /events
 * (o caminho de `claude mcp add --transport http`). `presence.beat`/`presence.focus` exigiam um
 * `sessionId` que só nascia de sse.ts; sem SSE, sem sessionId, sem presença — o cliente principal do
 * beta nunca aparecia em `presence.who` nem recebia `system.message`.
 *
 * Fix: `sessionId` é opcional em beat/focus. Omitido, `touch()` (presence.ts) resolve/cria uma Session
 * SINTÉTICA sem canal de push, keyed deterministicamente por (tenant,userId) — não aleatória como a SSE,
 * porque a identidade já vem do token (`requireToken`) e não de posse de um id opaco. Nenhum destes
 * testes abre `GET /events`: tudo aqui é POST /mcp puro, o cenário exato do relato do "bob".
 */

test("a client that never opens /events can declare presence via presence.beat and appears in presence.who", async () => {
  const s = startServer()
  try {
    const bob = await register(s.url, "bob")
    const observer = await register(s.url, "observer")

    // No SSE anywhere in this test — bob is a pure POST /mcp client.
    const beat = await callTool(s.url, "presence.beat", { token: bob.token, agentKind: "claude-code" })
    expect(beat.ok).toBe(true)
    expect(typeof beat.sessionId).toBe("string")

    const who = await callTool(s.url, "presence.who", { token: observer.token })
    expect(who.users).toEqual([{ id: bob.userId, name: "bob", agentKind: "claude-code", focusCell: null, openCount: 0, lastSeen: expect.any(Number) }])
  } finally {
    s.stop()
  }
})

test("presence.focus without sessionId also registers presence and can declare a focus cell", async () => {
  const s = startServer({ focusDebounceMs: 10 })
  try {
    const bob = await register(s.url, "bob")

    const focus = await callTool(s.url, "presence.focus", { token: bob.token, cell: "ui:4", agentKind: "claude-code" })
    expect(focus.ok).toBe(true)
    expect(typeof focus.sessionId).toBe("string")

    const who = await callTool(s.url, "presence.who", { token: bob.token, cell: "ui:4" })
    expect(who.users.map((u: any) => u.id)).toEqual([bob.userId])
    expect(who.users[0].focusCell).toBe("ui:4")
  } finally {
    s.stop()
  }
})

test("repeated beats without sessionId land on the SAME presence entry, not a new one each time", async () => {
  const s = startServer()
  try {
    const bob = await register(s.url, "bob")

    const first = await callTool(s.url, "presence.beat", { token: bob.token, agentKind: "claude-code" })
    const second = await callTool(s.url, "presence.beat", { token: bob.token, agentKind: "claude-code" })
    expect(second.sessionId).toBe(first.sessionId)

    const who = await callTool(s.url, "presence.who", { token: bob.token })
    expect(who.users.length).toBe(1) // not two — same Presence, not a fresh one per call
  } finally {
    s.stop()
  }
})

// The exact evidence from the report: bob attempts to open a turn on a cell alice holds and gets
// cell_locked with a holder id — but if alice (the holder) is ALSO a headless client that never opens
// SSE, she was previously invisible in presence.who, making "is the holder a live session or an orphan
// lock?" unanswerable. With MP-1 fixed, a holder that proactively beats (no SSE) shows up as present.
test("the holder of a lock is visible as present even though neither side ever opened SSE", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")
    const cell = "docs:4"

    // Alice declares presence (headless) before opening her turn — the realistic sequence for a client
    // that registers once per session rather than per tool call.
    await callTool(s.url, "presence.beat", { token: alice.token, agentKind: "claude-code" })
    const opened = await callTool(s.url, "changeset.open", { token: alice.token, cells: [cell], intent: "alice's turn" })
    expect(opened.ok).toBe(true)

    // Bob (also headless) tries the same cell and is denied.
    const attempt = await callTool(s.url, "changeset.open", { token: bob.token, cells: [cell], intent: "bob tries" })
    expect(attempt.ok).toBe(false)
    expect(attempt.reason).toBe("cell_locked")
    expect(attempt.holder).toBe(alice.userId)

    // The inconsistency from the report ("um lock pessoal sem ninguém presente") is resolved: the holder
    // IS present.
    const who = await callTool(s.url, "presence.who", { token: bob.token })
    expect(who.users.map((u: any) => u.id)).toContain(alice.userId)
  } finally {
    s.stop()
  }
})

test("a no-SSE presence expires by heartbeat exactly like an SSE one (sweepPresence)", async () => {
  // presenceTtlMs:0 — sweepPresence's cutoff (`now() - ttlMs`) lands on `now()` itself, and the
  // comparison is strict (`p.lastSeen > cutoff`), so a presence touched at any point strictly before the
  // sweep call is expired without needing any real elapsed time (no setTimeout to synchronize).
  const s = startServer({ presenceTtlMs: 0 })
  try {
    const bob = await register(s.url, "bob")

    const beat = await callTool(s.url, "presence.beat", { token: bob.token, agentKind: "claude-code" })
    expect((await callTool(s.url, "presence.who", { token: bob.token })).users.length).toBe(1)

    s.sweepPresenceNow() // deterministic sweep knob (prod runs this on an interval) — no setTimeout needed

    const who = await callTool(s.url, "presence.who", { token: bob.token })
    expect(who.users).toEqual([])
    expect(s.state.actorSessions.get(bob.tenantId)?.has(bob.userId) ?? false).toBe(false)

    // Re-beating after expiry resurrects a FRESH presence (same synthetic sessionId — deterministic —
    // but a new Presence object, exactly like an SSE reconnect would).
    const rebeat = await callTool(s.url, "presence.beat", { token: bob.token, agentKind: "claude-code" })
    expect(rebeat.sessionId).toBe(beat.sessionId)
    expect((await callTool(s.url, "presence.who", { token: bob.token })).users.length).toBe(1)
  } finally {
    s.stop()
  }
})

test("attempting to hijack another token's no-SSE presence by guessing its sessionId is refused", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const eve = await register(s.url, "eve")

    const aliceBeat = await callTool(s.url, "presence.beat", { token: alice.token, agentKind: "claude-code" })
    const aliceSessionId = aliceBeat.sessionId as string

    // Eve somehow learns/computes Alice's deterministic sessionId and tries to ride it with her OWN
    // token — the exact hijack shape presence-ownership.test.ts covers for SSE ids.
    const hijackBeat = await callTool(s.url, "presence.beat", { token: eve.token, sessionId: aliceSessionId, agentKind: "claude-code" })
    expect(hijackBeat.ok).toBe(false)
    expect(hijackBeat.reasons).toEqual(["session not owned by caller"])

    const hijackFocus = await callTool(s.url, "presence.focus", { token: eve.token, sessionId: aliceSessionId, cell: "evil:1" })
    expect(hijackFocus.ok).toBe(false)

    // Alice's presence is untouched.
    const p = s.state.presence.get(aliceSessionId)!
    expect(p.userId).toBe(alice.userId)
    expect(p.focusCell).toBe(null)

    // Eve registering her OWN no-SSE presence works fine and gets her OWN distinct sessionId.
    const eveBeat = await callTool(s.url, "presence.beat", { token: eve.token, agentKind: "claude-code" })
    expect(eveBeat.ok).toBe(true)
    expect(eveBeat.sessionId).not.toBe(aliceSessionId)
  } finally {
    s.stop()
  }
})

test("an empty-string sessionId is still rejected as malformed input (distinct from simply omitting it)", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    await expect(callTool(s.url, "presence.beat", { token: alice.token, sessionId: "" })).rejects.toThrow()
    await expect(callTool(s.url, "presence.focus", { token: alice.token, sessionId: "", cell: "ui:4" })).rejects.toThrow()
  } finally {
    s.stop()
  }
})

// INT-3 payoff: with a no-SSE session now a first-class member of state.sessions, affinity routing
// (affinity.ts sessionsOfUser) finds it for lock.denied, and pushEnvelope's maybeSystemMessage (state.ts)
// renders + persists a system.message for it (agentKind non-"web") — system.pending can then drain it
// from a totally fresh, stateless poll, no live connection required at any point.
test("system.pending delivers the lock.denied notification to a client that only ever used POST /mcp", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")
    const cell = "docs:4"

    await callTool(s.url, "changeset.open", { token: alice.token, cells: [cell], intent: "alice holds it" })

    // Bob registers presence headlessly, declaring a non-web agentKind (required for system.message —
    // same gate an SSE-based non-web client already needs, system-message.ts).
    await callTool(s.url, "presence.beat", { token: bob.token, agentKind: "claude-code" })

    const attempt = await callTool(s.url, "changeset.open", { token: bob.token, cells: [cell], intent: "bob tries" })
    expect(attempt.ok).toBe(false)
    expect(attempt.reason).toBe("cell_locked")

    // Stateless drain — no SSE connection open at all, exactly the fresh-process-per-tool-call shape a
    // Claude Code hook has (system-message.ts's own rationale for system.pending existing).
    const pending = await callTool(s.url, "system.pending", { token: bob.token })
    expect(pending.messages.length).toBe(1)
    expect(pending.messages[0].text).toContain(cell)
    expect(pending.messages[0].text).toContain("open-graph")

    // Drained once — a second poll is empty.
    const second = await callTool(s.url, "system.pending", { token: bob.token })
    expect(second.messages).toEqual([])
  } finally {
    s.stop()
  }
})

// The SSE path must be bit-for-bit identical: this mirrors presence-ownership.test.ts's happy path but
// exists here so a regression in the no-SSE branch of touch() can't silently also break the SSE branch.
test("the SSE path is unchanged: an explicit sessionId still works exactly as before", async () => {
  const { openSse } = await import("./helpers")
  const s = startServer({ focusDebounceMs: 10 })
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")

    const bobSse = await openSse(s.url, 0, bob.token)
    const aliceSse = await openSse(s.url, 0, alice.token)
    const aliceSessionId = aliceSse.events[0].sessionId

    const focus = await callTool(s.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell: "ui:4" })
    expect(focus.ok).toBe(true)
    expect(focus.sessionId).toBe(aliceSessionId) // additive field only — echoes back the caller's own id

    await bobSse.waitFor((e) => e.kind === "user.focused" && e.payload.sessionId === aliceSessionId)

    const who = await callTool(s.url, "presence.who", { token: bob.token, cell: "ui:4" })
    expect(who.users.map((u: any) => u.id)).toEqual([alice.userId])

    aliceSse.close()
    bobSse.close()
  } finally {
    s.stop()
  }
})
