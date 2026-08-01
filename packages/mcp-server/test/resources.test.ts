import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { resolveResource } from "../src/resources"
import { projectClaimFile } from "../src/resources"
import { callTool, readResource, register } from "./helpers"

test("claim file projection is dialect-aware and deny-by-default", () => {
  expect(projectClaimFile("/srv/work/repo/src/auth/login.ts", "/srv/work/repo")).toBe("src/auth/login.ts")
  expect(projectClaimFile("/srv/work/repo-secret/config.yml", "/srv/work/repo")).toBe("config.yml")
  expect(projectClaimFile("src\\auth\\login.ts", "/srv/work/repo")).toBe("src/auth/login.ts")
  for (const value of ["/home/private/secret.ts", "C:\\private\\secret.ts", "C:private\\secret.ts", "\\\\host\\share\\secret.ts", "\\\\?\\C:\\private\\secret.ts", "https://host/private/secret.ts", "../private/secret.ts", "src/../secret.ts"]) {
    expect(projectClaimFile(value, "/srv/work/repo")).toBe("secret.ts")
  }
  for (const value of ["", "/", ".", "..", "C:\\", "\\\\host\\share\\", "bad\0name.ts", "bad\nname.ts"]) {
    expect(projectClaimFile(value, "/srv/work/repo")).toBeUndefined()
  }
})

test("claim file projection denies drive-relative roots and hostile encodings", () => {
  expect(projectClaimFile("C:repo/private/secret.ts", "C:repo")).toBe("secret.ts")
  for (const value of ["src/%252e%252e/secret.ts", "https:host/private/secret.ts", "file:/private/secret.ts", "//host/share/private/secret.ts"]) {
    expect(projectClaimFile(value, "/srv/work/repo")).toBe("secret.ts")
  }
  for (const value of ["private/\u0085secret.ts", "private/\u202esecret.ts"]) expect(projectClaimFile(value, "/srv/work/repo")).toBeUndefined()
})

test("all claim resource modes quarantine invalid durable levels", () => {
  const s = startServer()
  try {
    const insert = s.state.db.query("INSERT INTO claims (tenant_id,id,seq,subject,domain,level,refs) VALUES (?,?,?,?,?,?,?)")
    for (const [id, level, seq] of [["p6", "P6", 1], ["p9", "P9", 2], ["huge", "P999999999999999999", 3]] as const) insert.run("default", id, seq, id, "bad", level, "[]")
    expect((resolveResource(s.state, "graph://claims?scope=snapshot", "default") as any).claims).toEqual([])
    for (const id of ["p6", "p9", "huge"]) expect(resolveResource(s.state, `graph://claims?id=${id}`, "default")).toEqual({ claim: null })
    expect((resolveResource(s.state, "graph://claims?cell=bad:P6", "default") as any).claims).toEqual([])
  } finally { s.stop() }
})

test("basename fallback metrics are aggregate and identifier-safe", () => {
  const s = startServer({ repoPath: "/repo" })
  try {
    s.state.db.query("INSERT INTO claims (tenant_id,id,seq,domain,level,refs,file) VALUES (?,?,?,?,?,?,?)").run("secret-tenant", "secret-id", 1, "d", "P4", "[]", "/elsewhere/private.ts")
    resolveResource(s.state, "graph://claims?id=secret-id", "secret-tenant")
    expect(s.state.claimFileProjectionMetrics).toEqual({ repoRelative: 0, basenameFallback: 1, omitted: 0 })
    expect(JSON.stringify(s.state.claimFileProjectionMetrics)).not.toContain("secret")
  } finally { s.stop() }
})

test("graph://claims?id resolves exact encoded tenant claims and hides misses", async () => {
  const s = startServer({ repoPath: "/private/repo" })
  try {
    const alice = await register(s.url, "alice", "tenant-a")
    const bob = await register(s.url, "bob", "tenant-b")
    const insert = s.state.db.query("INSERT INTO claims (tenant_id,id,seq,subject,domain,level,refs,anchor,file,verdict_confidence,verdict_overclaim) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    const id = "ref:α/1 & reserved"
    insert.run("tenant-a", id, 1, "encoded", "auth", "P3", JSON.stringify(["base"]), "anchor", "/private/repo/src/auth/login.ts", 0.8, 1)

    const hit = await readResource(s.url, `graph://claims?id=${encodeURIComponent(id)}`, alice.token)
    expect(hit.claim).toEqual(expect.objectContaining({ id, domain: "auth", level: 3, refs: ["base"], file: "src/auth/login.ts" }))
    expect(hit.claim.verdict).toEqual({ confidence: 0.8, overclaim: true })
    expect(await readResource(s.url, "graph://claims?id=missing", alice.token)).toEqual({ claim: null })
    expect(await readResource(s.url, `graph://claims?id=${encodeURIComponent(id)}`, bob.token)).toEqual({ claim: null })
  } finally { s.stop() }
})

test("graph://claims?id rejects empty and ambiguous lookup modes", () => {
  const s = startServer()
  try {
    expect(() => resolveResource(s.state, "graph://claims?id=", "tenant-a")).toThrow("claim id required")
    expect(() => resolveResource(s.state, "graph://claims?id=x&cell=auth:P3", "tenant-a")).toThrow("ambiguous claims mode")
    expect(() => resolveResource(s.state, "graph://claims?id=x&scope=snapshot", "tenant-a")).toThrow("ambiguous claims mode")
    expect(() => resolveResource(s.state, "graph://claims?id=x&id=y", "tenant-a")).toThrow("ambiguous claims mode")
    expect(() => resolveResource(s.state, "graph://claims?id=x&since=0", "tenant-a")).toThrow("ambiguous claims mode")
    expect(() => resolveResource(s.state, "graph://claims?id=x&limit=1", "tenant-a")).toThrow("ambiguous claims mode")
  } finally { s.stop() }
})

test("point lookup redacts Windows and UNC roots and records tenant-neutral metrics", () => {
  const s = startServer({ repoPath: "C:\\work\\repo" })
  try {
    const insert = s.state.db.query("INSERT INTO claims (tenant_id,id,seq,subject,domain,level,refs,anchor,file) VALUES (?,?,?,?,?,?,?,?,?)")
    insert.run("tenant-a", "drive", 1, "drive", "auth", "P3", "[]", "", "C:\\work\\repo\\src\\auth\\secret.ts")
    insert.run("tenant-a", "unc", 2, "unc", "auth", "P3", "[]", "", "\\\\server\\share\\private\\secret.ts")
    insert.run("tenant-a", "other-drive", 3, "other", "auth", "P3", "[]", "", "D:\\private\\outside.ts")
    insert.run("tenant-a", "drive-relative", 4, "relative", "auth", "P3", "[]", "", "C:private\\secret.ts")
    expect((resolveResource(s.state, "graph://claims?id=drive", "tenant-a") as any).claim.file).toBe("src/auth/secret.ts")
    expect((resolveResource(s.state, "graph://claims?id=unc", "tenant-a") as any).claim.file).toBe("secret.ts")
    expect((resolveResource(s.state, "graph://claims?id=other-drive", "tenant-a") as any).claim.file).toBe("outside.ts")
    expect((resolveResource(s.state, "graph://claims?id=drive-relative", "tenant-a") as any).claim.file).toBe("secret.ts")
    expect(resolveResource(s.state, "graph://claims?id=absent", "tenant-b")).toEqual({ claim: null })
    expect(s.state.claimLookupMetrics).toEqual({ hits: 4, misses: 1, totalLatencyMs: expect.any(Number), maxLatencyMs: expect.any(Number) })
    expect(Object.keys(s.state.claimLookupMetrics)).not.toContain("tenant")
  } finally { s.stop() }
})

test("graph://claims?cell= returns full ClaimRecord[] for that cell only", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["auth:P5"], intent: "claims resource test" })
    await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "c1", subject: "login raiz", domain: "auth", level: "P5", refs: [] } },
    })
    await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "c2", subject: "login mid", domain: "auth", level: "P5", refs: [] } },
    })
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "claims resource test" })
    expect(commit.ok).toBe(true)

    const env = await readResource(s.url, "graph://claims?cell=auth:P5", a.token)
    expect(env.cell).toBe("auth:P5")
    expect(Array.isArray(env.claims)).toBe(true)
    expect(env.claims.length).toBe(2)
    const ids = env.claims.map((c: any) => c.id).sort()
    expect(ids).toEqual(["c1", "c2"])
    for (const c of env.claims) {
      expect(typeof c.id).toBe("string")
      expect(typeof c.subject).toBe("string")
      expect(Array.isArray(c.refs)).toBe(true)
      expect(typeof c.anchor).toBe("string")
      expect(c.seq).toBeDefined()
    }
  } finally {
    s.stop()
  }
})

test("graph://claims without cell throws 'cell key required'", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    let threw: Error | null = null
    try {
      await readResource(s.url, "graph://claims", a.token)
    } catch (e) {
      threw = e as Error
    }
    expect(threw).not.toBeNull()
    expect(threw!.message).toContain("cell key required")
  } finally {
    s.stop()
  }
})

test("graph://claims?cell=unknown:P1 returns empty claims array (not error)", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const env = await readResource(s.url, "graph://claims?cell=unknown:P1", a.token)
    expect(env.cell).toBe("unknown:P1")
    expect(Array.isArray(env.claims)).toBe(true)
    expect(env.claims.length).toBe(0)
  } finally {
    s.stop()
  }
})

test("graph://claims?cell= rejects malformed cells (missing colon, empty domain/level)", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    for (const bad of ["auth", ":P3", "auth:", " P3"]) {
      let threw: Error | null = null
      try {
        await readResource(s.url, `graph://claims?cell=${encodeURIComponent(bad)}`, a.token)
      } catch (e) {
        threw = e as Error
      }
      expect(threw).not.toBeNull()
      expect(threw!.message).toMatch(/malformed/)
    }
    // 'auth:P3' still works (control)
    const env = await readResource(s.url, "graph://claims?cell=auth:P3", a.token)
    expect(env.cell).toBe("auth:P3")
  } finally {
    s.stop()
  }
})

test("graph://claims redacts file path prefix (server filesystem layout non-disclosure)", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["auth:P5"], intent: "redact test" })
    // No anchor → incrementalGate skips file-content check (gates.ts:67 only checks when both set).
    await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "cR", subject: "s", domain: "auth", level: "P5", refs: [], file: "/abs/repo/src/auth/login.ts" } },
    })
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "redact test" })
    expect(commit.ok).toBe(true)

    const env = await readResource(s.url, "graph://claims?cell=auth:P5", a.token)
    expect(env.claims.length).toBeGreaterThanOrEqual(1)
    const c = env.claims.find((x: any) => x.id === "cR")
    expect(c).toBeDefined()
    expect(c.file).toBe("login.ts")
  } finally {
    s.stop()
  }
})

test("graph://claims pure SQL predicate avoids N+1 tenant scan (frozen claimsCount)", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    // Canonical rows isolate the SQL resource predicate from roundtrip admission rules.
    const insert = s.state.db.query("INSERT INTO claims (tenant_id,id,seq,subject,domain,level,refs,anchor) VALUES (?,?,?,?,?,?,?,?)")
    for (let index = 1; index <= 3; index++) insert.run("default", `a${index}`, index, "x", "auth", "P3", "[]", "")
    insert.run("default", "a5", 5, "x", "auth", "P5", "[]", "")

    const p3 = await readResource(s.url, "graph://claims?cell=auth:P3", a.token)
    const p5 = await readResource(s.url, "graph://claims?cell=auth:P5", a.token)
    // Frozen expected counts
    expect(p3.claims.length).toBe(3)
    expect(p5.claims.length).toBe(1)
  } finally {
    s.stop()
  }
})

test("graph://claims?scope=snapshot returns a bounded flat cursor page", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    for (const [cell, id, level] of [["auth:P5", "root", "P5"], ["billing:P5", "bill", "P5"]] as const) {
      const cs = await callTool(s.url, "changeset.open", { token: a.token, cells: [cell], intent: id })
      await callTool(s.url, "changeset.claim", { token: a.token, csId: cs.csId, delta: { kind: "claim.add", payload: { id, subject: id, domain: cell.split(":")[0], level, refs: [] } } })
      expect((await callTool(s.url, "changeset.commit", { token: a.token, csId: cs.csId, intent: id })).ok).toBe(true)
    }
    const env = await readResource(s.url, "graph://claims?scope=snapshot", a.token)
    expect(env.claims.map((claim: any) => claim.id)).toEqual(["root", "bill"])
    expect(env.nextCursor).toBe(env.claims[1].seq)
    expect(env.hasMore).toBe(false)
  } finally {
    s.stop()
  }
})

test("snapshot claims projection isolates corrupt persisted refs", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const cs = await callTool(s.url, "changeset.open", { token: a.token, cells: ["auth:P5"], intent: "legacy" })
    await callTool(s.url, "changeset.claim", { token: a.token, csId: cs.csId, delta: { kind: "claim.add", payload: { id: "legacy", subject: "legacy", domain: "auth", level: "P5", refs: [] } } })
    await callTool(s.url, "changeset.commit", { token: a.token, csId: cs.csId, intent: "legacy" })
    s.state.db.query("UPDATE claims SET refs = ? WHERE tenant_id = ? AND id = ?").run("{broken", "default", "legacy")
    const env = await readResource(s.url, "graph://claims?scope=snapshot", a.token)
    expect(env.claims[0].refs).toEqual([])
  } finally {
    s.stop()
  }
})

test("claims and history cursor pages traverse without overlap and reject malformed bounds", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const cs = await callTool(s.url, "changeset.open", { token: a.token, cells: ["auth:P5"], intent: "pagination" })
    for (let i = 1; i <= 5; i++) await callTool(s.url, "changeset.claim", {
      token: a.token, csId: cs.csId,
      delta: { kind: "claim.add", payload: { id: `page-${i}`, subject: `claim ${i}`, domain: "auth", level: "P5", refs: [] } },
    })
    expect((await callTool(s.url, "changeset.commit", { token: a.token, csId: cs.csId, intent: "pagination" })).ok).toBe(true)

    const seen: string[] = []
    let since = 0
    let hasMore = true
    while (hasMore) {
      const page = await readResource(s.url, `graph://claims?scope=snapshot&since=${since}&limit=2`, a.token)
      expect(page.claims.length).toBeLessThanOrEqual(2)
      expect(page.claims.every((c: any, i: number) => i === 0 || page.claims[i - 1].seq < c.seq)).toBe(true)
      seen.push(...page.claims.map((c: any) => c.id))
      since = page.nextCursor
      hasMore = page.hasMore
    }
    expect(seen).toEqual(["page-1", "page-2", "page-3", "page-4", "page-5"])
    const terminal = await readResource(s.url, `graph://claims?scope=snapshot&since=${since}&limit=2`, a.token)
    expect(terminal).toMatchObject({ claims: [], nextCursor: since, hasMore: false })

    const history = await readResource(s.url, "graph://history?since=0&limit=2", a.token)
    expect(history.events.length).toBeLessThanOrEqual(2)
    expect(history.nextCursor).toBe(history.events.at(-1)?.seq ?? 0)

    for (const uri of [
      "graph://claims?scope=snapshot&since=-1", "graph://claims?scope=snapshot&since=1.5",
      "graph://claims?scope=snapshot&since=", "graph://history?limit=0", "graph://history?limit=501",
      "graph://history?limit=NaN",
    ]) await expect(readResource(s.url, uri, a.token)).rejects.toThrow()
  } finally {
    s.stop()
  }
})

test("pagination queries have tenant/sequence and tenant/cell/sequence indexes", () => {
  const s = startServer()
  try {
    const indexes = s.state.db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'claims'").all() as { name: string }[]
    expect(indexes.map((row) => row.name)).toContain("claims_tenant_seq")
    expect(indexes.map((row) => row.name)).toContain("claims_tenant_cell_seq")
    const snapshotPlan = s.state.db.query("EXPLAIN QUERY PLAN SELECT id FROM claims WHERE tenant_id = ? AND seq > ? ORDER BY seq LIMIT ?").all("default", 0, 101) as { detail: string }[]
    expect(snapshotPlan.some((row) => row.detail.includes("claims_tenant_seq"))).toBe(true)
    const cellPlan = s.state.db.query("EXPLAIN QUERY PLAN SELECT id FROM claims WHERE tenant_id = ? AND domain = ? AND level = ? AND seq > ? ORDER BY seq LIMIT ?").all("default", "auth", "P4", 0, 101) as { detail: string }[]
    expect(cellPlan.some((row) => row.detail.includes("claims_tenant_cell_seq"))).toBe(true)
    expect(cellPlan.some((row) => row.detail.includes("TEMP B-TREE"))).toBe(false)
  } finally {
    s.stop()
  }
})

test("default bounds, tenant isolation, and private history filtering preserve continuation", () => {
  const s = startServer()
  try {
    const insertClaim = s.state.db.query("INSERT INTO claims (tenant_id,id,seq,subject,domain,level,refs,anchor) VALUES (?,?,?,?,?,?,?,?)")
    for (let seq = 1; seq <= 101; seq++) {
      insertClaim.run("tenant-a", `a-${seq}`, seq, `A ${seq}`, "auth", "P4", "[]", "")
      insertClaim.run("tenant-b", `b-${seq}`, seq, `B ${seq}`, "auth", "P4", "[]", "")
    }
    const claims = resolveResource(s.state, "graph://claims?scope=snapshot", "tenant-a") as any
    expect(claims.claims).toHaveLength(100)
    expect(claims.hasMore).toBe(true)
    expect(claims.claims.every((claim: any) => claim.id.startsWith("a-"))).toBe(true)

    const insertEvent = s.state.db.query("INSERT INTO events (tenant_id,seq,ts,kind,target_id,payload) VALUES (?,?,?,?,?,?)")
    insertEvent.run("tenant-a", 1, new Date().toISOString(), "changeset.opened", "one", "{}")
    insertEvent.run("tenant-a", 2, new Date().toISOString(), "lock.denied", "private", "{}")
    insertEvent.run("tenant-a", 3, new Date().toISOString(), "changeset.committed", "three", "{}")
    const first = resolveResource(s.state, "graph://history?since=0&limit=1", "tenant-a") as any
    expect(first.events.map((event: any) => event.seq)).toEqual([1])
    expect(first.hasMore).toBe(true)
    const second = resolveResource(s.state, `graph://history?since=${first.nextCursor}&limit=1`, "tenant-a") as any
    expect(second.events.map((event: any) => event.seq)).toEqual([3])
    expect(second.hasMore).toBe(false)
  } finally {
    s.stop()
  }
})
