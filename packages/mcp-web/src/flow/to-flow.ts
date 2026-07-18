/**
 * Projeção Graph → React Flow (WD4): posições derivadas do esquema de bandas
 * do graph-core (domínio = banda vertical, nível = banda horizontal — mesma
 * semântica de xForNode/yForLevel), com UMA adaptação: dentro de cada cell os
 * cards entram em grade determinística (ids ordenados) em vez do hash de
 * seedLayout — hash espalha PONTOS, mas cards têm área e sobrepunham (risco 2
 * do 00-scope, pago aqui, graph-core intocado). Alturas de banda crescem com a
 * maior cell pra grade nunca invadir o nível vizinho; tudo puro e determinístico.
 */
import type { Graph, GraphNode } from "@open-graph-mcp/graph-core/build"
import type { Edge, Node } from "@xyflow/react"

export const CARD_W = 190
export const CARD_H = 96
const GAP = 18
const COLS = 4
const CELL_PAD = 24
const BAND_GAP = 80

export type CardData = { node: GraphNode; cell: string }

export function toFlow(graph: Graph): { nodes: Node<CardData>[]; edges: Edge[] } {
  const domains = [...new Set(graph.nodes.map((n) => n.domain).filter((d): d is string => d !== null))].sort()
  // mesma regra de banda de xForNode (layout.ts): domínio conhecido = índice alfabético; null/desconhecido = última banda
  const domainIdx = (d: string | null) => {
    if (d === null) return domains.length
    const i = domains.indexOf(d)
    return i >= 0 ? i : domains.length
  }
  const cellOf = (n: GraphNode) => `${n.domain ?? "(unassigned)"}:${n.level}`

  // agrupa por cell; ordena ids pra grade ser estável entre snapshots
  const byCell = new Map<string, GraphNode[]>()
  for (const n of graph.nodes) {
    const key = cellOf(n)
    if (!byCell.has(key)) byCell.set(key, [])
    byCell.get(key)!.push(n)
  }
  for (const list of byCell.values()) list.sort((a, b) => a.id.localeCompare(b.id))

  // altura por banda de nível = maior nº de linhas entre as cells daquele nível
  const levels = ["P1", "P2", "P3", "P4", "P5"]
  const rowsOfCell = (count: number) => Math.ceil(count / COLS)
  const bandRows = new Map<string, number>()
  for (const [key, list] of byCell) {
    const level = key.split(":")[1] ?? "P5"
    bandRows.set(level, Math.max(bandRows.get(level) ?? 1, rowsOfCell(list.length)))
  }
  const bandY = new Map<string, number>()
  let y = 0
  for (const level of levels) {
    bandY.set(level, y)
    y += (bandRows.get(level) ?? 1) * (CARD_H + GAP) + CELL_PAD * 2 + BAND_GAP
  }
  const bandW = COLS * (CARD_W + GAP) + CELL_PAD * 2 + BAND_GAP

  const nodes: Node<CardData>[] = []
  for (const [key, list] of byCell) {
    const level = key.split(":")[1] ?? "P5"
    const x0 = domainIdx(list[0]!.domain) * bandW + CELL_PAD
    const y0 = (bandY.get(level) ?? y) + CELL_PAD
    list.forEach((n, i) => {
      nodes.push({
        id: n.id,
        type: "card",
        position: { x: x0 + (i % COLS) * (CARD_W + GAP), y: y0 + Math.floor(i / COLS) * (CARD_H + GAP) },
        data: { node: n, cell: key },
      })
    })
  }

  const known = new Set(graph.nodes.map((n) => n.id))
  const edges: Edge[] = graph.edges
    .filter((e) => known.has(e.from) && known.has(e.to))
    .map((e) => ({
      id: `${e.type}:${e.from}→${e.to}`,
      source: e.from,
      target: e.to,
      type: "default",
      style: { stroke: e.type === "survey" ? "#26262e" : "#3f3f4b" },
    }))

  return { nodes, edges }
}
