import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

// QA-3 DoD: web + non-web (opencode et al.) observing the SAME event, over the SAME server. Web gets the
// raw envelope only (toasts render it client-side, Task 4); non-web gets the raw envelope PLUS a pt-BR
// `system.message` (system-message.ts renders it server-side, since non-web has no canvas/toasts). The
// existing system-message.test.ts already covers this shape for changeset.opened and lock.denied — this
// file extends it to the other two DoD-named kinds (changeset.committed, authority.flipped) plus the
// TTL-abort scenario and the unknown-agentKind gate.

async function declareAgentKind(base: string, sse: Awaited<ReturnType<typeof openSse>>, token: string, agentKind: string) {
  const sessionId = sse.events[0].sessionId
  await callTool(base, "presence.beat", { token, sessionId, agentKind })
}

test("changeset.committed: non-web gets envelope + system.message, web gets envelope only", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice") // holder, commits
    const bob = await register(s.url, "bob") // non-web observer
    const carol = await register(s.url, "carol") // web observer

    const bobSse = await openSse(s.url, 0, bob.token, "cell:commitcell:4")
    const carolSse = await openSse(s.url, 0, carol.token, "cell:commitcell:4")
    await declareAgentKind(s.url, bobSse, bob.token, "opencode")
    await declareAgentKind(s.url, carolSse, carol.token, "web")

    const { csId } = await callTool(s.url, "changeset.open", { token: alice.token, cells: ["commitcell:4"], intent: "cross-client commit" })
    const commit = await callTool(s.url, "changeset.commit", { token: alice.token, csId, intent: "cross-client commit" })
    expect(commit.ok).toBe(true)

    // bob is cell-filtered, so he also received the earlier changeset.opened system.message
    // ("... abriu turno ...") — disambiguate to the commit-specific one.
    const sysMsg = await bobSse.waitFor((e) => e.kind === "system.message" && e.payload.text.includes("commitou"))
    expect(sysMsg.payload.text).toContain("[open-graph]")
    expect(sysMsg.payload.text).toContain(csId)
    expect(sysMsg.payload.text).toContain("commitcell:4")

    // Sentinel instead of a sleep: wait for Carol's OWN copy of the commit envelope (she's cell-filtered
    // like Bob). pushEnvelope's per-recipient loop is synchronous, and frames on one SSE connection
    // arrive in write order — once her changeset.committed lands, the (skipped, she's web) system.message
    // decision for this same envelope has already been made, provably, with no clock dependency.
    await carolSse.waitFor((e) => e.kind === "changeset.committed")
    expect(carolSse.events.some((e) => e.kind === "system.message")).toBe(false)
    expect(carolSse.events.some((e) => e.kind === "changeset.committed")).toBe(true)

    bobSse.close()
    carolSse.close()
  } finally {
    s.stop()
  }
})

test("authority.flipped: non-web gets envelope + system.message, web gets envelope only", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice") // flips
    const bob = await register(s.url, "bob") // non-web observer
    const carol = await register(s.url, "carol") // web observer
    const cell = "flipcell:5"

    const bobSse = await openSse(s.url)
    const carolSse = await openSse(s.url)
    await declareAgentKind(s.url, bobSse, bob.token, "opencode")
    await declareAgentKind(s.url, carolSse, carol.token, "web")

    const flip = await callTool(s.url, "authority.flip", { token: alice.token, cell, to: "graph" })
    expect(flip.ok).toBe(true)

    const sysMsg = await bobSse.waitFor((e) => e.kind === "system.message")
    expect(sysMsg.payload.text).toContain("[open-graph]")
    expect(sysMsg.payload.text).toContain(cell)
    expect(sysMsg.payload.text).toContain("graph")

    // Sentinel instead of a sleep: authority.flipped is ALWAYS_BROADCAST (state.ts), so Carol's stream
    // (unfiltered SSE) also receives it from the very same envelope. Waiting for her copy proves the
    // (skipped, she's web) system.message decision for it has already resolved — same connection, same
    // write-ordered delivery.
    await carolSse.waitFor((e) => e.kind === "authority.flipped")
    expect(carolSse.events.some((e) => e.kind === "system.message")).toBe(false)
    expect(carolSse.events.some((e) => e.kind === "authority.flipped")).toBe(true)

    bobSse.close()
    carolSse.close()
  } finally {
    s.stop()
  }
})

test("TTL abort while a non-web holder and a web observer both watch: opencode gets 'seu changeset abortado', web gets the raw changeset.aborted envelope", async () => {
  const s = startServer({ ttlMs: 1 }) // deterministic — see ttl-expire.test.ts's pattern
  try {
    const alice = await register(s.url, "alice") // opencode holder, loses the turn to TTL
    const bob = await register(s.url, "bob") // web, observes by event kind (§6.1: changeset.aborted
    // routes to cs_id-observers + holder only — NEVER cell-observers, so bob's filter can't be "cell:…")

    const aliceSse = await openSse(s.url, 0, alice.token)
    const bobSse = await openSse(s.url, 0, bob.token, "event:changeset.aborted")
    await declareAgentKind(s.url, aliceSse, alice.token, "opencode")
    await declareAgentKind(s.url, bobSse, bob.token, "web")

    const { csId } = await callTool(s.url, "changeset.open", { token: alice.token, cells: ["ttlcell:4"], intent: "opencode turn" })

    // No sleep needed: sweepTtl compares against a REAL wall clock (`expires_at < now()`, sweeper.ts),
    // and ttlMs:1 has already elapsed by the time the several awaited RPC round-trips above (register,
    // openSse x2, presence.beat x2, changeset.open) return — s.sweep() is the deterministic knob (prod
    // runs this on an interval, same pattern as ttl-expire.test.ts), the sleep before it was redundant.
    s.sweep()

    const sysMsg = await aliceSse.waitFor((e) => e.kind === "system.message")
    expect(sysMsg.payload.text).toContain("[open-graph]")
    expect(sysMsg.payload.text).toContain("Seu changeset")
    expect(sysMsg.payload.text).toContain(csId)
    expect(sysMsg.payload.text).toContain("TTL")

    const abortEvt = await bobSse.waitFor((e) => e.kind === "changeset.aborted" && e.payload.csId === csId)
    expect(abortEvt.payload.reason).toBe("ttl_expired")
    expect(bobSse.events.some((e) => e.kind === "system.message")).toBe(false)

    aliceSse.close()
    bobSse.close()
  } finally {
    s.stop()
  }
})

test("a session with NO declared agentKind (never called presence.beat/focus) never receives system.message, even for an event it's routed to receive", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")

    // Bob's SSE is open and filtered to the cell — the affinity router WILL route the raw envelope to
    // him — but he never calls presence.beat/focus, so state.presence has no record for his session at
    // all. system-message.ts's gate (`!presence || presence.agentKind === "web"`) must treat "no
    // presence yet" as "unknown, not non-web" and stay silent, same as an explicit agentKind:"web".
    const bobSse = await openSse(s.url, 0, bob.token, "cell:unknownkind:4")

    await callTool(s.url, "changeset.open", { token: alice.token, cells: ["unknownkind:4"], intent: "unknown agentKind gate" })

    const envelope = await bobSse.waitFor((e) => e.kind === "changeset.opened")
    expect(envelope.payload.cells).toEqual(["unknownkind:4"])

    // No sleep needed: waiting for bob's changeset.opened frame above already proves the (synchronous,
    // same-envelope) maybeSystemMessage decision for him — no presence yet — has resolved and, if a
    // system.message had been queued for him, it would already be in his event list (write-ordered
    // delivery on the same connection).
    expect(bobSse.events.some((e) => e.kind === "system.message")).toBe(false)

    bobSse.close()
  } finally {
    s.stop()
  }
})
