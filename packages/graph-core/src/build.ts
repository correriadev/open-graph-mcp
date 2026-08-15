/**
 * build.ts — consolidador determinístico: junta as peças do pipeline num grafo único.
 * Nós = símbolos (meta). Arestas = deps de símbolo (meta.deps) + relações de domínio (survey).
 * Cada nó carrega os claims que o referenciam e o verdict agregado (confiança média / overclaim).
 * Sem LLM — só costura o que Pass A/B/C já provaram. Saída: .graph/graph.json.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import { readAllMeta, type MetaRecord } from "./meta"
import { readAllClaims, type ClaimRecord } from "./claim-store"
import { readLedgerV2 } from "./prune"
import { classifyFile, type Level } from "./classify"
import { assignDomain, loadDomains, type DomainMap } from "./domains"

export type SurveyPattern = {
  domainA: string
  domainB: string
  relationship: string
  strength: number
  summary: string
}

export type GraphNode = {
  id: string
  file: string
  kind: string
  sig?: string
  domain: string | null
  level: Level // torre P1-P5 do arquivo (classify.ts), granularidade da célula no cell-dag
  responsibility: string
  exposed: boolean
  anchor: string
  range?: string
  claims: string[]
  confidence: number | null // média dos claims que referenciam o nó
  overclaim: boolean // algum claim marcou overclaim
}

export type GraphEdge = {
  from: string
  to: string
  type: "depends-on" | "survey"
  resolved?: boolean // depends-on: o alvo é um nó conhecido (true) ou ref externa (false)
  strength?: number // survey
  summary?: string // survey
}

export type Graph = {
  schemaVersion: 1
  repo: string
  generatedAt: string
  projectSummary?: string
  stats: { nodes: number; edges: number; claims: number; domains: number }
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Truth ownership per cell "<domain>:<level>". Absent key = "source" (α). */
  authority?: Record<string, "source" | "graph" | "suspended">
}

/** Costura pura (testável sem fs): meta + claims + survey → grafo. */
export function assembleGraph(opts: {
  repo: string
  projectSummary?: string
  meta: readonly MetaRecord[]
  claims: readonly ClaimRecord[]
  survey: readonly SurveyPattern[]
  generatedAt?: string
  /** Mapa de posse explícita de domínio (.graph/domains.json). null = fallback ao sort-tiebreak antigo. */
  domainMap?: DomainMap | null
}): Graph {
  const { repo, projectSummary, meta, claims, survey, domainMap = null } = opts
  const nodeIds = new Set(meta.map((m) => m.id))

  // ref (meta id) → claims/domínio/verdicts que o tocam
  type Agg = { claims: string[]; domains: Set<string>; confs: number[]; over: boolean }
  const byRef = new Map<string, Agg>()
  for (const c of claims) {
    for (const r of c.refs) {
      const a = byRef.get(r) ?? { claims: [], domains: new Set(), confs: [], over: false }
      a.claims.push(c.id)
      if (c.domain) a.domains.add(c.domain)
      if (c.verdict) {
        a.confs.push(c.verdict.confidence)
        a.over = a.over || c.verdict.overclaim
      }
      byRef.set(r, a)
    }
  }

  const nodes: GraphNode[] = meta.map((m) => {
    const a = byRef.get(m.id)
    return {
      id: m.id,
      file: m.file,
      kind: m.kind,
      sig: m.sig,
      domain: assignDomain(m.file, a?.domains ?? [], domainMap),
      level: classifyFile(m.file),
      responsibility: m.responsibility,
      exposed: m.exposed,
      anchor: m.anchor,
      range: m.range,
      claims: a?.claims ?? [],
      confidence: a && a.confs.length ? a.confs.reduce((s, n) => s + n, 0) / a.confs.length : null,
      overclaim: a?.over ?? false,
    }
  })

  const edges: GraphEdge[] = []
  // arestas de dependência de símbolo (meta.deps)
  for (const m of meta) {
    for (const dep of m.deps ?? []) {
      edges.push({ from: m.id, to: dep, type: "depends-on", resolved: nodeIds.has(dep) })
    }
  }
  // arestas de domínio (survey)
  for (const p of survey) {
    edges.push({ from: p.domainA, to: p.domainB, type: "survey", strength: p.strength, summary: p.summary })
  }

  const domains = new Set(nodes.map((n) => n.domain).filter((d): d is string => d !== null))
  return {
    schemaVersion: 1,
    repo,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    projectSummary,
    stats: { nodes: nodes.length, edges: edges.length, claims: new Set(claims.map((c) => c.id)).size, domains: domains.size },
    nodes,
    edges,
  }
}

function readSurvey(root: string): SurveyPattern[] {
  const file = path.join(root, ".graph", "survey.json")
  if (!existsSync(file)) return []
  try {
    const arr = JSON.parse(readFileSync(file, "utf8"))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/** Lê as peças do disco e monta o grafo. */
export function buildGraph(root: string): Graph {
  const ledger = readLedgerV2(root, "ledger.json")
  return assembleGraph({
    repo: ledger?.repo ?? root,
    projectSummary: ledger?.projectSummary,
    meta: readAllMeta(root),
    claims: readAllClaims(root),
    survey: readSurvey(root),
    domainMap: loadDomains(root),
  })
}

export function writeGraph(root: string, graph: Graph): string {
  const dir = path.join(root, ".graph")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "graph.json")
  writeFileSync(file, JSON.stringify(graph, null, 2))
  return file
}

import {
  validateGraphSnapshotV2,
  type GraphSnapshotV2,
  type GraphNodeV2,
  type PublishedRelationship,
  type EvidenceRecord,
  type CoverageManifest,
  type HorizonGraphScope,
  type PolicyVersion,
} from "./relationship-types"
import { computeGraphSnapshotId } from "./graph-checksum"

export * from "./relationship-types"
export * from "./graph-checksum"

export function assembleGraphSnapshotV2(opts: {
  tenantId: string
  horizonId: string
  policyVersion: PolicyVersion
  nodes: readonly GraphNodeV2[]
  relationships: readonly PublishedRelationship[]
  evidence: readonly EvidenceRecord[]
  coverage: CoverageManifest
  graphId?: string
}): GraphSnapshotV2 {
  const { tenantId, horizonId, policyVersion, nodes, relationships, evidence, coverage } = opts
  const computedGraphId =
    opts.graphId ??
    computeGraphSnapshotId({
      tenantId,
      horizonId,
      policyVersion,
      nodes,
      relationships,
      evidence,
      coverage,
    })

  const scope: HorizonGraphScope = {
    tenantId,
    horizonId,
    graphId: computedGraphId,
  }

  // Ensure coverage scope matches exactly
  const finalizedCoverage: CoverageManifest = {
    ...coverage,
    scope,
  }

  return validateGraphSnapshotV2({
    scope,
    policyVersion,
    nodes,
    relationships,
    evidence,
    coverage: finalizedCoverage,
  })
}

