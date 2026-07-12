/**
 * context-compiler.ts — compila uma seleção de nós (lasso no canvas) num payload de
 * prompt determinístico e orçado em tokens, pra um LLM de borda. Pura: (Graph,
 * selectionIds, opts) → CompiledContext idêntico byte-a-byte, sempre (INV-H3-3).
 * Sem Date, sem random, sem fs. Toda ordem de emissão vem de sort() explícito —
 * nunca de iteração de Map/Set (que não é uma ordem garantida entre runs/nós JS).
 *
 * Subgrafo induzido: nós selecionados + arestas `depends-on` resolvidas entre eles
 * + fronteira de um salto (vizinhos diretos, não selecionados, conhecidos no grafo)
 * viram BOUNDARY STUBS — id + responsibility, nunca anchor/corpo. A fronteira é
 * explícita: uma dep não-resolvida (alvo fora do grafo) não vira stub, porque não
 * temos responsibility pra reportar — fingir um stub vazio seria fuzzy, não exato.
 *
 * Orçamento: estimativa determinística e documentada — ceil(chars/4), não é uma
 * contagem real de tokens do tokenizer do modelo alvo, é um teto de segurança
 * grosseiro e estável. Trim, em ordem fixa: (1) boundary stubs primeiro, do maior id
 * pro menor; (2) anchors de nós α (authority "source"), mesma ordem reversa; nunca
 * a responsibility de um nó selecionado. O header sempre reporta a contagem real do
 * que foi cortado, nas duas categorias.
 */
import { createHash } from "node:crypto"
import type { Graph, GraphNode } from "./build"
import { cellKey } from "./cell-dag"

export type CompileContextOpts = {
  /** Teto duro de tokens (estimativa: ceil(chars/4)). */
  budget: number
}

export type CompiledContext = {
  payload: string
  hash: string
  trimmed: { boundaryStubs: number; alphaAnchors: number }
  nodeCount: number
}

type SelectedEntry = {
  id: string
  domain: string
  level: string
  authority: "source" | "graph" | "suspended"
  responsibility: string
  anchor: string
  includeAnchor: boolean
}

type BoundaryEntry = {
  id: string
  responsibility: string
  included: boolean
}

type InducedEdge = { from: string; to: string; type: string }

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4)
}

function domainKey(n: GraphNode): string {
  return n.domain ?? "(unassigned)"
}

function render(
  budget: number,
  selected: readonly SelectedEntry[],
  edges: readonly InducedEdge[],
  boundary: readonly BoundaryEntry[],
  trimmed: { boundaryStubs: number; alphaAnchors: number },
): string {
  const includedBoundary = boundary.filter((b) => b.included)
  const lines: string[] = []
  lines.push("# compiled-context v1")
  lines.push(
    `budget=${budget} nodeCount=${selected.length} boundaryCount=${includedBoundary.length} ` +
      `trimmed.boundaryStubs=${trimmed.boundaryStubs} trimmed.alphaAnchors=${trimmed.alphaAnchors}`,
  )
  lines.push("## selected")
  for (const s of selected) {
    lines.push(`- id=${s.id} domain=${s.domain} level=${s.level} authority=${s.authority}`)
    lines.push(`  responsibility: ${s.responsibility}`)
    if (s.includeAnchor) lines.push(`  anchor: ${s.anchor}`)
  }
  lines.push("## edges")
  for (const e of edges) lines.push(`- ${e.from} -> ${e.to} (${e.type})`)
  lines.push("## boundary")
  for (const b of includedBoundary) {
    lines.push(`- id=${b.id}`)
    lines.push(`  responsibility: ${b.responsibility}`)
  }
  return lines.join("\n")
}

/** Compila a seleção num payload determinístico, orçado, hasheado (sha256). */
export function compileContext(graph: Graph, selectionIds: readonly string[], opts: CompileContextOpts): CompiledContext {
  const budget = opts.budget

  // nodesById: independente da ordem de graph.nodes na entrada.
  const nodesById = new Map<string, GraphNode>()
  for (const n of graph.nodes) nodesById.set(n.id, n)

  // dedupe + só ids que existem no grafo; independente da ordem de selectionIds.
  const selectedIds = [...new Set(selectionIds)].filter((id) => nodesById.has(id)).sort()
  const selectedSet = new Set(selectedIds)

  // arestas depends-on resolvidas entre selecionados (interconnecting) e pra fronteira.
  const interEdgeKeys = new Set<string>()
  const interEdges: InducedEdge[] = []
  const boundaryIds = new Set<string>()

  for (const e of graph.edges) {
    if (e.type !== "depends-on" || !e.resolved) continue
    const fromSel = selectedSet.has(e.from)
    const toSel = selectedSet.has(e.to)
    if (fromSel && toSel) {
      const key = `${e.from}|${e.to}`
      if (!interEdgeKeys.has(key)) {
        interEdgeKeys.add(key)
        interEdges.push({ from: e.from, to: e.to, type: e.type })
      }
    } else if (fromSel && !toSel && nodesById.has(e.to)) {
      boundaryIds.add(e.to)
    } else if (toSel && !fromSel && nodesById.has(e.from)) {
      boundaryIds.add(e.from)
    }
  }

  interEdges.sort((a, b) => {
    const ka = `${a.from}|${a.to}`
    const kb = `${b.from}|${b.to}`
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })

  const selected: SelectedEntry[] = selectedIds.map((id) => {
    const n = nodesById.get(id)!
    const authority = graph.authority?.[cellKey(domainKey(n), n.level)] ?? "source"
    return {
      id: n.id,
      domain: domainKey(n),
      level: n.level,
      authority,
      responsibility: n.responsibility,
      anchor: n.anchor,
      includeAnchor: true,
    }
  })
  selected.sort((a, b) => {
    if (a.domain !== b.domain) return a.domain < b.domain ? -1 : 1
    if (a.level !== b.level) return a.level < b.level ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const boundary: BoundaryEntry[] = [...boundaryIds]
    .sort()
    .map((id) => ({ id, responsibility: nodesById.get(id)!.responsibility, included: true }))

  const trimmed = { boundaryStubs: 0, alphaAnchors: 0 }

  // trim, ordem fixa: boundary stubs (do maior id pro menor) primeiro, depois anchors
  // de nós α/source (mesma ordem reversa). Responsibility de selecionado NUNCA cai.
  for (;;) {
    const payload = render(budget, selected, interEdges, boundary, trimmed)
    if (estimateTokens(payload) <= budget) break

    const nextBoundary = [...boundary].reverse().find((b) => b.included)
    if (nextBoundary) {
      nextBoundary.included = false
      trimmed.boundaryStubs++
      continue
    }

    const nextAnchor = [...selected].reverse().find((s) => s.includeAnchor && s.authority === "source")
    if (nextAnchor) {
      nextAnchor.includeAnchor = false
      trimmed.alphaAnchors++
      continue
    }

    break // nada mais cortável sem tocar responsibility — respeita o teto duro na medida do possível
  }

  const payload = render(budget, selected, interEdges, boundary, trimmed)
  const hash = createHash("sha256").update(payload).digest("hex")

  return { payload, hash, trimmed, nodeCount: selected.length }
}
