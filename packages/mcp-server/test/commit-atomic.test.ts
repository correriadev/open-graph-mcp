import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, readResource, register } from "./helpers"

const claim = (id: string, refs: string[] = []) => ({ kind: "claim.add", payload: { id, subject: id, domain: "ui", level: 5, refs } })

test("commit fails atomically when one delta breaks the ladder — no delta is admitted", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:5"], intent: "atomicity" })

    // 3 valid root claims stage cleanly...
    for (const id of ["c1", "c2", "c3"]) {
      const r = await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: claim(id) })
      expect(r.ok).toBe(true)
    }
    // ...and 1 with a dangling ref: the incremental gate only WARNS (spec §5.2), it still stages.
    const bad = await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: claim("c4", ["ghost"]) })
    expect(bad.ok).toBe(true)
    expect(bad.warnings.length).toBeGreaterThan(0)

    // The final gate (§5.3) is the hard wall: the whole changeset is rejected atomically.
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "atomicity" })
    expect(commit.ok).toBe(false)
    expect(commit.reasons.some((r: string) => r.includes("dangling-ref"))).toBe(true)

    // Rollback total: NENHUM claim foi persistido; o changeset ficou 'aborted'.
    const claimsInDb = (s.state.db.query("SELECT COUNT(*) AS c FROM claims WHERE tenant_id = ?").get("default") as { c: number }).c
    expect(claimsInDb).toBe(0)
    const view = await readResource(s.url, `graph://changeset/${csId}`, a.token)
    expect(view.status).toBe("aborted")
  } finally {
    s.stop()
  }
})
