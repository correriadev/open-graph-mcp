/**
 * resources.ts — leitura MCP (spec §4.3 + Fase 2). Escopadas por tenant (param opcional `token`).
 *   graph://guide                   → guia de fluxo curto p/ agente recém-conectado (Entrega 2)
 *   graph://snapshot                → grafo publicado do tenant + graphId/pipeline
 *   graph://history?since=N         → tail do log de eventos do tenant (SQLite)
 *   graph://cell/{domain:level}     → autoridade, nós, claim count, drift grade da célula
 *   graph://domain/{domain}         → todas as células do domain
 *   graph://changeset/{id}          → estado + deltas + participantes (Fase 2)
 *   graph://changesets?status=open  → lista de changesets do tenant (Fase 2)
 */
import { DEFAULT_TENANT, tenantGraph, type EventEnvelope, type ServerState } from "./state"
import { normalizeClaimLevel } from "./claim-level"
import { authorityOf } from "./store"
import { canonicalCell } from "./gates"

/**
 * F2 fix (docs/roadmap-server-beta/01-evidencias-fluxo-completo.md §F2): before this, drift grade was
 * read off `n.stale`, a field NOBODY ever wrote — every cell/domain read reported "fresh" forever, even
 * seconds after `watch-bridge.ts` had emitted `drift.node` + `authority.demoted` for that exact cell.
 *
 * The real, live drift index is `state.driftStale: Map<tenant, Map<nodeId, cause>>` (populated by
 * `watch-bridge.ts::tick`). A node id present in the tenant's map is stale, tagged with the cause `tick`
 * computed at drift time: "gone" (file missing/unreadable) or "structural" (file present, anchor gone).
 *
 * Aggregation is worst-of: any "gone" node in the cell makes the CELL "gone" — the file disappeared out
 * from under at least one of its nodes, which is a stronger claim than "the code moved" — even if other
 * nodes in the same cell are merely "structural". Absent any "gone" node, any "structural" node makes the
 * cell "stale". No node in drift at all → "fresh". This is honest, not fabricated: the cause traveled all
 * the way from `tick`'s own `readFileSync` catch (gone) vs. `excerptCheck` failure (structural), through
 * `state.driftStale`, into this aggregation — nothing here is inferred or guessed.
 */
function driftGradeOf(nodes: { id: string }[], causesById: ReadonlyMap<string, "gone" | "structural">): "fresh" | "stale" | "gone" {
  let worst: "fresh" | "stale" | "gone" = "fresh"
  for (const n of nodes) {
    const cause = causesById.get(n.id)
    if (cause === "gone") return "gone" // worst possible for the cell — short-circuit
    if (cause === "structural") worst = "stale"
  }
  return worst
}

function cellState(state: ServerState, tenant: string, cellKey: string) {
  const graph = tenantGraph(state, tenant).graph
  // F1 (integração): este arquivo tinha a TERCEIRA cópia da comparação célula↔nó, com a convenção
  // INVERTIDA em relação a `gates.nodesOfCell` — aqui o nível vinha cru e o `P` era prefixado na
  // comparação, então `graph://cell/auth:P4` virava `"P4" === "PP4"` e devolvia `nodeCount: 0`.
  // Corrigir só `nodesOfCell` (que este caminho nem usa) não consertaria o recurso. Agora tudo passa
  // pela canonicalização única de gates.ts.
  const canon = canonicalCell(cellKey)
  const cut = canon.lastIndexOf(":")
  const domain = cut > 0 ? canon.slice(0, cut) : canon
  const level = cut > 0 ? canon.slice(cut + 1) : ""
  const nodes = (graph?.nodes ?? []).filter((n) => n.domain === domain && (level === "" || String(n.level) === `P${level}`))
  const claims = new Set<string>()
  for (const n of nodes) for (const c of n.claims) claims.add(c)
  const driftCauses = state.driftStale.get(tenant) ?? new Map<string, "gone" | "structural">()
  // Lookup por chave CANÔNICA (F7): a tabela `locks` é escrita canonicalizada por changeset.ts, então
  // consultá-la com a string crua faria `graph://cell/auth:P4` reportar `lock: null` sobre uma célula
  // de fato trancada — "está livre" é a resposta errada mais perigosa que este recurso pode dar.
  const lock = state.db.query("SELECT cs_id, holder, expires_at FROM locks WHERE tenant_id = ? AND cell = ?").get(tenant, canon) as
    | { cs_id: string; holder: string; expires_at: string }
    | null
  return {
    cell: cellKey,
    // REPORT-B1 (Tier 1 fix): the hot graph's `graph?.authority?.[cellKey]` is NOT the source of
    // truth — `bootstrap`/`rebuild` (graph-bootstrap.ts, owned by WS-F) replace `tg.graph` with a
    // freshly indexed Graph object whose `authority` field never carries over the SQLite `authority`
    // table's existing rows (see persistGraph: it only WRITES `graph.authority` into the table, never
    // deletes/merges the other direction). A cell flipped before a bootstrap/rebuild — or flipped in a
    // tenant whose hot graph was still null (commit path in changeset.ts guards `if (tg.graph)` before
    // touching `tg.graph.authority`) — silently read back as "source" here while SQLite (and the final
    // gate, via store.authorityOf) still say "graph"/"suspended". Reading through SQLite directly closes
    // that gap without touching the resource's shape (same field name/type) and without needing any
    // change outside this file.
    authority: authorityOf(state, tenant, canon),
    nodeCount: nodes.length,
    claimCount: claims.size,
    driftGrade: driftGradeOf(nodes, driftCauses),
    lock: lock ? { csId: lock.cs_id, holder: lock.holder, expiresAt: lock.expires_at } : null,
    nodes: nodes.map((n) => ({ id: n.id, file: n.file, anchor: n.anchor, stale: driftCauses.has(n.id) ? "stale" as const : "fresh" as const })),
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
  refs: string | null; covers: string | null; anchor: string | null; file: string | null
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

/** `covers` (F4) is stored NULL when absent (writeClaim only serializes it when non-empty) — undefined
 *  here, not `[]`, so callers can tell "never set" apart from "explicitly empty" if that ever matters. */
function parseCovers(raw: string | null): string[] | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : undefined
  } catch {
    return undefined
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
    covers: parseCovers(row.covers),
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
      "SELECT id, seq, subject, domain, level, refs, covers, anchor, file, verdict_confidence, verdict_overclaim, supersedes FROM claims WHERE tenant_id = ? AND domain = ? AND level = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
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
    "SELECT id, seq, subject, domain, level, refs, covers, anchor, file, verdict_confidence, verdict_overclaim, supersedes FROM claims WHERE tenant_id = ? AND level IN ('P0','P1','P2','P3','P4','P5') AND seq > ? ORDER BY seq ASC LIMIT ?",
  ).all(tenant, since, limit + 1) as ClaimRow[]
  const page = pageEnvelope(rows.map((row) => claimFromRow(row, state)).filter((row): row is NonNullable<typeof row> => row !== null), since, limit)
  return { since, limit, claims: page.records, nextCursor: page.nextCursor, hasMore: page.hasMore }
}

/**
 * `graph://guide` (Entrega 2): the `claude mcp add --transport http` install path gives an agent the
 * tools and NOTHING else — no skill, no hook, no plugin. This is the one place a freshly-connected
 * agent can read the workflow for itself. Kept short and dense — this lands in an agent's context
 * window, so wasted prose is real cost. Derived from what the code actually does (transport.ts tool
 * descriptions, tools/changeset.ts's OpenResult shape, README.md "O modelo de claims"), not invented.
 */
const GUIDE_TEXT = `open-graph-mcp workflow for agents

1. Register first: session.register {name} -> {token, userId, tenantId}. Pass token on almost every
   other call. If a call ever fails with "invalid or expired token", call session.register again with
   the same name — identity and any open changeset are preserved.

2. Look before you write: graph.query (search by terms) and graph.impact (blast radius of a file id)
   are read-only, need no lock, and no changeset. Use them to orient before touching anything.

3. Changing knowledge is a turn:
   - changeset.open {token, cells, intent} locks the cells (pessimistic, atomic). Optional —
     changeset.claim opens one implicitly (intent "") on its cell if none is open yet.
   - changeset.claim {token, csId?, delta} adds one claim.add or authority.flip delta and runs the
     incremental gate. Claims form a 6-level ladder, 5=code down to 0=ideation. Every non-root claim's
     refs must point to OTHER CLAIM ids exactly 1 level away (adjacency) — never a raw node id.
     refs: [] is only valid at level 0 or 5.
   - Node coverage (required to ever reach authority "graph"/beta): set covers on a claim to the list
     of NODE ids it covers — a separate field from refs, so the same claim can satisfy ladder adjacency
     (refs, claim ids only) and node coverage (covers, node ids) at once, with no id-space collision.
     Legacy compat: a level-5 claim whose id IS a node's file id, with that id also appearing in refs
     (the old "floor-claim" pattern), still counts as coverage for that node — kept working for claims
     written before covers existed, but covers is the path to use going forward.
   - changeset.commit {token, csId, intent} runs the final gate and admits, or aborts with reasons.

4. cell_locked: changeset.open/claim can return {ok:false, reason:"cell_locked", cell, holder,
   holderName, csId, expiresAt, retryAfterMs, hint} — another agent has a turn open on that cell. The
   response itself names the holder and says when the lock expires; read the hint field. Do not force it: work
   elsewhere (query, impact, a different cell) and retry after expiresAt. graph://cell/{domain:level}
   also reports the current lock. Note presence.who {cell} filters by DECLARED FOCUS
   (presence.focus), not by who holds the lock — a holder who never called presence.focus will not
   appear there.

5. Be visible to others: call presence.beat {token, agentKind} once early (no sessionId needed — you
   do not need an SSE connection). Without it you are invisible in presence.who and you receive no
   system.message text at all, including the notice that someone took a cell you were working near.

6. No live SSE connection? system.pending {token} drains (returns and clears) any system.message text
   queued for you since your last poll — stateless, safe to call from a fresh process.`

function claimById(state: ServerState, tenant: string, id: string) {
  const startedAt = performance.now()
  const row = state.db.query(
    "SELECT id, seq, subject, domain, level, refs, covers, anchor, file, verdict_confidence, verdict_overclaim, supersedes FROM claims WHERE tenant_id = ? AND id = ? LIMIT 1",
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
    case "guide":
      return { text: GUIDE_TEXT }
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
  { uri: "graph://guide", name: "guide", mimeType: "application/json", description: "Short workflow guide for an agent that just connected: register, query before writing, the claims/changeset flow, cell_locked, system.pending." },
  { uri: "graph://snapshot", name: "snapshot", mimeType: "application/json", description: "Published graph (nodes, edges, authority, stats)." },
  { uri: "graph://history", name: "history", mimeType: "application/json", description: "Bounded event log page (?since=N&limit=N; default 100, max 500)." },
  { uri: "graph://cell/{cellKey}", name: "cell", mimeType: "application/json", description: "Cell state: authority, nodes, claim count, drift grade, lock." },
  { uri: "graph://domain/{domain}", name: "domain", mimeType: "application/json", description: "All cells of a domain." },
  { uri: "graph://changeset/{id}", name: "changeset", mimeType: "application/json", description: "Changeset state, deltas and participants." },
  { uri: "graph://changesets", name: "changesets", mimeType: "application/json", description: "Changesets of the tenant (?status=open)." },
  { uri: "graph://claims", name: "claims", mimeType: "application/json", description: "Exact claim lookup (?id=claimId) or bounded page (?cell=domain:level or scope=snapshot&since=N&limit=N; default 100, max 500)." },
]
