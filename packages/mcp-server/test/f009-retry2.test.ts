import { expect, test } from "bun:test"
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { injectMirrorAppendFailure, write } from "../src/db"
import { startServer } from "../src/index"
import { resolveResource } from "../src/resources"
import { tenantGraph } from "../src/state"
import { buildPhase1Graph, callTool, register, tempRepo } from "./helpers"

function durableBytes(stateDir: string, tenant = "default") {
  const dir = path.join(stateDir, "tenants", tenant)
  const result: Record<string, string> = {}
  for (const table of ["users", "nodes", "edges", "claims", "authority", "changesets", "cs_deltas", "events"]) {
    const file = path.join(dir, `${table}.jsonl`)
    result[table] = existsSync(file) ? readFileSync(file, "utf8") : ""
  }
  return result
}

test("graph.import canonicalizes supported claim levels before durable effects", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root })
  try {
    await buildPhase1Graph(s.url, root)
    appendFileSync(path.join(root, ".graph", "claims.jsonl"), [
      { id: "numeric", seq: 1, subject: "numeric", domain: "import", level: 4, refs: [], anchor: "" },
      { id: "prefixed", seq: 2, subject: "prefixed", domain: "import", level: "P5", refs: [], anchor: "" },
    ].map((claim) => JSON.stringify(claim)).join("\n") + "\n")
    const actor = await register(s.url, "alice")

    expect((await callTool(s.url, "graph.import", { token: actor.token, repoPath: root })).imported).toBe(true)
    expect(s.state.db.query("SELECT id,level FROM claims WHERE tenant_id=? ORDER BY seq").all("default")).toEqual([
      { id: "numeric", level: "P4" }, { id: "prefixed", level: "P5" },
    ])
    expect(readFileSync(path.join(s.state.stateDir, "tenants", "default", "claims.jsonl"), "utf8")).toContain('"level":"P4"')
    expect((resolveResource(s.state, "graph://claims?cell=import:P4", "default") as any).claims[0].level).toBe(4)
  } finally { s.stop(); cleanup() }
})

test("graph.import rejects invalid claim levels before SQLite, mirrors, graph, or events change", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root })
  try {
    await buildPhase1Graph(s.url, root)
    appendFileSync(path.join(root, ".graph", "claims.jsonl"), JSON.stringify({ id: "bad", seq: 1, subject: "bad", domain: "import", level: "P9", refs: [], anchor: "" }) + "\n")
    const actor = await register(s.url, "alice")
    const before = durableBytes(s.state.stateDir)
    const beforeGraph = structuredClone(tenantGraph(s.state, "default").graph)
    await expect(callTool(s.url, "graph.import", { token: actor.token, repoPath: root })).rejects.toThrow("claim.add: invalid level")
    expect(durableBytes(s.state.stateDir)).toEqual(before)
    expect(s.state.db.query("SELECT COUNT(*) AS c FROM claims WHERE tenant_id=?").get("default")).toEqual({ c: 0 })
    expect(tenantGraph(s.state, "default").graph).toEqual(beforeGraph)
  } finally { s.stop(); cleanup() }
})

test("second mirror append failure rolls graph.import SQLite and every touched mirror back", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root })
  try {
    await buildPhase1Graph(s.url, root)
    const actor = await register(s.url, "alice")
    const before = durableBytes(s.state.stateDir)
    const beforeGraph = structuredClone(tenantGraph(s.state, "default").graph)
    const beforeCounts = Object.fromEntries(["nodes", "edges", "claims", "authority", "changesets", "events"].map((table) => [
      table, (s.state.db.query(`SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id=?`).get("default") as { c: number }).c,
    ]))
    const restore = injectMirrorAppendFailure(s.state.db, 2)
    try { await expect(callTool(s.url, "graph.import", { token: actor.token, repoPath: root })).rejects.toThrow("injected mirror append failure") }
    finally { restore() }
    expect(durableBytes(s.state.stateDir)).toEqual(before)
    for (const table of ["nodes", "edges", "claims", "authority", "changesets", "events"]) {
      expect(s.state.db.query(`SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id=?`).get("default")).toEqual({ c: beforeCounts[table] })
    }
    expect(tenantGraph(s.state, "default").graph).toEqual(beforeGraph)
  } finally { s.stop(); cleanup() }
})

test("mirror failures roll back standalone writers and TTL sweeping", async () => {
  const s = startServer({ ttlMs: 1 })
  try {
    let restore = injectMirrorAppendFailure(s.state.db, 1)
    try {
      expect(() => write(s.state.db, s.state.stateDir, "default", "users", { tenant_id: "default", id: "standalone", name: "x", created_at: "now" })).toThrow("injected mirror append failure")
    } finally { restore() }
    expect(s.state.db.query("SELECT id FROM users WHERE tenant_id=? AND id=?").get("default", "standalone")).toBeNull()

    const actor = await register(s.url, "alice")
    const opened = await callTool(s.url, "changeset.open", { token: actor.token, cells: ["ttl:P5"], intent: "ttl rollback" })
    s.state.db.query("UPDATE locks SET expires_at=? WHERE tenant_id=? AND cs_id=?").run("2000-01-01T00:00:00.000Z", "default", opened.csId)
    s.state.deltaCounts.set(opened.csId, { tenant: "default", byUser: actor.userId, count: 3 })
    const before = durableBytes(s.state.stateDir)
    restore = injectMirrorAppendFailure(s.state.db, 2)
    try { expect(() => s.sweep()).toThrow("injected mirror append failure") } finally { restore() }
    expect(durableBytes(s.state.stateDir)).toEqual(before)
    expect((s.state.db.query("SELECT status FROM changesets WHERE tenant_id=? AND id=?").get("default", opened.csId) as any).status).toBe("open")
    expect(s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id=? AND cs_id=?").get("default", opened.csId)).toEqual({ c: 1 })
    expect(s.state.deltaCounts.get(opened.csId)?.count).toBe(3)
  } finally { s.stop() }
})

test("invalid stored levels are quarantined before snapshot pagination", () => {
  const s = startServer()
  try {
    const insert = s.state.db.query("INSERT INTO claims (tenant_id,id,seq,domain,level,refs) VALUES (?,?,?,?,?,?)")
    insert.run("default", "bad-1", 1, "d", "P9", "[]")
    insert.run("default", "bad-2", 2, "d", "P6", "[]")
    insert.run("default", "good-3", 3, "d", "P4", "[]")
    insert.run("default", "good-4", 4, "d", "P4", "[]")
    const first = resolveResource(s.state, "graph://claims?scope=snapshot&limit=1", "default") as any
    expect(first.claims.map((c: any) => c.id)).toEqual(["good-3"])
    expect(first).toEqual(expect.objectContaining({ nextCursor: 3, hasMore: true }))
    const second = resolveResource(s.state, `graph://claims?scope=snapshot&limit=1&since=${first.nextCursor}`, "default") as any
    expect(second.claims.map((c: any) => c.id)).toEqual(["good-4"])
    expect(second.hasMore).toBe(false)
  } finally { s.stop() }
})

test("encoded traversal under a matching root falls back and Windows containment metric is case-insensitive", () => {
  const s = startServer({ repoPath: "C:\\Work\\Repo" })
  try {
    const insert = s.state.db.query("INSERT INTO claims (tenant_id,id,seq,domain,level,refs,file) VALUES (?,?,?,?,?,?,?)")
    insert.run("default", "encoded", 1, "d", "P4", "[]", "C:\\Work\\Repo\\src\\%252e%252e\\private\\secret.ts")
    insert.run("default", "case", 2, "d", "P4", "[]", "c:\\work\\repo\\src\\safe.ts")
    expect((resolveResource(s.state, "graph://claims?id=encoded", "default") as any).claim.file).toBe("secret.ts")
    expect((resolveResource(s.state, "graph://claims?id=case", "default") as any).claim.file).toBe("src/safe.ts")
    expect(s.state.claimFileProjectionMetrics).toEqual({ repoRelative: 1, basenameFallback: 1, omitted: 0 })
  } finally { s.stop() }
})
