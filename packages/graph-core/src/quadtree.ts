/**
 * quadtree.ts — índice espacial para culling de viewport no explorer do grafo.
 * Sem isto, desenhar N nós custa O(N) por frame mesmo quando só uma fração está visível.
 * Com o quadtree, `queryRange` custa ~O(log N + k) onde k = pontos no viewport — o frame
 * cost vira O(visível), nunca O(grafo) (INV-H3-4).
 *
 * Travessia via pilha explícita (sem recursão), consistente com o resto do módulo graph/
 * (ver roundtrip.ts) — profundidade alta ou fixtures densas não estouram a call stack.
 */

export type QuadPoint = { id: string; x: number; y: number }
export type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

const DEFAULT_CAPACITY = 8
const MAX_DEPTH = 24

function boundsContains(b: Bounds, x: number, y: number): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY
}

function boundsIntersects(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

function quadrantBounds(b: Bounds, quadrant: 0 | 1 | 2 | 3): Bounds {
  const midX = (b.minX + b.maxX) / 2
  const midY = (b.minY + b.maxY) / 2
  switch (quadrant) {
    case 0: // NW
      return { minX: b.minX, maxX: midX, minY: b.minY, maxY: midY }
    case 1: // NE
      return { minX: midX, maxX: b.maxX, minY: b.minY, maxY: midY }
    case 2: // SW
      return { minX: b.minX, maxX: midX, minY: midY, maxY: b.maxY }
    case 3: // SE
      return { minX: midX, maxX: b.maxX, minY: midY, maxY: b.maxY }
  }
}

type QuadNode = {
  bounds: Bounds
  depth: number
  points: QuadPoint[]
  children: [QuadNode, QuadNode, QuadNode, QuadNode] | null
}

function makeNode(bounds: Bounds, depth: number): QuadNode {
  return { bounds, depth, points: [], children: null }
}

/**
 * Índice espacial pontual (quadtree). `insert` é O(log N) amortizado; `queryRange` retorna
 * somente os ids cujos pontos caem dentro de `bounds` (culling real, não um filtro linear
 * disfarçado) — travessia com pilha explícita, nunca recursão.
 */
export class Quadtree {
  private root: QuadNode
  private readonly capacity: number

  constructor(bounds: Bounds, capacity: number = DEFAULT_CAPACITY) {
    this.root = makeNode(bounds, 0)
    this.capacity = capacity
  }

  /** Constrói um quadtree a partir de uma lista de pontos, inferindo os bounds se omitidos. */
  static fromPoints(points: readonly QuadPoint[], bounds?: Bounds, capacity?: number): Quadtree {
    const b = bounds ?? computeBounds(points)
    const qt = new Quadtree(b, capacity)
    for (const p of points) qt.insert(p)
    return qt
  }

  insert(point: QuadPoint): boolean {
    if (!boundsContains(this.root.bounds, point.x, point.y)) return false

    // Pilha explícita: desce até achar a folha correta para inserir (ou subdividir).
    let node = this.root
    for (;;) {
      if (node.children) {
        const idx = quadrantIndex(node.bounds, point.x, point.y)
        node = node.children[idx]
        continue
      }
      node.points.push(point)
      if (node.points.length > this.capacity && node.depth < MAX_DEPTH) {
        this.subdivide(node)
      }
      return true
    }
  }

  private subdivide(node: QuadNode): void {
    const children: QuadNode[] = []
    for (let q = 0 as 0 | 1 | 2 | 3; q < 4; q++) {
      children.push(makeNode(quadrantBounds(node.bounds, q as 0 | 1 | 2 | 3), node.depth + 1))
    }
    node.children = children as [QuadNode, QuadNode, QuadNode, QuadNode]
    const existing = node.points
    node.points = []
    for (const p of existing) {
      const idx = quadrantIndex(node.bounds, p.x, p.y)
      node.children[idx].points.push(p)
    }
  }

  /** Retorna os ids dos pontos dentro de `range`, ordenados (saída determinística). */
  queryRange(range: Bounds): string[] {
    const results: string[] = []
    const stack: QuadNode[] = [this.root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (!boundsIntersects(node.bounds, range)) continue
      if (node.children) {
        for (const child of node.children) stack.push(child)
        continue
      }
      for (const p of node.points) {
        if (boundsContains(range, p.x, p.y)) results.push(p.id)
      }
    }
    results.sort()
    return results
  }
}

function quadrantIndex(b: Bounds, x: number, y: number): 0 | 1 | 2 | 3 {
  const midX = (b.minX + b.maxX) / 2
  const midY = (b.minY + b.maxY) / 2
  const east = x >= midX
  const south = y >= midY
  if (!east && !south) return 0
  if (east && !south) return 1
  if (!east && south) return 2
  return 3
}

function computeBounds(points: readonly QuadPoint[]): Bounds {
  if (points.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  // padding pra evitar bounds degenerados (todos os pontos na mesma linha/coluna).
  if (minX === maxX) {
    minX -= 1
    maxX += 1
  }
  if (minY === maxY) {
    minY -= 1
    maxY += 1
  }
  return { minX, maxX, minY, maxY }
}
