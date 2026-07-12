/**
 * score.ts — saúde do mapa: agrega grounding/confiança/overclaim em score por domínio + projeto,
 * e detecta LACUNAS ESTRUTURAIS (onde o mapa é fraco). Determinístico, lê o graph.json consolidado.
 * Espelha score.py da POC (grounding_report + structural gaps), sem LLM.
 */

type NodeIn = {
  id: string
  domain?: string | null
  exposed?: boolean
  overclaim?: boolean
  confidence?: number | null
  claims?: string[]
}
type EdgeIn = { from: string; to: string; type: "depends-on" | "survey" }
type GraphIn = { nodes?: NodeIn[]; edges?: EdgeIn[] }

export type DomainScore = {
  domain: string
  nodes: number
  claimed: number
  meanConfidence: number | null
  overclaim: number
  score: number // 0..1
}

export type Gap = {
  kind: "no-claim" | "exposed-unclaimed" | "low-confidence" | "isolated-domain" | "thin-domain"
  id: string
  detail: string
}

export type Score = {
  project: { nodes: number; domains: number; claimedRate: number; meanConfidence: number | null; overclaimRate: number; score: number }
  domains: DomainScore[]
  gaps: Gap[]
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null)

/** score 0..1 = 0.4·taxa-de-claim + 0.4·confiança-média + 0.2·(1−taxa-overclaim). */
function scoreOf(nodes: NodeIn[]): number {
  if (!nodes.length) return 0
  const claimRate = nodes.filter((n) => (n.claims?.length ?? 0) > 0).length / nodes.length
  const confs = nodes.map((n) => n.confidence).filter((c): c is number => c != null)
  const conf = confs.length ? confs.reduce((s, n) => s + n, 0) / confs.length : 0
  const overRate = nodes.filter((n) => n.overclaim).length / nodes.length
  return Math.round((0.4 * claimRate + 0.4 * conf + 0.2 * (1 - overRate)) * 100) / 100
}

/** Projeta o grafo em score + lacunas. Puro. */
export function scoreGraph(g: GraphIn): Score {
  const nodes = g.nodes ?? []
  const edges = g.edges ?? []
  const byDomain = new Map<string, NodeIn[]>()
  for (const n of nodes) {
    const d = n.domain ?? "(unassigned)"
    ;(byDomain.get(d) ?? byDomain.set(d, []).get(d)!).push(n)
  }

  // domínios tocados por aresta survey (relação cross-domínio)
  const linkedDomains = new Set<string>()
  for (const e of edges) if (e.type === "survey") { linkedDomains.add(e.from); linkedDomains.add(e.to) }

  const domains: DomainScore[] = [...byDomain.entries()]
    .map(([domain, ns]) => ({
      domain,
      nodes: ns.length,
      claimed: ns.filter((n) => (n.claims?.length ?? 0) > 0).length,
      meanConfidence: mean(ns.map((n) => n.confidence).filter((c): c is number => c != null)),
      overclaim: ns.filter((n) => n.overclaim).length,
      score: scoreOf(ns),
    }))
    .sort((a, b) => a.score - b.score) // pior primeiro (onde focar)

  const gaps: Gap[] = []
  for (const n of nodes) {
    const claimed = (n.claims?.length ?? 0) > 0
    if (!claimed && n.exposed) gaps.push({ kind: "exposed-unclaimed", id: n.id, detail: "public symbol with no claim" })
    else if (!claimed) gaps.push({ kind: "no-claim", id: n.id, detail: "symbol mapped but not asserted" })
    if (n.confidence != null && n.confidence < 0.5) gaps.push({ kind: "low-confidence", id: n.id, detail: `confidence ${n.confidence}` })
  }
  for (const ds of domains) {
    if (!linkedDomains.has(ds.domain) && byDomain.size > 1)
      gaps.push({ kind: "isolated-domain", id: ds.domain, detail: "no cross-domain relation found" })
    if (ds.nodes >= 4 && ds.claimed / ds.nodes < 0.5)
      gaps.push({ kind: "thin-domain", id: ds.domain, detail: `${ds.claimed}/${ds.nodes} symbols claimed` })
  }

  const confs = nodes.map((n) => n.confidence).filter((c): c is number => c != null)
  return {
    project: {
      nodes: nodes.length,
      domains: byDomain.size,
      claimedRate: nodes.length ? Math.round((nodes.filter((n) => (n.claims?.length ?? 0) > 0).length / nodes.length) * 100) / 100 : 0,
      meanConfidence: mean(confs),
      overclaimRate: nodes.length ? Math.round((nodes.filter((n) => n.overclaim).length / nodes.length) * 100) / 100 : 0,
      score: scoreOf(nodes),
    },
    domains,
    gaps,
  }
}
