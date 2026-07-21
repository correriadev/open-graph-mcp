import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { Database } from "bun:sqlite"
import path from "node:path"
import { normalizeClaimLevel, normalizeRecoveredClaimLevel } from "../src/claim-level"
import { startServer } from "../src/index"
import { callTool, readResource, register } from "./helpers"
import { writeClaim } from "../src/store"
import { openDb } from "../src/db"

test("wire and recovery levels normalize without coercion", () => {
  for (let level = 0; level <= 5; level++) {
    expect(normalizeClaimLevel(level)).toEqual({ ok: true, numeric: level, stored: `P${level}` })
    expect(normalizeClaimLevel(`P${level}`)).toEqual({ ok: true, numeric: level, stored: `P${level}` })
    expect(normalizeRecoveredClaimLevel(String(level))).toEqual({ ok: true, numeric: level, stored: `P${level}` })
  }
  for (const value of [undefined, null, true, false, 1.5, Infinity, -1, 6, "", "1", "+1", " 1", "P01", "p1", "PP1", {}, []]) {
    expect(normalizeClaimLevel(value).ok).toBe(false)
  }
})

test("numeric negative zero is rejected", () => {
  expect(normalizeClaimLevel(-0).ok).toBe(false)
  expect(normalizeRecoveredClaimLevel(-0).ok).toBe(false)
})

test("startup rejects invalid legacy SQLite levels without partial migration", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "og-level-")), "state.sqlite")
  const db = openDb(file)
  db.query("INSERT INTO claims (tenant_id,id,seq,domain,level) VALUES (?,?,?,?,?)").run("default", "valid", 1, "d", "4")
  db.query("INSERT INTO claims (tenant_id,id,seq,domain,level) VALUES (?,?,?,?,?)").run("default", "invalid", 2, "d", "9")
  db.close()
  expect(() => openDb(file)).toThrow("claim.add: invalid level")
  const inspect = new Database(file)
  expect(inspect.query("SELECT id,level FROM claims ORDER BY seq").all()).toEqual([{ id: "valid", level: "4" }, { id: "invalid", level: "9" }])
  inspect.close()
})

test("invalid claim levels are rejected before staging or aggregation", async () => {
  const s = startServer()
  try {
    const actor = await register(s.url, "level-owner")
    const { csId } = await callTool(s.url, "changeset.open", { token: actor.token, cells: ["level:4"], intent: "canonical level" })
    for (const level of [undefined, null, true, 4.5, -1, 6, "4", "P04", "p4", {}, []]) {
      const result = await callTool(s.url, "changeset.claim", { token: actor.token, csId, delta: { kind: "claim.add", payload: { id: `bad-${String(level)}`, subject: "bad", domain: "level", level, refs: [] } } })
      expect(result).toEqual({ ok: false, reasons: ["claim.add: invalid level"] })
    }
    expect((s.state.db.query("SELECT COUNT(*) AS count FROM cs_deltas WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as any).count).toBe(0)
    expect(s.state.deltaCounts.has(csId)).toBe(false)
  } finally { s.stop() }
})

test("P-form admission stages numeric payload and persists canonical SQLite and JSONL", async () => {
  const s = startServer()
  try {
    const actor = await register(s.url, "canonical-owner")
    const { csId } = await callTool(s.url, "changeset.open", { token: actor.token, cells: ["canonical:P5"], intent: "canonical level" })
    expect((await callTool(s.url, "changeset.claim", { token: actor.token, csId, delta: { kind: "claim.add", payload: { id: "canonical", subject: "ok", domain: "canonical", level: "P5", refs: [] } } })).ok).toBe(true)
    const staged = s.state.db.query("SELECT payload FROM cs_deltas WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { payload: string }
    expect(JSON.parse(staged.payload).level).toBe(5)
    expect((await callTool(s.url, "changeset.commit", { token: actor.token, csId })).ok).toBe(true)
    expect((s.state.db.query("SELECT level FROM claims WHERE tenant_id = ? AND id = ?").get("default", "canonical") as any).level).toBe("P5")
    const jsonl = readFileSync(path.join(s.state.stateDir, "tenants", "default", "claims.jsonl"), "utf8")
    expect(JSON.parse(jsonl.trim().split("\n").at(-1)!).level).toBe("P5")
    expect((await readResource(s.url, "graph://claims?id=canonical", actor.token)).claim.level).toBe(5)
  } finally { s.stop() }
})

test("writeClaim rejects a noncanonical bypass without SQLite or JSONL visibility", () => {
  const s = startServer()
  try {
    expect(() => writeClaim(s.state, "default", 1, { id: "bypass", subject: "bad", domain: "x", level: "P4" as any, refs: [] })).toThrow("claim.add: invalid level")
    expect(s.state.db.query("SELECT id FROM claims WHERE tenant_id = ? AND id = ?").get("default", "bypass")).toBeNull()
  } finally { s.stop() }
})

test("all numeric and P wire levels commit through canonical ladders", async () => {
  const s = startServer()
  try {
    const actor = await register(s.url, "all-levels")
    for (const dialect of ["numeric", "prefixed"] as const) {
      let parent: string | null = null
      for (let level = 5; level >= 0; level--) {
        const id = `${dialect}-${level}`
        const domain = `levels-${dialect}`
        const { csId } = await callTool(s.url, "changeset.open", { token: actor.token, cells: [`${domain}:P${level}`], intent: id })
        const wireLevel = dialect === "numeric" ? level : `P${level}`
        expect((await callTool(s.url, "changeset.claim", { token: actor.token, csId, delta: { kind: "claim.add", payload: { id, subject: id, domain, level: wireLevel, refs: parent ? [parent] : [] } } })).ok).toBe(true)
        expect((await callTool(s.url, "changeset.commit", { token: actor.token, csId })).ok).toBe(true)
        expect((s.state.db.query("SELECT level FROM claims WHERE tenant_id = ? AND id = ?").get("default", id) as any).level).toBe(`P${level}`)
        expect((await readResource(s.url, `graph://claims?id=${id}`, actor.token)).claim.level).toBe(level)
        parent = id
      }
    }
  } finally { s.stop() }
})

test("commit rejects a directly injected noncanonical staged payload atomically", async () => {
  const s = startServer()
  try {
    const actor = await register(s.url, "bypass-commit")
    const { csId } = await callTool(s.url, "changeset.open", { token: actor.token, cells: ["bypass:P5"], intent: "bypass" })
    s.state.db.query("INSERT INTO cs_deltas (tenant_id,cs_id,seq,kind,payload,created_at) VALUES (?,?,?,?,?,?)").run(
      "default", csId, 1, "claim.add", JSON.stringify({ id: "bad-commit", subject: "bad", domain: "bypass", level: "5", refs: [] }), new Date().toISOString(),
    )
    const result = await callTool(s.url, "changeset.commit", { token: actor.token, csId })
    expect(result).toEqual({ ok: false, reasons: ["claim.add: invalid level"] })
    expect(s.state.db.query("SELECT id FROM claims WHERE tenant_id = ? AND id = ?").get("default", "bad-commit")).toBeNull()
  } finally { s.stop() }
})
