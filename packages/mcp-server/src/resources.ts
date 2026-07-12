/**
 * resources.ts — leitura MCP (spec §4.3). Conteúdos derivados do grafo publicado + log em memória.
 *   graph://snapshot            → grafo publicado + graphId/pipeline
 *   graph://history?since=N     → tail do log (envelopes com seq > N)
 *   graph://cell/{domain:level} → autoridade, nós, claim count, drift grade da célula
 *   graph://domain/{domain}     → todas as células daquele domain
 */
import type { ServerState } from "./state"

function driftGradeOf(nodes: { stale?: unknown }[]): "fresh" | "stale" | "gone" {
  let worst: "fresh" | "stale" | "gone" = "fresh"
  for (const n of nodes) {
    if (n.stale === "gone") return "gone"
    if (n.stale === "stale") worst = "stale"
  }
  return worst
}

function cellState(state: ServerState, cellKey: string) {
  const cut = cellKey.lastIndexOf(":")
  const domain = cut > 0 ? cellKey.slice(0, cut) : cellKey
  const level = cut > 0 ? cellKey.slice(cut + 1) : ""
  const nodes = (state.graph?.nodes ?? []).filter(
    (n) => n.domain === domain && (level === "" || String(n.level) === `P${level}`),
  )
  const claims = new Set<string>()
  for (const n of nodes) for (const c of n.claims) claims.add(c)
  return {
    cell: cellKey,
    authority: state.graph?.authority?.[cellKey] ?? "source",
    nodeCount: nodes.length,
    claimCount: claims.size,
    driftGrade: driftGradeOf(nodes),
    nodes: nodes.map((n) => ({ id: n.id, file: n.file, anchor: n.anchor, stale: n.stale ?? "fresh" })),
  }
}

export function resolveResource(state: ServerState, uri: string): unknown {
  const rest = uri.replace(/^graph:\/\//, "")
  const [pathPart, queryPart] = rest.split("?")
  const [head, ...tail] = pathPart.split("/")
  const arg = tail.join("/")

  switch (head) {
    case "snapshot":
      if (!state.graph) throw new Error("not bootstrapped")
      return { graphId: state.graphId, pipeline: state.pipeline, bootstrappedAt: state.bootstrappedAt, lastEventSeq: state.lastEventSeq, graph: state.graph }
    case "history": {
      const since = Number(new URLSearchParams(queryPart ?? "").get("since") ?? 0)
      return { graphId: state.graphId, since, events: state.log.filter((e) => e.seq > since) }
    }
    case "cell":
      if (!arg) throw new Error("cell key required")
      return cellState(state, arg)
    case "domain": {
      if (!arg) throw new Error("domain required")
      const levels = new Set<string>()
      for (const n of state.graph?.nodes ?? []) if (n.domain === arg) levels.add(String(n.level).replace(/^P/, ""))
      return {
        domain: arg,
        cells: [...levels].sort().map((lvl) => cellState(state, `${arg}:${lvl}`)),
      }
    }
    default:
      throw new Error(`unknown resource: ${uri}`)
  }
}

export const RESOURCE_LIST = [
  { uri: "graph://snapshot", name: "snapshot", mimeType: "application/json", description: "Published graph (nodes, edges, authority, stats)." },
  { uri: "graph://history", name: "history", mimeType: "application/json", description: "Event log tail (?since=N)." },
  { uri: "graph://cell/{cellKey}", name: "cell", mimeType: "application/json", description: "Cell state: authority, nodes, claim count, drift grade." },
  { uri: "graph://domain/{domain}", name: "domain", mimeType: "application/json", description: "All cells of a domain." },
]
