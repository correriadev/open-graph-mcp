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

  setGraph: (g: Graph | null) => void
  setConn: (c: ConnState) => void
  setIdentity: (name: string, userId: string) => void
  select: (id: string | null) => void
  setSettings: (s: Settings) => void
  requestCenter: (cell: string | null) => void
  setRefPicking: (on: boolean) => void
  pickRef: (id: string) => void
  clearRefDraft: () => void
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
}))
