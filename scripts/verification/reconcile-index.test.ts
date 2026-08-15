/**
 * F002 task 21 — generated Test Index and documentation reconciliation gate.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  DIGEST_PATH,
  FEATURE_PATH,
  GRAPH_PATH,
  deriveTestIndex,
  diffIndex,
  loadTraceabilityMapForIndex,
  reconcileDocuments,
  repoRoot,
} from "./reconcile-index"

const ROOT = repoRoot()
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8")
const map = () => loadTraceabilityMapForIndex(read("docs/verification/traceability-map.json"))

describe("Test Index — derived truth", () => {
  test("derives tested_by and every EAP test file from the Traceability Map", () => {
    const expected = deriveTestIndex(map())
    const scenarios = [...new Set(map().links.map((link) => link.scenario))].sort()

    expect(expected.testedBy).toEqual(scenarios)
    expect(expected.testFiles).toEqual([...map().corpus.files].sort())
    expect(expected.testedBy.length).toBeGreaterThan(0)
  })

  test("uses all five post-rename retry files plus transport and validation evidence", () => {
    const files = deriveTestIndex(map()).testFiles
    expect(files).toContain("packages/mcp-server/test/epistemic-state-durability-and-bounds.test.ts")
    expect(files).toContain("packages/mcp-server/test/epistemic-write-atomicity-and-authz.test.ts")
    expect(files).toContain("packages/mcp-server/test/read-model-projection-and-freshness.test.ts")
    expect(files).toContain("packages/mcp-server/test/recall-closure-gate.test.ts")
    expect(files).toContain("packages/mcp-server/test/recall-resume-and-closure-index.test.ts")
    expect(files).toContain("packages/mcp-server/test/f001-transport-delegation.test.ts")
    expect(files).toContain("packages/mcp-server/test/f001-validation-audit-vulns.test.ts")
    expect(files.some((file) => file.includes("f001-retry"))).toBe(false)
  })
})

describe("Documentation reconciliation", () => {
  const committedFeature = read(FEATURE_PATH)
  const committedDigest = read(DIGEST_PATH)
  const committedGraph = read(GRAPH_PATH)

  test("renders map-derived fields, the pinned typecheck route, and both normative PRD nodes", () => {
    const rendered = reconcileDocuments(map(), committedFeature, committedDigest, committedGraph)
    const expected = deriveTestIndex(map())

    expect(rendered.featureGraph.tested_by).toEqual(expected.testedBy)
    expect(rendered.featureGraph.test_files).toEqual(expected.testFiles)
    expect(rendered.digest).toContain("`bun run typecheck`")
    expect(rendered.digest).not.toContain("tsconfig.check.json")
    expect(rendered.graph.nodes.map((node) => node.path)).toContain(
      "docs/PRD/OpenGraph_Working_Paper_v1_0.md",
    )
    expect(rendered.graph.nodes.map((node) => node.path)).toContain("docs/PRD/PRD.md")
  })

  test("reports every drift with file, field, expected, and actual", () => {
    const staleFeature = committedFeature.replace(
      /  "tested_by": \[[\s\S]*?\],\n  "entrypoints":/,
      '  "tested_by": [],\n  "entrypoints":',
    )
    const staleDigest = committedDigest.replace(/^- Typecheck pin:.*\r?\n/m, "")
    const graph = JSON.parse(committedGraph) as { nodes: { path: string }[]; edges: unknown[] }
    graph.nodes = graph.nodes.filter((node) => !node.path.startsWith("docs/PRD/"))
    const staleGraph = `${JSON.stringify(graph)}\n`
    const rendered = reconcileDocuments(map(), staleFeature, staleDigest, staleGraph)
    const drifts = diffIndex(rendered, staleFeature, staleDigest, staleGraph)
    const staleTestedBy = drifts.find((drift) => drift.field === "graph.tested_by")

    expect(staleTestedBy).toMatchObject({ file: FEATURE_PATH, actual: [] })
    expect(staleTestedBy?.expected).toEqual(rendered.featureGraph.tested_by)
    expect(drifts.every((drift) => Object.keys(drift).sort().join(",") === "actual,expected,field,file")).toBe(true)
  })

  test("is byte-stable and clean after applying the rendered documents", () => {
    const first = reconcileDocuments(map(), committedFeature, committedDigest, committedGraph)
    const second = reconcileDocuments(map(), first.feature, first.digest, first.graphText)

    expect(second.feature).toBe(first.feature)
    expect(second.digest).toBe(first.digest)
    expect(second.graphText).toBe(first.graphText)
    expect(diffIndex(second, first.feature, first.digest, first.graphText)).toEqual([])
  })
})
