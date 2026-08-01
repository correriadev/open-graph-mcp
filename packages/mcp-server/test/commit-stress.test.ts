import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, register } from "./helpers"

test("concurrent commits serialize: unique monotonic seqs, zero lost deltas, clean locks", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const N = 12

    // Stage N changesets on distinct cells.
    const ids: string[] = []
    for (let i = 0; i < N; i++) {
      const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: [`d${i}:5`], intent: `t${i}` })
      await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: { kind: "claim.add", payload: { id: `c${i}`, subject: "s", domain: `d${i}`, level: 5, refs: [] } } })
      ids.push(csId)
    }

    // Commit ALL concurrently.
    const results = await Promise.all(ids.map((csId) => callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "stress" })))
    expect(results.every((r) => r.ok)).toBe(true)

    const admitSeqs = results.map((r) => r.admitSeq)
    expect(new Set(admitSeqs).size).toBe(N) // unique per tenant

    // Global event seqs are unique & monotonic (PK (tenant,seq) + per-tenant counter).
    const seqs = (s.state.db.query("SELECT seq FROM events WHERE tenant_id = ? ORDER BY seq").all("default") as { seq: number }[]).map((r) => r.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1])

    // Zero lost deltas: one claim admitted per changeset; no locks left over.
    const claims = (s.state.db.query("SELECT COUNT(*) AS c FROM claims WHERE tenant_id = ?").get("default") as { c: number }).c
    expect(claims).toBe(N)
    const locks = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ?").get("default") as { c: number }).c
    expect(locks).toBe(0)

    // Same-cell race: two users open the same cell concurrently → exactly one wins.
    const b = await register(s.url, "bob")
    const [ra, rb] = await Promise.all([
      callTool(s.url, "changeset.open", { token: a.token, cells: ["race:5"], intent: "ra" }),
      callTool(s.url, "changeset.open", { token: b.token, cells: ["race:5"], intent: "rb" }),
    ])
    expect([ra.ok, rb.ok].filter(Boolean).length).toBe(1)
  } finally {
    s.stop()
  }
})
