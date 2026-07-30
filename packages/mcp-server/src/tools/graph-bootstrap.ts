/**
 * graph-bootstrap.ts — publica um grafo em memória a partir do repo-alvo.
 *
 * Caminho (a): .graph/graph.json existe e valida (boot-gate) → carrega e publica (pipeline "existing").
 * Caminho (b): sem .graph/ → gera um ESQUELETO ESTRUTURAL determinístico (1 record por arquivo-fonte,
 *   âncora = 1ª linha não-vazia, deps = imports relativos resolvidos; SEM LLM, SEM claims, SEM
 *   autoridade β) e então (a). Marcado `pipeline: "skeleton"` no snapshot/stats — o cliente NUNCA
 *   confunde com um grafo governado real.
 *
 * NOTA DE REALIDADE (ADR §1, 2025): o pipeline brownfield REAL — claims com subject e vereditos —
 * é uma sessão de agente LLM (Pass A/B/C); não é spawnável/puro. O que É determinístico e roda aqui
 * é a ESTRUTURA: arquivos, âncoras e arestas de dependência (extract.ts, sem LLM). A Fase 1 prova o
 * PROTOCOLO e entrega um grafo navegável; o que ela NÃO reproduz é a camada de conhecimento
 * (claims/verdicts/domínios inferidos), que continua sendo trabalho de agente.
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
import { extractImports } from "@open-graph-mcp/graph-core/extract"
import { publish, tenantGraph, DEFAULT_TENANT, type Pipeline, type ServerState } from "../state"

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
      else if (e.isFile() && SOURCE_EXT.has(path.extname(e.name)))
        // normaliza p/ separador POSIX: id de nó é gravado em disco (.graph/meta, graph.json) e
        // precisa ser idêntico entre SOs — path.relative() usa `\` no Windows, o que quebra
        // matchesPattern() em domains.ts e faz o grafo gerado no Windows ilegível p/ cliente Linux.
        out.push(path.relative(root, full).split(path.sep).join("/"))
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

/** Extensões tentadas ao resolver um spec relativo sem extensão (ordem = precedência). */
const RESOLVE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]

/**
 * Resolve um spec de import RELATIVO p/ o id (relpath POSIX) de um nó conhecido. Só relativos:
 * `react`/`@scope/x` são deps externas, não viram aresta interna (build.ts já marca
 * `resolved: false` p/ ref desconhecida, mas emitir uma aresta por import de node_modules só
 * polui o grafo). Devolve null quando nada casa — o caller descarta.
 */
function resolveRelative(fromRel: string, spec: string, known: ReadonlySet<string>): string | null {
  if (!spec.startsWith(".")) return null
  const dir = path.posix.dirname(fromRel)
  const base = path.posix.normalize(path.posix.join(dir, spec))
  if (known.has(base)) return base
  for (const ext of RESOLVE_EXT) if (known.has(base + ext)) return base + ext
  for (const ext of RESOLVE_EXT) if (known.has(`${base}/index${ext}`)) return `${base}/index${ext}`
  return null
}

/**
 * Esqueleto estrutural determinístico: 1 MetaRecord por arquivo-fonte (id/file = relpath).
 *
 * `deps` sai do piso determinístico de `extract.ts` (`extractImports`, regex single-line, sem LLM
 * e sem tree-sitter): cada import relativo resolvido p/ um arquivo conhecido vira uma aresta
 * `depends-on` em build.ts. Antes disto `deps` era `[]` fixo e TODO grafo saía com `edges: 0` —
 * sem aresta não há DAG de células, e sem DAG a cascata de regeneração e a autoridade β não têm
 * sobre o que operar.
 *
 * ponytail: herda os gaps documentados de `extractImports` — import MULTILINHA e re-export
 * (`export { x } from "./y"`) não são capturados. Medido no harness-kit: 592 imports em 131
 * arquivos, dos quais 400 relativos; barrels de re-export saem com deps vazias. O upgrade é
 * `extractImportsAst` (cobre multilinha), que é async e exigiria propagar async por
 * buildSkeleton/bootstrap/callTool — troca deixada p/ quando alguém precisar dos multilinha.
 */
function buildSkeleton(root: string): void {
  const files = walkSource(root)
  const known = new Set(files)
  const byModule = new Map<string, MetaRecord[]>()
  for (const rel of files) {
    let content: string
    try {
      content = readFileSync(path.join(root, rel), "utf8")
    } catch {
      continue
    }
    const anchor = firstAnchor(content)
    if (!anchor) continue // arquivo vazio: nada verbatim p/ ancorar
    const deps = [...new Set(extractImports(content).map((i) => resolveRelative(rel, i.spec, known)).filter((d): d is string => d !== null))].sort()
    const module = rel.split(/[/\\]/)[0] || "root"
    const list = byModule.get(module) ?? []
    list.push({ id: rel, file: rel, kind: "File", responsibility: rel, exposed: false, deps, anchor })
    byModule.set(module, list)
  }
  for (const [module, records] of byModule) appendShard(root, module, records)
  writeGraph(root, buildGraph(root))
}

function loadGraphJson(root: string): Graph {
  return JSON.parse(readFileSync(path.join(root, ".graph", "graph.json"), "utf8")) as Graph
}

export type BootstrapResult = { graphId: string; stats: Graph["stats"] & { pipeline: Pipeline } }

/**
 * `tenant` é explícito e o graphId é escopado por ele. Antes esta função gravava sempre em
 * `tenantGraph(state, DEFAULT_TENANT)`: com D13 (multi-tenant) já em vigor no resto do servidor,
 * dois tenants chamando graph.bootstrap disputavam o MESMO slot — o segundo sobrescrevia o grafo
 * do primeiro, e o evento `graph.bootstrapped` ia para o log do tenant errado. O default
 * DEFAULT_TENANT existe só p/ o autoBootstrap de servidor (index.ts), que roda sem token.
 *
 * O repoPath passa a ser POR TENANT (`tg.repoPath`): cada tenant indexa o seu repo, e `rebuild`
 * relê o repo daquele tenant em vez de um `state.repoPath` global compartilhado.
 */
export function bootstrap(state: ServerState, repoPath: string, tenant: string = DEFAULT_TENANT): BootstrapResult {
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
  // tenant entra no hash: o mesmo repo publicado por dois tenants são dois grafos distintos, e um
  // cliente que trocasse de tenant sem trocar de graphId reusaria `since` de um log que não é o seu.
  const graphId = createHash("sha256").update(`${root}:${tenant}:${graphChecksum(graph)}`).digest("hex").slice(0, 16)
  const stats = { ...graph.stats, pipeline }

  const tg = tenantGraph(state, tenant)
  if (tg.graphId === graphId && tg.graph) return { graphId, stats } // idempotente: nada mudou

  if (!state.repoPath) state.repoPath = root // default de servidor: só o 1º bootstrap o define
  tg.repoPath = root
  tg.graph = graph
  tg.graphId = graphId
  tg.pipeline = pipeline
  tg.bootstrappedAt = new Date().toISOString()
  publish(state, { kind: "graph.bootstrapped", target: null, payload: { stats, pipeline } }, tenant)
  return { graphId, stats }
}

/** graph.rebuild: re-lê o .graph/ do repo DAQUELE tenant e re-emite snapshot p/ ele (spec §4.2). */
export function rebuild(state: ServerState, tenant: string = DEFAULT_TENANT): { ok: true; stats: Graph["stats"] & { pipeline: Pipeline } } {
  const tg = tenantGraph(state, tenant)
  const root = tg.repoPath ?? state.repoPath
  if (!root) throw new Error("not bootstrapped")
  const graph = loadGraphJson(root)
  const pipeline = tg.pipeline ?? "existing"
  tg.graph = graph
  tg.graphId = createHash("sha256").update(`${root}:${tenant}:${graphChecksum(graph)}`).digest("hex").slice(0, 16)
  const stats = { ...graph.stats, pipeline }
  publish(state, { kind: "graph.rebuilt", target: null, payload: { stats } }, tenant)
  return { ok: true, stats }
}
