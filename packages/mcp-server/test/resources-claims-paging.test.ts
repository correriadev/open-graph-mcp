/**
 * resources-claims-paging.test.ts — WS-B (SB-0). Pagination past the default limit (100) was previously
 * only exercised inside the CI-skipped target-repo-scale.test.ts. This file builds enough claims
 * in-process to page past the default and the max (500), walks `hasMore`/`nextCursor` to exhaustion with
 * no overlap/no gaps, and covers the `limit`/`since` edge cases (0, 501, non-integer, past-the-end).
 * Also covers `graph://snapshot` throwing "not bootstrapped" directly (previously only asserted
 * indirectly via graph.query).
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { resolveResource } from "../src/resources"

/**
 * `offset` existe porque (tenant_id, id) e (tenant_id, seq) sao unicos: uma segunda chamada no MESMO
 * tenant tem que comecar depois da primeira, senao colide com UNIQUE em vez de testar paginacao.
 */
function seedClaims(s: ReturnType<typeof startServer>, tenant: string, count: number, domain = "auth", level = "P5", offset = 0) {
  const insert = s.state.db.query("INSERT INTO claims (tenant_id,id,seq,subject,domain,level,refs,anchor) VALUES (?,?,?,?,?,?,?,?)")
  for (let i = 1; i <= count; i++) {
    const seq = offset + i
    insert.run(tenant, `${tenant}-${seq}`, seq, `claim ${seq}`, domain, level, "[]", "")
  }
}

test("graph://claims?scope=snapshot pages past the default limit (100) to exhaustion — no overlap, no gaps", () => {
  const s = startServer()
  try {
    seedClaims(s, "default", 237)

    const seen: number[] = []
    let since = 0
    let hasMore = true
    let pages = 0
    while (hasMore) {
      const page = resolveResource(s.state, `graph://claims?scope=snapshot&since=${since}`, "default") as any // default limit
      expect(page.limit).toBe(100)
      expect(page.claims.length).toBeLessThanOrEqual(100)
      seen.push(...page.claims.map((c: any) => c.seq))
      since = page.nextCursor
      hasMore = page.hasMore
      pages++
      expect(pages).toBeLessThan(10) // guard against an infinite loop if pagination regresses
    }
    expect(pages).toBe(3) // 100 + 100 + 37
    expect(seen).toEqual(Array.from({ length: 237 }, (_, i) => i + 1)) // exact sequence, no gaps, no dupes

    const terminal = resolveResource(s.state, `graph://claims?scope=snapshot&since=${since}`, "default") as any
    expect(terminal).toMatchObject({ claims: [], hasMore: false, nextCursor: since })
  } finally {
    s.stop()
  }
})

test("graph://claims?cell= pages past the default limit with the same exhaustion guarantee", () => {
  const s = startServer()
  try {
    seedClaims(s, "default", 150, "auth", "P5")
    seedClaims(s, "default", 5, "other", "P5", 150) // control: must never leak into the auth:5 page

    const seen: string[] = []
    let since = 0
    let hasMore = true
    while (hasMore) {
      const page = resolveResource(s.state, `graph://claims?cell=auth:5&since=${since}`, "default") as any
      expect(page.claims.length).toBeLessThanOrEqual(100)
      seen.push(...page.claims.map((c: any) => c.id))
      since = page.nextCursor
      hasMore = page.hasMore
    }
    expect(seen).toHaveLength(150)
    expect(new Set(seen).size).toBe(150) // no duplicates across the page boundary
    // exatamente os 150 de auth:5 — os 5 de other:5 (seq 151-155) nao vazaram
    expect([...seen].sort()).toEqual(Array.from({ length: 150 }, (_, i) => `default-${i + 1}`).sort())
  } finally {
    s.stop()
  }
})

test("limit bounds: 0 and 501 are rejected, 500 (the max) is accepted", () => {
  const s = startServer()
  try {
    seedClaims(s, "default", 3)
    expect(() => resolveResource(s.state, "graph://claims?scope=snapshot&limit=0", "default")).toThrow(/invalid limit/)
    expect(() => resolveResource(s.state, "graph://claims?scope=snapshot&limit=501", "default")).toThrow(/invalid limit/)
    const atMax = resolveResource(s.state, "graph://claims?scope=snapshot&limit=500", "default") as any
    expect(atMax.limit).toBe(500)
    expect(atMax.claims).toHaveLength(3)
    expect(atMax.hasMore).toBe(false)
  } finally {
    s.stop()
  }
})

test("non-integer since is rejected, since past the end yields an empty terminal page", () => {
  const s = startServer()
  try {
    seedClaims(s, "default", 5)
    for (const bad of ["1.5", "abc", "-1", "1e3", " 1", "1 "]) {
      expect(() => resolveResource(s.state, `graph://claims?scope=snapshot&since=${encodeURIComponent(bad)}`, "default")).toThrow(/invalid since/)
    }
    const pastEnd = resolveResource(s.state, "graph://claims?scope=snapshot&since=9999", "default") as any
    expect(pastEnd).toMatchObject({ claims: [], hasMore: false, nextCursor: 9999 })
  } finally {
    s.stop()
  }
})

test("graph://snapshot throws 'not bootstrapped' directly when the tenant has no hot graph", () => {
  const s = startServer()
  try {
    expect(() => resolveResource(s.state, "graph://snapshot", "default")).toThrow("not bootstrapped")
    expect(() => resolveResource(s.state, "graph://snapshot", "some-other-tenant")).toThrow("not bootstrapped")
  } finally {
    s.stop()
  }
})
