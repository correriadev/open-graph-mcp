/**
 * state.ts — ServerState. Fase 1 mantinha tudo em memória; a Fase 2 move o estado durável p/ SQLite +
 * espelho JSONL por tenant (ADR §4.1). O GRAFO agora TAMBÉM vive no banco (nodes/edges/authority por
 * tenant): `tg.graph` é só um índice quente, hidratado do SQLite no start (graph-bootstrap.ts
 * `hydrateFromDb`) e reescrito a cada indexação — não é mais a única cópia, e por isso o grafo
 * sobrevive a restart. Eventos, changesets e locks seguem no banco.
 *
 * Tokens/sessions são EM MEMÓRIA (spec §9): somem no restart; os changesets sobrevivem no SQLite.
 * `seq` de eventos é monotônico POR TENANT (D13).
 */
import type { Database } from "bun:sqlite"
import type { Graph } from "@open-graph-mcp/graph-core/build"
import { openDb, write } from "./db"
import { route } from "./affinity"
import { renderSystemMessage, pushSystemMessage } from "./system-message"
import { flavor, type AgentKind } from "./agent-registry"
import { hydrateTokens, DEFAULT_TOKEN_TTL_MS } from "./tokens"

export const DEFAULT_TENANT = "default"
export const DEFAULT_TTL_MS = 30 * 60 * 1000
export const DEFAULT_PRESENCE_TTL_MS = 60_000
export const DEFAULT_FOCUS_DEBOUNCE_MS = 2_000
/** Fase 3 §5.1: janela do scan de "digitando" e limiares de classificação (configuráveis p/ teste). */
export const DEFAULT_TYPING_INTERVAL_MS = 500
export const DEFAULT_TYPING_MS = 2_000
export const DEFAULT_IDLE_MS = 5_000

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
  /** true = evento efêmero (presença, Fase 3 §3.1): nunca persistido; seq NÃO avança o cursor `since` do cliente e não participa de dedup por seq. */
  ephemeral?: true
}

export type Session = {
  id: string
  tenant: string
  filters: Filter[]
  push: (env: EventEnvelope) => void
  /** Identidade do token usado para abrir o SSE (null p/ conexão anônima). Fase 3 §6.1: o router de
   *  afinidade usa isto p/ rotear por USUÁRIO (holder de changeset.delta, atacante de lock.denied) sem
   *  depender de Presence (que só existe depois de um presence.beat/focus explícito). */
  userId: string | null
  /** true = esta sessão SSE nasceu de uma reconexão com um token que o processo atual não reconhece
   *  (spec §9.1: tokens são em memória — um restart do server os apaga). Sinal pragmático de "o server
   *  reiniciou desde a última vez que este cliente se conectou", sem precisar de um bootId dedicado:
   *  se o cliente apresenta um token e o processo não o conhece, ou o token expirou/é lixo, ou (o caso
   *  que nos interessa) o processo reiniciou. Consumido uma vez por presence.ts `touch()` — assim que o
   *  agentKind é conhecido (primeiro beat/focus) — pra decidir se emite o system.message de restart
   *  (só non-web; web já trata o envelope `server.restarted` cru, Task 4). */
  restartPending: boolean
}

/**
 * Token → identidade. D10-lite: o Map continua sendo o índice quente (todo lookup é dele), mas agora
 * é HIDRATADO do SQLite no boot, então um token sobrevive a restart — antes, reiniciar o servidor
 * invalidava silenciosamente todo token já emitido.
 *
 * `expiresAt` (epoch ms) é checado em todo lookup, não só no boot: um processo que ficou meses de pé
 * não pode continuar aceitando um token vencido só porque a varredura de boot já passou.
 *
 * `staleBoot` = "este token foi emitido por um processo ANTERIOR" (veio da hidratação). É o que
 * substitui o antigo sinal de restart: `restartPending` era `token && !tokens.has(token)`, que só
 * funcionava PORQUE os tokens morriam. Com tokens duráveis esse sinal sumiria e o cliente nunca
 * saberia que a presença foi zerada. Consumido uma vez, na primeira conexão SSE que apresentar o
 * token (sse.ts), e então zerado — as reconexões seguintes do mesmo processo não são restart.
 */
export type TokenInfo = { token: string; userId: string; tenantId: string; name: string; expiresAt: number; staleBoot?: boolean }

/**
 * Presence — estado de presença viva por sessão (Fase 3 §3), EM MEMÓRIA (nunca persistido: restart
 * esquece tudo). `tenant` não faz parte do contrato público (spec §3.1 não lista), mas é guardado aqui
 * p/ escopar presence.who/broadcasts por tenant sem depender da sessão SSE ainda estar viva.
 */
export type Presence = {
  sessionId: string
  tenant: string
  userId: string
  agentKind: AgentKind
  lastSeen: number
  focusCell: string | null
  openCsIds: string[]
  invisible: boolean
  lastDeltaAt: number
  /** Classificação corrente do agregador de "digitando" (Fase 3 §5.1) — usada só p/ detectar TRANSIÇÃO
   *  (o broadcast de `user.typing_state` acontece só quando isto muda, nunca a cada tick). */
  typingState: "typing" | "idle" | "quiet"
}

/** "indexed" = servidor indexou o repo e persistiu no tenant. "skeleton"/"existing" eram os
 *  caminhos antigos, quando o grafo vinha de `.graph/` no repo-alvo — mantidos só p/ leitura de
 *  snapshots gravados antes da migração. */
export type Pipeline = "indexed" | "skeleton" | "existing"

/** Grafo de conhecimento por tenant (índice quente p/ query/watch). O default carrega o fluxo Fase 1. */
/** `repoPath`: cada tenant indexa o SEU repo. `state.repoPath` continua existindo como default de
 *  servidor (env GRAPH_REPO_PATH / autoBootstrap), mas não é mais o que o rebuild de um tenant lê. */
export type TenantGraph = { graph: Graph | null; graphId: string; pipeline: Pipeline | null; bootstrappedAt: string | null; repoPath: string | null }

export type ServerState = {
  repoPath: string
  stateDir: string
  db: Database
  ttlMs: number
  presenceTtlMs: number
  focusDebounceMs: number
  /** Limiares de classificação de "digitando" (Fase 3 §5.1), configuráveis p/ teste. */
  typingMs: number
  idleMs: number
  /** Validade de um token novo (D10-lite). Overridável p/ teste, como ttlMs/presenceTtlMs. */
  tokenTtlMs: number
  graphs: Map<string, TenantGraph>
  tokens: Map<string, TokenInfo>
  subscriptions: Map<string, Filter[]>
  sessions: Map<string, Session>
  /** Contador de deltas por changeset p/ o agregador de 100ms (payload só count, spec §6). */
  deltaCounts: Map<string, { count: number; tenant: string; byUser: string }>
  /**
   * "o tick anterior DESTE tenant teve eventos?" — o que decide se o proximo tick silencioso emite
   * `watch.converged`. Era um `boolean` unico do processo (SB-0/REPORT-F1): com dois tenants sob
   * watch, o tick de A zerava o flag e o `watch.converged` de B era engolido, ou pior, atribuido ao
   * tenant errado. A chave e o tenantId.
   */
  lastTickHadEvents: Map<string, boolean>
  /** Presença viva por sessionId (Fase 3 §3) — em memória, some no restart. */
  presence: Map<string, Presence>
  /** Ephemeral collision-safe tenant → actor → live session IDs index for the typing hot path. */
  actorSessions: Map<string, Map<string, Set<string>>>
  /** Timers de debounce de focus por sessionId (Fase 3 §6.3) — só o último settle broadcast. */
  focusDebounce: Map<string, ReturnType<typeof setTimeout>>
  /** Cache em memória de `readClaims` por tenant (QA-5: full-tenant scan em TODO `changeset.claim`
   *  media p95 subir ~9x num soak de 10min conforme claims commitados acumulam). Populado lazy no
   *  primeiro `readClaims`; `writeClaim` empurra incrementalmente (append-only — claims nunca mudam
   *  nem somem); `rebuildFromJsonl` invalida (único caminho que escreve claims por fora de writeClaim). */
  claimsCache: Map<string, import("./gates").ClaimSnapshot[]>
  /** Aggregate point-lookup observability; deliberately contains no tenant or claim identifiers. */
  claimLookupMetrics: { hits: number; misses: number; totalLatencyMs: number; maxLatencyMs: number }
  claimFileProjectionMetrics: { repoRelative: number; basenameFallback: number; omitted: number }
  /** Nós em drift por tenant, COM a causa por nó (índice vivo do watch-bridge). Perdível: recomputado
   *  no 1o tick. Valor "gone" = arquivo sumiu/ilegível; "structural" = arquivo existe mas a âncora
   *  verbatim sumiu. A causa é o que permite `resources.ts::driftGradeOf` produzir "gone" de verdade
   *  em vez de só "stale" para tudo (antes só o id do nó sobrevivia, num Set — a causa se perdia). */
  driftStale: Map<string, Map<string, "gone" | "structural">>
  /** Regras de posse de domínio (`{ pattern, domain }`, first-match-wins). CONFIG DO SERVIDOR —
   *  vinham de `.graph/domains.json` no repo-alvo, mas o repo não hospeda mais nada de grafo. */
  domains: readonly { pattern: string; domain: string }[] | null
}

export function createState(opts: {
  repoPath?: string
  stateDir: string
  ttlMs?: number
  presenceTtlMs?: number
  focusDebounceMs?: number
  typingMs?: number
  idleMs?: number
  tokenTtlMs?: number
  domains?: readonly { pattern: string; domain: string }[] | null
  db?: Database
}): ServerState {
  const db = opts.db ?? openDb(opts.stateDir === ":memory:" ? ":memory:" : `${opts.stateDir}/state.sqlite`)
  const state: ServerState = {
    repoPath: opts.repoPath ?? "",
    stateDir: opts.stateDir === ":memory:" ? "" : opts.stateDir,
    db,
    ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
    presenceTtlMs: opts.presenceTtlMs ?? DEFAULT_PRESENCE_TTL_MS,
    focusDebounceMs: opts.focusDebounceMs ?? DEFAULT_FOCUS_DEBOUNCE_MS,
    typingMs: opts.typingMs ?? DEFAULT_TYPING_MS,
    idleMs: opts.idleMs ?? DEFAULT_IDLE_MS,
    tokenTtlMs: opts.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS,
    graphs: new Map(),
    tokens: new Map(),
    subscriptions: new Map(),
    sessions: new Map(),
    deltaCounts: new Map(),
    lastTickHadEvents: new Map(),
    presence: new Map(),
    actorSessions: new Map(),
    focusDebounce: new Map(),
    claimsCache: new Map(),
    claimLookupMetrics: { hits: 0, misses: 0, totalLatencyMs: 0, maxLatencyMs: 0 },
    claimFileProjectionMetrics: { repoRelative: 0, basenameFallback: 0, omitted: 0 },
    domains: opts.domains?.length ? opts.domains : null,
    driftStale: new Map(),
  }
  // D10-lite: tokens sobrevivem a restart. A hidratação é aqui — no ÚNICO ponto por onde todo
  // caminho (produção, teste, rebuild) constrói um ServerState — e não no `import.meta.main` de
  // index.ts, senão um teste que reabre o mesmo STATE_DIR não veria os próprios tokens de volta,
  // que é exatamente o comportamento sob prova.
  hydrateTokens(state)
  return state
}

export function tenantGraph(state: ServerState, tenant: string): TenantGraph {
  let g = state.graphs.get(tenant)
  if (!g) {
    g = { graph: null, graphId: "", pipeline: null, bootstrappedAt: null, repoPath: null }
    state.graphs.set(tenant, g)
  }
  return g
}

/** Exportado p/ affinity.ts reusar o teste "casa este filtro" fora do AND-de-todos-os-filtros de matches(). */
export function matchOne(f: Filter, e: EventEnvelope): boolean {
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

/**
 * pushEnvelope — ponto único de difusão (durável via appendEvent, efêmero via broadcastEphemeral).
 * Fase 3 §6.1: o destinatário de CADA evento é calculado pelo router de afinidade (affinity.ts), que
 * generaliza `matches()` (a base "Fase 2 simples") com as regras por-kind da tabela §6.1 (holder,
 * focus-na-cell, restrição de lock.denied etc). `route` é puro — recebe os mapas e devolve os
 * sessionIds destinatários; aqui só resolvemos o Session e chamamos `.push`.
 */
export function pushEnvelope(state: ServerState, tenant: string, env: EventEnvelope): void {
  for (const id of route(env, state.sessions, state.presence, tenant)) {
    const s = state.sessions.get(id)
    if (!s) continue
    s.push(env)
    maybeSystemMessage(state, tenant, env, s)
  }
}

/**
 * Fase 3 §8.1: pra cada destinatário que o affinity router JÁ decidiu (route(), acima) — nenhuma rota
 * nova — renderiza uma versão texto do evento e empurra como `system.message` SE essa sessão for de um
 * agentKind não-web. `system.message` nunca entra aqui de novo (evita eco): renderSystemMessage não
 * conhece esse kind vindo de pushEnvelope (só é usado diretamente por sse.ts pro caso server.restarted).
 */
function maybeSystemMessage(state: ServerState, tenant: string, env: EventEnvelope, s: Session): void {
  if (env.kind === "system.message") return
  const presence = state.presence.get(s.id)
  if (!presence) return
  if (flavor(presence.agentKind).liveTier === "none") return
  const text = renderSystemMessage(state, tenant, env, presence.userId)
  if (text) pushSystemMessage(state, tenant, s, text, env.target)
}

export type EventInput = {
  kind: string
  targetKind?: string | null
  targetId?: string | null
  payload?: Record<string, unknown>
  byUser?: string | null
}

/**
 * Payload canônico de `changeset.aborted` — `byUser` (= holder) é ESTRUTURAL aqui: o router de afinidade
 * (affinity.ts) roteia o abort p/ o holder por este campo do PAYLOAD (EventInput.byUser vai só p/ a
 * coluna de auditoria, não entra no envelope). Helper único p/ os três emissores (commit rejeitado,
 * abort explícito, TTL expiry) não divergirem de shape.
 */
export function abortedPayload(
  cs: { id: string; opened_by: string },
  reason: "rejected" | "user" | "ttl_expired",
  cells: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { csId: cs.id, reason, cells, byUser: cs.opened_by, ...extra }
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

/**
 * broadcastEphemeral — difunde SEM persistir (nem SQLite `events`, nem espelho JSONL): presença é
 * efêmera (Fase 3 §3.1 — restart esquece tudo; replay/rebuild não deve reproduzir user.joined/
 * focused/left). Roteia pelos MESMOS filtros de sessão dos eventos duráveis (pushEnvelope → matches).
 *
 * CONTRATO do envelope efêmero (`ephemeral: true`): o `seq` carrega o max durável corrente do tenant
 * (NÃO aloca um novo) — efêmero nunca avança o cursor `since` de replay, e clientes NÃO devem
 * deduplicar efêmeros por seq (vários efêmeros repetem o mesmo seq por design; a flag é o sinal).
 */
export function broadcastEphemeral(state: ServerState, tenant: string, input: EventInput): EventEnvelope {
  const env: EventEnvelope = {
    schemaVersion: 1,
    seq: nextSeq(state, tenant) - 1,
    ephemeral: true,
    ts: new Date().toISOString(),
    kind: input.kind,
    target: input.targetId ?? null,
    payload: input.payload ?? {},
    graphId: tenantGraph(state, tenant).graphId,
  }
  pushEnvelope(state, tenant, env)
  return env
}

/** Wrapper da Fase 1: eventos de bootstrap/watch/drift no tenant default. */
export function publish(
  state: ServerState,
  partial: { kind: string; target: string | null; payload: Record<string, unknown> },
  tenant: string = DEFAULT_TENANT,
): EventEnvelope {
  return appendEvent(state, tenant, { kind: partial.kind, targetId: partial.target, payload: partial.payload })
}

/** Célula de um nó no grafo default (usado pelo watch-bridge Fase 1). */
export function nodeCell(state: ServerState, nodeId: string): { domain: string; cell: string } | null {
  const n = tenantGraph(state, DEFAULT_TENANT).graph?.nodes.find((x) => x.id === nodeId)
  if (!n || !n.domain) return null
  const level = String(n.level).replace(/^P/, "")
  return { domain: n.domain, cell: `${n.domain}:${level}` }
}
