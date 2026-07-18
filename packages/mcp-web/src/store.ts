/**
 * Estado de UI (WD4): só o que é apresentação — grafo projetado, conexão,
 * identidade, seleção. A verdade do grafo vem do server (snapshot + eventos);
 * nenhuma mutação acontece aqui. Slices no padrão Dify (referencias-dify.md §A1),
 * enxutos por fase — UI-1 adiciona presença/eventos, UI-2 draft.
 */
import type { Graph } from "@open-graph-mcp/graph-core/build"
import { create } from "zustand"

type ConnState = "on" | "off"

type UiState = {
  graph: Graph | null
  conn: ConnState
  /** Nome exibido (registrado); vazio = anônimo (só leitura do snapshot). */
  name: string
  userId: string
  selectedId: string | null

  setGraph: (g: Graph | null) => void
  setConn: (c: ConnState) => void
  setIdentity: (name: string, userId: string) => void
  select: (id: string | null) => void
}

export const useUi = create<UiState>((set) => ({
  graph: null,
  conn: "off",
  name: "",
  userId: "",
  selectedId: null,

  setGraph: (graph) => set({ graph }),
  setConn: (conn) => set({ conn }),
  setIdentity: (name, userId) => set({ name, userId }),
  select: (selectedId) => set({ selectedId }),
}))
