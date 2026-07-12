/**
 * graph-query.ts — indexer herdado (opencode/graph/indexer) sobre o grafo publicado em memória.
 * Read-only; nunca muta. Retorna candidates + gaps (gaps são load-bearing: termo/domínio que não
 * casou nada é como o cliente aprende a perguntar em vez de assumir).
 */
import { queryGraph, type Query, type Result } from "@open-graph-mcp/graph-core/indexer"
import type { ServerState } from "../state"

export function query(state: ServerState, q: Query): Result {
  if (!state.graph) throw new Error("not bootstrapped")
  return queryGraph(state.graph.nodes, q)
}
