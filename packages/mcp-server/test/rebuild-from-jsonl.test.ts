import { expect, test } from "bun:test"
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { startServer } from "../src/index"
import { rebuildFromJsonl } from "../src/db"
import { invalidateClaimsCache } from "../src/store"
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
    invalidateClaimsCache(s.state, "default")

    expect(count(s, "claims")).toBe(before.claims)
    expect(count(s, "changesets")).toBe(before.changesets)
    expect(count(s, "events")).toBe(before.events)
    const authAfter = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", "auth:0") as { value: string }
    expect(authAfter.value).toBe("graph")
  } finally {
    s.stop()
  }
})

test("legacy numeric claim levels replay canonically and invalid replay rolls back atomically", () => {
  const s = startServer()
  try {
    const file = path.join(s.state.stateDir, "tenants", "default", "claims.jsonl")
    mkdirSync(path.dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify({ tenant_id: "default", id: "legacy-number", seq: 1, subject: "n", domain: "legacy", level: 4, refs: "[]", anchor: null, file: null }) + "\n")
    appendFileSync(file, JSON.stringify({ tenant_id: "default", id: "legacy-string", seq: 2, subject: "s", domain: "legacy", level: "4", refs: "[]", anchor: null, file: null }) + "\n")
    rebuildFromJsonl(s.state.db, s.state.stateDir, "default")
    expect((s.state.db.query("SELECT GROUP_CONCAT(level) AS levels FROM claims WHERE tenant_id = ? ORDER BY seq").get("default") as any).levels).toBe("P4,P4")

    appendFileSync(file, JSON.stringify({ tenant_id: "default", id: "invalid", seq: 3, subject: "bad", domain: "legacy", level: "P9", refs: "[]", anchor: null, file: null }) + "\n")
    expect(() => rebuildFromJsonl(s.state.db, s.state.stateDir, "default")).toThrow("claim.add: invalid level")
    expect((s.state.db.query("SELECT COUNT(*) AS count FROM claims WHERE tenant_id = ?").get("default") as any).count).toBe(2)
    expect(s.state.db.query("SELECT id FROM claims WHERE tenant_id = ? AND id = ?").get("default", "invalid")).toBeNull()
    expect(readFileSync(file, "utf8")).toContain('"level":"P9"')
  } finally { s.stop() }
})

test("rebuild rejects foreign tenant rows before changing prior state", () => {
  for (const table of ["users", "nodes", "edges", "claims", "authority", "changesets", "cs_deltas", "events"]) {
    const s = startServer()
    try {
      s.state.db.query("INSERT INTO users (tenant_id,id,name,created_at) VALUES (?,?,?,?)").run("default", "sentinel", "sentinel", "now")
      const file = path.join(s.state.stateDir, "tenants", "default", `${table}.jsonl`)
      mkdirSync(path.dirname(file), { recursive: true })
      appendFileSync(file, JSON.stringify({ tenant_id: "foreign" }) + "\n")
      expect(() => rebuildFromJsonl(s.state.db, s.state.stateDir, "default")).toThrow("recovery tenant mismatch")
      expect(s.state.db.query("SELECT id FROM users WHERE tenant_id=?").get("default")).toEqual({ id: "sentinel" })
      expect((s.state.db.query(`SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id=?`).get("foreign") as any).c).toBe(0)
    } finally { s.stop() }
  }
})

test("malformed middle or truncated final recovery preserves prior state", () => {
  for (const suffix of ["{broken\n", '{"tenant_id":"default"']) {
    const s = startServer()
    try {
      s.state.db.query("INSERT INTO claims (tenant_id,id,seq,domain,level,refs) VALUES (?,?,?,?,?,?)").run("default", "sentinel", 7, "d", "P4", "[]")
      const file = path.join(s.state.stateDir, "tenants", "default", "claims.jsonl")
      mkdirSync(path.dirname(file), { recursive: true })
      appendFileSync(file, JSON.stringify({ tenant_id: "default", id: "candidate", seq: 1, domain: "d", level: 4, refs: "[]" }) + "\n" + suffix)
      expect(() => rebuildFromJsonl(s.state.db, s.state.stateDir, "default")).toThrow()
      expect(s.state.db.query("SELECT id,level FROM claims WHERE tenant_id=?").all("default")).toEqual([{ id: "sentinel", level: "P4" }])
    } finally { s.stop() }
  }
})
