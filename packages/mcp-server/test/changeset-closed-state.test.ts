import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, register } from "./helpers"

test("double-commit: second commit is a clean refusal, no crash, no partial write", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:1"], intent: "first" })
    const commit1 = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "first" })
    expect(commit1.ok).toBe(true)

    const commit2 = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "second" })
    expect(commit2.ok).toBe(false)
    expect(commit2.reasons).toEqual([`changeset ${csId} not open`])

    const csRow = s.state.db.query("SELECT status, admit_seq FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string; admit_seq: number }
    expect(csRow.status).toBe("admitted")
    expect(csRow.admit_seq).toBe(commit1.admitSeq) // unchanged by the second attempt
  } finally {
    s.stop()
  }
})

test("claim after commit is refused cleanly, without resurrecting the changeset", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:2"], intent: "done" })
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "done" })
    expect(commit.ok).toBe(true)

    const claim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "c1", subject: "c1", domain: "ui", level: 1, refs: [] } },
    })
    expect(claim.ok).toBe(false)
    expect(claim.reasons).toEqual([`changeset ${csId} not open`])

    const csRow = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string }
    expect(csRow.status).toBe("admitted")
  } finally {
    s.stop()
  }
})

// The highest-value case in this file: the classic client-retry-after-TTL scenario. A client opens a
// turn, network hiccups, the server's sweeper TTL-aborts the cs while the client is still "working" on
// it locally, and only later does the client retry its commit call. That retry must be a clean refusal
// — never a crash, never a partial admit.
test("commit after sweep() TTL-aborted the cs: clean refusal, no crash, no partial write (client-retry-after-TTL)", async () => {
  const s = startServer({ ttlMs: 1 })
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:3"], intent: "will-expire" })
    const claim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "c1", subject: "c1", domain: "ui", level: 3, refs: [] } },
    })
    expect(claim.ok).toBe(true)

    await new Promise((r) => setTimeout(r, 20)) // move real wall clock past the 1ms TTL
    s.sweep() // deterministic — TTL-aborts the cs exactly like production's interval would

    const csRowBefore = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string }
    expect(csRowBefore.status).toBe("aborted")

    // the client, unaware, retries its commit
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "will-expire" })
    expect(commit.ok).toBe(false)
    expect(commit.reasons).toEqual([`changeset ${csId} not open`])

    // no partial write: the staged claim never became a real claim, status still 'aborted'
    const claimsInDb = (s.state.db.query("SELECT COUNT(*) AS c FROM claims WHERE tenant_id = ?").get("default") as { c: number }).c
    expect(claimsInDb).toBe(0)
    const csRowAfter = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string }
    expect(csRowAfter.status).toBe("aborted")
  } finally {
    s.stop()
  }
})

test("abort after abort is a clean refusal, not a crash", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:4"], intent: "abort-twice" })
    const abort1 = await callTool(s.url, "changeset.abort", { token: a.token, csId })
    expect(abort1.ok).toBe(true)

    const abort2 = await callTool(s.url, "changeset.abort", { token: a.token, csId })
    expect(abort2.ok).toBe(false)

    const csRow = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { status: string }
    expect(csRow.status).toBe("aborted")
  } finally {
    s.stop()
  }
})
