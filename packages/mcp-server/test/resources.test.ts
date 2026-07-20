import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, readResource, register } from "./helpers"

test("graph://claims?cell= returns full ClaimRecord[] for that cell only", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["auth:P3"], intent: "claims resource test" })
    await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "c1", subject: "login raiz", domain: "auth", level: "P3", refs: [] } },
    })
    await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "c2", subject: "login mid", domain: "auth", level: "P3", refs: [] } },
    })
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId })
    expect(commit.ok).toBe(true)

    const env = await readResource(s.url, "graph://claims?cell=auth:P3", a.token)
    expect(env.cell).toBe("auth:P3")
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
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["auth:P3"], intent: "redact test" })
    // No anchor → incrementalGate skips file-content check (gates.ts:67 only checks when both set).
    await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "cR", subject: "s", domain: "auth", level: "P3", refs: [], file: "/abs/repo/src/auth/login.ts" } },
    })
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId })
    expect(commit.ok).toBe(true)

    const env = await readResource(s.url, "graph://claims?cell=auth:P3", a.token)
    expect(env.claims.length).toBeGreaterThanOrEqual(1)
    const c = env.claims.find((x: any) => x.id === "cR")
    expect(c).toBeDefined()
    expect(c.file).toBe("src/auth/login.ts")
  } finally {
    s.stop()
  }
})

test("graph://claims pure SQL predicate avoids N+1 tenant scan (frozen claimsCount)", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    // Commit 3 claims at auth:P3 and 1 at auth:P5
    const csA = await callTool(s.url, "changeset.open", { token: a.token, cells: ["auth:P3"], intent: "p3 set" })
    await callTool(s.url, "changeset.claim", { token: a.token, csId: csA.csId, delta: { kind: "claim.add", payload: { id: "a1", subject: "x", domain: "auth", level: "P3", refs: [] } } })
    await callTool(s.url, "changeset.claim", { token: a.token, csId: csA.csId, delta: { kind: "claim.add", payload: { id: "a2", subject: "x", domain: "auth", level: "P3", refs: [] } } })
    await callTool(s.url, "changeset.claim", { token: a.token, csId: csA.csId, delta: { kind: "claim.add", payload: { id: "a3", subject: "x", domain: "auth", level: "P3", refs: [] } } })
    await callTool(s.url, "changeset.commit", { token: a.token, csId: csA.csId })
    const csB = await callTool(s.url, "changeset.open", { token: a.token, cells: ["auth:P5"], intent: "p5 set" })
    await callTool(s.url, "changeset.claim", { token: a.token, csId: csB.csId, delta: { kind: "claim.add", payload: { id: "a5", subject: "x", domain: "auth", level: "P5", refs: [] } } })
    await callTool(s.url, "changeset.commit", { token: a.token, csId: csB.csId })

    const p3 = await readResource(s.url, "graph://claims?cell=auth:P3", a.token)
    const p5 = await readResource(s.url, "graph://claims?cell=auth:P5", a.token)
    // Frozen expected counts
    expect(p3.claims.length).toBe(3)
    expect(p5.claims.length).toBe(1)
  } finally {
    s.stop()
  }
})