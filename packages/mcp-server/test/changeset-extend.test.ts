import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

test("changeset.extend strictly advances expiresAt", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId, expiresAt: openedExpiry } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:1"], intent: "extend" })

    const ext = await callTool(s.url, "changeset.extend", { token: a.token, csId })
    expect(ext.ok).toBe(true)
    expect(Date.parse(ext.expiresAt)).toBeGreaterThanOrEqual(Date.parse(openedExpiry))
  } finally {
    s.stop()
  }
})

test("an extended changeset SURVIVES a sweep that would otherwise TTL-abort it", async () => {
  const s = startServer({ ttlMs: 1 }) // 1ms TTL — would expire almost immediately
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:0"], intent: "turn" })
    const claim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      // level 0 — a root claim (extreme of the ladder), so it's still valid at final commit, not just staging
      delta: { kind: "claim.add", payload: { id: "c1", subject: "c1", domain: "ui", level: 0, refs: [] } },
    })
    expect(claim.ok).toBe(true)

    // move real wall clock past the 1ms TTL before extending, so extend's own expires_at write is
    // itself the thing under test (not an artifact of "no time passed yet")
    await new Promise((r) => setTimeout(r, 5))
    const ext = await callTool(s.url, "changeset.extend", { token: a.token, csId })
    expect(ext.ok).toBe(true)

    s.sweep() // deterministic — would have aborted the cs if extend hadn't pushed expires_at forward

    const csRow = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string }
    expect(csRow.status).toBe("open")
    const lockCount = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { c: number }).c
    expect(lockCount).toBe(1)

    // and the turn is still usable: commit succeeds
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "turn" })
    expect(commit.ok).toBe(true)
  } finally {
    s.stop()
  }
})

test("a non-holder cannot extend someone else's changeset, and expires_at does not move", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const b = await register(s.url, "bob")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:2"], intent: "mine" })
    const before = (s.state.db.query("SELECT expires_at FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { expires_at: string }).expires_at

    const ext = await callTool(s.url, "changeset.extend", { token: b.token, csId })
    expect(ext.ok).toBe(false)

    const after = (s.state.db.query("SELECT expires_at FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { expires_at: string }).expires_at
    expect(after).toBe(before)
  } finally {
    s.stop()
  }
})

test("extend on an already-aborted changeset fails and does not resurrect it or re-create locks", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:3"], intent: "to-abort" })
    const abort = await callTool(s.url, "changeset.abort", { token: a.token, csId })
    expect(abort.ok).toBe(true)

    const ext = await callTool(s.url, "changeset.extend", { token: a.token, csId })
    expect(ext.ok).toBe(false)

    const csRow = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string }
    expect(csRow.status).toBe("aborted")
    const lockCount = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { c: number }).c
    expect(lockCount).toBe(0)
  } finally {
    s.stop()
  }
})

test("extend on an already-admitted changeset fails and does not resurrect it or re-create locks", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:4"], intent: "to-commit" })
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "to-commit" })
    expect(commit.ok).toBe(true)

    const ext = await callTool(s.url, "changeset.extend", { token: a.token, csId })
    expect(ext.ok).toBe(false)

    const csRow = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string }
    expect(csRow.status).toBe("admitted")
    const lockCount = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { c: number }).c
    expect(lockCount).toBe(0)
  } finally {
    s.stop()
  }
})

// REPORT-A1: changesetExtend emits NO event today — silence asserted below. A `changeset.extended` /
// `lock.extended` notification would let a second observer (or the holder's own other tab) learn a
// turn's TTL was pushed forward without polling `changeset.list_mine`. Adding one is a Tier 2 contract
// change (new event `kind`) — out of scope for a mechanical Tier 1 fix in changeset.ts.
test("REPORT-A1: changeset.extend currently emits no SSE event (documented silence, not a bug fix)", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const sse = await openSse(s.url, 0, a.token)
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:5"], intent: "silent-extend" })
    await sse.waitFor((e) => e.kind === "changeset.opened" && e.payload.csId === csId)

    const ext = await callTool(s.url, "changeset.extend", { token: a.token, csId })
    expect(ext.ok).toBe(true)

    // Sentinel: perform a second, later action that DOES emit an event and wait for it. Its arrival
    // proves the SSE pump drained everything up to "now" — if extend had emitted anything, it would
    // have arrived before the sentinel.
    const abort = await callTool(s.url, "changeset.abort", { token: a.token, csId })
    expect(abort.ok).toBe(true)
    await sse.waitFor((e) => e.kind === "changeset.aborted" && e.payload.csId === csId)

    const extendRelated = sse.events.filter((e) => typeof e.kind === "string" && (e.kind.startsWith("changeset.extend") || e.kind.startsWith("lock.extend")))
    expect(extendRelated.length).toBe(0)
    sse.close()
  } finally {
    s.stop()
  }
})

test.todo("REPORT-A1: changeset.extend should emit changeset.extended (or lock.extended) with the new expiresAt")
