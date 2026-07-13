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
export const DEFAULT_PRESENCE_TTL_MS = 60_000
export const DEFAULT_FOCUS_DEBOUNCE_MS = 2_000

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

/**
 * Presence — estado de presença viva por sessão (Fase 3 §3), EM MEMÓRIA (nunca persistido: restart
 * esquece tudo). `tenant` não faz parte do contrato público (spec §3.1 não lista), mas é guardado aqui
 * p/ escopar presence.who/broadcasts por tenant sem depender da sessão SSE ainda estar viva.
 */
export type Presence = {
  sessionId: string
  tenant: string
  userId: string
  agentKind: string
  lastSeen: number
  focusCell: string | null
  openCsIds: string[]
  invisible: boolean
  lastDeltaAt: number
}

export type Pipeline = "skeleton" | "existing"

/** Grafo de conhecimento por tenant (índice quente p/ query/watch). O default carrega o fluxo Fase 1. */
export type TenantGraph = { graph: Graph | null; graphId: string; pipeline: Pipeline | null; bootstrappedAt: string | null }

export type ServerState = {
  repoPath: string
  stateDir: string
  db: Database
  ttlMs: number
  presenceTtlMs: number
  focusDebounceMs: number
  graphs: Map<string, TenantGraph>
  tokens: Map<string, TokenInfo>
  subscriptions: Map<string, Filter[]>
  sessions: Map<string, Session>
  sessionCounter: number
  /** Contador de deltas por changeset p/ o agregador de 100ms (payload só count, spec §6). */
  deltaCounts: Map<string, { count: number; tenant: string; byUser: string }>
  lastTickHadEvents: boolean
  /** Presença viva por sessionId (Fase 3 §3) — em memória, some no restart. */
  presence: Map<string, Presence>
  /** Timers de debounce de focus por sessionId (Fase 3 §6.3) — só o último settle broadcast. */
  focusDebounce: Map<string, ReturnType<typeof setTimeout>>
}

export function createState(opts: {
  repoPath?: string
  stateDir: string
  ttlMs?: number
  presenceTtlMs?: number
  focusDebounceMs?: number
  db?: Database
}): ServerState {
  const db = opts.db ?? openDb(opts.stateDir === ":memory:" ? ":memory:" : `${opts.stateDir}/state.sqlite`)
  return {
    repoPath: opts.repoPath ?? "",
    stateDir: opts.stateDir === ":memory:" ? "" : opts.stateDir,
    db,
    ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
    presenceTtlMs: opts.presenceTtlMs ?? DEFAULT_PRESENCE_TTL_MS,
    focusDebounceMs: opts.focusDebounceMs ?? DEFAULT_FOCUS_DEBOUNCE_MS,
    graphs: new Map(),
    tokens: new Map(),
    subscriptions: new Map(),
    sessions: new Map(),
    sessionCounter: 0,
    deltaCounts: new Map(),
    lastTickHadEvents: false,
    presence: new Map(),
    focusDebounce: new Map(),
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

/** Kinds que ignoram filtro de sessão — sempre chegam a todo conectado do tenant (Fase 3 §6.1).
 *  `user.joined` é "broadcast geral p/ contagem da topbar atualizar" por definição da tabela §6.1. */
const ALWAYS_BROADCAST_KINDS = new Set<string>(["authority.flipped", "user.joined"])

/** OR dentro de um filtro, AND entre filtros. Vazio = tudo (spec §4.4). authority.flipped ignora filtro. */
export function matches(filters: Filter[], e: EventEnvelope): boolean {
  if (ALWAYS_BROADCAST_KINDS.has(e.kind)) return true
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
