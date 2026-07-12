/**
 * graph-bootstrap.ts — publica um grafo em memória a partir do repo-alvo.
 *
 * Caminho (a): .graph/graph.json existe e valida (boot-gate) → carrega e publica (pipeline "existing").
 * Caminho (b): sem .graph/ → gera um ESQUELETO ESTRUTURAL determinístico (1 record por arquivo-fonte,
 *   âncora = 1ª linha não-vazia; SEM LLM, SEM claims, SEM autoridade β) e então (a). Marcado
 *   `pipeline: "skeleton"` no snapshot/stats — o cliente NUNCA confunde com um grafo governado real.
 *
 * NOTA DE REALIDADE (ADR §1, 2025): o pipeline brownfield REAL é uma sessão de agente LLM (Pass A/B/C);
 * não é spawnável/puro. A Fase 1 prova o PROTOCOLO, não reproduz o pipeline de conhecimento — daí o
 * esqueleto marcado como caminho fresh honesto e mínimo (sem tree-sitter, sem dep nova; ver README).
 *
 * Idempotente: graphId = sha256(repoPath + checksum-semântico-do-grafo). Rechamar sobre conteúdo
 * inalterado devolve o mesmo graphId e não re-emite evento; conteúdo mudado (drift/re-bootstrap) gera
 * novo graphId (spec §6).
 */
import { readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import type { Graph } from "@open-graph-mcp/graph-core/build"
import { buildGraph, writeGraph } from "@open-graph-mcp/graph-core/build"
import { bootReadiness, graphChecksum } from "@open-graph-mcp/graph-core/boot-gate"
import { appendShard, type MetaRecord } from "@open-graph-mcp/graph-core/meta"
import { DEFAULT_IGNORE } from "@open-graph-mcp/graph-core/scan"
import { publish, type Pipeline, type ServerState } from "../state"

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".md"])

function walkSource(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: import("node:fs").Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      if (DEFAULT_IGNORE.includes(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile() && SOURCE_EXT.has(path.extname(e.name))) out.push(path.relative(root, full))
    }
  }
  walk(root)
  return out.sort()
}

function firstAnchor(content: string): string | null {
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    if (line.trim()) return line
  }
  return null
}

/** Esqueleto estrutural determinístico: 1 MetaRecord por arquivo-fonte (id/file = relpath). */
function buildSkeleton(root: string): void {
  const byModule = new Map<string, MetaRecord[]>()
  for (const rel of walkSource(root)) {
    let content: string
    try {
      content = readFileSync(path.join(root, rel), "utf8")
    } catch {
      continue
    }
    const anchor = firstAnchor(content)
    if (!anchor) continue // arquivo vazio: nada verbatim p/ ancorar
    const module = rel.split(/[/\\]/)[0] || "root"
    const list = byModule.get(module) ?? []
    list.push({ id: rel, file: rel, kind: "File", responsibility: rel, exposed: false, deps: [], anchor })
    byModule.set(module, list)
  }
  for (const [module, records] of byModule) appendShard(root, module, records)
  writeGraph(root, buildGraph(root))
}

function loadGraphJson(root: string): Graph {
  return JSON.parse(readFileSync(path.join(root, ".graph", "graph.json"), "utf8")) as Graph
}

export type BootstrapResult = { graphId: string; stats: Graph["stats"] & { pipeline: Pipeline } }

export function bootstrap(state: ServerState, repoPath: string): BootstrapResult {
  const root = path.resolve(repoPath)
  let pipeline: Pipeline
  let verdict = bootReadiness(root).verdict
  if (verdict === "corrupt") throw new Error(`.graph/graph.json corrupt at ${root}`)
  if (verdict === "no-graph") {
    buildSkeleton(root)
    verdict = bootReadiness(root).verdict
    if (verdict !== "ready") throw new Error(`skeleton pipeline failed to produce a valid graph at ${root}`)
    pipeline = "skeleton"
  } else {
    pipeline = "existing"
  }

  const graph = loadGraphJson(root)
  const graphId = createHash("sha256").update(`${root}:${graphChecksum(graph)}`).digest("hex").slice(0, 16)
  const stats = { ...graph.stats, pipeline }

  if (state.graphId === graphId && state.graph) return { graphId, stats } // idempotente: nada mudou

  state.repoPath = root
  state.graph = graph
  state.graphId = graphId
  state.pipeline = pipeline
  state.bootstrappedAt = new Date().toISOString()
  publish(state, { kind: "graph.bootstrapped", target: null, payload: { stats, pipeline } })
  return { graphId, stats }
}

/** graph.rebuild: re-lê .graph/ do disco e re-emite snapshot p/ todos (spec §4.2). */
export function rebuild(state: ServerState): { ok: true; stats: Graph["stats"] & { pipeline: Pipeline } } {
  if (!state.repoPath) throw new Error("not bootstrapped")
  const graph = loadGraphJson(state.repoPath)
  const pipeline = state.pipeline ?? "existing"
  state.graph = graph
  state.graphId = createHash("sha256").update(`${state.repoPath}:${graphChecksum(graph)}`).digest("hex").slice(0, 16)
  const stats = { ...graph.stats, pipeline }
  publish(state, { kind: "graph.rebuilt", target: null, payload: { stats } })
  return { ok: true, stats }
}
