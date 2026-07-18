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

/**
 * readClaims — QA-5 achou este SELECT rodando a cada `changeset.claim` (não só no commit), custo
 * crescendo com o total de claims já commitados: p95 subiu ~9x num soak de 10min. Cacheado em memória
 * por tenant (`state.claimsCache`), populado lazy aqui na primeira leitura, mantido incrementalmente
 * por `writeClaim` — evita o full-tenant-scan repetido sem mudar a forma como os chamadores usam isto.
 */
export function readClaims(state: ServerState, tenant: string): ClaimSnapshot[] {
  const cached = state.claimsCache.get(tenant)
  if (cached) return cached
  const rows = state.db.query("SELECT id, subject, domain, level, refs, anchor, file FROM claims WHERE tenant_id = ?").all(tenant) as {
    id: string
    subject: string | null
    domain: string | null
    level: string | null
    refs: string | null
    anchor: string | null
    file: string | null
  }[]
  const claims = rows.map((r) => ({
    id: r.id,
    subject: r.subject ?? undefined,
    domain: r.domain ?? undefined,
    level: r.level != null ? Number(r.level) : undefined,
    refs: JSON.parse(r.refs ?? "[]"),
    anchor: r.anchor ?? undefined,
    file: r.file ?? undefined,
  }))
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

export function authorityOf(state: ServerState, tenant: string, cell: string): "source" | "graph" | "suspended" {
  const row = state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get(tenant, cell) as { value: string } | null
  return (row?.value as any) ?? "source"
}

/** readFile injetável p/ os gates (âncora/verify). Lê do repo-alvo do tenant default; ausente → undefined. */
export function makeReadFile(state: ServerState): (f: string) => string | undefined {
  const cache = new Map<string, string | undefined>()
  return (f: string) => {
    if (cache.has(f)) return cache.get(f)
    let content: string | undefined
    try {
      content = state.repoPath ? readFileSync(path.join(state.repoPath, f), "utf8") : undefined
    } catch {
      content = undefined
    }
    cache.set(f, content)
    return content
  }
}

export function writeClaim(state: ServerState, tenant: string, seq: number, c: ClaimSnapshot): void {
  write(state.db, state.stateDir, tenant, "claims", {
    tenant_id: tenant,
    id: c.id,
    seq,
    subject: c.subject ?? null,
    domain: c.domain ?? null,
    level: c.level != null ? String(c.level) : null,
    refs: JSON.stringify(c.refs ?? []),
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
  write(state.db, state.stateDir, tenant, "authority", { tenant_id: tenant, cell, value, last_flip_seq: seq, last_flip_by: by })
}

/** Maior seq de claim do tenant (base do contador monotônico de claims). */
export function maxClaimSeq(state: ServerState, tenant: string): number {
  const row = state.db.query("SELECT COALESCE(MAX(seq),0) AS m FROM claims WHERE tenant_id = ?").get(tenant) as { m: number }
  return row.m
}
