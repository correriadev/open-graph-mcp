#!/usr/bin/env bun
/**
 * F002 task 21 — regenerate the Test Index and fail on documentation drift.
 *
 *   bun scripts/verification/reconcile-index.ts          -> write derived documents
 *   bun scripts/verification/reconcile-index.ts --check  -> report drift and exit non-zero
 */

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const MAP_PATH = "docs/verification/traceability-map.json"
export const FEATURE_PATH = "docs/feature/cognitive_line.md"
export const DIGEST_PATH = "docs/.digest.md"
export const GRAPH_PATH = "docs/.graph.json"
export const PINNED_TYPECHECK_COMMAND = "bun run typecheck"

export interface TraceabilityLinkForIndex {
  scenario: string
  testFile: string
  testName: string
  kind: "asserts" | "covers-partially"
}

export interface TraceabilityMapForIndex {
  corpus: { files: string[] }
  links: TraceabilityLinkForIndex[]
}

export interface FeatureGraph {
  node_id: string
  tested_by: string[]
  test_files: string[]
  [key: string]: unknown
}

export interface DocumentNode {
  id: string
  type: string
  title: string
  path: string
  tags: string[]
}

export interface DocumentGraph {
  nodes: DocumentNode[]
  edges: { source: string; target: string; relation: string }[]
}

export interface RenderedDocuments {
  feature: string
  featureGraph: FeatureGraph
  digest: string
  graphText: string
  graph: DocumentGraph
}

export interface DocumentationDrift {
  file: string
  field: string
  expected: unknown
  actual: unknown
}

const PRD_NODES: readonly DocumentNode[] = [
  {
    id: "prd:working-paper-v1",
    type: "prd",
    title: "OpenGraph — Working Paper v1.0",
    path: "docs/PRD/OpenGraph_Working_Paper_v1_0.md",
    tags: ["opengraph", "eap", "normative-source", "working-paper"],
  },
  {
    id: "prd:graduation",
    type: "prd",
    title: "PRD — OpenGraph v1.0 Graduation",
    path: "docs/PRD/PRD.md",
    tags: ["opengraph", "eap", "requirements", "graduation"],
  },
]

export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..")
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

export function loadTraceabilityMapForIndex(raw: string): TraceabilityMapForIndex {
  const parsed = JSON.parse(raw) as Partial<TraceabilityMapForIndex>
  if (!parsed.corpus || !isStringArray(parsed.corpus.files)) {
    throw new Error("Traceability Map corpus.files must be an array of paths")
  }
  if (!Array.isArray(parsed.links)) throw new Error("Traceability Map links must be an array")
  for (const [index, link] of parsed.links.entries()) {
    if (
      !link ||
      typeof link.scenario !== "string" ||
      typeof link.testFile !== "string" ||
      typeof link.testName !== "string" ||
      (link.kind !== "asserts" && link.kind !== "covers-partially")
    ) {
      throw new Error(`Traceability Map links[${index}] is invalid`)
    }
  }
  return parsed as TraceabilityMapForIndex
}

export function deriveTestIndex(map: TraceabilityMapForIndex): {
  testedBy: string[]
  testFiles: string[]
} {
  return {
    testedBy: [...new Set(map.links.map((link) => link.scenario))].sort(),
    testFiles: [...new Set(map.corpus.files)].sort(),
  }
}

function parseFeatureGraph(feature: string): { graph: FeatureGraph; start: number; end: number } {
  const match = /```graph\r?\n([\s\S]*?)\r?\n```/.exec(feature)
  if (!match || match.index === undefined) throw new Error(`${FEATURE_PATH} has no graph code block`)
  const graph = JSON.parse(match[1]!) as FeatureGraph
  if (typeof graph.node_id !== "string") throw new Error(`${FEATURE_PATH} graph.node_id is missing`)
  return { graph, start: match.index, end: match.index + match[0].length }
}

function renderFeature(feature: string, testedBy: string[], testFiles: string[]): {
  text: string
  graph: FeatureGraph
} {
  const parsed = parseFeatureGraph(feature)
  const graph = { ...parsed.graph, tested_by: testedBy, test_files: testFiles }
  const block = `\`\`\`graph\n${JSON.stringify(graph, null, 2)}\n\`\`\``
  return {
    text: feature.slice(0, parsed.start) + block + feature.slice(parsed.end),
    graph,
  }
}

function renderDigest(digest: string): string {
  const line = `- Typecheck pin: \`${PINNED_TYPECHECK_COMMAND}\` (TypeScript 5.8.2 from the lockfile).`
  const existing = /^- Typecheck pin:.*$/m
  if (existing.test(digest)) return digest.replace(existing, line)

  const commands = /^(- Commands:.*)$/m
  if (!commands.test(digest)) throw new Error(`${DIGEST_PATH} TESTS section has no Commands line`)
  return digest.replace(commands, `$1\n${line}`)
}

function loadDocumentGraph(raw: string): DocumentGraph {
  const graph = JSON.parse(raw) as Partial<DocumentGraph>
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error(`${GRAPH_PATH} must contain nodes and edges arrays`)
  }
  return graph as DocumentGraph
}

function renderDocumentGraph(raw: string): { graph: DocumentGraph; text: string } {
  const current = loadDocumentGraph(raw)
  const byPath = new Map(current.nodes.map((node) => [node.path, node]))
  for (const node of PRD_NODES) byPath.set(node.path, { ...node, tags: [...node.tags] })
  const graph: DocumentGraph = {
    nodes: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
    edges: [...current.edges].sort((a, b) =>
      `${a.source}\0${a.target}\0${a.relation}`.localeCompare(`${b.source}\0${b.target}\0${b.relation}`),
    ),
  }
  return { graph, text: `${JSON.stringify(graph)}\n` }
}

export function reconcileDocuments(
  map: TraceabilityMapForIndex,
  feature: string,
  digest: string,
  graphText: string,
): RenderedDocuments {
  const index = deriveTestIndex(map)
  const renderedFeature = renderFeature(feature, index.testedBy, index.testFiles)
  const renderedGraph = renderDocumentGraph(graphText)
  return {
    feature: renderedFeature.text,
    featureGraph: renderedFeature.graph,
    digest: renderDigest(digest),
    graphText: renderedGraph.text,
    graph: renderedGraph.graph,
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function diffIndex(
  expected: RenderedDocuments,
  actualFeature: string,
  actualDigest: string,
  actualGraphText: string,
): DocumentationDrift[] {
  const actualFeatureGraph = parseFeatureGraph(actualFeature).graph
  const actualGraph = loadDocumentGraph(actualGraphText)
  const drifts: DocumentationDrift[] = []
  const add = (file: string, field: string, wanted: unknown, actual: unknown): void => {
    if (!same(wanted, actual)) drifts.push({ file, field, expected: wanted, actual })
  }

  add(FEATURE_PATH, "graph.tested_by", expected.featureGraph.tested_by, actualFeatureGraph.tested_by)
  add(FEATURE_PATH, "graph.test_files", expected.featureGraph.test_files, actualFeatureGraph.test_files)

  const expectedLine = expected.digest.match(/^- Typecheck pin:.*$/m)?.[0] ?? null
  const actualLine = actualDigest.match(/^- Typecheck pin:.*$/m)?.[0] ?? null
  add(DIGEST_PATH, "tests.typecheck", expectedLine, actualLine)
  if (actualDigest.includes("tsconfig.check.json")) {
    drifts.push({
      file: DIGEST_PATH,
      field: "tests.deleted_typecheck_route",
      expected: null,
      actual: "tsconfig.check.json",
    })
  }

  const requiredPaths = new Set(PRD_NODES.map((node) => node.path))
  const expectedPrds = expected.graph.nodes.filter((node) => requiredPaths.has(node.path))
  const actualPrds = actualGraph.nodes.filter((node) => requiredPaths.has(node.path))
  add(GRAPH_PATH, "nodes.prd", expectedPrds, actualPrds)
  return drifts
}

export function formatDrift(drift: DocumentationDrift): string {
  return `DocumentationDriftDetected ${JSON.stringify(drift)}`
}

function main(): void {
  const root = repoRoot()
  const read = (path: string): string => readFileSync(join(root, path), "utf8")
  const map = loadTraceabilityMapForIndex(read(MAP_PATH))
  const feature = read(FEATURE_PATH)
  const digest = read(DIGEST_PATH)
  const graphText = read(GRAPH_PATH)
  const expected = reconcileDocuments(map, feature, digest, graphText)
  const drifts = diffIndex(expected, feature, digest, graphText)

  if (process.argv.includes("--check")) {
    if (drifts.length === 0) {
      console.log("Test Index reconciliation: PASS")
      return
    }
    for (const drift of drifts) console.error(formatDrift(drift))
    process.exitCode = 1
    return
  }

  writeFileSync(join(root, FEATURE_PATH), expected.feature)
  writeFileSync(join(root, DIGEST_PATH), expected.digest)
  writeFileSync(join(root, GRAPH_PATH), expected.graphText)
  console.log(`Test Index reconciliation: wrote ${FEATURE_PATH}, ${DIGEST_PATH}, ${GRAPH_PATH}`)
}

if (import.meta.main) main()
