/**
 * docs.ts — gera documentação bottom-up A PARTIR DO GRAFO (graph.json), não de prosa humana.
 * Determinístico: cada linha rastreia a um nó/âncora/verdict — não consegue divergir do código.
 * Ascende: símbolos (folhas) → domínios → arquitetura. Saída: .graph/docs/*.md.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import { buildGraph, type Graph, type GraphNode } from "./build"

const slug = (s: string) => s.toLowerCase().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "root"
const conf = (n: GraphNode) => (n.confidence === null ? "—" : n.confidence.toFixed(2))

function nodesByDomain(g: Graph): Map<string, GraphNode[]> {
  const m = new Map<string, GraphNode[]>()
  for (const n of g.nodes) {
    const d = n.domain ?? "(unassigned)"
    ;(m.get(d) ?? m.set(d, []).get(d)!).push(n)
  }
  return m
}

/** Página de um domínio: folhas (símbolos) com responsabilidade + evidência + deps internas. */
function renderDomain(domain: string, nodes: GraphNode[]): string {
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id))
  const withConf = sorted.filter((n) => n.confidence !== null)
  const mean = withConf.length ? withConf.reduce((s, n) => s + (n.confidence ?? 0), 0) / withConf.length : null
  const over = sorted.filter((n) => n.overclaim)

  const L: string[] = []
  L.push(`# Domain: ${domain}`)
  L.push("")
  L.push(`> Generated from code (graph.json). ${sorted.length} symbols${mean !== null ? `, mean confidence ${mean.toFixed(2)}` : ""}${over.length ? `, ${over.length} flagged overclaim` : ""}.`)
  L.push("")
  L.push("## Symbols")
  for (const n of sorted) {
    L.push("")
    L.push(`### ${n.id} \`${n.kind}\`${n.exposed ? " · exposed" : ""} · confidence ${conf(n)}${n.overclaim ? " · ⚠ overclaim" : ""}`)
    L.push(n.responsibility || "_(no responsibility recorded)_")
    if (n.sig) L.push("")
    if (n.sig) L.push(`\`${n.sig}\``)
    L.push("")
    L.push(`- file: \`${n.file}\``)
    L.push(`- anchor: \`${n.anchor}\``)
    if (n.claims.length) L.push(`- claims: ${n.claims.map((c) => `\`${c}\``).join(", ")}`)
  }
  return L.join("\n") + "\n"
}

/** Página de arquitetura: compõe os domínios + relações (survey) + camadas. */
function renderArchitecture(g: Graph, byDomain: Map<string, GraphNode[]>): string {
  const surveyEdges = g.edges.filter((e) => e.type === "survey")
  const internalDeps = g.edges.filter((e) => e.type === "depends-on" && e.resolved).length
  const externalDeps = g.edges.filter((e) => e.type === "depends-on" && !e.resolved).length
  const over = g.nodes.filter((n) => n.overclaim).length
  const withConf = g.nodes.filter((n) => n.confidence !== null)
  const mean = withConf.length ? withConf.reduce((s, n) => s + (n.confidence ?? 0), 0) / withConf.length : null

  const L: string[] = []
  L.push("# Architecture (from code)")
  L.push("")
  L.push("> Derived only from what the code reported — symbols, dependencies, and code-anchored claims. Not from prose docs.")
  L.push("")
  if (g.projectSummary) {
    L.push("## Summary")
    L.push(g.projectSummary)
    L.push("")
  }
  L.push("## Stats")
  L.push(`- ${g.stats.nodes} symbols across ${g.stats.domains} domains`)
  L.push(`- ${g.stats.edges} edges (${internalDeps} internal deps, ${externalDeps} external refs, ${surveyEdges.length} domain relations)`)
  L.push(`- ${g.stats.claims} claims${mean !== null ? `, mean confidence ${mean.toFixed(2)}` : ""}${over ? `, ${over} symbols flagged overclaim` : ""}`)
  L.push("")
  L.push("## Domains")
  for (const [d, nodes] of [...byDomain.entries()].sort((a, b) => b[1].length - a[1].length)) {
    L.push(`- [${d}](./${slug(d)}.md) — ${nodes.length} symbols`)
  }
  L.push("")
  if (surveyEdges.length) {
    L.push("## Domain relations")
    for (const e of surveyEdges.sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))) {
      L.push(`- **${e.from}** → **${e.to}** (${e.type === "survey" ? (e.strength ?? 0).toFixed(2) : ""}): ${e.summary ?? ""}`)
    }
    L.push("")
  }
  return L.join("\n") + "\n"
}

export type DocFile = { path: string; content: string }

/** Renderiza o conjunto de docs (puro, testável). architecture.md + 1 md por domínio. */
export function renderDocs(g: Graph): DocFile[] {
  const byDomain = nodesByDomain(g)
  const files: DocFile[] = [{ path: "architecture.md", content: renderArchitecture(g, byDomain) }]
  for (const [domain, nodes] of byDomain) {
    files.push({ path: `${slug(domain)}.md`, content: renderDomainWithEdges(domain, nodes, g) })
  }
  return files
}

/** Domínio com deps internas resolvidas das arestas do grafo. */
function renderDomainWithEdges(domain: string, nodes: GraphNode[], g: Graph): string {
  const base = renderDomain(domain, nodes)
  const ids = new Set(nodes.map((n) => n.id))
  const deps = g.edges.filter((e) => e.type === "depends-on" && e.resolved && ids.has(e.from))
  if (!deps.length) return base
  const L = [base.trimEnd(), "", "## Internal dependencies"]
  for (const e of deps.sort((a, b) => a.from.localeCompare(b.from))) {
    L.push(`- \`${e.from}\` → \`${e.to}\`${ids.has(e.to) ? "" : " (other domain)"}`)
  }
  return L.join("\n") + "\n"
}

export function writeDocs(root: string, files: DocFile[]): string {
  const dir = path.join(root, ".graph", "docs")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  for (const f of files) writeFileSync(path.join(dir, f.path), f.content)
  return dir
}

/** Lê graph.json (via buildGraph) e gera os docs. */
export function buildDocs(root: string): { dir: string; files: DocFile[] } {
  const g = buildGraph(root)
  const files = renderDocs(g)
  const dir = writeDocs(root, files)
  return { dir, files }
}
