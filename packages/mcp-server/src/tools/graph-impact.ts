/**
 * graph-impact.ts — `graph.impact { id, depth?, token? }`: "o que quebra se eu mexer neste arquivo?"
 *
 * F5 (docs/roadmap-server-beta/01-evidencias-fluxo-completo.md): o servidor já tem os dados — cada
 * `depends-on` edge do grafo (`from` depende de `to`, ver graph-core/build.ts::assembleGraph) — mas
 * nenhuma tool os percorre. `graph.query` é match de token sobre metadados de nó, não traversal de
 * aresta; sem esta tool, o cliente tinha que baixar `graph://snapshot` inteiro e andar nas arestas
 * na mão.
 *
 * Semântica da aresta (confirmada em build.ts, não assumida): `{ from, to, type: "depends-on" }`
 * significa "from importa/usa to". Logo:
 *   - dependents  (raio de impacto) = todo `from` cujo `to` é `id`      — quem quebra se `id` mudar.
 *   - dependencies                  = todo `to` de uma edge cujo `from` é `id` — do que `id` depende.
 * Só arestas `depends-on` entram no traversal — `survey` liga DOMÍNIOS (from/to são nomes de domínio,
 * não ids de nó; misturá-las no walk por id produziria adjacências falsas).
 *
 * Read-only, mesma postura de graph-query.ts: token opcional (tenantOf resolve default/erro em
 * transport.ts), nunca muta. `id` inexistente no grafo é um GAP explícito (não uma lista vazia — a
 * mesma classe de defeito que F1/F2/F7 corrigiram: silêncio indistinguível de "sem impacto").
 */
import { UNASSIGNED } from "@open-graph-mcp/graph-core/domains"
import { tenantGraph, type ServerState } from "../state"
import { authorityOf, holderNameOf } from "../store"
import { canonicalCell } from "../gates"

export const DEFAULT_IMPACT_DEPTH = 1
export const MAX_IMPACT_DEPTH = 5

export type ImpactHit = { id: string; file: string; depth: number }

export type CellStateLite = {
  cell: string
  authority: "source" | "graph" | "suspended"
  locked: boolean
  holder: string | null
  holderName: string | null
}

export type ImpactResult = {
  id: string
  depth: number
  dependents: ImpactHit[]
  dependencies: ImpactHit[]
  cells: CellStateLite[]
  gaps: string[]
}

/** BFS por até `depth` saltos numa direção da adjacência dada. Não revisita (grafo pode ter ciclos). */
function walk(start: string, depth: number, adj: Map<string, string[]>, nodeById: Map<string, { id: string; file: string }>): ImpactHit[] {
  const seen = new Set<string>([start])
  const out: ImpactHit[] = []
  let frontier = [start]
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = []
    for (const cur of frontier) {
      for (const nb of adj.get(cur) ?? []) {
        if (seen.has(nb)) continue
        seen.add(nb)
        const n = nodeById.get(nb)
        out.push({ id: nb, file: n?.file ?? nb, depth: d })
        next.push(nb)
      }
    }
    frontier = next
  }
  return out
}

export function impact(state: ServerState, args: any, tenant: string): ImpactResult {
  // `id` ausente/mal-tipado — mesma disciplina de graph-query.ts::query: validar na borda da tool,
  // com mensagem de contrato, em vez de deixar vazar um TypeError cru de dentro do traversal.
  if (typeof args?.id !== "string" || args.id.length === 0) {
    throw new Error("graph.impact: id deve ser uma string não vazia (id de nó, ex.: \"auth/login.ts\")")
  }
  const id = args.id

  let depth = DEFAULT_IMPACT_DEPTH
  if (args.depth !== undefined) {
    if (typeof args.depth !== "number" || !Number.isInteger(args.depth) || args.depth < 1) {
      throw new Error("graph.impact: depth deve ser um inteiro >= 1")
    }
    depth = Math.min(args.depth, MAX_IMPACT_DEPTH)
  }

  const graph = tenantGraph(state, tenant).graph
  if (!graph) throw new Error("not bootstrapped")

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  if (!nodeById.has(id)) {
    return { id, depth, dependents: [], dependencies: [], cells: [], gaps: [`node not found in graph: ${id}`] }
  }

  // dependents[to] = [from, ...]   (quem depende de `to`)
  // dependencies[from] = [to, ...] (do que `from` depende)
  const dependentsAdj = new Map<string, string[]>()
  const dependenciesAdj = new Map<string, string[]>()
  for (const e of graph.edges) {
    if (e.type !== "depends-on") continue
    const deps = dependenciesAdj.get(e.from) ?? []
    deps.push(e.to)
    dependenciesAdj.set(e.from, deps)
    const dependents = dependentsAdj.get(e.to) ?? []
    dependents.push(e.from)
    dependentsAdj.set(e.to, dependents)
  }

  const dependents = walk(id, depth, dependentsAdj, nodeById)
  const dependencies = walk(id, depth, dependenciesAdj, nodeById)

  // Células atingidas: a do próprio `id` + a de todo dependente/dependência encontrado. Um nó sem
  // domínio atribuído cai em UNASSIGNED (mesma convenção de domains.ts) — célula nunca flipável, mas
  // ainda reportável (o agente precisa saber que a mudança toca ali, mesmo sem dono de autoridade).
  const affectedIds = new Set<string>([id, ...dependents.map((h) => h.id), ...dependencies.map((h) => h.id)])
  const cellKeys = new Set<string>()
  for (const nid of affectedIds) {
    const n = nodeById.get(nid)
    if (!n) continue
    const domain = n.domain ?? UNASSIGNED
    const level = String(n.level).replace(/^P/, "")
    cellKeys.add(canonicalCell(`${domain}:${level}`))
  }

  const cells: CellStateLite[] = [...cellKeys].sort().map((cell) => {
    const lock = state.db.query("SELECT holder FROM locks WHERE tenant_id = ? AND cell = ?").get(tenant, cell) as { holder: string } | null
    return {
      cell,
      authority: authorityOf(state, tenant, cell),
      locked: lock !== null,
      holder: lock?.holder ?? null,
      holderName: lock ? holderNameOf(state, tenant, lock.holder) : null,
    }
  })

  return { id, depth, dependents, dependencies, cells, gaps: [] }
}
