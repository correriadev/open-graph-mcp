import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { rebuildFromJsonl } from "../src/db"
import { callTool, register } from "./helpers"

const count = (s: any, table: string) => (s.state.db.query(`SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id = ?`).get("default") as { c: number }).c

// Proves the canonical rule (ADR §4.1): JSONL is durable truth, SQLite is a rebuildable index.
test("rebuildFromJsonl reconstructs a tenant's SQLite state from the JSONL mirror", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")

    // Populate via changesets: two claim commits + one authority flip on an empty cell (canFlip green).
    for (let i = 0; i < 2; i++) {
      const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: [`d${i}:5`], intent: `t${i}` })
      await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: { kind: "claim.add", payload: { id: `c${i}`, subject: "s", domain: `d${i}`, level: 5, refs: [] } } })
      await callTool(s.url, "changeset.commit", { token: a.token, csId })
    }
    const flipCs = await callTool(s.url, "changeset.open", { token: a.token, cells: ["auth:0"], intent: "flip" })
    await callTool(s.url, "changeset.claim", { token: a.token, csId: flipCs.csId, delta: { kind: "claim.add", payload: { id: "ca", subject: "s", domain: "auth", level: 0, refs: [] } } })
    await callTool(s.url, "changeset.claim", { token: a.token, csId: flipCs.csId, delta: { kind: "authority.flip", payload: { cell: "auth:0", to: "graph" } } })
    const fc = await callTool(s.url, "changeset.commit", { token: a.token, csId: flipCs.csId })
    expect(fc.ok).toBe(true)

    const before = { claims: count(s, "claims"), changesets: count(s, "changesets"), events: count(s, "events") }
    const authBefore = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", "auth:0") as { value: string }
    expect(before.claims).toBe(3)
    expect(authBefore.value).toBe("graph")

    // Nuke SQLite tenant state entirely, then rebuild from JSONL.
    for (const t of ["users", "nodes", "edges", "claims", "authority", "changesets", "cs_deltas", "locks", "events"]) s.state.db.query(`DELETE FROM ${t} WHERE tenant_id = ?`).run("default")
    expect(count(s, "claims")).toBe(0)

    rebuildFromJsonl(s.state.db, s.state.stateDir, "default")

    expect(count(s, "claims")).toBe(before.claims)
    expect(count(s, "changesets")).toBe(before.changesets)
    expect(count(s, "events")).toBe(before.events)
    const authAfter = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", "auth:0") as { value: string }
    expect(authAfter.value).toBe("graph")
  } finally {
    s.stop()
  }
})
