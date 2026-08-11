/**
 * claim-covers.test.ts — F4 (docs/CHANGELOG.md §F4).
 *
 * `refs` used to carry two incompatible contracts: ladder adjacency (roundtrip.checkClaims,
 * blocking at commit — every ref must resolve to a CLAIM id) and node coverage (claimCoverage,
 * gated at authority.flip — measured against NODE ids). The only way to satisfy both with one
 * field was a floor-claim trick (a level-5 claim whose id IS the node's id). `covers` is the new,
 * explicit field for node coverage, letting `refs` go back to being pure ladder adjacency.
 *
 * This file proves:
 *   1. Coverage closed using ONLY `covers` (no floor-claim anywhere) reaches authority.flip("graph").
 *   2. The legacy floor-claim path (refs carrying a node id) still closes coverage — no regression,
 *      no lost coverage for claims written before `covers` existed.
 *   3. `refs` pointing at a node id is still `dangling-ref` at commit when no claim shares that id —
 *      contract 1 (ladder adjacency) has not been loosened by adding `covers`.
 *   4. A STATE_DIR built by a server running the OLD schema (claims table without `covers`) still
 *      boots and works after the migration — ALTER TABLE ran, no crash on an existing tenant.
 *   5. Partial coverage (one node in the cell left uncovered) still refuses the flip.
 */
import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { startServer } from "../src/index"
import { callTool, register, tempRepo } from "./helpers"

function insertNode(s: { state: { db: { query: (sql: string) => { run: (...args: unknown[]) => unknown } } } }, id: string, domain: string, level: string, file: string, anchor: string): void {
  s.state.db.query("INSERT INTO nodes (tenant_id,id,domain,level,file,anchor) VALUES (?,?,?,?,?,?)").run("default", id, domain, level, file, anchor)
}

// ── 1. covers ALONE (no floor-claim in sight) closes coverage and reaches authority.flip("graph") ──

test("F4: coverage closed using ONLY `covers` (no floor-claim) allows authority.flip to graph", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root })
  try {
    const a = await register(s.url, "alice")
    const domain = "coversonly"
    // Node lives at level 5 (code) — the claim closing its cell's coverage can sit at the extreme
    // (refs: [] is valid there per roundtrip, no adjacency needed), so this exercises `covers` in
    // total isolation from the cross-cell ladder-adjacency machinery (verify.ts's dangling-ref check
    // is scoped per-cell and — pre-existing, orthogonal to F4 — only tolerates a claim's ref pointing
    // at another claim's id if that id ALSO happens to be a node id in the SAME cell; that constraint
    // is what forces the floor-claim id-equals-node-id trick for any ladder ref crossing cells, and is
    // untouched here on purpose — this test isolates `covers` itself, not the ladder).
    insertNode(s, `${domain}-node`, domain, "P5", "src/audit.ts", "adversarialAudit")
    const nodeId = `${domain}-node`

    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: [`${domain}:5`], intent: "covers-only" })

    // The claim's own id is NOT the node's id — this is deliberately NOT a floor-claim. Coverage is
    // declared solely through `covers`.
    const claim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: `${domain}-claim`, subject: "grounding claim", domain, level: 5, refs: [], covers: [nodeId], anchor: "adversarialAudit", file: "src/audit.ts" } },
    })
    expect(claim.ok).toBe(true)

    const flip = await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: { kind: "authority.flip", payload: { cell: `${domain}:5`, to: "graph" } } })
    expect(flip.ok).toBe(true)

    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "covers-only" })
    expect(commit.ok).toBe(true)

    const row = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", `${domain}:5`) as { value: string }
    expect(row.value).toBe("graph")

    // The claim's id truly never coincided with the node's id — proves this closed WITHOUT the
    // floor-claim trick, purely via `covers`.
    expect(`${domain}-claim`).not.toBe(nodeId)
  } finally {
    s.stop()
    cleanup()
  }
})

// ── 2. Legacy floor-claim path (refs carrying the node id) STILL closes coverage — compatibility ──

test("F4: legacy floor-claim (refs carrying node id, no `covers`) still closes coverage — back-compat", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root })
  try {
    const a = await register(s.url, "alice")
    const domain = "legacyfloor"
    insertNode(s, `${domain}-node`, domain, "P4", "src/audit.ts", "adversarialAudit")
    const nodeId = `${domain}-node`

    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: [`${domain}:4`, `${domain}:5`], intent: "legacy floor" })

    // Classic floor-claim: id === node id, refs: [], no `covers` field at all.
    const floor = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: nodeId, subject: nodeId, domain, level: 5, refs: [], anchor: "adversarialAudit", file: "src/audit.ts" } },
    })
    expect(floor.ok).toBe(true)

    const upper = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: `${domain}-upper`, subject: "upper", domain, level: 4, refs: [nodeId] } },
    })
    expect(upper.ok).toBe(true)

    const flip = await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: { kind: "authority.flip", payload: { cell: `${domain}:4`, to: "graph" } } })
    expect(flip.ok).toBe(true)

    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "legacy floor" })
    expect(commit.ok).toBe(true)

    const row = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", `${domain}:4`) as { value: string }
    expect(row.value).toBe("graph")
  } finally {
    s.stop()
    cleanup()
  }
})

// ── 3. refs pointing at a node id is STILL dangling-ref at commit when no claim shares that id ──
// (contract 1 — ladder adjacency — did not loosen just because `covers` exists now)

test("F4: refs pointing at a bare node id (no claim with that id, and no covers) still dangling-refs at commit", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root })
  try {
    const a = await register(s.url, "alice")
    const domain = "stilldangling"
    insertNode(s, `${domain}-node`, domain, "P4", "src/audit.ts", "adversarialAudit")
    const nodeId = `${domain}-node`

    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: [`${domain}:4`], intent: "still dangling" })

    // Level-4 claim refs the RAW node id directly — no claim in the set has that id, and `covers` is
    // not used either. incrementalGate accepts with a roundtrip warning; commit must hard-block.
    const claimResult = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: `${domain}-bad`, subject: "bad", domain, level: 4, refs: [nodeId] } },
    })
    expect(claimResult.ok).toBe(true) // incremental gate: advisory only, not blocking
    expect(claimResult.warnings.join(" ")).toContain("dangling-ref")

    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "still dangling" })
    expect(commit.ok).toBe(false)
    expect(commit.reasons.join(" ")).toContain("dangling-ref")

    // No authority was written — the flip path never even got a chance.
    const row = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", `${domain}:4`)
    expect(row).toBeNull()
  } finally {
    s.stop()
    cleanup()
  }
})

// ── 4. Migration: a STATE_DIR built by the OLD schema (claims table with no `covers` column) still
// boots and works after the migration — ALTER TABLE ran against a pre-existing tenant. ──

test("F4 migration: a claims table created before `covers` existed gets migrated in place and keeps working", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const stateDir = mkdtempSync(path.join(tmpdir(), "og-state-oldschema-"))
  // Build the OLD schema by hand — the exact `claims` CREATE TABLE this repo shipped before F4,
  // minus the `covers` column — to prove openDb's migration (PRAGMA table_info + ALTER TABLE) fires
  // against a real pre-existing STATE_DIR, not just a freshly created one.
  const oldDb = new Database(path.join(stateDir, "state.sqlite"), { create: true })
  oldDb.exec(`
    CREATE TABLE IF NOT EXISTS tenants (tenant_id TEXT NOT NULL, repo_path TEXT, domains TEXT, indexed_at TEXT, PRIMARY KEY (tenant_id));
    CREATE TABLE IF NOT EXISTS users (tenant_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (tenant_id, id));
    CREATE TABLE IF NOT EXISTS nodes (tenant_id TEXT NOT NULL, id TEXT NOT NULL, domain TEXT, level TEXT, file TEXT, kind TEXT, sig TEXT, anchor TEXT, symbol_path TEXT, token_hash TEXT, exposed INTEGER, responsibility TEXT, confidence REAL, created_seq INTEGER, supersede_seq INTEGER, PRIMARY KEY (tenant_id, id));
    CREATE TABLE IF NOT EXISTS edges (tenant_id TEXT NOT NULL, id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL, created_seq INTEGER, supersede_seq INTEGER, PRIMARY KEY (tenant_id, id));
    CREATE TABLE IF NOT EXISTS claims (tenant_id TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, subject TEXT, domain TEXT, level TEXT, refs TEXT, anchor TEXT, file TEXT, verdict_confidence REAL, verdict_overclaim INTEGER, supersedes TEXT, PRIMARY KEY (tenant_id, id));
    CREATE TABLE IF NOT EXISTS authority (tenant_id TEXT NOT NULL, cell TEXT NOT NULL, value TEXT NOT NULL, last_flip_seq INTEGER, last_flip_by TEXT, PRIMARY KEY (tenant_id, cell));
    CREATE TABLE IF NOT EXISTS changesets (tenant_id TEXT NOT NULL, id TEXT NOT NULL, intent TEXT NOT NULL, parent TEXT, status TEXT NOT NULL, opened_by TEXT NOT NULL, opened_at TEXT NOT NULL, closed_at TEXT, base_seq INTEGER, admit_seq INTEGER, blast_cells TEXT, PRIMARY KEY (tenant_id, id));
    CREATE TABLE IF NOT EXISTS cs_deltas (tenant_id TEXT NOT NULL, cs_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (tenant_id, cs_id, seq));
    CREATE TABLE IF NOT EXISTS locks (tenant_id TEXT NOT NULL, cell TEXT NOT NULL, cs_id TEXT NOT NULL, mode TEXT NOT NULL, acquired_at TEXT NOT NULL, expires_at TEXT NOT NULL, holder TEXT NOT NULL, PRIMARY KEY (tenant_id, cell));
    CREATE TABLE IF NOT EXISTS events (tenant_id TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL, kind TEXT NOT NULL, target_kind TEXT, target_id TEXT, payload TEXT, by_user TEXT, PRIMARY KEY (tenant_id, seq));
    CREATE TABLE IF NOT EXISTS system_messages (tenant_id TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tokens (tenant_id TEXT NOT NULL, token_hash TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY (token_hash));
  `)
  // Pre-existing tenant/claim row, written under the old schema — proves migrating in place doesn't
  // lose or corrupt what was already there.
  oldDb.query("INSERT INTO tenants (tenant_id, repo_path, domains, indexed_at) VALUES (?,?,?,?)").run("default", null, "[]", new Date().toISOString())
  oldDb.query("INSERT INTO claims (tenant_id, id, seq, subject, domain, level, refs, anchor, file) VALUES (?,?,?,?,?,?,?,?,?)").run(
    "default", "preexisting-claim", 1, "s", "oldschema", "P5", "[]", null, null,
  )
  const oldCols = oldDb.query("PRAGMA table_info(claims)").all() as { name: string }[]
  expect(oldCols.some((c) => c.name === "covers")).toBe(false)
  oldDb.close()

  const s = startServer({ stateDir, repoPath: root })
  try {
    // Server booted on the pre-existing STATE_DIR without crashing — the migration ran.
    const cols = s.state.db.query("PRAGMA table_info(claims)").all() as { name: string }[]
    expect(cols.some((c) => c.name === "covers")).toBe(true)

    // The claim written under the old schema survived the ALTER TABLE untouched.
    const pre = s.state.db.query("SELECT id, refs, covers FROM claims WHERE tenant_id = ? AND id = ?").get("default", "preexisting-claim") as { id: string; refs: string; covers: string | null }
    expect(pre.id).toBe("preexisting-claim")
    expect(pre.covers).toBeNull()

    // And the migrated table works end-to-end with `covers` going forward.
    const a = await register(s.url, "alice")
    insertNode(s, "migrated-node", "migrated", "P5", "src/audit.ts", "adversarialAudit")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["migrated:5"], intent: "post-migration" })
    const claim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "migrated-claim", subject: "grounding", domain: "migrated", level: 5, refs: [], covers: ["migrated-node"], anchor: "adversarialAudit", file: "src/audit.ts" } },
    })
    expect(claim.ok).toBe(true)
    const flip = await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: { kind: "authority.flip", payload: { cell: "migrated:5", to: "graph" } } })
    expect(flip.ok).toBe(true)
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "post-migration" })
    expect(commit.ok).toBe(true)
  } finally {
    s.stop()
    cleanup()
  }
})

// ── 5. Partial coverage (one node in the cell left uncovered) still refuses the flip ──

test("F4: partial coverage via `covers` (one node left out) still refuses authority.flip", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root })
  try {
    const a = await register(s.url, "alice")
    const domain = "partialcover"
    insertNode(s, `${domain}-node1`, domain, "P5", "src/audit.ts", "adversarialAudit")
    insertNode(s, `${domain}-node2`, domain, "P5", "src/audit.ts", "adversarialAudit")

    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: [`${domain}:5`], intent: "partial" })

    // Only node1 gets covered — node2 is left out on purpose.
    const claim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: `${domain}-claim`, subject: "grounding", domain, level: 5, refs: [], covers: [`${domain}-node1`], anchor: "adversarialAudit", file: "src/audit.ts" } },
    })
    expect(claim.ok).toBe(true)

    const flip = await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: { kind: "authority.flip", payload: { cell: `${domain}:5`, to: "graph" } } })
    expect(flip.ok).toBe(true) // incremental gate doesn't check coverage — only the final gate does

    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "partial" })
    expect(commit.ok).toBe(false)
    expect(commit.reasons.join(" ")).toContain("coverage not balanced")
    expect(commit.reasons.join(" ")).toContain("1 node(s) without claims")

    const row = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", `${domain}:5`)
    expect(row).toBeNull()
  } finally {
    s.stop()
    cleanup()
  }
})
