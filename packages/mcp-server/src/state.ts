/**
 * state.ts — ServerState 100% em memória (spec §6). Zero persistência nova: o grafo é derivado
 * do .graph/ do repo-alvo, o log de eventos vive só aqui e some no restart (re-bootstrap gera
 * novo graphId; cliente com graphId diferente descarta since e refaz snapshot — spec §6).
 */
import type { Graph } from "@open-graph-mcp/graph-core/build"

export type Filter =
  | { kind: "all" }
  | { kind: "cell"; cell: string }
  | { kind: "domain"; domain: string }
  | { kind: "changeset"; id: string } // placeholder Fase 2 — nunca casa agora
  | { kind: "event"; events: string[] }

/** Envelope de evento (contrato fixo, spec §4.4). schemaVersion desde a Fase 1. */
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
  filters: Filter[]
  push: (env: EventEnvelope) => void
}

/** "skeleton" = grafo estrutural determinístico (sem claims/autoridade β); "existing" = .graph/ herdado. */
export type Pipeline = "skeleton" | "existing"

export type ServerState = {
  repoPath: string
  graph: Graph | null
  graphId: string
  pipeline: Pipeline | null
  bootstrappedAt: string | null
  log: EventEnvelope[]
  lastEventSeq: number
  subscriptions: Map<string, Filter[]>
  sessions: Map<string, Session>
  sessionCounter: number
  lastTickHadEvents: boolean
}

export function createState(repoPath: string): ServerState {
  return {
    repoPath,
    graph: null,
    graphId: "",
    pipeline: null,
    bootstrappedAt: null,
    log: [],
    lastEventSeq: 0,
    subscriptions: new Map(),
    sessions: new Map(),
    sessionCounter: 0,
    lastTickHadEvents: false,
  }
}

function matchOne(f: Filter, e: EventEnvelope): boolean {
  switch (f.kind) {
    case "all":
      return true
    case "event":
      return f.events.includes(e.kind)
    case "domain":
      return e.payload.domain === f.domain
    case "cell":
      return e.payload.cell === f.cell || e.target === f.cell
    case "changeset":
      return false
  }
}

/** OR dentro de um filtro, AND entre filtros do mesmo subscription (spec §4.4). Vazio = tudo. */
export function matches(filters: Filter[], e: EventEnvelope): boolean {
  if (filters.length === 0) return true
  return filters.every((f) => matchOne(f, e))
}

/** Anexa ao log em memória (seq monotônico) e faz push server-side p/ cada sessão que casa. */
export function publish(
  state: ServerState,
  partial: { kind: string; target: string | null; payload: Record<string, unknown> },
): EventEnvelope {
  const env: EventEnvelope = {
    schemaVersion: 1,
    seq: ++state.lastEventSeq,
    ts: new Date().toISOString(),
    graphId: state.graphId,
    kind: partial.kind,
    target: partial.target,
    payload: partial.payload,
  }
  state.log.push(env)
  for (const s of state.sessions.values()) if (matches(s.filters, env)) s.push(env)
  return env
}

/** Célula de um nó: "<domain>:<levelNum>" (Level "P5" → 5), null se nó/domínio ausente. */
export function nodeCell(state: ServerState, nodeId: string): { domain: string; cell: string } | null {
  const n = state.graph?.nodes.find((x) => x.id === nodeId)
  if (!n || !n.domain) return null
  const level = String(n.level).replace(/^P/, "")
  return { domain: n.domain, cell: `${n.domain}:${level}` }
}
