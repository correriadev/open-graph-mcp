/**
 * resources-cell-domain.test.ts — WS-B (SB-0). `graph://cell/{k}` and `graph://domain/{d}` had their
 * ONLY coverage inside `describe.skipIf(!targetRepoAvailable())` in target-repo-scale.test.ts — never
 * run on CI. This file exercises both resolvers with in-process fixtures, no external repo required.
 *
 * `cellState` (resources.ts) reads `nodeCount`/`claimCount`/`driftGrade` off the tenant's HOT graph
 * (`tenantGraph(state, tenant).graph.nodes`), not off SQLite — so tests that want exact, readable counts
 * seed `s.state.graphs` directly (unit-style, same spirit as resources.test.ts's direct `s.state.db`
 * inserts) instead of depending on classify.ts's file→domain/level inference over a real fixture.
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { resolveResource } from "../src/resources"
import { callTool, readResource, register } from "./helpers"

type FakeNode = {
  id: string
  file: string
  domain: string | null
  level: string
  claims: string[]
  anchor: string
  stale?: "fresh" | "stale" | "gone"
}

function seedGraph(nodes: FakeNode[]) {
  return {
    graph: {
      schemaVersion: 1 as const,
      repo: "fake",
      generatedAt: new Date().toISOString(),
      stats: { nodes: nodes.length, edges: 0, claims: 0, domains: new Set(nodes.map((n) => n.domain)).size },
      nodes: nodes.map((n) => ({ ...n, kind: "File", responsibility: n.id, exposed: false, confidence: null, overclaim: false })),
      edges: [],
    } as any,
    graphId: "fake-graph-id",
    pipeline: "indexed" as const,
    bootstrappedAt: new Date().toISOString(),
    repoPath: null,
  }
}

test("graph://cell/{k}: authority, nodeCount, claimCount, driftGrade, and lock populated while a turn is open, null after commit", async () => {
  const s = startServer()
  try {
    s.state.graphs.set("default", seedGraph([
      { id: "n1", file: "src/auth/login.ts", domain: "auth", level: "P5", claims: ["c1"], anchor: "a1", stale: "fresh" },
      { id: "n2", file: "src/auth/logout.ts", domain: "auth", level: "P5", claims: ["c1", "c2"], anchor: "a2", stale: "stale" },
    ]))
    const a = await register(s.url, "alice")

    const before = await readResource(s.url, "graph://cell/auth:5", a.token)
    expect(before.cell).toBe("auth:5")
    expect(before.authority).toBe("source") // never flipped
    expect(before.nodeCount).toBe(2)
    expect(before.claimCount).toBe(2) // distinct claim ids referenced by the cell's nodes: c1, c2
    expect(before.driftGrade).toBe("stale") // worst of fresh/stale, no "gone"
    expect(before.lock).toBeNull()

    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["auth:5"], intent: "probe" })
    const duringOpen = await readResource(s.url, "graph://cell/auth:5", a.token)
    expect(duringOpen.lock).toEqual({ csId, holder: a.userId, expiresAt: expect.any(String) })

    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "probe" })
    expect(commit.ok).toBe(true)
    const afterCommit = await readResource(s.url, "graph://cell/auth:5", a.token)
    expect(afterCommit.lock).toBeNull()
  } finally {
    s.stop()
  }
})

test("graph://cell/{k}: driftGrade is 'gone' when any node is gone, even if others are only stale", async () => {
  const s = startServer()
  try {
    s.state.graphs.set("default", seedGraph([
      { id: "n1", file: "a.ts", domain: "d", level: "P3", claims: [], anchor: "", stale: "stale" },
      { id: "n2", file: "b.ts", domain: "d", level: "P3", claims: [], anchor: "", stale: "gone" },
    ]))
    const env = resolveResource(s.state, "graph://cell/d:3", "default") as any
    expect(env.driftGrade).toBe("gone")
  } finally {
    s.stop()
  }
})

test("graph://cell/{k}: malformed keys — no colon, empty level, and missing key entirely", () => {
  const s = startServer()
  try {
    s.state.graphs.set("default", seedGraph([
      { id: "n1", file: "a.ts", domain: "auth", level: "P5", claims: [], anchor: "" },
      { id: "n2", file: "b.ts", domain: "auth", level: "P3", claims: [], anchor: "" },
      { id: "n3", file: "c.ts", domain: "billing", level: "P5", claims: [], anchor: "" },
    ]))

    // No ":" — the whole string becomes the domain, level defaults to "" (matches nothing here).
    const noColon = resolveResource(s.state, "graph://cell/authP5", "default") as any
    expect(noColon.cell).toBe("authP5")
    expect(noColon.nodeCount).toBe(0)

    // Trailing ":" — empty level is a wildcard: matches every level of the domain (both auth cells).
    const emptyLevel = resolveResource(s.state, "graph://cell/auth:", "default") as any
    expect(emptyLevel.cell).toBe("auth:")
    expect(emptyLevel.nodeCount).toBe(2)

    // Missing key entirely.
    expect(() => resolveResource(s.state, "graph://cell/", "default")).toThrow("cell key required")
    expect(() => resolveResource(s.state, "graph://cell", "default")).toThrow("cell key required")
  } finally {
    s.stop()
  }
})

test("graph://domain/{d}: enumerates exactly the levels present, each entry a full cell state", async () => {
  const s = startServer()
  try {
    s.state.graphs.set("default", seedGraph([
      { id: "n1", file: "a.ts", domain: "auth", level: "P5", claims: ["c1"], anchor: "" },
      { id: "n2", file: "b.ts", domain: "auth", level: "P3", claims: [], anchor: "" },
      { id: "n3", file: "c.ts", domain: "billing", level: "P5", claims: [], anchor: "" },
    ]))
    const a = await register(s.url, "alice")
    const view = await readResource(s.url, "graph://domain/auth", a.token)
    expect(view.domain).toBe("auth")
    expect(view.cells.map((c: any) => c.cell)).toEqual(["auth:3", "auth:5"]) // sorted, billing excluded
    const p5 = view.cells.find((c: any) => c.cell === "auth:5")
    expect(p5).toMatchObject({ nodeCount: 1, claimCount: 1, authority: "source", lock: null })
  } finally {
    s.stop()
  }
})

test("graph://domain/{d}: unknown domain returns an empty cells array (not an error)", async () => {
  const s = startServer()
  try {
    s.state.graphs.set("default", seedGraph([{ id: "n1", file: "a.ts", domain: "auth", level: "P5", claims: [], anchor: "" }]))
    const env = resolveResource(s.state, "graph://domain/does-not-exist", "default") as any
    expect(env).toEqual({ domain: "does-not-exist", cells: [] })
  } finally {
    s.stop()
  }
})

test("graph://domain/ (missing domain) throws 'domain required'", () => {
  const s = startServer()
  try {
    expect(() => resolveResource(s.state, "graph://domain/", "default")).toThrow("domain required")
    expect(() => resolveResource(s.state, "graph://domain", "default")).toThrow("domain required")
  } finally {
    s.stop()
  }
})

test("graph://cell/{k} is tenant-scoped: tenant A's cell is not readable with tenant B's token", async () => {
  const s = startServer()
  try {
    s.state.graphs.set("tenant-a", seedGraph([{ id: "secret", file: "secret.ts", domain: "secret", level: "P5", claims: ["c1"], anchor: "" }]))
    const b = await register(s.url, "bob", "tenant-b")

    const asB = await readResource(s.url, "graph://cell/secret:5", b.token)
    expect(asB.nodeCount).toBe(0) // tenant-b's own (empty) graph, never tenant-a's node
    expect(asB.claimCount).toBe(0)

    const asA = resolveResource(s.state, "graph://cell/secret:5", "tenant-a") as any
    expect(asA.nodeCount).toBe(1) // control: the data really is there, just not visible to tenant-b
  } finally {
    s.stop()
  }
})

// ---------------------------------------------------------------------------
// The authority divergence probe (REPORT-B1 / campaign §4 pre-classified finding).
//
// `cellState`'s `authority` field used to read `graph?.authority?.[cellKey] ?? "source"` off the hot
// in-memory graph, while `store.authorityOf` (used by the final gate in changeset.ts) reads the SQLite
// `authority` table. Two angles were tried to make them disagree:
//
//   (a) flip while the hot graph exists (it stays in sync at flip time — changeset.ts updates
//       tg.graph.authority directly on commit), THEN call graph.rebuild/graph.bootstrap. Both replace
//       tg.graph wholesale with a freshly-indexed Graph whose `authority` field is empty — the fresh
//       index has no way to know about a prior flip. persistGraph (graph-bootstrap.ts) only WRITES
//       `graph.authority` INTO the SQLite table; it never reads existing rows back out to merge into the
//       new in-memory graph. So the SQLite row survives (the table is only ever unioned into, never
//       DELETEd on reindex) but the hot graph forgets — REPRODUCES.
//   (b) flip authority in a tenant whose hot graph is null (commit path in changeset.ts guards
//       `if (tg.graph)` before touching `tg.graph.authority`, but `writeAuthority` — the SQLite write —
//       runs unconditionally). Before any bootstrap, `graph://cell` read "source" while SQLite already
//       said "graph" — REPRODUCES, and is in fact the same root cause as (a): `cellState` trusted the
//       hot graph, which is not guaranteed to reflect every committed flip.
//
// FIX (Tier 1, this file only, no shape change): `cellState`'s `authority` field now reads through
// `store.authorityOf` (SQLite) directly, exactly like the final gate does — never `graph.authority`.
// This closes both angles without touching graph-bootstrap.ts (WS-F's file): SQLite was never wrong,
// only the hot-graph shortcut resources.ts used to read was. WS-F may still independently choose to make
// bootstrap/rebuild merge SQLite authority into the freshly-built hot graph (so `graph://snapshot`, which
// legitimately DOES report `graph.authority` verbatim, stops reverting too) — that is a separate, correct
// fix in a file this workstream does not own, and is reported, not applied, here.
// ---------------------------------------------------------------------------

test("REPORT-B1: authority divergence angle (b) — flip with a null hot graph, before any bootstrap", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    expect(s.state.graphs.get("default")?.graph ?? null).toBeNull() // control: hot graph is null

    const flip = await callTool(s.url, "authority.flip", { token: a.token, cell: "nevermounted:5", to: "graph" })
    expect(flip.ok).toBe(true)

    // SQLite (the final gate's source of truth) already says "graph".
    const row = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", "nevermounted:5") as { value: string }
    expect(row.value).toBe("graph")

    // graph://cell must agree — this is the fixed behavior; before the Tier 1 fix this read "source"
    // because tg.graph was (and still is, at this point) null.
    const cell = await readResource(s.url, "graph://cell/nevermounted:5", a.token)
    expect(cell.authority).toBe("graph")
  } finally {
    s.stop()
  }
})

test("REPORT-B1: authority divergence angle (a) — flip while hot, then bootstrap wipes the hot graph's authority but not SQLite's", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    // Give the tenant a hot graph so the flip updates tg.graph.authority in-memory too (the "easy" case).
    s.state.graphs.set("default", seedGraph([{ id: "n1", file: "a.ts", domain: "rebuiltdomain", level: "P5", claims: [], anchor: "" }]))

    const flip = await callTool(s.url, "authority.flip", { token: a.token, cell: "rebuiltdomain:5", to: "graph" })
    expect(flip.ok).toBe(true)
    expect((s.state.graphs.get("default")!.graph as any).authority).toEqual({ "rebuiltdomain:5": "graph" })

    // WS-F's bootstrap/rebuild replaces tg.graph wholesale with a freshly-indexed graph — simulate that
    // exact replacement (the real indexer would do the same: a fresh index has no memory of prior flips).
    s.state.graphs.set("default", seedGraph([{ id: "n1", file: "a.ts", domain: "rebuiltdomain", level: "P5", claims: [], anchor: "" }]))
    expect((s.state.graphs.get("default")!.graph as any).authority).toBeUndefined() // hot graph forgot

    // SQLite never forgot.
    const row = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", "rebuiltdomain:5") as { value: string }
    expect(row.value).toBe("graph")

    // graph://cell reads through SQLite, so it still agrees post-"rebuild".
    const cell = await readResource(s.url, "graph://cell/rebuiltdomain:5", a.token)
    expect(cell.authority).toBe("graph")
  } finally {
    s.stop()
  }
})
