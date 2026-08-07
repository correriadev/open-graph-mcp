import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

test("bob cannot claim into alice's changeset: exact refusal, zero side effects", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const b = await register(s.url, "bob")
    const sse = await openSse(s.url, 0, a.token)
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:1"], intent: "alice's turn" })
    await sse.waitFor((e) => e.kind === "changeset.opened" && e.payload.csId === csId)

    const claim = await callTool(s.url, "changeset.claim", {
      token: b.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "c1", subject: "c1", domain: "ui", level: 1, refs: [] } },
    })
    expect(claim.ok).toBe(false)
    expect(claim.reasons).toEqual(["not the holder of this changeset"])

    // zero side effects: cs still open, lock unmoved, no claim staged, no delta count bumped
    const csRow = s.state.db.query("SELECT status, opened_by FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string; opened_by: string }
    expect(csRow.status).toBe("open")
    expect(csRow.opened_by).toBe(a.userId)
    const deltaCount = (s.state.db.query("SELECT COUNT(*) AS c FROM cs_deltas WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { c: number }).c
    expect(deltaCount).toBe(0)

    // sentinel: alice aborts (a later, known event) — its arrival proves no event leaked from bob's attempt
    const abort = await callTool(s.url, "changeset.abort", { token: a.token, csId })
    expect(abort.ok).toBe(true)
    await sse.waitFor((e) => e.kind === "changeset.aborted" && e.payload.csId === csId)
    const claimRelated = sse.events.filter((e) => typeof e.kind === "string" && e.kind.startsWith("claim."))
    expect(claimRelated.length).toBe(0)
    sse.close()
  } finally {
    s.stop()
  }
})

test("bob cannot commit alice's changeset: exact refusal, zero side effects", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const b = await register(s.url, "bob")
    const sse = await openSse(s.url, 0, a.token)
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:2"], intent: "alice's turn" })
    await sse.waitFor((e) => e.kind === "changeset.opened" && e.payload.csId === csId)

    const commit = await callTool(s.url, "changeset.commit", { token: b.token, csId, intent: "steal it" })
    expect(commit.ok).toBe(false)
    expect(commit.reasons).toEqual(["not the holder of this changeset"])

    const csRow = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string }
    expect(csRow.status).toBe("open")
    const lockCount = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { c: number }).c
    expect(lockCount).toBe(1)

    // sentinel
    const abort = await callTool(s.url, "changeset.abort", { token: a.token, csId })
    expect(abort.ok).toBe(true)
    await sse.waitFor((e) => e.kind === "changeset.aborted" && e.payload.csId === csId)
    const committedEvt = sse.events.find((e) => e.kind === "changeset.committed" && e.payload.csId === csId)
    expect(committedEvt).toBeUndefined()
    sse.close()
  } finally {
    s.stop()
  }
})

test("bob cannot abort alice's changeset: {ok:false}, zero side effects", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const b = await register(s.url, "bob")
    const sse = await openSse(s.url, 0, a.token)
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:3"], intent: "alice's turn" })
    await sse.waitFor((e) => e.kind === "changeset.opened" && e.payload.csId === csId)

    const abortAttempt = await callTool(s.url, "changeset.abort", { token: b.token, csId })
    expect(abortAttempt.ok).toBe(false)

    const csRow = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string }
    expect(csRow.status).toBe("open")
    const lockCount = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { c: number }).c
    expect(lockCount).toBe(1)

    // sentinel: alice's own abort must be the first changeset.aborted seen
    const abort = await callTool(s.url, "changeset.abort", { token: a.token, csId })
    expect(abort.ok).toBe(true)
    const aborted = await sse.waitFor((e) => e.kind === "changeset.aborted" && e.payload.csId === csId)
    expect(aborted.payload.byUser).toBe(a.userId)
    const abortedEvents = sse.events.filter((e) => e.kind === "changeset.aborted" && e.payload.csId === csId)
    expect(abortedEvents.length).toBe(1)
    sse.close()
  } finally {
    s.stop()
  }
})

test("bob cannot extend alice's changeset: {ok:false}, zero side effects", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const b = await register(s.url, "bob")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:4"], intent: "alice's turn" })
    const before = (s.state.db.query("SELECT expires_at FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { expires_at: string }).expires_at

    const extendAttempt = await callTool(s.url, "changeset.extend", { token: b.token, csId })
    expect(extendAttempt.ok).toBe(false)

    const after = (s.state.db.query("SELECT expires_at FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { expires_at: string }).expires_at
    expect(after).toBe(before)
    const status = (s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string }).status
    expect(status).toBe("open")
  } finally {
    s.stop()
  }
})
