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

    await callTool(s.url, "changeset.open", { token: alice.token, cells: ["ui:4"], intent: "notify test" })

    const sysMsg = await bobSse.waitFor((e) => e.kind === "system.message")
    expect(sysMsg.payload.text).toContain("[open-graph]")
    expect(sysMsg.payload.text).toContain("ui:4")
    expect(sysMsg.ephemeral).toBe(true)

    // Give Carol's (web) stream the same settle time — she must never receive this kind.
    await new Promise((r) => setTimeout(r, 50))
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
