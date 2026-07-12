/**
 * imports-manifest.ts — fecha o blindspot 1.2: uma célula β (A) pode projetar código que
 * importa um símbolo estrangeiro (B.f) de outra célula (B). As arestas `depends-on`
 * cross-tower já existem (build.ts) e cell-dag.ts já as eleva a granularidade de célula,
 * mas nada registrava a IDENTIDADE do símbolo estrangeiro — então um humano editando B.f
 * (legal, B é α) não deixava rastro nenhum na célula A, mesmo que A agora projete código
 * que não compila ou computa errado.
 *
 * `computeImportsManifest` grava, por célula, o hash de identidade de cada símbolo
 * estrangeiro do qual ela depende (cross-cell `depends-on` resolvida). `verifyImportsManifest`
 * recomputa esses hashes contra o estado atual e nomeia quem driftou. Ambas são funções puras
 * de (graph, source bytes via readFile) — sem estado oculto, ordenação estável (sort por
 * cellKey / symbolId) pra determinismo.
 *
 * Identidade do símbolo (INV compat): se o nó carrega symbolPath+tokenHash (1.1, ainda não
 * fez backfill em todo MetaRecord legado), usa resolveAnchor (gate estrutural, tree-sitter) e
 * pega o tokenHash CORRENTE da árvore. Senão (legado), usa sha256 da linha-âncora verbatim —
 * "presente e idêntica" vs. "sumiu/mudou" (via excerptCheck), o que ainda detecta a mudança
 * sem exigir os campos estruturais.
 */
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import type { Graph, GraphNode } from "./build"
import { buildCellDag, cellKey } from "./cell-dag"
import { excerptCheck, resolveAnchor } from "./extract"

export type ImportsManifest = { cell: string; deps: { symbolId: string; hash: string }[] }[]

export type ImportsDrift = { cell: string; driftedSymbols: string[] }

export type ReadFile = (f: string) => string | undefined

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

/** Nó estendido (opcional) com os campos estruturais de 1.1 — GraphNode ainda não os declara. */
type StructNode = GraphNode & { symbolPath?: string; tokenHash?: string }

/**
 * Hash de identidade CORRENTE de um símbolo (nó do graph), lido do source via readFile.
 * Pura função de (node, conteúdo atual do arquivo). Usada tanto na gravação quanto na
 * verificação — a comparação entre os dois momentos é o que detecta drift.
 */
async function currentIdentityHash(node: GraphNode | undefined, symbolId: string, readFile: ReadFile): Promise<string> {
  if (!node) return sha256(`NODE_MISSING:${symbolId}`)
  const content = readFile(node.file)
  if (content === undefined) return sha256(`FILE_MISSING:${node.file}`)

  const n = node as StructNode
  if (n.symbolPath && n.tokenHash) {
    const resolved = await resolveAnchor(content, node.file, n.symbolPath, n.tokenHash)
    return resolved.tokenHash ?? sha256(`SYMBOL_GONE:${n.symbolPath}`)
  }

  // legado: sem symbolPath/tokenHash — identidade = presença verbatim da âncora salva.
  return excerptCheck(content, node.anchor) ? sha256(node.anchor) : sha256(`ANCHOR_MISSING:${symbolId}`)
}

/** Mapa nodeId → cellKey (domain::Level), mesma convenção de cell-dag.ts. */
function nodeCellMap(graph: Graph): Map<string, string> {
  const out = new Map<string, string>()
  for (const n of graph.nodes) out.set(n.id, cellKey(n.domain ?? "(unassigned)", n.level))
  return out
}

/**
 * Constrói o manifesto: para cada célula presente no grafo, a lista (ordenada por symbolId)
 * dos símbolos estrangeiros dos quais ela depende (aresta `depends-on` resolvida cruzando
 * célula) e o hash de identidade corrente de cada um. Célula sem deps estrangeiras = lista vazia.
 */
export async function computeImportsManifest(graph: Graph, readFile: ReadFile): Promise<ImportsManifest> {
  const dag = buildCellDag(graph)
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const nodeCell = nodeCellMap(graph)

  const depsByCell = new Map<string, Set<string>>()
  for (const id of dag.cellIds) depsByCell.set(id, new Set())

  for (const e of graph.edges) {
    if (e.type !== "depends-on" || !e.resolved) continue
    if (!nodeById.has(e.from) || !nodeById.has(e.to)) continue
    const fromCell = nodeCell.get(e.from)
    const toCell = nodeCell.get(e.to)
    if (!fromCell || !toCell || fromCell === toCell) continue
    depsByCell.get(fromCell)?.add(e.to)
  }

  const manifest: ImportsManifest = []
  for (const cellId of dag.cellIds) {
    const symbolIds = [...(depsByCell.get(cellId) ?? [])].sort()
    const deps: { symbolId: string; hash: string }[] = []
    for (const symbolId of symbolIds) {
      const hash = await currentIdentityHash(nodeById.get(symbolId), symbolId, readFile)
      deps.push({ symbolId, hash })
    }
    manifest.push({ cell: cellId, deps })
  }
  return manifest
}

/**
 * Recomputa cada hash registrado contra o estado atual; qualquer divergência = a célula
 * importadora tem drift estrangeiro, nomeando os símbolos driftados. Vazio = tudo verifica.
 * Ordenado (por cellKey / symbolId) pra determinismo.
 */
export async function verifyImportsManifest(manifest: ImportsManifest, graph: Graph, readFile: ReadFile): Promise<ImportsDrift[]> {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const out: ImportsDrift[] = []
  for (const entry of manifest) {
    const drifted: string[] = []
    for (const dep of entry.deps) {
      const current = await currentIdentityHash(nodeById.get(dep.symbolId), dep.symbolId, readFile)
      if (current !== dep.hash) drifted.push(dep.symbolId)
    }
    if (drifted.length) out.push({ cell: entry.cell, driftedSymbols: drifted.sort() })
  }
  return out.sort((a, b) => (a.cell < b.cell ? -1 : a.cell > b.cell ? 1 : 0))
}

// ── persistência (.graph/imports.json) — espelha o discipline de watch.ts/build.ts ────────

function importsManifestPath(root: string): string {
  return path.join(root, ".graph", "imports.json")
}

/** Carrega o manifesto persistido; null se o arquivo não existe ou está malformado. */
export function readImportsManifest(root: string): ImportsManifest | null {
  const file = importsManifestPath(root)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"))
    if (!Array.isArray(parsed)) return null
    return parsed as ImportsManifest
  } catch {
    return null
  }
}

/** Grava o manifesto (determinístico — a ordem já vem estável de computeImportsManifest). */
export function writeImportsManifest(root: string, manifest: ImportsManifest): string {
  const file = importsManifestPath(root)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(manifest, null, 2))
  return file
}
