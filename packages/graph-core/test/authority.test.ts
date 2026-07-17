import { expect, test } from "bun:test"
import { canFlip, getAuthority, setAuthority, type FlipChecks } from "../src/authority"
import type { Graph } from "../src/build"

// QA-4 DoD item 1: canFlip + authority semantics — the exact surface mcp-server's gates.ts
// (authority.flip's final gate) consumes. Permitted/denied/invalid cases.

const OK: FlipChecks = { coverageBalanced: true, verifyClean: true, roundtripOk: true }

test("canFlip: permitted when all three checks pass", () => {
  const r = canFlip(OK)
  expect(r.ok).toBe(true)
  expect(r.reasons).toEqual([])
})

test("canFlip: denied — coverage not balanced", () => {
  const r = canFlip({ ...OK, coverageBalanced: false })
  expect(r.ok).toBe(false)
  expect(r.reasons).toEqual(["cell coverage not closed — nodes without claims in the cell"])
})

test("canFlip: denied — verify not clean", () => {
  const r = canFlip({ ...OK, verifyClean: false })
  expect(r.ok).toBe(false)
  expect(r.reasons).toEqual(["graphverify red — integrity breaches present"])
})

test("canFlip: denied — roundtrip not ok", () => {
  const r = canFlip({ ...OK, roundtripOk: false })
  expect(r.ok).toBe(false)
  expect(r.reasons).toEqual(["roundtrip red — ladder violations present"])
})

test("canFlip: denied — all three checks fail, one named reason each", () => {
  const r = canFlip({ coverageBalanced: false, verifyClean: false, roundtripOk: false })
  expect(r.ok).toBe(false)
  expect(r.reasons).toHaveLength(3)
})

function minimalGraph(authority?: Record<string, "graph" | "suspended">): Graph {
  return {
    schemaVersion: 1,
    repo: "/tmp/fake",
    generatedAt: new Date().toISOString(),
    nodes: [],
    edges: [],
    stats: { nodes: 0, edges: 0, claims: 0, domains: 0 },
    authority,
  } as unknown as Graph
}

test("getAuthority: absent key defaults to source (α)", () => {
  expect(getAuthority(minimalGraph(), "auth:4")).toBe("source")
})

test("getAuthority: reflects an explicitly stored value", () => {
  expect(getAuthority(minimalGraph({ "auth:4": "graph" }), "auth:4")).toBe("graph")
})

test("setAuthority: setting to graph stores the key", () => {
  const g = setAuthority(minimalGraph(), "auth:4", "graph")
  expect(g.authority).toEqual({ "auth:4": "graph" })
})

test("setAuthority: setting back to source DELETES the key (keeps graph.json lean, not just overwrites)", () => {
  const g = setAuthority(minimalGraph({ "auth:4": "graph" }), "auth:4", "source")
  expect(g.authority).toEqual({})
  expect(getAuthority(g, "auth:4")).toBe("source") // absent → default, same observable result either way
})

test("setAuthority: returns a NEW graph, does not mutate the input", () => {
  const g0 = minimalGraph()
  const g1 = setAuthority(g0, "auth:4", "graph")
  expect(g0.authority).toBeUndefined()
  expect(g1).not.toBe(g0)
})
