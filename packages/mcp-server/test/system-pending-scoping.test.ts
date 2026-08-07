/**
 * system-pending-scoping.test.ts — WS-D. `system.pending { token }` (src/system-message.ts) drains a
 * per-(tenant,user) queue keyed by `requireToken`'s resolved { userId, tenantId }. Nothing today asserts
 * the authz boundary a beta reviewer asks about first: can Bob drain Alice's queue? Are two users named
 * the same but in different tenants actually distinct? What's the ordering/drain-once behavior across
 * multiple pending messages? What does an empty drain return?
 *
 * Pre-classified Tier 3 (see docs/roadmap-server-beta/00-scope-sb-0-hardening-servidor.md §4): systemPending
 * does read-then-delete against SQLite with NO transaction wrapping the two statements — a crash between
 * the SELECT and the DELETE either loses the message (if the crash is after delivery but the caller never
 * gets the response) or, worse, a concurrent second `system.pending` call from a racing second process for
 * the same user could observe rows that are about to be deleted out from under it. Not fixed here: it's
 * transaction semantics living conceptually next to `db.ts`'s transaction helpers, which belong to WS-F.
 * Reported below as REPORT-D3.
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

test("system.pending vazio devolve messages: []", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const result = await callTool(s.url, "system.pending", { token: alice.token })
    expect(result).toEqual({ messages: [] })
  } finally {
    s.stop()
  }
})

test("Bob NÃO drena a fila da Alice: system.pending é escopado por userId, não compartilhado no tenant", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")

    // Give Alice a queued message: open a changeset she'd be notified about via a third party, using
    // the same event-driven path the existing system-message tests use (changeset.opened on an observed
    // cell). Simpler and still faithful to production: have carol open a turn Alice is watching.
    const carol = await register(s.url, "carol")
    const aliceSse = await openSse(s.url, 0, alice.token, "cell:ui:9")
    const aliceSessionId = aliceSse.events[0].sessionId
    await callTool(s.url, "presence.beat", { token: alice.token, sessionId: aliceSessionId, agentKind: "opencode" })
    await callTool(s.url, "changeset.open", { token: carol.token, cells: ["ui:9"], intent: "notify test" })
    await aliceSse.waitFor((e) => e.kind === "system.message")
    aliceSse.close()

    // Bob polls first — he must get nothing, and critically, must NOT consume Alice's message.
    const bobDrain = await callTool(s.url, "system.pending", { token: bob.token })
    expect(bobDrain).toEqual({ messages: [] })

    // Alice's message must still be there.
    const aliceDrain = await callTool(s.url, "system.pending", { token: alice.token })
    expect(aliceDrain.messages.length).toBe(1)
    expect(aliceDrain.messages[0].text).toContain("ui:9")
  } finally {
    s.stop()
  }
})

test("cross-tenant: dois users com o MESMO name em tenants diferentes têm filas distintas", async () => {
  const s = startServer()
  try {
    const aliceAcme = await register(s.url, "alice", "acme")
    const aliceZeta = await register(s.url, "alice", "zeta")
    expect(aliceAcme.userId).not.toBe(aliceZeta.userId) // userId hashes tenant+name — distinct identities
    expect(aliceAcme.tenantId).toBe("acme")
    expect(aliceZeta.tenantId).toBe("zeta")

    const carolAcme = await register(s.url, "carol", "acme")

    const aliceAcmeSse = await openSse(s.url, 0, aliceAcme.token, "cell:ui:10")
    const aliceAcmeSessionId = aliceAcmeSse.events[0].sessionId
    await callTool(s.url, "presence.beat", { token: aliceAcme.token, sessionId: aliceAcmeSessionId, agentKind: "opencode" })
    await callTool(s.url, "changeset.open", { token: carolAcme.token, cells: ["ui:10"], intent: "notify test" })
    await aliceAcmeSse.waitFor((e) => e.kind === "system.message")
    aliceAcmeSse.close()

    // Alice-in-zeta must see nothing: same display name, different tenant, different userId, different queue.
    const zetaDrain = await callTool(s.url, "system.pending", { token: aliceZeta.token })
    expect(zetaDrain).toEqual({ messages: [] })

    const acmeDrain = await callTool(s.url, "system.pending", { token: aliceAcme.token })
    expect(acmeDrain.messages.length).toBe(1)
  } finally {
    s.stop()
  }
})

test("múltiplas mensagens pendentes: ordem oldest-first e drenagem única (segunda chamada vem vazia)", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")
    const carol = await register(s.url, "carol")

    // No filter: alice observes every kind, from every cell — sidesteps affinity.ts's deliberate
    // restriction of changeset.aborted routing to cs_id observers only (spec §6.1, NOT cell observers),
    // which would otherwise make an abort-based second event invisible to a cell-scoped subscriber.
    const aliceSse = await openSse(s.url, 0, alice.token)
    const aliceSessionId = aliceSse.events[0].sessionId
    await callTool(s.url, "presence.beat", { token: alice.token, sessionId: aliceSessionId, agentKind: "opencode" })

    // Two separate events, in a known order, on two different cells Alice observes ambiently.
    await callTool(s.url, "changeset.open", { token: bob.token, cells: ["ui:11"], intent: "first" })
    await aliceSse.waitFor((e) => e.kind === "system.message" && e.payload.text.includes("bob"))

    await callTool(s.url, "changeset.open", { token: carol.token, cells: ["ui:12"], intent: "second" })
    await aliceSse.waitFor((e) => e.kind === "system.message" && e.payload.text.includes("carol"))
    aliceSse.close()

    const drain = await callTool(s.url, "system.pending", { token: alice.token })
    expect(drain.messages.length).toBe(2)
    // oldest first: bob's open, then carol's open.
    expect(drain.messages[0].text).toContain("bob")
    expect(drain.messages[0].text).toContain("ui:11")
    expect(drain.messages[1].text).toContain("carol")
    expect(drain.messages[1].text).toContain("ui:12")

    // drain-once: a second call sees nothing left.
    const second = await callTool(s.url, "system.pending", { token: alice.token })
    expect(second).toEqual({ messages: [] })
  } finally {
    s.stop()
  }
})

// REPORT-D3 (Tier 3, pre-classified — do not fix, escalate): system.pending's read-then-delete against
// SQLite (system-message.ts systemPending) is two separate statements with no transaction around them.
// This test documents the DESIRED behavior (atomic drain) as a todo rather than attempting a fix — the
// fix is `db.ts` transaction-helper territory, owned by WS-F.
test.todo("REPORT-D3: system.pending drena atomicamente (SELECT+DELETE numa única transação, sem janela de perda entre as duas)")
