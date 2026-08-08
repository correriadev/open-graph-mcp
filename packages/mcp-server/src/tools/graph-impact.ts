/**
 * graph-impact.ts — `graph.impact { id, depth?, limit?, token? }`: "o que quebra se eu mexer neste
 * arquivo?"
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
 *
 * LIMITE (evidência de escala real: 186 nós, `graph.impact` num único hub devolveu 38 dependentes só
 * em depth:1 — num monorepo de verdade isso estoura contexto de agente). O mesmo defeito de "silêncio
 * na direção errada" que motivou F1/F2/F7 se aplica aqui na direção oposta: uma resposta GIGANTE em
 * silêncio é tão ruim quanto uma vazia em silêncio. Por isso:
 *   - `limit` corta dependents/dependencies/cells, mas o TOTAL real (antes do corte) sempre viaja na
 *     resposta — "este arquivo tem 847 dependentes" é frequentemente a resposta que importa, mesmo sem
 *     a lista inteira; nunca fingimos que 847 é 100.
 *   - o corte nunca é silencioso: dependentsTruncated/dependenciesTruncated/cellsTruncated dizem
 *     explicitamente quando a lista devolvida é menor que o total.
 *   - ordem determinística (depth crescente, desempate por id) para que `limit` corte sempre os MESMOS
 *     itens entre chamadas, e para que quem importa mais (salto direto) nunca perca lugar para quem
 *     importa menos (salto distante) por causa da ordem de inserção das arestas no grafo.
 *
 * Trabalho vs. corte: o corte da LISTA é barato de limitar (só materializamos `file` via nodeById para
 * os itens que sobrevivem ao slice). O TOTAL exato, porém, não pode ser barateado por parada antecipada
 * — para saber que um hub tem exatamente 847 dependentes em depth 3 é preciso visitar os 847 (senão o
 * total também vira uma mentira, só que menor). Preferimos total exato a total aproximado (é o dado de
 * maior valor desta tool) — o custo é O(nós alcançáveis dentro de `depth` saltos), não O(grafo inteiro),
 * mas em um hub real essas duas coisas convergem. `cells` evita a segunda ponta cara (2 queries SQL por
 * célula): a classificação célula↔nó é feita sobre o conjunto completo (barata, em memória), mas as
 * queries de lock/authority só rodam para as até `limit` células que sobrevivem ao corte.
 */
import { UNASSIGNED } from "@open-graph-mcp/graph-core/domains"
import { tenantGraph, type ServerState } from "../state"
import { authorityOf, holderNameOf } from "../store"
import { canonicalCell } from "../gates"

export const DEFAULT_IMPACT_DEPTH = 1
export const MAX_IMPACT_DEPTH = 5

// Mesma convenção de graph://claims / graph://history (resources.ts: DEFAULT_PAGE_LIMIT=100,
// MAX_PAGE_LIMIT=500) — não inventar uma terceira convenção de paginação no mesmo servidor.
export const DEFAULT_IMPACT_LIMIT = 100
export const MAX_IMPACT_LIMIT = 500

export type ImpactHit = { id: string; file: string; depth: number }
type WalkHit = { id: string; depth: number }

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
  limit: number
  dependents: ImpactHit[]
  dependencies: ImpactHit[]
  totalDependents: number
  totalDependencies: number
  dependentsTruncated: boolean
  dependenciesTruncated: boolean
  cells: CellStateLite[]
  totalCells: number
  cellsTruncated: boolean
  gaps: string[]
}

/**
 * BFS por até `depth` saltos numa direção da adjacência dada. Não revisita (grafo pode ter ciclos).
 * Devolve TODOS os nós alcançados (id + depth, sem `file`) — o total exato depende de visitar o
 * conjunto alcançável inteiro; materializar `file` fica para depois do corte, só para quem sobrevive.
 */
function walk(start: string, depth: number, adj: Map<string, string[]>): WalkHit[] {
  const seen = new Set<string>([start])
  const out: WalkHit[] = []
  let frontier = [start]
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = []
    for (const cur of frontier) {
      for (const nb of adj.get(cur) ?? []) {
        if (seen.has(nb)) continue
        seen.add(nb)
        out.push({ id: nb, depth: d })
        next.push(nb)
      }
    }
    frontier = next
  }
  return out
}

/** depth crescente primeiro (quem importa mais), desempate por id (estável entre chamadas). */
function byDepthThenId(a: WalkHit, b: WalkHit): number {
  return a.depth - b.depth || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Ordena por relevância, corta em `limit`, e só então materializa `file` para quem sobrou. */
function cutAndMaterialize(hits: WalkHit[], limit: number, nodeById: Map<string, { id: string; file: string }>): ImpactHit[] {
  const sorted = [...hits].sort(byDepthThenId)
  return sorted.slice(0, limit).map((h) => ({ id: h.id, file: nodeById.get(h.id)?.file ?? h.id, depth: h.depth }))
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

  // `limit` diverge de `depth` de propósito: `depth` clampa porque um teto de profundidade só
  // estreita o raio de busca (o valor efetivo já volta no campo `depth` da resposta — o chamador vê o
  // que foi realmente usado). `limit`, ao contrário, controla quanto da resposta volta; um valor acima
  // do teto aqui é tratado como erro, não clamp, para ficar coerente com a convenção que
  // graph://claims/graph://history JÁ usam neste servidor (resources.ts::pageInteger) — não inventar
  // uma segunda regra de paginação que se comporta diferente da primeira no mesmo processo.
  let limit = DEFAULT_IMPACT_LIMIT
  if (args.limit !== undefined) {
    if (typeof args.limit !== "number" || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > MAX_IMPACT_LIMIT) {
      throw new Error(`graph.impact: limit deve ser um inteiro entre 1 e ${MAX_IMPACT_LIMIT}`)
    }
    limit = args.limit
  }

  const graph = tenantGraph(state, tenant).graph
  if (!graph) throw new Error("not bootstrapped")

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  if (!nodeById.has(id)) {
    return {
      id,
      depth,
      limit,
      dependents: [],
      dependencies: [],
      totalDependents: 0,
      totalDependencies: 0,
      dependentsTruncated: false,
      dependenciesTruncated: false,
      cells: [],
      totalCells: 0,
      cellsTruncated: false,
      gaps: [`node not found in graph: ${id}`],
    }
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

  // BFS completo (id + depth, sem `file`) — o total exato precisa do conjunto alcançável inteiro; ver
  // nota de topo do arquivo sobre por que parada antecipada falsificaria o total.
  const dependentsAll = walk(id, depth, dependentsAdj)
  const dependenciesAll = walk(id, depth, dependenciesAdj)

  const dependents = cutAndMaterialize(dependentsAll, limit, nodeById)
  const dependencies = cutAndMaterialize(dependenciesAll, limit, nodeById)

  // Células atingidas: a do próprio `id` + a de todo dependente/dependência encontrado NO CONJUNTO
  // COMPLETO (não só na lista cortada) — classificar domain/level é barato (em memória, sem SQL), então
  // não há razão para deixar uma célula travada fora do radar só porque seu nó ficou fora do top-`limit`
  // da lista. Um nó sem domínio atribuído cai em UNASSIGNED (mesma convenção de domains.ts) — célula
  // nunca flipável, mas ainda reportável (o agente precisa saber que a mudança toca ali, mesmo sem dono
  // de autoridade).
  const affectedIds = new Set<string>([id, ...dependentsAll.map((h) => h.id), ...dependenciesAll.map((h) => h.id)])
  const cellKeys = new Set<string>()
  for (const nid of affectedIds) {
    const n = nodeById.get(nid)
    if (!n) continue
    const domain = n.domain ?? UNASSIGNED
    const level = String(n.level).replace(/^P/, "")
    cellKeys.add(canonicalCell(`${domain}:${level}`))
  }

  // O corte caro está aqui: cada célula custa DUAS queries SQL (lock + authority). Classificar TODAS as
  // células é grátis; consultar o banco só roda para as até `limit` que sobrevivem ao corte — um raio de
  // impacto com centenas de células não vira centenas de queries por chamada.
  const sortedCellKeys = [...cellKeys].sort()
  const totalCells = sortedCellKeys.length
  const cells: CellStateLite[] = sortedCellKeys.slice(0, limit).map((cell) => {
    const lock = state.db.query("SELECT holder FROM locks WHERE tenant_id = ? AND cell = ?").get(tenant, cell) as { holder: string } | null
    return {
      cell,
      authority: authorityOf(state, tenant, cell),
      locked: lock !== null,
      holder: lock?.holder ?? null,
      holderName: lock ? holderNameOf(state, tenant, lock.holder) : null,
    }
  })

  return {
    id,
    depth,
    limit,
    dependents,
    dependencies,
    totalDependents: dependentsAll.length,
    totalDependencies: dependenciesAll.length,
    dependentsTruncated: dependentsAll.length > limit,
    dependenciesTruncated: dependenciesAll.length > limit,
    cells,
    totalCells,
    cellsTruncated: totalCells > limit,
    gaps: [],
  }
}
