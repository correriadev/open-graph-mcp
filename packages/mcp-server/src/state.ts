/**
 * state.ts — ServerState. Fase 1 mantinha tudo em memória; a Fase 2 move o estado durável p/ SQLite +
 * espelho JSONL por tenant (ADR §4.1), mas o GRAFO de conhecimento (query/watch/drift) segue em memória
 * por tenant como índice quente. Eventos, changesets, locks e o grafo autoritativo (import) vivem no banco.
 *
 * Tokens/sessions são EM MEMÓRIA (spec §9): somem no restart; os changesets sobrevivem no SQLite.
 * `seq` de eventos é monotônico POR TENANT (D13).
 */
import type { Database } from "bun:sqlite"
import type { Graph } from "@open-graph-mcp/graph-core/build"
import { openDb, write } from "./db"

export const DEFAULT_TENANT = "default"
export const DEFAULT_TTL_MS = 30 * 60 * 1000

export type Filter =
  | { kind: "all" }
  | { kind: "cell"; cell: string }
  | { kind: "domain"; domain: string }
  | { kind: "changeset"; id: string }
  | { kind: "event"; events: string[] }

/** Envelope de evento (contrato fixo da Fase 1, inalterado). tenant NÃO vaza no envelope: o escopo é server-side. */
export type EventEnvelope = {
  schemaVersion: 1
  seq: number
  ts: string
  kind: string
  target: string | null
  payload: Record<string, unknown>
  graphId: string
}

export type Session = {
  id: string
  tenant: string
  filters: Filter[]
  push: (env: EventEnvelope) => void
}

/** Token em memória → identidade. Some no restart; changesets persistem no SQLite (spec §9). */
export type TokenInfo = { token: string; userId: string; tenantId: string; name: string }

export type Pipeline = "skeleton" | "existing"

/** Grafo de conhecimento por tenant (índice quente p/ query/watch). O default carrega o fluxo Fase 1. */
export type TenantGraph = { graph: Graph | null; graphId: string; pipeline: Pipeline | null; bootstrappedAt: string | null }

export type ServerState = {
  repoPath: string
  stateDir: string
  db: Database
  ttlMs: number
  graphs: Map<string, TenantGraph>
  tokens: Map<string, TokenInfo>
  subscriptions: Map<string, Filter[]>
  sessions: Map<string, Session>
  sessionCounter: number
  /** Contador de deltas por changeset p/ o agregador de 100ms (payload só count, spec §6). */
  deltaCounts: Map<string, { count: number; tenant: string; byUser: string }>
  lastTickHadEvents: boolean
}

export function createState(opts: { repoPath?: string; stateDir: string; ttlMs?: number; db?: Database }): ServerState {
  const db = opts.db ?? openDb(opts.stateDir === ":memory:" ? ":memory:" : `${opts.stateDir}/state.sqlite`)
  return {
    repoPath: opts.repoPath ?? "",
    stateDir: opts.stateDir === ":memory:" ? "" : opts.stateDir,
    db,
    ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
    graphs: new Map(),
    tokens: new Map(),
    subscriptions: new Map(),
    sessions: new Map(),
    sessionCounter: 0,
    deltaCounts: new Map(),
    lastTickHadEvents: false,
  }
}

export function tenantGraph(state: ServerState, tenant: string): TenantGraph {
  let g = state.graphs.get(tenant)
  if (!g) {
    g = { graph: null, graphId: "", pipeline: null, bootstrappedAt: null }
    state.graphs.set(tenant, g)
  }
  return g
}

function matchOne(f: Filter, e: EventEnvelope): boolean {
  switch (f.kind) {
    case "all":
      return true
    case "event":
      return f.events.includes(e.kind)
    case "domain":
      return e.payload.domain === f.domain
    case "cell": {
      const cells = e.payload.cells
      return e.payload.cell === f.cell || e.target === f.cell || (Array.isArray(cells) && cells.includes(f.cell))
    }
    case "changeset":
      return e.payload.csId === f.id || e.target === f.id
  }
}

/** OR dentro de um filtro, AND entre filtros. Vazio = tudo (spec §4.4). */
export function matches(filters: Filter[], e: EventEnvelope): boolean {
  if (filters.length === 0) return true
  return filters.every((f) => matchOne(f, e))
}

export function nextSeq(state: ServerState, tenant: string): number {
  const row = state.db.query("SELECT COALESCE(MAX(seq),0) AS m FROM events WHERE tenant_id = ?").get(tenant) as { m: number }
  return row.m + 1
}

export function pushEnvelope(state: ServerState, tenant: string, env: EventEnvelope): void {
  for (const s of state.sessions.values()) if (s.tenant === tenant && matches(s.filters, env)) s.push(env)
}

export type EventInput = {
  kind: string
  targetKind?: string | null
  targetId?: string | null
  payload?: Record<string, unknown>
  byUser?: string | null
}

/**
 * appendEvent — grava o evento no SQLite + JSONL do tenant (seq monotônico por tenant) e o difunde no SSE
 * do tenant. `broadcast:false` → só auditoria (ex.: lock.denied, spec §6). `defer:true` → não difunde agora
 * (usado dentro da transação de commit; o chamador difunde depois de a transação retornar).
 */
export function appendEvent(
  state: ServerState,
  tenant: string,
  input: EventInput,
  opts: { broadcast?: boolean; defer?: boolean } = {},
): EventEnvelope {
  const seq = nextSeq(state, tenant)
  const ts = new Date().toISOString()
  const payload = input.payload ?? {}
  write(state.db, state.stateDir, tenant, "events", {
    tenant_id: tenant,
    seq,
    ts,
    kind: input.kind,
    target_kind: input.targetKind ?? null,
    target_id: input.targetId ?? null,
    payload: JSON.stringify(payload),
    by_user: input.byUser ?? null,
  })
  const env: EventEnvelope = {
    schemaVersion: 1,
    seq,
    ts,
    kind: input.kind,
    target: input.targetId ?? null,
    payload,
    graphId: tenantGraph(state, tenant).graphId,
  }
  if (opts.broadcast !== false && !opts.defer) pushEnvelope(state, tenant, env)
  return env
}

/** Wrapper da Fase 1: eventos de bootstrap/watch/drift no tenant default. */
export function publish(
  state: ServerState,
  partial: { kind: string; target: string | null; payload: Record<string, unknown> },
): EventEnvelope {
  return appendEvent(state, DEFAULT_TENANT, { kind: partial.kind, targetId: partial.target, payload: partial.payload })
}

/** Célula de um nó no grafo default (usado pelo watch-bridge Fase 1). */
export function nodeCell(state: ServerState, nodeId: string): { domain: string; cell: string } | null {
  const n = tenantGraph(state, DEFAULT_TENANT).graph?.nodes.find((x) => x.id === nodeId)
  if (!n || !n.domain) return null
  const level = String(n.level).replace(/^P/, "")
  return { domain: n.domain, cell: `${n.domain}:${level}` }
}
