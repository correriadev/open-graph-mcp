import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

// Fase 3 §8.1: non-web MCP sessions (opencode et al.) have no canvas — relevant events must also arrive
// as a human-readable pt-BR `system.message { text }` envelope, gated to sessions whose declared
// agentKind isn't "web". Web sessions get toasts (Task 4) instead and must NEVER see this kind.
test("non-web session gets a pt-BR system.message for a relevant event; web session does not", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice") // holder — opens the turno
    const bob = await register(s.url, "bob") // non-web observer of the same cell
    const carol = await register(s.url, "carol") // web observer of the same cell

    const bobSse = await openSse(s.url, 0, bob.token, "cell:ui:4")
    const carolSse = await openSse(s.url, 0, carol.token, "cell:ui:4")
    const bobSessionId = bobSse.events[0].sessionId
    const carolSessionId = carolSse.events[0].sessionId

    // Declare agentKind BEFORE the event fires — system.message gating reads Presence.agentKind, which
    // only exists after the first presence-registering call (spec §3; documented in system-message.ts).
    await callTool(s.url, "presence.beat", { token: bob.token, sessionId: bobSessionId, agentKind: "opencode" })
    await callTool(s.url, "presence.beat", { token: carol.token, sessionId: carolSessionId, agentKind: "web" })

    const opened = await callTool(s.url, "changeset.open", { token: alice.token, cells: ["ui:4"], intent: "notify test" })

    const sysMsg = await bobSse.waitFor((e) => e.kind === "system.message")
    expect(sysMsg.payload.text).toContain("[open-graph]")
    expect(sysMsg.payload.text).toContain("ui:4")
    expect(sysMsg.ephemeral).toBe(true)

    // Sentinel instead of a sleep: commit the same changeset — Carol (cell-filtered, web) receives
    // changeset.committed over the SAME connection. pushEnvelope's per-recipient loop (state.ts) is
    // synchronous — her push and the (skipped, she's web) system.message decision for THIS commit
    // envelope both happen before the RPC call below even returns. Frames on one SSE connection arrive
    // in write order, so once her committed frame lands client-side, absence of system.message from the
    // changeset.open above is provable without waiting on a clock.
    const commit = await callTool(s.url, "changeset.commit", { token: alice.token, csId: opened.csId, intent: "notify test" })
    expect(commit.ok).toBe(true)
    await carolSse.waitFor((e) => e.kind === "changeset.committed")
    expect(carolSse.events.some((e) => e.kind === "system.message")).toBe(false)
    // ...but she still gets the raw event (toasts consume it, Task 4).
    expect(carolSse.events.some((e) => e.kind === "changeset.opened")).toBe(true)

    bobSse.close()
    carolSse.close()
  } finally {
    s.stop()
  }
})

test("lock.denied system.message reaches only the non-web session that attempted the lock", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")

    await callTool(s.url, "changeset.open", { token: alice.token, cells: ["ui:5"], intent: "holds it" })

    const bobSse = await openSse(s.url, 0, bob.token)
    const bobSessionId = bobSse.events[0].sessionId
    await callTool(s.url, "presence.beat", { token: bob.token, sessionId: bobSessionId, agentKind: "cursor" })

    const denied = await callTool(s.url, "changeset.open", { token: bob.token, cells: ["ui:5"], intent: "tries and fails" })
    expect(denied.ok).toBe(false)

    const sysMsg = await bobSse.waitFor((e) => e.kind === "system.message")
    expect(sysMsg.payload.text).toContain("ui:5")

    bobSse.close()
  } finally {
    s.stop()
  }
})

// INT-3: a Claude Code hook is a fresh, short-lived process — it can't read the `--live` proxy's
// in-memory SSE stream. `system.pending { token }` persists rendered system.message text server-side
// so a stateless poll (same pattern as the other INT-3 hooks: curl + on-disk credentials) can retrieve
// what it missed, independent of whether a live connection is even open at poll time. Drain semantics:
// a message returned once is consumed (deleted) and won't be returned again.
test("system.pending persists a rendered system.message for stateless poll-based drain, once", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")

    const bobSse = await openSse(s.url, 0, bob.token, "cell:ui:6")
    const bobSessionId = bobSse.events[0].sessionId
    await callTool(s.url, "presence.beat", { token: bob.token, sessionId: bobSessionId, agentKind: "opencode" })

    await callTool(s.url, "changeset.open", { token: alice.token, cells: ["ui:6"], intent: "notify test" })
    await bobSse.waitFor((e) => e.kind === "system.message")

    const first = await callTool(s.url, "system.pending", { token: bob.token })
    expect(first.messages.length).toBe(1)
    expect(first.messages[0].text).toContain("ui:6")

    const second = await callTool(s.url, "system.pending", { token: bob.token })
    expect(second.messages).toEqual([])

    bobSse.close()
  } finally {
    s.stop()
  }
})
