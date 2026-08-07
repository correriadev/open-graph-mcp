/**
 * graph-query.ts — indexer herdado (opencode/graph/indexer) sobre o grafo publicado em memória.
 * Read-only; nunca muta. Retorna candidates + gaps (gaps são load-bearing: termo/domínio que não
 * casou nada é como o cliente aprende a perguntar em vez de assumir).
 */
import { queryGraph, type Query, type Result } from "@open-graph-mcp/graph-core/indexer"
import { tenantGraph, DEFAULT_TENANT, type ServerState } from "../state"

export function query(state: ServerState, q: Query, tenant = DEFAULT_TENANT): Result {
  // `terms` ausente/mal-tipado batia direto em `q.terms.map` dentro de queryGraph (indexer herdado,
  // não valida entrada) e vazava um TypeError cru ("q.terms.map is not a function...") pro caller —
  // mensagem de implementação, não de contrato. Validar aqui, na borda da tool, antes de entrar no
  // indexer.
  if (!Array.isArray(q.terms) || !q.terms.every((t) => typeof t === "string")) {
    throw new Error("graph.query: terms deve ser um array de strings")
  }
  const graph = tenantGraph(state, tenant).graph
  if (!graph) throw new Error("not bootstrapped")
  return queryGraph(graph.nodes, q)
}
