/**
 * Conexão única com o server via @open-graph-mcp/client (WD3): connect() é dono
 * de register/SSE/reconnect/reauth/presença (INT-2/QA-1). Este módulo fold-eia
 * cada envelope nos stores puros (PresenceStore da lib; GhostStore/ToastQueue
 * portados da UI velha com seus unit tests) e projeta snapshots imutáveis pro
 * zustand — componentes nunca tocam os singletons. Sem api.ts: tool calls por
 * og().call(), resources pelo resourceRead da lib com o token cacheado.
 */
import {
  connect,
  PresenceStore,
  resourceRead,
  type Envelope,
  type OgHandle,
  type ReauthEvent,
} from "@open-graph-mcp/client"
import { toServerCell, toUiCell, levelNum } from "./cells"
import { colorForCsId, GhostStore, type GhostDelta } from "./ghosts"
import { localStorageTokenStore } from "./token-store"
import { ToastQueue } from "./toasts"
import { useUi, mergeClaimPage, mergeHistoryPage, shouldReadCellPage, type ActiveCs, type DraftDelta, type ClaimRecord, type HistoryEvent, type MatchResult, type GapResult } from "./store"
import { buildReverseIndex as buildReverseIndexPure, mergeReverseIndex } from "./reverse-index"
import { SingleFlight } from "./single-flight"
import { createTypingRateLimiter } from "./typing-rate-limit"
import { ConnectionOwner } from "./connection-owner"
import { submitClaimDraft } from "./claim-draft"
import { createRefNavigator } from "./ref-lookup"

const DRIFT_KINDS = new Set(["drift.node", "drift.cell"])
const CS_KINDS = new Set([
  "changeset.opened",
  "changeset.delta",
  "changeset.committed",
  "changeset.aborted",
  "lock.acquired",
  "lock.released",
])
const PRESENCE_KINDS = new Set(["user.joined", "user.focused", "user.left", "user.typing_state"])

export function serverBase(): string {
  const q = new URLSearchParams(location.search).get("server")
  return (q || "http://localhost:8787").replace(/\/$/, "")
}

const tenant = new URLSearchParams(location.search).get("tenant") || undefined
const tokenStore = localStorageTokenStore()

// ---- singletons puros (fold) + projeções imutáveis (zustand) ---------------
const presence = new PresenceStore()
const ghosts = new GhostStore()
const toasts = new ToastQueue()
const demotions = new Map<string, number>()

let handle: OgHandle | null = null
export const og = (): OgHandle | null => handle

/** Cell focada localmente — maybeToast precisa dela, e o toggle invisible re-envia a mesma. */
let focusedCell: string | null = null

function projectPresence(): void {
  useUi.setState({ roster: presence.list() })
}

function projectGhosts(): void {
  // chaves convertidas pro dialeto de exibição ("auth:2" → "auth:P2") — cells.ts
  const locks = Object.fromEntries([...ghosts.locks.values()].map((l) => [toUiCell(l.cell), l]))
  const ghostCells: Record<string, string> = {}
  const ghostDeltasByCell: Record<string, DraftDelta[]> = {}
  for (const cs of ghosts.changesets.values())
    for (const cell of cs.cells) {
      const uiCell = toUiCell(cell)
      ghostCells[uiCell] = colorForCsId(cs.csId)
      for (const d of cs.deltas)
        (ghostDeltasByCell[uiCell] ??= []).push({ kind: d.kind, id: d.id, summary: d.summary, at: d.at })
    }
  const active = useUi.getState().activeCs
  const draftDeltas: DraftDelta[] = active
    ? (ghosts.changesets.get(active.csId)?.deltas ?? []).map((d) => ({ kind: d.kind, id: d.id, summary: d.summary, at: d.at }))
    : []
  useUi.setState({ locks, ghostCells, ghostDeltasByCell, draftDeltas })
}

function projectToasts(): void {
  const { toasts: list, overflow } = toasts.visible(5)
  useUi.setState({ toasts: { list: [...list], overflow } })
}

function projectDrift(patch: Record<string, string>): void {
  useUi.setState((s) => ({ drift: { ...s.drift, ...patch } }))
}

function refreshDemotions(): void {
  const cutoff = Date.now() - 24 * 3600_000
  useUi.setState({ demotions: [...demotions.values()].filter((ts) => ts >= cutoff).length })
}

// ---- toasts ----------------------------------------------------------------
export function pushToast(key: string, text: string, target?: string): void {
  const t = toasts.push(key, text, { target })
  projectToasts()
  setTimeout(() => {
    toasts.remove(t.id)
    projectToasts()
  }, 8_000)
}

export const toastTarget = (id: string): string | undefined => toasts.all().find((t) => t.id === id)?.target

const myUserId = (): string => useUi.getState().userId || (localStorage.getItem("og.userId") ?? "")
/** userId → nome de exibição via roster vivo (cai pro próprio id). */
const nameOf = (userId: string): string => presence.users.get(userId)?.name ?? userId

/** Regras de toast da UI velha, portadas intactas (spec §7.4). */
function maybeToast(env: Envelope): void {
  const p = env.payload ?? {}
  const settings = useUi.getState().settings
  if (env.kind === "changeset.aborted" && p.reason === "ttl_expired") {
    pushToast(p.csId, `${p.csId} abortado por TTL`, p.cells?.[0])
  } else if (env.kind === "lock.acquired" && focusedCell && toUiCell(p.cell ?? "") === focusedCell && p.holder !== myUserId()) {
    pushToast(p.csId ?? p.cell, `${nameOf(p.holder)} abriu turno em [${toUiCell(p.cell)}] — você perdeu prioridade`, toUiCell(p.cell))
  } else if (env.kind === "changeset.committed" && settings.notifyCommits) {
    // payload não tem byUser — a entrada ghost (removida só depois deste handler) conhece o dono
    const opener = ghosts.changesets.get(p.csId)?.byUser
    if (opener && opener === myUserId()) return // não toastar o próprio commit
    const cell = p.cells?.[0] ? toUiCell(p.cells[0]) : undefined
    pushToast(p.csId, `${opener ? nameOf(opener) : "alguém"} commitou ${p.csId} em [${cell ?? "?"}]`, cell)
  }
}

// ---- presença --------------------------------------------------------------
export function setFocus(cell: string | null): void {
  focusedCell = cell
  // invisible sempre explícito: o server só atualiza invisibilidade quando o flag é boolean
  handle?.presence
    .focus(cell, { invisible: !useUi.getState().settings.showPresence })
    .catch((e) => console.error("presence.focus failed", e))
}

/** Toggle de invisibilidade re-envia a MESMA cell focada com o flag novo. */
export function refreshFocus(): void {
  setFocus(focusedCell)
}

export async function pollWho(): Promise<void> {
  if (!handle || !tokenStore.get()) return
  try {
    const res: any = await handle.call("presence.who", {})
    presence.mergeWho(res?.users ?? [])
    projectPresence()
  } catch (e) {
    console.error("presence.who failed", e)
  }
}

let typingLimiter: ReturnType<typeof createTypingRateLimiter> | null = null
const connectionOwner = new ConnectionOwner()
export function signalTyping(): void { typingLimiter?.signal() }

// Timers armed on connect, disarmed on close (RETRY #1 REWORK-LOG openPoint 5).
let pollTimer: ReturnType<typeof setInterval> | null = null
let presenceTimer: ReturnType<typeof setInterval> | null = null
function armTimers(): void {
  if (pollTimer === null) pollTimer = setInterval(pollWho, 10_000)
  if (presenceTimer === null) presenceTimer = setInterval(projectPresence, 5_000)
}
function disarmTimers(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null }
}

// ---- ghost deltas: refetch com debounce de graph://changeset/{id} ----------
const refetchTimers = new Map<string, ReturnType<typeof setTimeout>>()
function refetchDeltas(csId: string): void {
  clearTimeout(refetchTimers.get(csId))
  refetchTimers.set(
    csId,
    setTimeout(async () => {
      try {
        const res: any = await resourceRead(serverBase(), `graph://changeset/${csId}`, tokenStore.get()?.token)
        const raw: any[] = res?.deltas ?? res?.changeset?.deltas ?? []
        ghosts.setDeltas(csId, raw.map(toGhostDelta))
        projectGhosts()
      } catch (e) {
        console.error("changeset refetch failed", e)
      }
    }, 150),
  )
}

function toGhostDelta(d: any): GhostDelta {
  const pl = d.payload ?? {}
  return { kind: d.kind, id: pl.id, subject: pl.subject, domain: pl.domain ?? null, level: pl.level, summary: pl.subject ?? pl.cell ?? d.kind, at: d.createdAt ?? d.at }
}

async function loadOpenChangesets(): Promise<void> {
  try {
    const res: any = await resourceRead(serverBase(), "graph://changesets?status=open", tokenStore.get()?.token)
    const list: any[] = res?.changesets ?? res ?? []
    for (const cs of list) {
      ghosts.track({
        csId: cs.csId ?? cs.id,
        intent: cs.intent ?? "",
        cells: cs.cells ?? [],
        byUser: cs.byUser ?? "?",
        openedAt: cs.openedAt ?? 0,
        expiresAt: cs.expiresAt ?? "",
        deltaCount: 0,
        deltas: [],
      })
      refetchDeltas(cs.csId ?? cs.id)
    }
    projectGhosts()
  } catch (e) {
    console.error("open changesets failed", e)
  }
}

// ---- snapshot --------------------------------------------------------------
export async function loadSnapshot(): Promise<void> {
  try {
    const res = await resourceRead(serverBase(), "graph://snapshot", tokenStore.get()?.token)
    useUi.getState().setGraph(res.graph)
    await loadOpenChangesets()
  } catch (e) {
    console.error("snapshot failed", e)
  }
}

// ---- projeção de eventos ---------------------------------------------------
function applyEvent(env: Envelope): void {
  useUi.setState((s) => ({
    seq: env.seq ?? s.seq,
    events: [{ seq: env.seq ?? 0, ts: env.ts || Date.now(), kind: env.kind, target: env.target }, ...s.events].slice(0, 20),
  }))

  if (DRIFT_KINDS.has(env.kind) && env.target) projectDrift({ [env.target]: env.payload?.grade ?? "drift" })
  if (env.kind === "authority.demoted" && env.target) {
    demotions.set(env.target, env.ts || Date.now())
    refreshDemotions()
  }
  if (env.kind === "authority.reconciled" && env.target) {
    demotions.delete(env.target)
    refreshDemotions()
  }
  if (env.kind === "graph.rebuilt" || env.kind === "graph.bootstrapped") {
    loadSnapshot()
    invalidateReverseIndex()
  }

  if (env.kind === "server.restarted") {
    // presença vive só na memória do server (spec §9.1); a recuperação em si é do connect()
    pushToast("server", "Server reiniciou — sua presença foi resetada")
  }

  if (PRESENCE_KINDS.has(env.kind)) {
    presence.apply(env)
    projectPresence()
  }

  maybeToast(env)

  if (CS_KINDS.has(env.kind) || env.kind === "authority.flipped") {
    const r = ghosts.apply(env)
    if (r.refetch) refetchDeltas(r.refetch)
    if (r.committed) loadSnapshot()
    // turno ativo morreu (commit meu confirmado, ou abort por TTL/rollback do gate final)
    if (
      (env.kind === "changeset.committed" || env.kind === "changeset.aborted") &&
      env.payload?.csId === useUi.getState().activeCs?.csId
    ) {
      useUi.setState({ activeCs: null })
      listMine()
    }
    projectGhosts()
  }
}

// ---- turnos (UI-2) ---------------------------------------------------------
export type OpenTurnResult = { ok: true } | { ok: false; denied?: true }

/** Abre turno nas cells (dialeto de exibição); converte pro server aqui (cells.ts). */
export async function openTurn(uiCells: string[], intent: string): Promise<OpenTurnResult> {
  const h = handle
  if (!h) return { ok: false }
  const res: any = await h.call("changeset.open", { cells: uiCells.map(toServerCell), intent })
  if (res?.ok === false) {
    if (res.reason === "cell_locked") {
      useUi.setState({ denied: { cell: toUiCell(res.cell), holder: res.holder, csId: res.csId, expiresAt: res.expiresAt } })
      return { ok: false, denied: true }
    }
    return { ok: false }
  }
  const active: ActiveCs = { csId: res.csId, intent, cells: uiCells, expiresAt: res.expiresAt }
  ghosts.track({
    csId: res.csId,
    intent,
    cells: uiCells.map(toServerCell),
    byUser: myUserId(),
    openedAt: Date.now(),
    expiresAt: res.expiresAt,
    deltaCount: 0,
    deltas: [],
  })
  useUi.setState({ activeCs: active, denied: null })
  projectGhosts()
  listMine()
  return { ok: true }
}

export type ClaimForm = {
  id: string
  subject: string
  domain: string
  level: string | number
  refs: string[]
  anchor?: string
  file?: string
}

/** Claim do form; level marshallado numérico (gate real). Retorna reasons/warnings pro painel. */
export async function claimDraft(form: ClaimForm | Record<string, unknown>, rawJson?: string): Promise<{ ok: boolean; reasons: string[]; warnings: string[] }> {
  const h = handle
  const cs = useUi.getState().activeCs
  if (!h || !cs) return { ok: false, reasons: ["sem turno ativo"], warnings: [] }
  const payload = rawJson ? {} : { ...(form as ClaimForm), level: levelNum((form as ClaimForm).level) }
  const outcome = await submitClaimDraft(payload, rawJson, (claim) =>
    h.call("changeset.claim", { csId: cs.csId, delta: { kind: "claim.add", payload: claim } }) as Promise<any>)
  if (outcome.ok) refetchDeltas(cs.csId)
  return outcome
}

async function csAction(tool: string): Promise<{ ok: boolean; reasons: string[]; expiresAt?: string }> {
  const h = handle
  const cs = useUi.getState().activeCs
  if (!h || !cs) return { ok: false, reasons: ["sem turno ativo"] }
  const res: any = await h.call(tool, { csId: cs.csId })
  if (res?.ok === false) return { ok: false, reasons: res.reasons ?? ["recusado"] }
  return { ok: true, reasons: [], expiresAt: res?.expiresAt }
}

export async function commitTurn(): Promise<{ ok: boolean; reasons: string[] }> {
  const r = await csAction("changeset.commit")
  if (r.ok) {
    useUi.setState({ activeCs: null })
    listMine()
    projectGhosts()
  }
  return r
}

export async function abortTurn(): Promise<{ ok: boolean; reasons: string[] }> {
  const r = await csAction("changeset.abort")
  if (r.ok) {
    useUi.setState({ activeCs: null })
    listMine()
    projectGhosts()
  }
  return r
}

export async function extendTurn(): Promise<{ ok: boolean; reasons: string[] }> {
  const r = await csAction("changeset.extend")
  if (r.ok && r.expiresAt) {
    const cs = useUi.getState().activeCs
    if (cs) useUi.setState({ activeCs: { ...cs, expiresAt: r.expiresAt } })
  }
  return r
}

// ---- UI-3 (F002): claims/query/history/reverse-index ----------------------
export type { ClaimRecord, HistoryEvent, MatchResult, GapResult }

export async function listMine(): Promise<void> {
  const h = handle
  if (!h || !tokenStore.get()) return
  try {
    const res: any = await h.call("changeset.list_mine", {})
    useUi.setState({
      myTurns: (res?.changesets ?? []).map((c: any) => ({ ...c, cells: (c.cells ?? []).map(toUiCell) })),
    })
  } catch (e) {
    console.error("list_mine failed", e)
  }
}

/** Read-only `graph://claims?cell=<domain:level>` → ClaimRecord[]. Cached in store per snapshot. */
const cellClaimsRequests = new SingleFlight<ClaimRecord[]>()
export async function readClaims(cell: string, continuation = false): Promise<ClaimRecord[]> {
  const state = useUi.getState()
  const cached = state.claimsByCell[cell]
  const pageState = state.claimCellPages[cell] ?? { cursor: 0, hasMore: true, loading: false, initialized: false }
  if (!shouldReadCellPage(cached, pageState, continuation)) return cached ?? []
  if (continuation && !pageState.hasMore) return cached ?? []
  const since = continuation ? pageState.cursor : 0
  const generation = state.claimsGeneration
  const requestKey = `${generation}:${cell}:${since}`
  const isActiveRequest = () => useUi.getState().selectedCell === cell
  if (isActiveRequest()) {
    useUi.getState().setClaimsLoading(true)
    useUi.setState({ claimsCellError: null })
  }
  return cellClaimsRequests.run(requestKey, async () => { try {
    useUi.setState((current) => ({ claimCellPages: { ...current.claimCellPages, [cell]: { ...pageState, loading: true } } }))
    const res: any = await resourceRead(serverBase(), `graph://claims?cell=${encodeURIComponent(cell)}&since=${since}&limit=100`, tokenStore.get()?.token)
    const claims: ClaimRecord[] = (res?.claims ?? []).map((c: any) => ({
      id: c.id,
      subject: c.subject ?? c.id,
      domain: c.domain,
      level: c.level,
      refs: c.refs ?? [],
      anchor: c.anchor ?? "",
      file: c.file,
      seq: c.seq,
      verdict: c.verdict,
      status: c.status,
      supersedes: c.supersedes,
    }))
    if (useUi.getState().claimsGeneration !== generation) return useUi.getState().claimsByCell[cell] ?? []
    useUi.setState((current) => ({
      claimsByCell: mergeClaimPage(current.claimsByCell, claims),
      claimCellPages: { ...current.claimCellPages, [cell]: { cursor: res?.nextCursor ?? since, hasMore: !!res?.hasMore, loading: false, initialized: true } },
    }))
    return useUi.getState().claimsByCell[cell] ?? []
  } catch (e) {
    if (useUi.getState().claimsGeneration === generation) {
      if (isActiveRequest()) useUi.setState({ claimsCellError: (e as Error).message })
      useUi.setState((current) => ({ claimCellPages: { ...current.claimCellPages, [cell]: { ...pageState, loading: false } } }))
    }
    return useUi.getState().claimsByCell[cell] ?? []
  } finally {
    if (useUi.getState().claimsGeneration === generation && isActiveRequest()) useUi.getState().setClaimsLoading(false)
  } })
}

export function loadMoreCellClaims(cell: string): Promise<ClaimRecord[]> { return readClaims(cell, true) }

const snapshotClaimsRequests = new SingleFlight<Record<string, ClaimRecord[]>>()
export async function readSnapshotClaims(force = false): Promise<Record<string, ClaimRecord[]>> {
  const generation = useUi.getState().claimsGeneration
  const since = force ? 0 : useUi.getState().claimsCursor
  const requestKey = `${generation}:${since}`
  return snapshotClaimsRequests.run(requestKey, async () => {
    useUi.setState({ claimsLoadingMore: true, claimsSnapshotError: null })
    try {
      const res: any = await resourceRead(serverBase(), `graph://claims?scope=snapshot&since=${since}&limit=100`, tokenStore.get()?.token)
      const claims = (res?.claims ?? []) as ClaimRecord[]
      if (useUi.getState().claimsGeneration !== generation) return useUi.getState().claimsByCell
      useUi.setState((state) => ({
        claimsByCell: mergeClaimPage(state.claimsByCell, claims),
        reverseIndex: mergeReverseIndex(state.reverseIndex ?? new Map(), claims),
        claimsCursor: res?.nextCursor ?? since,
        claimsHasMore: !!res?.hasMore,
      }))
      return useUi.getState().claimsByCell
    } catch (error) {
      if (useUi.getState().claimsGeneration === generation) useUi.setState({ claimsSnapshotError: (error as Error).message })
      return useUi.getState().claimsByCell
    } finally {
      if (useUi.getState().claimsGeneration === generation) useUi.setState({ claimsLoadingMore: false })
    }
  })
}

export async function loadMoreClaims(): Promise<Record<string, ClaimRecord[]>> {
  if (!useUi.getState().claimsHasMore) return useUi.getState().claimsByCell
  return readSnapshotClaims()
}

/** og.call('graph.query', {terms}) → normalised {candidates, gaps}. Gap is always 1st-class.
 *  RETRY #1 (REWORK-LOG openPoint G): validate `score` (number → return; otherwise → 0) and
 *  `domain` (string → return; otherwise → null) so a malformed server response can't TypeError
 *  on `score.toFixed(2)` or other renders. */
export async function queryClaims(term: string): Promise<{ candidates: MatchResult[]; gaps: GapResult[] }> {
  const h = og()
  if (!h) return { candidates: [], gaps: [{ term, suggestions: [] }] }
  const res: any = await h.call("graph.query", { terms: [term] })
  const candidates: MatchResult[] = (res?.candidates ?? []).map((c: any) => ({
    id: c.id,
    domain: typeof c.domain === "string" ? c.domain : null,
    layer: c.layer,
    subject: typeof c.subject === "string" ? c.subject : String(c.subject ?? c.id),
    file: typeof c.file === "string" ? c.file : "",
    anchor: typeof c.anchor === "string" ? c.anchor : "",
    score: typeof c.score === "number" ? c.score : 0,
  }))
  const rawGaps: string[] = res?.gaps ?? []
  const gaps: GapResult[] = rawGaps.map((t) => ({ term: t, suggestions: refinementFor(t) }))
  return { candidates, gaps }
}

function refinementFor(term: string): string[] {
  // Naive refinement hints from snapshot domain lexicon; ponytail: domain names are how the
  // orchestrator should drill — server-side semantic suggestions are a later slice.
  const g = useUi.getState().graph
  const domains = new Set<string>()
  for (const n of g?.nodes ?? []) if (n.domain) domains.add(n.domain)
  const near = [...domains].filter((d) => d.toLowerCase().includes(term.toLowerCase().slice(0, 3)) || term.toLowerCase().includes(d.toLowerCase().slice(0, 3)))
  return near.length ? near : [...domains]
}

const historyRequests = new SingleFlight<HistoryEvent[]>()
/** Read an initial bounded history page or append a continuation page. */
export async function readHistory(since = 0, limit = 100): Promise<HistoryEvent[]> {
  const append = since > 0
  return historyRequests.run(`${since}:${limit}`, async () => { try {
    useUi.getState().setHistoryLoading(!append)
    useUi.setState({ historyLoadingMore: append })
    useUi.getState().setHistoryError(null)
    const res: any = await resourceRead(serverBase(), `graph://history?since=${since}&limit=${limit}`, tokenStore.get()?.token)
    const events: HistoryEvent[] = (res?.events ?? []).map((e: any) => ({
      seq: e.seq,
      ts: e.ts,
      kind: e.kind,
      target: e.target,
      payload: e.payload,
      graphId: e.graphId,
    }))
    useUi.setState((state) => ({
      historyEvents: mergeHistoryPage(state.historyEvents, events, append),
      historyCursor: res?.nextCursor ?? since,
      historyHasMore: !!res?.hasMore,
    }))
    return useUi.getState().historyEvents
  } catch (e) {
    useUi.getState().setHistoryError((e as Error).message)
    return useUi.getState().historyEvents
  } finally {
    useUi.getState().setHistoryLoading(false)
    useUi.setState({ historyLoadingMore: false })
  } })
}

export async function loadMoreHistory(): Promise<HistoryEvent[]> {
  const state = useUi.getState()
  if (!state.historyHasMore) return state.historyEvents
  return readHistory(state.historyCursor, 100)
}

/** Reverse index builder — pure derivation moved to reverse-index.ts (unit-testable in
 * isolation; og.ts is browser-side and not importable under bun:test). */
export const buildReverseIndexStatic = buildReverseIndexPure

/** RefChip navigation (F002 task 03 acceptance, RETRY #1 REWORK-LOG openPoint A / edgeCase A):
 *  ownerCell lookup over claimsByCell → setSelectedCell BEFORE openClaim → requestCenter on
 *  the owner's cell (setCenter RF on the node) + open the target claim. If ref is dangling, toast
 *  'ref não encontrado' once + debounced snapshot refresh (negative cache on the refId).
 */
const refNavigator = createRefNavigator({
  snapshot: () => {
    const state = useUi.getState()
    return { generation: state.claimsGeneration, claimsByCell: state.claimsByCell }
  },
  read: (encodedId) => resourceRead(serverBase(), `graph://claims?id=${encodedId}`, tokenStore.get()?.token) as Promise<any>,
  merge: (claim) => useUi.setState((state) => ({ claimsByCell: mergeClaimPage(state.claimsByCell, [claim]) })),
  navigate: (ownerCell, refId) => {
    const state = useUi.getState()
    if (state.selectedCell !== ownerCell) state.setSelectedCell(ownerCell)
    state.openClaim(refId)
    state.requestCenter(ownerCell)
  },
  notifyMissing: (refId) => pushToast(`ref-${refId}`, "ref não encontrado"),
  notifyFailure: (refId) => pushToast(`ref-read-${refId}`, "falha ao ler referência"),
})

export function navigateToClaim(refId: string): Promise<void> { return refNavigator.navigate(refId) }
export function invalidateReverseIndex(): void {
  refNavigator.clear()
  useUi.getState().setReverseIndex(null)
  useUi.setState({ claimsError: null, claimsCellError: null, claimsSnapshotError: null })
  // claims per snapshot are stale after rebuild — drop caches so next ClaimsBrowser re-fetches.
  useUi.setState((state) => ({ claimsByCell: {}, claimCellPages: {}, claimsCursor: 0, claimsHasMore: false, claimsLoadingMore: false, claimsGeneration: state.claimsGeneration + 1 }))
}

/** Reabre o draft dum turno meu já aberto (widget "meus turnos" / reattach). */
export function reopenTurn(t: { csId: string; intent: string; cells: string[]; expiresAt: string | null }): void {
  useUi.setState({ activeCs: { csId: t.csId, intent: t.intent, cells: t.cells.map(toUiCell), expiresAt: t.expiresAt ?? "" } })
  refetchDeltas(t.csId)
}

/**
 * (Re)conecta — boot e troca de nome (identidade nova derruba a conexão
 * anterior). Sem nome nem token cache, conecta anônimo: SSE aberto, snapshot
 * visível, sem identidade.
 */
export async function connectOg(name?: string): Promise<void> {
  const cached = tokenStore.get()
  const finalName = (name || localStorage.getItem("og.name") || "").trim()

  typingLimiter?.cancel()
  typingLimiter = null
  handle?.close()
  const generation = connectionOwner.replace()
  let nextHandle: Awaited<ReturnType<typeof connect>>
  try {
    nextHandle = await connect({
      server: serverBase(),
      agentKind: "web",
      tenant,
      ...(cached || finalName ? { store: tokenStore, name: finalName || undefined } : {}),
      onOpen: () => { connectionOwner.ifCurrent(generation, () => { useUi.getState().setConn("on"); armTimers() }) },
      onClose: () => { connectionOwner.ifCurrent(generation, () => {
        typingLimiter?.cancel()
        typingLimiter = null
        useUi.getState().setConn("off")
        disarmTimers()
      }) },
      onReset: () => loadSnapshot(),
      // pós-(re)conexão: user.* efêmeros não são re-emitidos pra sessão nova — poll imediato;
      // changesets ainda abertos desta identidade voltam pros ghosts (spec §9)
      onReattach: (res: any) => {
        const mine: any[] = res?.changesets ?? res ?? []
        for (const cs of mine) {
          ghosts.track({
            csId: cs.csId ?? cs.id,
            intent: cs.intent ?? "",
            cells: cs.cells ?? [],
            byUser: cs.byUser ?? myUserId(),
            openedAt: cs.openedAt ?? 0,
            expiresAt: cs.expiresAt ?? "",
            deltaCount: 0,
            deltas: [],
          })
          refetchDeltas(cs.csId ?? cs.id)
        }
        // reconectou com turno aberto → draft volta sozinho (02-scope item 6);
        // não rouba o draft se o user já está com um aberto na UI
        const first = mine[0]
        if (first && !useUi.getState().activeCs) {
          reopenTurn({ csId: first.csId ?? first.id, intent: first.intent ?? "", cells: first.cells ?? [], expiresAt: first.expiresAt ?? null })
        }
        projectGhosts()
        listMine()
        pollWho()
      },
      onReauth: (ev: ReauthEvent) => {
        if (ev.type === "reregistered") {
          useUi.getState().setIdentity(finalName, ev.creds.userId)
          localStorage.setItem("og.userId", ev.creds.userId)
          // prova visível de que a auto-recuperação QA-1 rodou (dupla com o toast de server.restarted — intencional)
          pushToast("reauth", "Sessão renovada automaticamente após reinício do servidor")
        } else console.error("auto re-register failed", ev.error)
      },
    })
  } catch (e) {
    if (!connectionOwner.isCurrent(generation)) return
    console.error("connect failed", e)
    handle = null
    return
  }

  // A slower connection attempt may resolve after a replacement has already opened. It never owns
  // global state: close it immediately instead of installing its handle or typing limiter.
  if (!connectionOwner.isCurrent(generation)) {
    nextHandle.close()
    return
  }
  handle = nextHandle

  const connectionHandle = handle
  typingLimiter = createTypingRateLimiter(() => {
    connectionHandle.call("presence.typing", {}).catch((e) => console.error("presence.typing failed", e))
  })

  handle.on("*", applyEvent)

  const creds = tokenStore.get()
  if (creds && finalName) {
    localStorage.setItem("og.name", finalName)
    localStorage.setItem("og.userId", creds.userId)
    useUi.getState().setIdentity(finalName, creds.userId)
    // registro pode ter trocado o tenant efetivo — re-lê com a credencial certa
    await loadSnapshot()
    pollWho()
    listMine()
  }
}
