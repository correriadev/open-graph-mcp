/**
 * graph-import.ts — `graph.import { token, repoPath }` = migrate-from-phase-1 (spec §3.4). Lê o `.graph/`
 * (graph.json + claims.jsonl) e popula nodes/edges/claims/authority do tenant no SQLite autoritativo, +
 * cria um changeset 'bootstrap' admitted (admit_seq=0, blast_cells=todas). IDEMPOTENTE: a 2ª chamada vê o
 * changeset bootstrap já presente e é no-op (não re-espelha JSONL, não infla contagens).
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import type { Graph } from "@open-graph-mcp/graph-core/build"
import { readAllClaims } from "@open-graph-mcp/graph-core/claim-store"
import { createHash } from "node:crypto"
import { write } from "../db"
import { appendEvent, tenantGraph, type ServerState } from "../state"
import { requireToken } from "./session"
import { cellOfClaim } from "../gates"

const BOOTSTRAP_ID = "cs_bootstrap"

export type ImportResult = { ok: true; imported: boolean; nodes: number; edges: number; claims: number; graphId: string }

export function graphImport(state: ServerState, args: { token: string; repoPath?: string }): ImportResult {
  const { userId, tenantId: tenant } = requireToken(state, args.token)
  const root = path.resolve(args.repoPath ?? state.repoPath)

  const existing = state.db.query("SELECT id FROM changesets WHERE tenant_id = ? AND id = ?").get(tenant, BOOTSTRAP_ID)
  const counts = () => ({
    nodes: (state.db.query("SELECT COUNT(*) AS c FROM nodes WHERE tenant_id = ?").get(tenant) as { c: number }).c,
    edges: (state.db.query("SELECT COUNT(*) AS c FROM edges WHERE tenant_id = ?").get(tenant) as { c: number }).c,
    claims: (state.db.query("SELECT COUNT(*) AS c FROM claims WHERE tenant_id = ?").get(tenant) as { c: number }).c,
  })

  const graph = JSON.parse(readFileSync(path.join(root, ".graph", "graph.json"), "utf8")) as Graph
  const graphId = createHash("sha256").update(`${root}:${tenant}:${graph.stats.nodes}:${graph.stats.claims}`).digest("hex").slice(0, 16)

  const tg = tenantGraph(state, tenant)
  tg.graph = graph
  tg.graphId = graphId
  tg.pipeline = "existing"
  tg.bootstrappedAt = new Date().toISOString()

  if (existing) return { ok: true, imported: false, ...counts(), graphId } // idempotente: no-op

  const claims = readAllClaims(root)
  const cells = new Set<string>()

  const tx = state.db.transaction(() => {
    for (const n of graph.nodes) {
      write(state.db, state.stateDir, tenant, "nodes", {
        tenant_id: tenant, id: n.id, domain: n.domain, level: String(n.level), file: n.file, kind: n.kind, sig: n.sig ?? null, anchor: n.anchor,
        symbol_path: null, token_hash: null, exposed: n.exposed ? 1 : 0, responsibility: n.responsibility, confidence: n.confidence, created_seq: 0, supersede_seq: null,
      })
      if (n.domain) cells.add(`${n.domain}:${String(n.level).replace(/^P/, "")}`)
    }
    for (const e of graph.edges) {
      const id = `${e.from}->${e.to}:${e.type}`
      write(state.db, state.stateDir, tenant, "edges", { tenant_id: tenant, id, from_id: e.from, to_id: e.to, kind: e.type, created_seq: 0, supersede_seq: null })
    }
    let seq = 0
    for (const c of claims) {
      write(state.db, state.stateDir, tenant, "claims", {
        tenant_id: tenant, id: c.id, seq: c.seq ?? ++seq, subject: c.subject, domain: c.domain ?? null, level: c.level != null ? String(c.level) : null,
        refs: JSON.stringify(c.refs ?? []), anchor: c.anchor ?? null, file: c.file ?? null, verdict_confidence: c.verdict?.confidence ?? null, verdict_overclaim: c.verdict?.overclaim ? 1 : 0, supersedes: null,
      })
      cells.add(cellOfClaim(c))
    }
    for (const [cell, value] of Object.entries(graph.authority ?? {})) {
      write(state.db, state.stateDir, tenant, "authority", { tenant_id: tenant, cell, value, last_flip_seq: 0, last_flip_by: userId })
    }
    write(state.db, state.stateDir, tenant, "changesets", {
      tenant_id: tenant, id: BOOTSTRAP_ID, intent: "phase-1 import", parent: null, status: "admitted", opened_by: userId, opened_at: new Date().toISOString(), closed_at: new Date().toISOString(), base_seq: 0, admit_seq: 0, blast_cells: JSON.stringify([...cells].sort()),
    })
  })
  tx()

  appendEvent(state, tenant, { kind: "graph.imported", targetKind: "changeset", targetId: BOOTSTRAP_ID, byUser: userId, payload: { graphId, ...counts() } })
  return { ok: true, imported: true, ...counts(), graphId }
}
