/**
 * store.ts — leituras/escrituras SQLite escopadas por tenant, compartilhadas por gates, changeset e import.
 * Escrituras duráveis passam por `write` (SQLite + JSONL). Leituras devolvem snapshots planos p/ os gates
 * puros (gates.ts nunca tocam o banco).
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { write } from "./db"
import type { ServerState } from "./state"
import type { ClaimSnapshot, NodeSnapshot } from "./gates"
import { canonicalCell } from "./gates"
import { normalizeClaimLevel } from "./claim-level"

/**
 * readClaims — QA-5 achou este SELECT rodando a cada `changeset.claim` (não só no commit), custo
 * crescendo com o total de claims já commitados: p95 subiu ~9x num soak de 10min. Cacheado em memória
 * por tenant (`state.claimsCache`), populado lazy aqui na primeira leitura, mantido incrementalmente
 * por `writeClaim` — evita o full-tenant-scan repetido sem mudar a forma como os chamadores usam isto.
 */
export function readClaims(state: ServerState, tenant: string): ClaimSnapshot[] {
  const cached = state.claimsCache.get(tenant)
  if (cached) return cached
  const rows = state.db.query("SELECT id, subject, domain, level, refs, covers, anchor, file FROM claims WHERE tenant_id = ?").all(tenant) as {
    id: string
    subject: string | null
    domain: string | null
    level: string | null
    refs: string | null
    covers: string | null
    anchor: string | null
    file: string | null
  }[]
  const claims = rows.map((r) => {
    const normalized = normalizeClaimLevel(r.level)
    return ({
    id: r.id,
    subject: r.subject ?? undefined,
    domain: r.domain ?? undefined,
    level: normalized.ok ? normalized.numeric : undefined,
    refs: JSON.parse(r.refs ?? "[]"),
    covers: r.covers ? JSON.parse(r.covers) : undefined,
    anchor: r.anchor ?? undefined,
    file: r.file ?? undefined,
  })})
  state.claimsCache.set(tenant, claims)
  return claims
}

export function readNodes(state: ServerState, tenant: string): NodeSnapshot[] {
  const rows = state.db.query("SELECT id, domain, level, file, anchor FROM nodes WHERE tenant_id = ?").all(tenant) as {
    id: string
    domain: string | null
    level: string | null
    file: string | null
    anchor: string | null
  }[]
  return rows.map((r) => ({ id: r.id, domain: r.domain, level: Number(String(r.level ?? "P5").replace(/^P/, "")) || 5, file: r.file ?? "", anchor: r.anchor ?? "" }))
}

/** Invalidates readClaims' cache for a tenant — call after any claims mutation that bypasses
 *  writeClaim (currently only `rebuildFromJsonl`, db.ts — it writes claims directly via insertRow). */
export function invalidateClaimsCache(state: ServerState, tenant: string): void {
  state.claimsCache.delete(tenant)
}

/**
 * F1/F7 (integração): chave canônica na LEITURA e na ESCRITA da tabela `authority`. Sem isto,
 * `auth:P4` e `auth:4` viram duas linhas para a mesma célula — uma célula podia estar `graph` numa
 * grafia e `source` na outra ao mesmo tempo, e o gate final leria a que estivesse mais conveniente.
 */
export function authorityOf(state: ServerState, tenant: string, cell: string): "source" | "graph" | "suspended" {
  const row = state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get(tenant, canonicalCell(cell)) as { value: string } | null
  return (row?.value as any) ?? "source"
}

/**
 * Raízes de repo candidatas p/ resolver âncora/verify, sem exigir tenant explícito no call site (os
 * dois chamadores, `changeset.ts::changesetClaim/changesetCommit`, chamam `makeReadFile(state)` sem
 * tenant — mudar essa assinatura pertenceria a `changeset.ts`, arquivo de outro stream).
 *
 * `state.repoPath` (env/StartOptions de processo) é tentado PRIMEIRO — back-compat com quem passa
 * repoPath explícito ao subir o servidor (ex.: testes que fazem `startServer({ repoPath })`). No
 * caminho de PRODUÇÃO (`bun run dev`) isto é sempre `""`: `index.ts` não lê nenhuma env var de repo
 * (D1 — o repo é argumento de `graph.bootstrap`, não config de processo), então antes deste fix
 * `makeReadFile` devolvia `undefined` p/ TODO arquivo, e o gate de âncora (`c.anchor && c.file` em
 * `gates.ts::incrementalGate`) RECUSAVA toda claim com âncora+arquivo — mesmo com âncora genuína.
 *
 * Fallback: o `repoPath` HOT de cada tenant já indexado (`TenantGraph.repoPath`, setado em
 * `graph-bootstrap.ts::bootstrap`) e, defensivamente, `tenants.repo_path` no SQLite (tenant que por
 * algum motivo não tem o hot preenchido neste processo). Tentamos CADA raiz candidata até uma leitura
 * bater — não escolhemos "o" tenant do caller porque essa informação não chega aqui; colisão de
 * caminho relativo entre dois repos de tenants diferentes é uma ambiguidade pré-existente (o campo
 * único `state.repoPath` já não distinguia tenants) e fica documentada, não resolvida por este fix.
 */
function candidateRepoRoots(state: ServerState): string[] {
  const roots = new Set<string>()
  if (state.repoPath) roots.add(state.repoPath)
  for (const tg of state.graphs.values()) if (tg.repoPath) roots.add(tg.repoPath)
  const rows = state.db.query("SELECT repo_path FROM tenants WHERE repo_path IS NOT NULL").all() as { repo_path: string | null }[]
  for (const r of rows) if (r.repo_path) roots.add(r.repo_path)
  return [...roots]
}

/** readFile injetável p/ os gates (âncora/verify). Ausente em toda raiz candidata → undefined. */
export function makeReadFile(state: ServerState): (f: string) => string | undefined {
  const cache = new Map<string, string | undefined>()
  return (f: string) => {
    if (cache.has(f)) return cache.get(f)
    let content: string | undefined
    for (const root of candidateRepoRoots(state)) {
      try {
        content = readFileSync(path.join(root, f), "utf8")
        break
      } catch {
        continue
      }
    }
    cache.set(f, content)
    return content
  }
}

export function writeClaim(state: ServerState, tenant: string, seq: number, c: ClaimSnapshot): void {
  const normalized = normalizeClaimLevel(c.level)
  if (!normalized.ok || typeof c.level !== "number") throw new Error("claim.add: invalid level")
  write(state.db, state.stateDir, tenant, "claims", {
    tenant_id: tenant,
    id: c.id,
    seq,
    subject: c.subject ?? null,
    domain: c.domain ?? null,
    level: normalized.stored,
    refs: JSON.stringify(c.refs ?? []),
    covers: c.covers?.length ? JSON.stringify(c.covers) : null,
    anchor: c.anchor ?? null,
    file: c.file ?? null,
    verdict_confidence: null,
    verdict_overclaim: null,
    supersedes: null,
  })
  // Keep readClaims' cache in sync — claims are append-only (never updated/deleted once committed),
  // so pushing here is always correct as long as the cache was already populated (if not, the next
  // readClaims just loads fresh from SQLite, this row included).
  state.claimsCache.get(tenant)?.push({ ...c, refs: c.refs ?? [] })
}

export function writeAuthority(state: ServerState, tenant: string, cell: string, value: string, seq: number, by: string): void {
  write(state.db, state.stateDir, tenant, "authority", { tenant_id: tenant, cell: canonicalCell(cell), value, last_flip_seq: seq, last_flip_by: by })
}

/** Maior seq de claim do tenant (base do contador monotônico de claims). */
export function maxClaimSeq(state: ServerState, tenant: string): number {
  const row = state.db.query("SELECT COALESCE(MAX(seq),0) AS m FROM claims WHERE tenant_id = ?").get(tenant) as { m: number }
  return row.m
}

/** Nome de exibição do holder p/ eventos "em edição por X" (node.editing/node.idle, F1) — cai pro
 *  próprio userId se o registro de `users` sumiu (nunca deveria, mas o evento não pode quebrar por isso). */
export function holderNameOf(state: ServerState, tenant: string, userId: string): string {
  const row = state.db.query("SELECT name FROM users WHERE tenant_id = ? AND id = ?").get(tenant, userId) as { name: string } | null
  return row?.name ?? userId
}

import type {
  GraphSnapshotV2,
  HorizonGraphScope,
  CoverageManifest,
  EvidenceRecord,
  PublishedRelationship,
  GraphNodeV2,
} from "@open-graph-mcp/graph-core/relationship-types"
import { durableTransaction } from "./db"

export function publishHorizonGraphSnapshot(state: ServerState, snapshot: GraphSnapshotV2): void {
  const { tenantId, horizonId, graphId } = snapshot.scope
  const now = new Date().toISOString()

  durableTransaction(state.db, () => {
    // Delete existing snapshot rows for this exact scope to be strictly idempotent
    state.db.query("DELETE FROM graph_snapshots_v2 WHERE tenant_id = ? AND horizon_id = ? AND graph_id = ?").run(tenantId, horizonId, graphId)
    state.db.query("DELETE FROM nodes_v2 WHERE tenant_id = ? AND horizon_id = ? AND graph_id = ?").run(tenantId, horizonId, graphId)
    state.db.query("DELETE FROM relationships_v2 WHERE tenant_id = ? AND horizon_id = ? AND graph_id = ?").run(tenantId, horizonId, graphId)
    state.db.query("DELETE FROM evidence_v2 WHERE tenant_id = ? AND horizon_id = ? AND graph_id = ?").run(tenantId, horizonId, graphId)
    state.db.query("DELETE FROM coverage_manifests_v2 WHERE tenant_id = ? AND horizon_id = ? AND graph_id = ?").run(tenantId, horizonId, graphId)

    // Mark previous snapshots of this tenant/horizon as superseded
    state.db.query("UPDATE graph_snapshots_v2 SET status = 'superseded' WHERE tenant_id = ? AND horizon_id = ? AND status = 'active'").run(tenantId, horizonId)

    write(state.db, state.stateDir, tenantId, "graph_snapshots_v2", {
      tenant_id: tenantId,
      horizon_id: horizonId,
      graph_id: graphId,
      policy_version: snapshot.policyVersion,
      status: "active",
      created_at: now,
    })

    for (const node of snapshot.nodes) {
      write(state.db, state.stateDir, tenantId, "nodes_v2", {
        tenant_id: tenantId,
        horizon_id: horizonId,
        graph_id: graphId,
        id: node.id,
        file: node.file,
        kind: node.kind,
        domain: node.domain ?? null,
        label: node.label ?? null,
      })
    }

    for (const rel of snapshot.relationships) {
      write(state.db, state.stateDir, tenantId, "relationships_v2", {
        tenant_id: tenantId,
        horizon_id: horizonId,
        graph_id: graphId,
        id: rel.id,
        source_id: rel.source,
        target_id: rel.target,
        type: rel.type,
        grade: rel.grade,
        evidence_ids: JSON.stringify(rel.evidenceIds),
        traversable: rel.traversable ? 1 : 0,
      })
    }

    for (const ev of snapshot.evidence) {
      write(state.db, state.stateDir, tenantId, "evidence_v2", {
        tenant_id: tenantId,
        horizon_id: horizonId,
        graph_id: graphId,
        id: ev.id,
        source_id: ev.sourceId,
        kind: ev.kind,
        target_text: ev.targetText,
        location_json: JSON.stringify(ev.location),
      })
    }

    write(state.db, state.stateDir, tenantId, "coverage_manifests_v2", {
      tenant_id: tenantId,
      horizon_id: horizonId,
      graph_id: graphId,
      by_format_json: JSON.stringify(snapshot.coverage.byFormat),
      by_family_json: JSON.stringify(snapshot.coverage.byFamily),
      failures_json: JSON.stringify(snapshot.coverage.failures),
      eligible_count: snapshot.coverage.eligibleCount ?? null,
      analyzed_count: snapshot.coverage.analyzedCount ?? null,
      excluded_count: snapshot.coverage.excludedCount ?? null,
    })
  })
}

export function findHorizonGraphById(
  state: ServerState,
  tenantId: string,
  horizonId: string,
  graphId: string
): GraphSnapshotV2 | null {
  const snapRow = state.db
    .query("SELECT policy_version FROM graph_snapshots_v2 WHERE tenant_id = ? AND horizon_id = ? AND graph_id = ?")
    .get(tenantId, horizonId, graphId) as { policy_version: string } | null

  if (!snapRow) return null

  const nodeRows = state.db
    .query("SELECT id, file, kind, domain, label FROM nodes_v2 WHERE tenant_id = ? AND horizon_id = ? AND graph_id = ? ORDER BY id")
    .all(tenantId, horizonId, graphId) as { id: string; file: string; kind: string; domain: string | null; label: string | null }[]

  const relRows = state.db
    .query("SELECT id, source_id, target_id, type, grade, evidence_ids, traversable FROM relationships_v2 WHERE tenant_id = ? AND horizon_id = ? AND graph_id = ? ORDER BY id")
    .all(tenantId, horizonId, graphId) as { id: string; source_id: string; target_id: string; type: string; grade: string; evidence_ids: string; traversable: number }[]

  const evRows = state.db
    .query("SELECT id, source_id, kind, target_text, location_json FROM evidence_v2 WHERE tenant_id = ? AND horizon_id = ? AND graph_id = ? ORDER BY id")
    .all(tenantId, horizonId, graphId) as { id: string; source_id: string; kind: string; target_text: string; location_json: string }[]

  const covRow = state.db
    .query("SELECT by_format_json, by_family_json, failures_json, eligible_count, analyzed_count, excluded_count FROM coverage_manifests_v2 WHERE tenant_id = ? AND horizon_id = ? AND graph_id = ?")
    .get(tenantId, horizonId, graphId) as { by_format_json: string; by_family_json: string; failures_json: string; eligible_count: number | null; analyzed_count: number | null; excluded_count: number | null } | null

  const scope: HorizonGraphScope = { tenantId, horizonId, graphId }

  const coverage: CoverageManifest = covRow
    ? {
        scope,
        byFormat: JSON.parse(covRow.by_format_json),
        byFamily: JSON.parse(covRow.by_family_json),
        failures: JSON.parse(covRow.failures_json),
        eligibleCount: covRow.eligible_count ?? undefined,
        analyzedCount: covRow.analyzed_count ?? undefined,
        excludedCount: covRow.excluded_count ?? undefined,
      }
    : {
        scope,
        byFormat: {},
        byFamily: {},
        failures: [],
      }

  return {
    scope,
    policyVersion: snapRow.policy_version,
    nodes: nodeRows.map((n) => ({
      id: n.id,
      file: n.file,
      kind: n.kind,
      domain: n.domain,
      label: n.label ?? undefined,
    })),
    relationships: relRows.map((r) => ({
      id: r.id,
      source: r.source_id,
      target: r.target_id,
      type: r.type as any,
      grade: r.grade as any,
      evidenceIds: JSON.parse(r.evidence_ids),
      traversable: Boolean(r.traversable),
    })),
    evidence: evRows.map((e) => ({
      id: e.id,
      sourceId: e.source_id,
      kind: e.kind,
      targetText: e.target_text,
      location: JSON.parse(e.location_json),
    })),
    coverage,
  }
}

export function loadActiveHorizonGraph(
  state: ServerState,
  tenantId: string,
  horizonId: string
): GraphSnapshotV2 | null {
  const activeRow = state.db
    .query("SELECT graph_id FROM graph_snapshots_v2 WHERE tenant_id = ? AND horizon_id = ? AND status = 'active' ORDER BY rowid DESC LIMIT 1")
    .get(tenantId, horizonId) as { graph_id: string } | null

  if (!activeRow) return null
  return findHorizonGraphById(state, tenantId, horizonId, activeRow.graph_id)
}

