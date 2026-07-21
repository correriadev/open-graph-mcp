/**
 * Estado de UI (WD4): só o que é apresentação — grafo projetado, conexão,
 * identidade, seleção, e as PROJEÇÕES imutáveis dos stores puros de UI-1
 * (PresenceStore/GhostStore/ToastQueue vivem como singletons em og.ts e são
 * fold-eados lá; aqui só entra o snapshot que os componentes renderizam).
 * A verdade do grafo vem do server (snapshot + eventos); nenhuma mutação
 * acontece aqui. Slices no padrão Dify (referencias-dify.md §A1), enxutos
 * por fase — UI-2 adiciona draft.
 */
import type { Graph } from "@open-graph-mcp/graph-core/build"
import type { PresenceEntry } from "@open-graph-mcp/client"
import { create } from "zustand"
import type { Lock } from "./ghosts"
import type { Toast } from "./toasts"

type ConnState = "on" | "off"

export type FeedItem = { seq: number; ts: number; kind: string; target?: string }
export type Settings = { showPresence: boolean; notifyCommits: boolean }

export function loadSettings(): Settings {
  try {
    const raw = sessionStorage.getItem("og.settings")
    if (raw) return { showPresence: true, notifyCommits: true, ...JSON.parse(raw) }
  } catch {
    /* sessionStorage corrompido/inacessível — defaults */
  }
  return { showPresence: true, notifyCommits: true }
}

export type ActiveCs = { csId: string; intent: string; cells: string[]; expiresAt: string }
export type MyTurn = { csId: string; intent: string; cells: string[]; openedAt: string; expiresAt: string | null }
export type Denied = { cell: string; holder: string; csId: string; expiresAt: string }
export type DraftDelta = { kind: string; summary: string; id?: string; at?: number }

// UI-3 (F002): types for claims/query/history/sidebar
export type ClaimRecord = {
  id: string
  subject: string
  domain: string
  level?: number | string
  refs: string[]
  anchor: string
  file?: string
  seq?: number
  verdict?: { confidence?: number; overclaim?: boolean; contradiction?: boolean; findings?: string[] }
  status?: string
  supersedes?: string
}
export type MatchResult = { id: string; domain: string | null; layer?: string; subject: string; file: string; anchor: string; score: number }
export type GapResult = { term: string; suggestions: string[] }
export type QueryResults = { candidates: MatchResult[]; gaps: GapResult[] }
export type HistoryEvent = { seq: number; ts: number | string; kind: string; target?: string | null; payload?: any; graphId?: string }
export type HistoryFilters = { byUser?: string; target?: string; kind?: string }
export type QuickFilter = "all" | "open-turn" | "locked" | "mine"

export function mergeClaimPage(current: Record<string, ClaimRecord[]>, page: ClaimRecord[]): Record<string, ClaimRecord[]> {
  const next = { ...current }
  for (const claim of page) {
    const level = String(claim.level ?? "").replace(/^P/, "")
    if (!claim.domain || !level) continue
    const cell = `${claim.domain}:P${level}`
    const byId = new Map((next[cell] ?? []).map((item) => [item.id, item]))
    byId.set(claim.id, claim)
    next[cell] = [...byId.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  }
  return next
}

export function mergeHistoryPage(current: HistoryEvent[], page: HistoryEvent[], append: boolean): HistoryEvent[] {
  const bySeq = new Map((append ? current : []).map((event) => [event.seq, event]))
  for (const event of page) bySeq.set(event.seq, event)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

export function shouldReadCellPage(cached: ClaimRecord[] | undefined, page: { initialized: boolean } | undefined, continuation: boolean): boolean {
  if (continuation) return page?.initialized === true
  return !cached || page?.initialized !== true
}

export function claimsPaginationControls(input: {
  hasOpenClaim: boolean
  cellHasMore: boolean
  snapshotHasMore: boolean
  cellError: string | null
  snapshotError: string | null
}) {
  return {
    showCellContinuation: input.cellHasMore,
    showSnapshotContinuation: input.hasOpenClaim && input.snapshotHasMore,
    retryCell: !!input.cellError,
    retrySnapshot: !!input.snapshotError,
  }
}

type UiState = {
  graph: Graph | null
  conn: ConnState
  /** Nome exibido (registrado); vazio = anônimo (só leitura do snapshot). */
  name: string
  userId: string
  selectedId: string | null
  seq: number

  // projeções UI-1 (fonte: singletons em og.ts)
  roster: PresenceEntry[]
  locks: Record<string, Lock>
  /** cell → cor do changeset aberto que a toca (borda ghost). */
  ghostCells: Record<string, string>
  drift: Record<string, string> // nodeId → grade
  demotions: number
  toasts: { list: Toast[]; overflow: number }
  events: FeedItem[]
  settings: Settings
  /** cell pedida por clique em toast/feed — App centra a câmera e zera. */
  centerCell: string | null

  // UI-2: turno ativo (verdade dos deltas fica no server; aqui só a projeção)
  activeCs: ActiveCs | null
  /** Deltas do turno ativo, re-hidratados de graph://changeset/{id} (risco 1). */
  draftDeltas: DraftDelta[]
  /** Deltas ghost por cell (dialeto de exibição) — sub-cards tracejados. */
  ghostDeltasByCell: Record<string, DraftDelta[]>
  myTurns: MyTurn[]
  denied: Denied | null
  /** Modo ref-por-clique: clique em nó/ghost appenda id em refDraft. */
  refPicking: boolean
  refDraft: string[]

  // UI-3 (F002): leitura/query
  selectedCell: string | null
  claimsByCell: Record<string, ClaimRecord[]>
  claimsLoading: boolean
  claimsError: string | null
  claimsCellError: string | null
  claimsSnapshotError: string | null
  claimsCursor: number
  claimsHasMore: boolean
  claimsLoadingMore: boolean
  claimsGeneration: number
  claimCellPages: Record<string, { cursor: number; hasMore: boolean; loading: boolean; initialized: boolean }>
  selectedClaimId: string | null
  queryOpen: boolean
  queryResults: QueryResults | null
  queryLoading: boolean
  queryError: string | null
  reverseIndex: Map<string, string[]> | null
  historyEvents: HistoryEvent[]
  historyFilters: HistoryFilters
  historyLoading: boolean
  historyError: string | null
  historyCursor: number
  historyHasMore: boolean
  historyLoadingMore: boolean
  sidebarFilter: QuickFilter
  route: string

  setGraph: (g: Graph | null) => void
  setConn: (c: ConnState) => void
  setIdentity: (name: string, userId: string) => void
  select: (id: string | null) => void
  setSettings: (s: Settings) => void
  requestCenter: (cell: string | null) => void
  setRefPicking: (on: boolean) => void
  pickRef: (id: string) => void
  clearRefDraft: () => void

  setSelectedCell: (cell: string | null) => void
  setClaimsForCell: (cell: string, claims: ClaimRecord[]) => void
  setClaimsLoading: (b: boolean) => void
  setClaimsError: (e: string | null) => void
  openClaim: (id: string | null) => void
  openQuery: (b: boolean) => void
  setQueryResults: (r: QueryResults | null) => void
  setQueryLoading: (b: boolean) => void
  setQueryError: (e: string | null) => void
  setReverseIndex: (m: Map<string, string[]> | null) => void
  setHistoryEvents: (e: HistoryEvent[]) => void
  setHistoryFilters: (f: HistoryFilters) => void
  setHistoryLoading: (b: boolean) => void
  setHistoryError: (e: string | null) => void
  setSidebarFilter: (f: QuickFilter) => void
  navigate: (route: string) => void

  /** UI-3: signal to open TurnModal (UI-2) with a cell prefilled — from OpenClaim footer. */
  openTurnRequest: string | null
  requestOpenTurn: (cell: string | null) => void
}

export const useUi = create<UiState>((set) => ({
  graph: null,
  conn: "off",
  name: "",
  userId: "",
  selectedId: null,
  seq: 0,

  roster: [],
  locks: {},
  ghostCells: {},
  drift: {},
  demotions: 0,
  toasts: { list: [], overflow: 0 },
  events: [],
  settings: loadSettings(),
  centerCell: null,

  activeCs: null,
  draftDeltas: [],
  ghostDeltasByCell: {},
  myTurns: [],
  denied: null,
  refPicking: false,
  refDraft: [],

  selectedCell: null,
  claimsByCell: {},
  claimsLoading: false,
  claimsError: null,
  claimsCellError: null,
  claimsSnapshotError: null,
  claimsCursor: 0,
  claimsHasMore: false,
  claimsLoadingMore: false,
  claimsGeneration: 0,
  claimCellPages: {},
  selectedClaimId: null,
  queryOpen: false,
  queryResults: null,
  queryLoading: false,
  queryError: null,
  reverseIndex: null,
  historyEvents: [],
  historyFilters: {},
  historyLoading: false,
  historyError: null,
  historyCursor: 0,
  historyHasMore: false,
  historyLoadingMore: false,
  sidebarFilter: "all",
  route: typeof window !== "undefined" ? (window.location.hash.replace(/^#/, "") || "/") : "/",

  setGraph: (graph) => set({ graph }),
  setConn: (conn) => set({ conn }),
  setIdentity: (name, userId) => set({ name, userId }),
  select: (selectedId) => set({ selectedId }),
  setSettings: (settings) => {
    sessionStorage.setItem("og.settings", JSON.stringify(settings))
    set({ settings })
  },
  requestCenter: (centerCell) => set({ centerCell }),
  setRefPicking: (refPicking) => set({ refPicking }),
  pickRef: (id) => set((s) => (s.refDraft.includes(id) ? s : { refDraft: [...s.refDraft, id] })),
  clearRefDraft: () => set({ refDraft: [], refPicking: false }),
  setSelectedCell: (selectedCell) => set({ selectedCell, selectedClaimId: null }),
  setClaimsForCell: (cell, claims) => set((s) => ({ claimsByCell: { ...s.claimsByCell, [cell]: claims } })),
  setClaimsLoading: (claimsLoading) => set({ claimsLoading }),
  setClaimsError: (claimsError) => set({ claimsError }),
  openClaim: (selectedClaimId) => set({ selectedClaimId }),
  openQuery: (queryOpen) => set({ queryOpen }),
  setQueryResults: (queryResults) => set({ queryResults }),
  setQueryLoading: (queryLoading) => set({ queryLoading }),
  setQueryError: (queryError) => set({ queryError }),
  setReverseIndex: (reverseIndex) => set({ reverseIndex }),
  setHistoryEvents: (historyEvents) => set({ historyEvents }),
  setHistoryFilters: (historyFilters) => set({ historyFilters }),
  setHistoryLoading: (historyLoading) => set({ historyLoading }),
  setHistoryError: (historyError) => set({ historyError }),
  setSidebarFilter: (sidebarFilter) => set({ sidebarFilter }),
  navigate: (route) => {
    if (typeof window !== "undefined") window.location.hash = route
    set({ route })
  },
  openTurnRequest: null,
  requestOpenTurn: (openTurnRequest) => set({ openTurnRequest }),
}))
