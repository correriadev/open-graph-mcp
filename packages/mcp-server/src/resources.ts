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
import { normalizeClaimLevel } from "./claim-level"

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
    .all(tenant, since, limit + 1) as { seq: number; ts: string; kind: string; target_id: string | null; payload: string }[]
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
type FileProjection = { file: string | undefined; disposition: "repoRelative" | "basenameFallback" | "omitted" }

function claimFileProjection(raw: string | null, repoPath: string): FileProjection {
  const omitted = (): FileProjection => ({ file: undefined, disposition: "omitted" })
  const fallback = (file: string | undefined): FileProjection => file ? { file, disposition: "basenameFallback" } : omitted()
  if (!raw || /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(raw)) return omitted()
  const norm = raw.replace(/\\/g, "/")
  const parts = norm.split("/")
  const basename = parts.at(-1)
  const safeBasename = basename && basename !== "." && basename !== ".." && !/^[A-Za-z]:$/.test(basename) ? basename : undefined
  const encodedTraversal = /%(?:25)*(?:2e|2f|5c|00)/i.test(norm)
  const traversal = parts.some((part) => part === "." || part === "..")
  const drive = /^[A-Za-z]:/.test(norm)
  const driveRelative = /^[A-Za-z]:(?!\/)/.test(norm)
  const absolute = norm.startsWith("/") || drive
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(norm)

  if (!absolute && !scheme && !traversal && !encodedTraversal) {
    const file = parts.filter(Boolean).join("/") || undefined
    return file ? { file, disposition: "repoRelative" } : omitted()
  }

  const root = repoPath.replace(/\\/g, "/").replace(/\/+$/, "")
  if (driveRelative || /^[A-Za-z]:(?!\/)/.test(root)) return fallback(safeBasename)
  const windows = /^[A-Za-z]:/.test(norm) || norm.startsWith("//")
  const sameDialect = windows === (/^[A-Za-z]:/.test(root) || root.startsWith("//"))
  const comparablePath = windows ? norm.toLowerCase() : norm
  const comparableRoot = windows ? root.toLowerCase() : root
  if (!encodedTraversal && !traversal && root && sameDialect && comparablePath.startsWith(comparableRoot + "/")) {
    const relative = norm.slice(root.length + 1)
    if (relative && !relative.split("/").some((part) => !part || part === "." || part === "..")) return { file: relative, disposition: "repoRelative" }
  }
  return fallback(safeBasename)
}

export function projectClaimFile(raw: string | null, repoPath: string): string | undefined {
  return claimFileProjection(raw, repoPath).file
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

function claimFromRow(row: ClaimRow, state: ServerState, fallbackDomain = "") {
  const normalizedLevel = normalizeClaimLevel(row.level)
  if (!normalizedLevel.ok) return null
  const projection = claimFileProjection(row.file, state.repoPath)
  const file = projection.file
  state.claimFileProjectionMetrics[projection.disposition]++
  return {
    id: row.id,
    subject: row.subject ?? row.id,
    domain: row.domain ?? fallbackDomain,
    level: normalizedLevel.numeric,
    refs: parseRefs(row.refs),
    anchor: row.anchor ?? "",
    file,
    seq: row.seq,
    verdict: row.verdict_confidence != null || row.verdict_overclaim != null
      ? { confidence: row.verdict_confidence ?? undefined, overclaim: !!row.verdict_overclaim }
      : undefined,
    supersedes: row.supersedes ?? undefined,
  }
}

const DEFAULT_PAGE_LIMIT = 100
const MAX_PAGE_LIMIT = 500

function pageInteger(params: URLSearchParams, name: "since" | "limit"): number {
  if (!params.has(name)) return name === "since" ? 0 : DEFAULT_PAGE_LIMIT
  const raw = params.get(name)!
  if (!/^\d+$/.test(raw)) throw new Error(`invalid ${name}: expected integer`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || (name === "limit" && (value < 1 || value > MAX_PAGE_LIMIT))) {
    throw new Error(`invalid ${name}: out of range`)
  }
  return value
}

function pageEnvelope<T extends { seq: number }>(records: T[], since: number, limit: number) {
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records
  return { since, limit, records: page, nextCursor: page.at(-1)?.seq ?? since, hasMore }
}

function claimsOfCell(state: ServerState, tenant: string, cell: string, since: number, limit: number) {
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
  // openDb/writeClaim canonicalize claims.level to P<n>, allowing this equality predicate to use
  // the complete tenant/domain/level/sequence index without scanning sparse tenant ranges.
  const rows = state.db
    .query(
      "SELECT id, seq, subject, domain, level, refs, anchor, file, verdict_confidence, verdict_overclaim, supersedes FROM claims WHERE tenant_id = ? AND domain = ? AND level = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
    )
    .all(tenant, d, `P${lNorm}`, since, limit + 1) as ClaimRow[]
  const page = pageEnvelope(rows.map((row) => claimFromRow(row, state, d)).filter((row): row is NonNullable<typeof row> => row !== null), since, limit)
  return {
    cell,
    since: page.since,
    limit: page.limit,
    claims: page.records,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  }
}

function claimsOfSnapshot(state: ServerState, tenant: string, since: number, limit: number) {
  const rows = state.db.query(
    "SELECT id, seq, subject, domain, level, refs, anchor, file, verdict_confidence, verdict_overclaim, supersedes FROM claims WHERE tenant_id = ? AND level IN ('P0','P1','P2','P3','P4','P5') AND seq > ? ORDER BY seq ASC LIMIT ?",
  ).all(tenant, since, limit + 1) as ClaimRow[]
  const page = pageEnvelope(rows.map((row) => claimFromRow(row, state)).filter((row): row is NonNullable<typeof row> => row !== null), since, limit)
  return { since, limit, claims: page.records, nextCursor: page.nextCursor, hasMore: page.hasMore }
}

function claimById(state: ServerState, tenant: string, id: string) {
  const startedAt = performance.now()
  const row = state.db.query(
    "SELECT id, seq, subject, domain, level, refs, anchor, file, verdict_confidence, verdict_overclaim, supersedes FROM claims WHERE tenant_id = ? AND id = ? LIMIT 1",
  ).get(tenant, id) as ClaimRow | null
  const claim = row ? claimFromRow(row, state) : null
  if (claim) state.claimLookupMetrics.hits++
  else state.claimLookupMetrics.misses++
  const latencyMs = performance.now() - startedAt
  state.claimLookupMetrics.totalLatencyMs += latencyMs
  state.claimLookupMetrics.maxLatencyMs = Math.max(state.claimLookupMetrics.maxLatencyMs, latencyMs)
  return { claim }
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
      const since = pageInteger(params, "since")
      const limit = pageInteger(params, "limit")
      const page = pageEnvelope(historyEnvelopes(state, tenant, since, limit), since, limit)
      return { graphId: tenantGraph(state, tenant).graphId, since, limit, events: page.records, nextCursor: page.nextCursor, hasMore: page.hasMore }
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
    case "claims": {
      if (params.has("id")) {
        if (params.getAll("id").length !== 1 || params.has("cell") || params.has("scope") || params.has("since") || params.has("limit")) {
          throw new Error("ambiguous claims mode")
        }
        const id = params.get("id")!
        if (!id) throw new Error("claim id required")
        return claimById(state, tenant, id)
      }
      const since = pageInteger(params, "since")
      const limit = pageInteger(params, "limit")
      if (params.get("scope") === "snapshot") return claimsOfSnapshot(state, tenant, since, limit)
      return claimsOfCell(state, tenant, params.get("cell") ?? "", since, limit)
    }
    default:
      throw new Error(`unknown resource: ${uri}`)
  }
}

export const RESOURCE_LIST = [
  { uri: "graph://snapshot", name: "snapshot", mimeType: "application/json", description: "Published graph (nodes, edges, authority, stats)." },
  { uri: "graph://history", name: "history", mimeType: "application/json", description: "Bounded event log page (?since=N&limit=N; default 100, max 500)." },
  { uri: "graph://cell/{cellKey}", name: "cell", mimeType: "application/json", description: "Cell state: authority, nodes, claim count, drift grade, lock." },
  { uri: "graph://domain/{domain}", name: "domain", mimeType: "application/json", description: "All cells of a domain." },
  { uri: "graph://changeset/{id}", name: "changeset", mimeType: "application/json", description: "Changeset state, deltas and participants." },
  { uri: "graph://changesets", name: "changesets", mimeType: "application/json", description: "Changesets of the tenant (?status=open)." },
  { uri: "graph://claims", name: "claims", mimeType: "application/json", description: "Exact claim lookup (?id=claimId) or bounded page (?cell=domain:level or scope=snapshot&since=N&limit=N; default 100, max 500)." },
]
