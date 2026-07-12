/**
 * cell-dag.ts — DAG de células pra ordenar a cascata de regeneração (INV-H2-2).
 * Célula = (domain, level) presente no grafo. Duas famílias de aresta:
 *   (a) ownership — dentro de uma torre (mesmo domain), nível ℓ → ℓ+1 (P1..P5).
 *   (b) depends-on — cross-tower, arestas `depends-on` de símbolo (build.ts) elevadas
 *       pra granularidade de célula (dedup).
 * `condense` faz a SCC (Tarjan iterativo, pilha explícita — sem recursão profunda) e
 * devolve a ordem topológica ÚNICA do DAG condensado (tie-break por cellKey ordenado).
 * Ciclos de import mútuo entre células viram UMA SCC, regenerada como unidade.
 *
 * Puro: função de (Graph). Sem fs, sem Map/Set na saída — só arrays ordenados.
 */
import type { Graph } from "./build"
import type { Level } from "./classify"

export type Cell = { domain: string; level: Level }
export type CellEdgeKind = "ownership" | "depends-on"
export type CellEdge = { from: string; to: string; kind: CellEdgeKind }

export type CellDag = {
  cellIds: string[] // ordenado
  cells: Record<string, Cell>
  edges: CellEdge[] // ordenado (from, to, kind)
}

export type Scc = { id: string; cellIds: string[] } // id = menor cellKey do grupo (ordenado)
export type Condensed = {
  sccs: Scc[] // ordenado por id
  order: string[] // ordem topológica ÚNICA das sccs (ids), ponta de regeneração primeiro
}

const LEVEL_ORDER: Level[] = ["P1", "P2", "P3", "P4", "P5"]

export function cellKey(domain: string, level: Level): string {
  return `${domain}::${level}`
}

/** Constrói o DAG de células a partir de um Graph já montado (build.ts). */
export function buildCellDag(graph: Graph): CellDag {
  const cells = new Map<string, Cell>()
  const nodeCell = new Map<string, string>()

  for (const n of graph.nodes) {
    const domain = n.domain ?? "(unassigned)"
    const id = cellKey(domain, n.level)
    if (!cells.has(id)) cells.set(id, { domain, level: n.level })
    nodeCell.set(n.id, id)
  }

  const edgeKeys = new Set<string>()
  const edges: CellEdge[] = []
  function addEdge(from: string, to: string, kind: CellEdgeKind) {
    if (from === to) return
    const key = `${from}|${to}|${kind}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ from, to, kind })
  }

  // (a) ownership: mesma domain, nível ℓ → ℓ+1, ambas as células presentes
  const domainsPresent = new Set([...cells.values()].map((c) => c.domain))
  for (const domain of domainsPresent) {
    for (let i = 0; i < LEVEL_ORDER.length - 1; i++) {
      const a = cellKey(domain, LEVEL_ORDER[i])
      const b = cellKey(domain, LEVEL_ORDER[i + 1])
      if (cells.has(a) && cells.has(b)) addEdge(a, b, "ownership")
    }
  }

  // (b) depends-on cross-tower elevado pra célula (só arestas resolvidas, entre nós conhecidos)
  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  for (const e of graph.edges) {
    if (e.type !== "depends-on" || !e.resolved) continue
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) continue
    const fromCell = nodeCell.get(e.from)
    const toCell = nodeCell.get(e.to)
    if (!fromCell || !toCell) continue
    addEdge(fromCell, toCell, "depends-on")
  }

  edges.sort((x, y) => {
    const kx = `${x.from}|${x.to}|${x.kind}`
    const ky = `${y.from}|${y.to}|${y.kind}`
    return kx < ky ? -1 : kx > ky ? 1 : 0
  })

  return {
    cellIds: [...cells.keys()].sort(),
    cells: Object.fromEntries(cells),
    edges,
  }
}

/**
 * SCC (Tarjan, pilha explícita) + condensação + ordem topológica determinística
 * (Kahn com tie-break: sempre escolhe a menor scc id disponível). O resultado é a
 * ÚNICA ordem topológica válida dado o tie-break — não depende de iteração de Map/Set.
 */
export function condense(dag: CellDag): Condensed {
  const adj = new Map<string, string[]>()
  for (const id of dag.cellIds) adj.set(id, [])
  for (const e of dag.edges) adj.get(e.from)?.push(e.to)
  for (const list of adj.values()) list.sort()

  const indexOf = new Map<string, number>()
  const lowlink = new Map<string, number>()
  const onStack = new Set<string>()
  const tarjanStack: string[] = []
  let nextIndex = 0
  const rawSccs: string[][] = []

  const roots = [...dag.cellIds].sort()
  for (const start of roots) {
    if (indexOf.has(start)) continue

    type Frame = { node: string; i: number }
    const work: Frame[] = [{ node: start, i: 0 }]
    indexOf.set(start, nextIndex)
    lowlink.set(start, nextIndex)
    nextIndex++
    tarjanStack.push(start)
    onStack.add(start)

    while (work.length) {
      const frame = work[work.length - 1]
      const neighbors = adj.get(frame.node) ?? []
      if (frame.i < neighbors.length) {
        const w = neighbors[frame.i]
        frame.i++
        if (!indexOf.has(w)) {
          indexOf.set(w, nextIndex)
          lowlink.set(w, nextIndex)
          nextIndex++
          tarjanStack.push(w)
          onStack.add(w)
          work.push({ node: w, i: 0 })
        } else if (onStack.has(w)) {
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node)!, indexOf.get(w)!))
        }
      } else {
        work.pop()
        const parent = work[work.length - 1]
        if (parent) {
          lowlink.set(parent.node, Math.min(lowlink.get(parent.node)!, lowlink.get(frame.node)!))
        }
        if (lowlink.get(frame.node) === indexOf.get(frame.node)) {
          const component: string[] = []
          let w: string
          do {
            w = tarjanStack.pop()!
            onStack.delete(w)
            component.push(w)
          } while (w !== frame.node)
          rawSccs.push(component.sort())
        }
      }
    }
  }

  const sccs: Scc[] = rawSccs
    .map((cellIds) => ({ id: cellIds[0], cellIds }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const cellToScc = new Map<string, string>()
  for (const scc of sccs) for (const c of scc.cellIds) cellToScc.set(c, scc.id)

  const condensedAdj = new Map<string, Set<string>>()
  for (const scc of sccs) condensedAdj.set(scc.id, new Set())
  for (const e of dag.edges) {
    const from = cellToScc.get(e.from)!
    const to = cellToScc.get(e.to)!
    if (from === to) continue
    condensedAdj.get(from)!.add(to)
  }

  const inDegree = new Map<string, number>()
  for (const scc of sccs) inDegree.set(scc.id, 0)
  for (const [, tos] of condensedAdj) {
    for (const to of tos) inDegree.set(to, (inDegree.get(to) ?? 0) + 1)
  }

  const remaining = new Set(sccs.map((s) => s.id))
  let ready = sccs.filter((s) => inDegree.get(s.id) === 0).map((s) => s.id)
  const order: string[] = []

  while (ready.length) {
    ready.sort()
    const next = ready.shift()!
    order.push(next)
    remaining.delete(next)
    for (const to of condensedAdj.get(next) ?? []) {
      const d = inDegree.get(to)! - 1
      inDegree.set(to, d)
      if (d === 0 && remaining.has(to)) ready.push(to)
    }
  }

  return { sccs, order }
}
