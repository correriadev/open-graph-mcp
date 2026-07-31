/**
 * graph-bootstrap.ts — `graph.bootstrap { token, repoPath }`: indexa um repo e publica o grafo
 * NO SERVIDOR. Uma operação, um comando.
 *
 * ADR §4.1 / D1: "o grafo mora num banco, não num arquivo" e "não há `.graph/` no cliente — o repo
 * de cada usuário NÃO carrega a verdade". O servidor portanto **nunca escreve no repo-alvo**: ele
 * é lido (scan + âncoras + imports) e o resultado vai para SQLite + espelho JSONL por tenant, que
 * é a verdade durável (JSONL append-only = verdade; SQLite = índice reconstruível).
 *
 * Antes disto o fluxo era em dois passos e meio-fora-do-servidor: `buildSkeleton` gravava
 * `.graph/meta/*.jsonl` + `.graph/graph.json` DENTRO do repo-alvo, `bootstrap` relia esse arquivo
 * para a memória, e só um `graph.import` explícito — que ninguém chamava — levava para o banco.
 * Resultado prático: o grafo sumia a cada restart e sujava o repo indexado com estado derivado.
 *
 * O que é determinístico e roda aqui: a ESTRUTURA (arquivos, âncoras verbatim, arestas de
 * dependência via extract.ts, sem LLM). O que NÃO roda: claims com subject/verdict, que são
 * trabalho de sessão de agente (Pass A/B/C) e entram pela porta do changeset.
 *
 * Idempotente por tenant: graphId = sha256(repoPath + tenant + checksum-semântico). Reindexar
 * conteúdo inalterado devolve o mesmo graphId e não re-emite evento nem re-escreve o banco.
 */
import { readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import type { Graph, GraphNode } from "@open-graph-mcp/graph-core/build"
import { assembleGraph } from "@open-graph-mcp/graph-core/build"
import { graphChecksum } from "@open-graph-mcp/graph-core/boot-gate"
import { classifyFile } from "@open-graph-mcp/graph-core/classify"
import type { MetaRecord } from "@open-graph-mcp/graph-core/meta"
import { DEFAULT_IGNORE } from "@open-graph-mcp/graph-core/scan"
import { extractImports } from "@open-graph-mcp/graph-core/extract"
import { durableTransaction, write } from "../db"
import { invalidateClaimsCache } from "../store"
import { appendEvent, publish, pushEnvelope, tenantGraph, DEFAULT_TENANT, type Pipeline, type ServerState } from "../state"
import { requireToken } from "./session"

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".md"])
const BOOTSTRAP_ID = "cs_bootstrap"

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
        // normaliza p/ separador POSIX: o id é chave persistida (SQLite/JSONL) e precisa ser
        // idêntico entre SOs — path.relative() usa `\` no Windows, o que quebra matchesPattern()
        // em domains.ts e torna um grafo indexado no Windows ilegível p/ cliente Linux.
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
 * `react`/`@scope/x` são deps externas e não viram aresta interna (emitir uma aresta por import
 * de node_modules só polui o grafo). Devolve null quando nada casa — o caller descarta.
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
 * Indexa o repo EM MEMÓRIA — nenhuma escrita no repo-alvo. 1 nó por arquivo-fonte (âncora = 1ª
 * linha não-vazia), deps = imports relativos resolvidos.
 *
 * ponytail: herda os gaps documentados de `extractImports` (regex single-line) — import MULTILINHA
 * e re-export (`export { x } from "./y"`) não são capturados, então barrels saem sem deps. O
 * upgrade é `extractImportsAst`, async, que exigiria propagar async por todo o caminho de tool.
 */
export function indexRepo(root: string, domains: ReturnType<typeof loadDomainRules>): Graph {
  const files = walkSource(root)
  const known = new Set(files)
  const meta: MetaRecord[] = []
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
    meta.push({ id: rel, file: rel, kind: "File", responsibility: rel, exposed: false, deps, anchor })
  }
  return assembleGraph({ repo: root, meta, claims: [], survey: [], domainMap: domains })
}

/** Regras de domínio vêm da CONFIG DO SERVIDOR (StartOptions/env), nunca de um arquivo no repo. */
export type DomainRules = readonly { pattern: string; domain: string }[] | null
export function loadDomainRules(rules: DomainRules): DomainRules {
  return rules && rules.length ? rules : null
}

/** Reconstrói o Graph a partir do banco — é isto que faz o grafo sobreviver a restart. */
export function graphFromDb(state: ServerState, tenant: string, repoPath: string): Graph | null {
  const nodeRows = state.db
    .query("SELECT id, domain, level, file, kind, sig, anchor, exposed, responsibility, confidence FROM nodes WHERE tenant_id = ? ORDER BY id")
    .all(tenant) as {
    id: string
    domain: string | null
    level: string | null
    file: string | null
    kind: string | null
    sig: string | null
    anchor: string | null
    exposed: number
    responsibility: string | null
    confidence: number | null
  }[]
  if (!nodeRows.length) return null

  const claimRows = state.db.query("SELECT id, refs FROM claims WHERE tenant_id = ?").all(tenant) as { id: string; refs: string }[]
  const claimsByRef = new Map<string, string[]>()
  for (const row of claimRows) {
    let refs: string[] = []
    try {
      refs = JSON.parse(row.refs ?? "[]")
    } catch {
      refs = []
    }
    for (const ref of refs) claimsByRef.set(ref, [...(claimsByRef.get(ref) ?? []), row.id])
  }

  const nodes: GraphNode[] = nodeRows.map((r) => ({
    id: r.id,
    file: r.file ?? r.id,
    kind: r.kind ?? "File",
    sig: r.sig ?? undefined,
    domain: r.domain,
    level: (r.level as GraphNode["level"]) ?? classifyFile(r.file ?? r.id),
    responsibility: r.responsibility ?? r.id,
    exposed: !!r.exposed,
    anchor: r.anchor ?? "",
    claims: claimsByRef.get(r.id) ?? [],
    confidence: r.confidence,
    overclaim: false,
  }))

  const edgeRows = state.db.query("SELECT from_id, to_id, kind FROM edges WHERE tenant_id = ? ORDER BY id").all(tenant) as {
    from_id: string
    to_id: string
    kind: string
  }[]
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = edgeRows.map((e) => ({
    from: e.from_id,
    to: e.to_id,
    type: (e.kind === "survey" ? "survey" : "depends-on") as "depends-on" | "survey",
    resolved: nodeIds.has(e.to_id),
  }))

  const authorityRows = state.db.query("SELECT cell, value FROM authority WHERE tenant_id = ?").all(tenant) as { cell: string; value: string }[]
  const authority: Record<string, "source" | "graph" | "suspended"> = {}
  for (const row of authorityRows) authority[row.cell] = row.value as "source" | "graph" | "suspended"

  const domains = new Set(nodes.map((n) => n.domain).filter((d): d is string => d !== null))
  return {
    schemaVersion: 1,
    repo: repoPath,
    generatedAt: new Date().toISOString(),
    stats: { nodes: nodes.length, edges: edges.length, claims: claimRows.length, domains: domains.size },
    nodes,
    edges,
    authority: Object.keys(authority).length ? authority : undefined,
  }
}

/**
 * Persiste o grafo no tenant: SQLite + espelho JSONL, tudo numa transação. Substitui o conteúdo
 * anterior (reindexar é idempotente por definição — o repo é a fonte da estrutura).
 */
function persistGraph(state: ServerState, tenant: string, userId: string, graph: Graph): void {
  durableTransaction(state.db, () => {
    state.db.query("DELETE FROM nodes WHERE tenant_id = ?").run(tenant)
    state.db.query("DELETE FROM edges WHERE tenant_id = ?").run(tenant)
    const cells = new Set<string>()
    for (const n of graph.nodes) {
      write(state.db, state.stateDir, tenant, "nodes", {
        tenant_id: tenant, id: n.id, domain: n.domain, level: String(n.level), file: n.file, kind: n.kind, sig: n.sig ?? null, anchor: n.anchor,
        symbol_path: null, token_hash: null, exposed: n.exposed ? 1 : 0, responsibility: n.responsibility, confidence: n.confidence, created_seq: 0, supersede_seq: null,
      })
      if (n.domain) cells.add(`${n.domain}:${String(n.level).replace(/^P/, "")}`)
    }
    for (const e of graph.edges) {
      write(state.db, state.stateDir, tenant, "edges", {
        tenant_id: tenant, id: `${e.from}->${e.to}:${e.type}`, from_id: e.from, to_id: e.to, kind: e.type, created_seq: 0, supersede_seq: null,
      })
    }
    for (const [cell, value] of Object.entries(graph.authority ?? {})) {
      write(state.db, state.stateDir, tenant, "authority", { tenant_id: tenant, cell, value, last_flip_seq: 0, last_flip_by: userId })
    }
    // changeset 'bootstrap' admitido: a indexação é uma mutação com autoria, como qualquer outra —
    // é o que dá procedência aos nós no histórico em vez de eles surgirem do nada.
    const now = new Date().toISOString()
    write(state.db, state.stateDir, tenant, "changesets", {
      tenant_id: tenant, id: BOOTSTRAP_ID, intent: "bootstrap (index)", parent: null, status: "admitted", opened_by: userId,
      opened_at: now, closed_at: now, base_seq: 0, admit_seq: 0, blast_cells: JSON.stringify([...cells].sort()),
    })
  })
  invalidateClaimsCache(state, tenant)
}

export type BootstrapResult = { graphId: string; stats: Graph["stats"] & { pipeline: Pipeline } }

/**
 * `tenant` é explícito e o graphId é escopado por ele: o MESMO repo indexado por dois tenants são
 * dois grafos distintos, e um cliente que trocasse de tenant sem trocar de graphId reusaria
 * `since` de um log que não é o seu. O default DEFAULT_TENANT existe só p/ o autoBootstrap de
 * servidor (index.ts), que roda sem token.
 */
export function bootstrap(state: ServerState, repoPath: string, tenant: string = DEFAULT_TENANT, userId = "system"): BootstrapResult {
  const root = path.resolve(repoPath)
  const graph = indexRepo(root, state.domains)
  const graphId = createHash("sha256").update(`${root}:${tenant}:${graphChecksum(graph)}`).digest("hex").slice(0, 16)
  const stats = { ...graph.stats, pipeline: "indexed" as Pipeline }

  const tg = tenantGraph(state, tenant)
  if (tg.graphId === graphId && tg.graph) return { graphId, stats } // idempotente: nada mudou

  persistGraph(state, tenant, userId, graph)
  if (!state.repoPath) state.repoPath = root // default de servidor: só o 1º bootstrap o define
  tg.repoPath = root
  tg.graph = graph
  tg.graphId = graphId
  tg.pipeline = "indexed"
  tg.bootstrappedAt = new Date().toISOString()
  publish(state, { kind: "graph.bootstrapped", target: null, payload: { stats, pipeline: "indexed" } }, tenant)
  return { graphId, stats }
}

/** Tool: exige token — indexar ESCREVE no tenant do chamador. */
export function graphBootstrap(state: ServerState, args: { token: string; repoPath?: string }): BootstrapResult {
  const { userId, tenantId } = requireToken(state, args.token)
  const root = args.repoPath ?? tenantGraph(state, tenantId).repoPath ?? state.repoPath
  if (!root) throw new Error("graph.bootstrap: repoPath required (no server default configured)")
  return bootstrap(state, root, tenantId, userId)
}

/** graph.rebuild: re-indexa o repo do tenant e re-emite snapshot p/ ele (spec §4.2). */
export function rebuild(state: ServerState, tenant: string = DEFAULT_TENANT, userId = "system"): { ok: true; stats: Graph["stats"] & { pipeline: Pipeline } } {
  const tg = tenantGraph(state, tenant)
  const root = tg.repoPath ?? state.repoPath
  if (!root) throw new Error("not bootstrapped")
  const graph = indexRepo(path.resolve(root), state.domains)
  persistGraph(state, tenant, userId, graph)
  tg.graph = graph
  tg.graphId = createHash("sha256").update(`${root}:${tenant}:${graphChecksum(graph)}`).digest("hex").slice(0, 16)
  const stats = { ...graph.stats, pipeline: "indexed" as Pipeline }
  publish(state, { kind: "graph.rebuilt", target: null, payload: { stats } }, tenant)
  return { ok: true, stats }
}

export function graphRebuild(state: ServerState, args: { token: string }): { ok: true; stats: Graph["stats"] & { pipeline: Pipeline } } {
  const { userId, tenantId } = requireToken(state, args.token)
  return rebuild(state, tenantId, userId)
}

/**
 * Hidrata os grafos em memória a partir do banco, no start do servidor. É isto que faz o grafo
 * SOBREVIVER a restart: antes, estado 100% em memória significava que subir o servidor devolvia
 * "not bootstrapped" até alguém reindexar.
 */
export function hydrateFromDb(state: ServerState): number {
  const tenants = state.db.query("SELECT DISTINCT tenant_id FROM nodes").all() as { tenant_id: string }[]
  let count = 0
  for (const { tenant_id: tenant } of tenants) {
    const tg = tenantGraph(state, tenant)
    const repoPath = tg.repoPath ?? state.repoPath
    const graph = graphFromDb(state, tenant, repoPath)
    if (!graph) continue
    tg.graph = graph
    tg.graphId = createHash("sha256").update(`${repoPath}:${tenant}:${graphChecksum(graph)}`).digest("hex").slice(0, 16)
    tg.pipeline = "indexed"
    tg.bootstrappedAt = new Date().toISOString()
    tg.repoPath = repoPath || null
    count++
  }
  return count
}
