/**
 * resources.ts — leitura MCP (spec §4.3 + Fase 2). Escopadas por tenant (param opcional `token`).
 *   graph://snapshot                → grafo publicado do tenant + graphId/pipeline
 *   graph://history?since=N         → tail do log de eventos do tenant (SQLite)
 *   graph://cell/{domain:level}     → autoridade, nós, claim count, drift grade da célula
 *   graph://domain/{domain}         → todas as células do domain
 *   graph://changeset/{id}          → estado + deltas + participantes (Fase 2)
 *   graph://changesets?status=open  → lista de changesets do tenant (Fase 2)
 */
import { DEFAULT_TENANT, tenantGraph, type EventEnvelope, type ServerState } from "./state"

function driftGradeOf(nodes: { stale?: unknown }[]): "fresh" | "stale" | "gone" {
  let worst: "fresh" | "stale" | "gone" = "fresh"
  for (const n of nodes) {
    if (n.stale === "gone") return "gone"
    if (n.stale === "stale") worst = "stale"
  }
  return worst
}

function cellState(state: ServerState, tenant: string, cellKey: string) {
  const graph = tenantGraph(state, tenant).graph
  const cut = cellKey.lastIndexOf(":")
  const domain = cut > 0 ? cellKey.slice(0, cut) : cellKey
  const level = cut > 0 ? cellKey.slice(cut + 1) : ""
  const nodes = (graph?.nodes ?? []).filter((n) => n.domain === domain && (level === "" || String(n.level) === `P${level}`))
  const claims = new Set<string>()
  for (const n of nodes) for (const c of n.claims) claims.add(c)
  const lock = state.db.query("SELECT cs_id, holder, expires_at FROM locks WHERE tenant_id = ? AND cell = ?").get(tenant, cellKey) as
    | { cs_id: string; holder: string; expires_at: string }
    | null
  return {
    cell: cellKey,
    authority: graph?.authority?.[cellKey] ?? "source",
    nodeCount: nodes.length,
    claimCount: claims.size,
    driftGrade: driftGradeOf(nodes),
    lock: lock ? { csId: lock.cs_id, holder: lock.holder, expiresAt: lock.expires_at } : null,
    nodes: nodes.map((n) => ({ id: n.id, file: n.file, anchor: n.anchor, stale: n.stale ?? "fresh" })),
  }
}

function historyEnvelopes(state: ServerState, tenant: string, since: number, limit: number): EventEnvelope[] {
  const graphId = tenantGraph(state, tenant).graphId
  // DECISÃO deliberada (Fase 3 §6.1): lock.denied é PRIVADO — só o user que tentou o recebe (SSE live e
  // replay de backlog passam pelo router de afinidade). graph://history é compartilhado (qualquer token do
  // tenant lê), então lock.denied fica FORA daqui por completo; permanece no SQLite como auditoria.
  const rows = state.db
    .query("SELECT seq, ts, kind, target_id, payload FROM events WHERE tenant_id = ? AND seq > ? AND kind != 'lock.denied' ORDER BY seq LIMIT ?")
    .all(tenant, since, limit) as { seq: number; ts: string; kind: string; target_id: string | null; payload: string }[]
  return rows.map((r) => ({
    schemaVersion: 1,
    seq: r.seq,
    ts: r.ts,
    kind: r.kind,
    target: r.target_id,
    payload: JSON.parse(r.payload ?? "{}"),
    graphId,
  }))
}

function changesetView(state: ServerState, tenant: string, csId: string) {
  const cs = state.db.query("SELECT * FROM changesets WHERE tenant_id = ? AND id = ?").get(tenant, csId) as any
  if (!cs) throw new Error(`unknown changeset: ${csId}`)
  const deltas = state.db
    .query("SELECT seq, kind, payload, created_at FROM cs_deltas WHERE tenant_id = ? AND cs_id = ? ORDER BY seq")
    .all(tenant, csId) as { seq: number; kind: string; payload: string; created_at: string }[]
  return {
    id: cs.id,
    intent: cs.intent,
    status: cs.status,
    parent: cs.parent,
    openedBy: cs.opened_by,
    openedAt: cs.opened_at,
    closedAt: cs.closed_at,
    admitSeq: cs.admit_seq,
    cells: JSON.parse(cs.blast_cells ?? "[]"),
    participants: [cs.opened_by],
    deltas: deltas.map((d) => ({ seq: d.seq, kind: d.kind, payload: JSON.parse(d.payload), createdAt: d.created_at })),
  }
}

/**
 * ClaimsEnvelope read-only resource (F002 task 02, RETRY #1): returns full ClaimRecord[] for a cell.
 * Read-only direct SQLite read with domain+level pushed into the SQL WHERE predicate (REWORK-LOG
 * openPoint 1 / H / I — kills the O(tenant) JS post-filter and respects the 004 §174 200ms budget).
 * Rejects malformed cell keys (require exactly `domain:level`, both non-empty) — REWORK-LOG H.
 * Redacts the `file` path prefix (server filesystem layout disclosure — REWORK-LOG J).
 */
function redactFile(raw: string | null, repoPath: string): string | undefined {
  if (!raw) return undefined
  const norm = raw.replace(/\\/g, "/")
  if (repoPath) {
    const rp = repoPath.replace(/\\/g, "/").replace(/\/$/, "")
    if (norm === rp || norm.startsWith(rp + "/")) return norm.slice(rp.length).replace(/^\/+/, "")
  }
  const idx = norm.indexOf("/src/")
  if (idx >= 0) return norm.slice(idx + 1) // keep `src/…` relative
  if (norm.startsWith("/")) return norm.slice(norm.lastIndexOf("/") + 1)
  return norm
}

type ClaimRow = {
  id: string; seq: number; subject: string | null; domain: string | null; level: string | null
  refs: string | null; anchor: string | null; file: string | null
  verdict_confidence: number | null; verdict_overclaim: number | null; supersedes: string | null
}

function parseRefs(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((ref): ref is string => typeof ref === "string") : []
  } catch {
    return []
  }
}

function claimFromRow(row: ClaimRow, repoPath: string, fallbackDomain = "") {
  const normalizedLevel = row.level?.replace(/^P/, "")
  return {
    id: row.id,
    subject: row.subject ?? row.id,
    domain: row.domain ?? fallbackDomain,
    level: normalizedLevel && /^\d+$/.test(normalizedLevel) ? Number(normalizedLevel) : undefined,
    refs: parseRefs(row.refs),
    anchor: row.anchor ?? "",
    file: redactFile(row.file, repoPath),
    seq: row.seq,
    verdict: row.verdict_confidence != null || row.verdict_overclaim != null
      ? { confidence: row.verdict_confidence ?? undefined, overclaim: !!row.verdict_overclaim }
      : undefined,
    supersedes: row.supersedes ?? undefined,
  }
}

function claimsOfCell(state: ServerState, tenant: string, cell: string) {
  if (!cell) throw new Error("cell key required")
  const cut = cell.indexOf(":")
  if (cut <= 0 || cut >= cell.length - 1) {
    throw new Error(`cell key malformed: '${cell}' — expected 'domain:level'`)
  }
  const d = cell.slice(0, cut)
  const lpRaw = cell.slice(cut + 1)
  if (!d || !lpRaw) throw new Error(`cell key malformed: '${cell}' — expected 'domain:level'`)
  const lNorm = lpRaw.replace(/^P/, "")
  if (!/^\d+$/.test(lNorm)) throw new Error(`cell key malformed: '${cell}' — level must be numeric`)
  // claims.level is stored as either "P<n>" (UI string) or "<n>" (agent numeric) — match both via IN.
  const rows = state.db
    .query(
      "SELECT id, seq, subject, domain, level, refs, anchor, file, verdict_confidence, verdict_overclaim, supersedes FROM claims WHERE tenant_id = ? AND domain = ? AND level IN (?, ?)",
    )
    .all(tenant, d, `P${lNorm}`, lNorm) as ClaimRow[]
  return {
    cell,
    claims: rows.map((row) => claimFromRow(row, state.repoPath, d)),
  }
}

function claimsOfSnapshot(state: ServerState, tenant: string) {
  const rows = state.db.query(
    "SELECT id, seq, subject, domain, level, refs, anchor, file, verdict_confidence, verdict_overclaim, supersedes FROM claims WHERE tenant_id = ? ORDER BY seq",
  ).all(tenant) as ClaimRow[]
  const claimsByCell: Record<string, ReturnType<typeof claimFromRow>[]> = {}
  for (const row of rows) {
    if (!row.domain || !row.level) continue
    const cell = `${row.domain}:P${row.level.replace(/^P/, "")}`
    ;(claimsByCell[cell] ??= []).push(claimFromRow(row, state.repoPath))
  }
  return { claimsByCell }
}

export function resolveResource(state: ServerState, uri: string, tenant = DEFAULT_TENANT): unknown {
  const rest = uri.replace(/^graph:\/\//, "")
  const [pathPart, queryPart] = rest.split("?")
  const params = new URLSearchParams(queryPart ?? "")
  const [head, ...tail] = pathPart.split("/")
  const arg = tail.join("/")

  switch (head) {
    case "snapshot": {
      const tg = tenantGraph(state, tenant)
      if (!tg.graph) throw new Error("not bootstrapped")
      return { graphId: tg.graphId, pipeline: tg.pipeline, bootstrappedAt: tg.bootstrappedAt, graph: tg.graph }
    }
    case "history": {
      const since = Number(params.get("since") ?? 0)
      const limit = Number(params.get("limit") ?? 1000)
      return { graphId: tenantGraph(state, tenant).graphId, since, events: historyEnvelopes(state, tenant, since, limit) }
    }
    case "cell":
      if (!arg) throw new Error("cell key required")
      return cellState(state, tenant, arg)
    case "domain": {
      if (!arg) throw new Error("domain required")
      const levels = new Set<string>()
      for (const n of tenantGraph(state, tenant).graph?.nodes ?? []) if (n.domain === arg) levels.add(String(n.level).replace(/^P/, ""))
      return { domain: arg, cells: [...levels].sort().map((lvl) => cellState(state, tenant, `${arg}:${lvl}`)) }
    }
    case "changeset":
      if (!arg) throw new Error("changeset id required")
      return changesetView(state, tenant, arg)
    case "changesets": {
      const status = params.get("status")
      const rows = (
        status
          ? state.db.query("SELECT id FROM changesets WHERE tenant_id = ? AND status = ? ORDER BY opened_at").all(tenant, status)
          : state.db.query("SELECT id FROM changesets WHERE tenant_id = ? ORDER BY opened_at").all(tenant)
      ) as { id: string }[]
      return { changesets: rows.map((r) => changesetView(state, tenant, r.id)) }
    }
    case "claims":
      if (params.get("scope") === "snapshot") return claimsOfSnapshot(state, tenant)
      return claimsOfCell(state, tenant, params.get("cell") ?? "")
    default:
      throw new Error(`unknown resource: ${uri}`)
  }
}

export const RESOURCE_LIST = [
  { uri: "graph://snapshot", name: "snapshot", mimeType: "application/json", description: "Published graph (nodes, edges, authority, stats)." },
  { uri: "graph://history", name: "history", mimeType: "application/json", description: "Event log tail (?since=N&limit=)." },
  { uri: "graph://cell/{cellKey}", name: "cell", mimeType: "application/json", description: "Cell state: authority, nodes, claim count, drift grade, lock." },
  { uri: "graph://domain/{domain}", name: "domain", mimeType: "application/json", description: "All cells of a domain." },
  { uri: "graph://changeset/{id}", name: "changeset", mimeType: "application/json", description: "Changeset state, deltas and participants." },
  { uri: "graph://changesets", name: "changesets", mimeType: "application/json", description: "Changesets of the tenant (?status=open)." },
  { uri: "graph://claims", name: "claims", mimeType: "application/json", description: "Claims of a cell (?cell=domain:level)." },
]
