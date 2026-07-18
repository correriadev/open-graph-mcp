import { describe, expect, test } from "bun:test"
import type { Graph, GraphNode } from "@open-graph-mcp/graph-core/build"
import { CARD_H, CARD_W, toFlow } from "../src/flow/to-flow"

const node = (id: string, domain: string | null, level: GraphNode["level"]): GraphNode =>
  ({ id, domain, level, kind: "function", file: `${id}.ts`, anchor: id, responsibility: "", claims: [], confidence: null, overclaim: false, exposed: false }) as unknown as GraphNode

const graph = (nodes: GraphNode[], edges: Graph["edges"] = []): Graph =>
  ({ nodes, edges, stats: { nodes: nodes.length, edges: edges.length, claims: 0, domains: 0 } }) as Graph

describe("toFlow", () => {
  test("determinístico e sem sobreposição dentro da cell", () => {
    const nodes = Array.from({ length: 9 }, (_, i) => node(`n${i}`, "auth", "P2"))
    const a = toFlow(graph(nodes))
    const b = toFlow(graph([...nodes].reverse())) // ordem de entrada não importa
    expect(a.nodes.map((n) => [n.id, n.position])).toEqual(b.nodes.map((n) => [n.id, n.position]))

    const seen = new Set<string>()
    for (const n of a.nodes) {
      const key = `${n.position.x},${n.position.y}`
      expect(seen.has(key)).toBe(false) // grade: nenhuma posição repetida
      seen.add(key)
    }
    // cards adjacentes na grade distam pelo menos o tamanho do card
    const xs = [...new Set(a.nodes.map((n) => n.position.x))].sort((p, q) => p - q)
    const ys = [...new Set(a.nodes.map((n) => n.position.y))].sort((p, q) => p - q)
    if (xs.length > 1) expect(xs[1]! - xs[0]!).toBeGreaterThanOrEqual(CARD_W)
    if (ys.length > 1) expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(CARD_H)
  })

  test("domínios em bandas x distintas; nível controla banda y", () => {
    const g = graph([node("a", "auth", "P1"), node("b", "billing", "P1"), node("c", "auth", "P3"), node("d", null, "P1")])
    const { nodes } = toFlow(g)
    const pos = Object.fromEntries(nodes.map((n) => [n.id, n.position]))
    expect(pos.a!.x).toBeLessThan(pos.b!.x) // auth < billing (alfabético)
    expect(pos.b!.x).toBeLessThan(pos.d!.x) // null vai na última banda
    expect(pos.a!.y).toBeLessThan(pos.c!.y) // P1 acima de P3
  })

  test("edge com ponta desconhecida é filtrada", () => {
    const g = graph([node("a", "auth", "P1")], [
      { type: "depends-on", from: "a", to: "ghost" },
      { type: "refs", from: "a", to: "a" },
    ] as Graph["edges"])
    expect(toFlow(g).edges.map((e) => e.id)).toEqual(["refs:a→a"])
  })
})
