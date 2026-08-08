/**
 * graph-impact.test.ts — F5 (docs/roadmap-server-beta/01-evidencias-fluxo-completo.md): "o que
 * quebra se eu mexer neste arquivo?" via traversal de `depends-on`, não match de token.
 *
 * Fixture `impact-chain`: billing/invoice.ts → auth/verify.ts → auth/login.ts (import relativo,
 * cadeia de 2 saltos — dá para exercitar depth=1 vs depth=2 de verdade). Domínios: auth/* → auth,
 * billing/* → billing.
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, tempRepo, bootstrapAs, register } from "./helpers"
import { MAX_IMPACT_LIMIT } from "../src/tools/graph-impact"

const IMPACT_CHAIN_DOMAINS = [
  { pattern: "auth/*", domain: "auth" },
  { pattern: "billing/*", domain: "billing" },
] as const

test("dependente direto: quem quebra se auth/login.ts mudar (depth default 1)", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root)
    const r = await callTool(s.url, "graph.impact", { id: "auth/login.ts" })
    expect(r.gaps).toEqual([])
    expect(r.dependents.map((h: any) => h.id)).toEqual(["auth/verify.ts"])
    // billing/invoice.ts é transitivo (2 saltos) — não deve aparecer em depth 1.
    expect(r.dependents.some((h: any) => h.id === "billing/invoice.ts")).toBe(false)
  } finally {
    s.stop()
    cleanup()
  }
})

test("direção correta: dependents != dependencies", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root)
    const r = await callTool(s.url, "graph.impact", { id: "auth/verify.ts" })
    // verify é dependência de invoice (invoice depende de verify) — invoice é DEPENDENTE de verify.
    expect(r.dependents.map((h: any) => h.id)).toEqual(["billing/invoice.ts"])
    // verify DEPENDE de login — login é DEPENDÊNCIA de verify, nunca dependente.
    expect(r.dependencies.map((h: any) => h.id)).toEqual(["auth/login.ts"])
    expect(r.dependents.map((h: any) => h.id)).not.toEqual(r.dependencies.map((h: any) => h.id))
  } finally {
    s.stop()
    cleanup()
  }
})

test("transitivo: depth 2 alcança billing/invoice.ts a partir de auth/login.ts", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root)
    const r = await callTool(s.url, "graph.impact", { id: "auth/login.ts", depth: 2 })
    const ids = r.dependents.map((h: any) => h.id)
    expect(ids).toContain("auth/verify.ts")
    expect(ids).toContain("billing/invoice.ts")
    const invoiceHit = r.dependents.find((h: any) => h.id === "billing/invoice.ts")
    expect(invoiceHit.depth).toBe(2)
    const verifyHit = r.dependents.find((h: any) => h.id === "auth/verify.ts")
    expect(verifyHit.depth).toBe(1)
  } finally {
    s.stop()
    cleanup()
  }
})

test("nó inexistente devolve gap explícito, não listas vazias silenciosas", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root)
    const r = await callTool(s.url, "graph.impact", { id: "nope/nothing.ts" })
    expect(r.dependents).toEqual([])
    expect(r.dependencies).toEqual([])
    expect(r.cells).toEqual([])
    expect(r.gaps.length).toBeGreaterThan(0)
    expect(r.gaps[0]).toContain("nope/nothing.ts")
  } finally {
    s.stop()
    cleanup()
  }
})

test("célula travada aparece com o holder", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root)
    const alice = await register(s.url, "alice")
    // auth/verify.ts é P4, domínio auth → célula "auth:4".
    const open = await callTool(s.url, "changeset.open", { token: alice.token, cells: ["auth:4"], intent: "editando verify" })
    expect(open.ok).toBe(true)

    const r = await callTool(s.url, "graph.impact", { id: "auth/login.ts" })
    const authCell = r.cells.find((c: any) => c.cell === "auth:4")
    expect(authCell).toBeDefined()
    expect(authCell.locked).toBe(true)
    expect(authCell.holder).toBe(alice.userId)
    expect(authCell.holderName).toBe("alice")
  } finally {
    s.stop()
    cleanup()
  }
})

test("isolamento por tenant: impacto de um tenant não enxerga o grafo de outro", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root, "bootstrapper", "tenant-a")
    // tenant-b nunca bootstrapou — token válido, mas sem grafo publicado no seu tenant.
    const bob = await register(s.url, "bob", "tenant-b")
    await expect(callTool(s.url, "graph.impact", { id: "auth/login.ts", token: bob.token })).rejects.toThrow("not bootstrapped")

    // e o grafo do tenant-a responde normalmente com o próprio token.
    const alice = await register(s.url, "alice", "tenant-a")
    const r = await callTool(s.url, "graph.impact", { id: "auth/login.ts", token: alice.token })
    expect(r.gaps).toEqual([])
    expect(r.dependents.map((h: any) => h.id)).toEqual(["auth/verify.ts"])
  } finally {
    s.stop()
    cleanup()
  }
})

test("entrada inválida: id ausente/mal-tipado dá erro nomeado, não TypeError cru", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root)
    await expect(callTool(s.url, "graph.impact", {})).rejects.toThrow("graph.impact: id deve ser uma string não vazia")
    await expect(callTool(s.url, "graph.impact", { id: 42 })).rejects.toThrow("graph.impact: id deve ser uma string não vazia")
    await expect(callTool(s.url, "graph.impact", { id: "auth/login.ts", depth: 0 })).rejects.toThrow("graph.impact: depth deve ser um inteiro >= 1")
    await expect(callTool(s.url, "graph.impact", { id: "auth/login.ts", depth: "2" })).rejects.toThrow("graph.impact: depth deve ser um inteiro >= 1")
  } finally {
    s.stop()
    cleanup()
  }
})

test("teto de depth: um valor acima do máximo é clampado, não recusado", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root)
    const r = await callTool(s.url, "graph.impact", { id: "auth/login.ts", depth: 999 })
    expect(r.depth).toBeLessThanOrEqual(5)
  } finally {
    s.stop()
    cleanup()
  }
})

// ---------------------------------------------------------------------------
// `limit` — corte da resposta, não do trabalho de contar. Um hub com N dependentes precisa de mais nós
// que os testes por-fixture do topo do arquivo (impact-chain tem só 3 nós). Em vez de uma fixture de
// disco gigante, semeamos o grafo QUENTE direto em `s.state.graphs` — mesmo padrão de
// resources-cell-domain.test.ts::seedGraph — porque `impact()` só lê `tenantGraph(state, tenant).graph`,
// nunca toca disco.
//
// Topologia: HUB_LEAVES nós "leafNN" cada um numa célula PRÓPRIA (domain leafNN, level P5) e uma edge
// depends-on leafNN → hub (leafNN importa hub). Logo hub tem HUB_LEAVES dependentes E HUB_LEAVES células
// distintas atingidas — dá para testar corte de dependents/dependencies e de cells na mesma fixture.
// ---------------------------------------------------------------------------

const HUB_LEAVES = 10

function seedHubGraph(state: any) {
  const nodes = [
    { id: "hub", file: "hub.ts", domain: "hub", level: "P5", kind: "File", responsibility: "hub", exposed: false, confidence: null, overclaim: false, claims: [], anchor: "" },
    ...Array.from({ length: HUB_LEAVES }, (_, i) => {
      const n = String(i).padStart(2, "0")
      return {
        id: `leaf${n}`,
        file: `leaf${n}.ts`,
        domain: `leaf${n}`,
        level: "P5",
        kind: "File",
        responsibility: `leaf${n}`,
        exposed: false,
        confidence: null,
        overclaim: false,
        claims: [],
        anchor: "",
      }
    }),
  ]
  const edges = Array.from({ length: HUB_LEAVES }, (_, i) => ({ from: `leaf${String(i).padStart(2, "0")}`, to: "hub", type: "depends-on" as const }))
  state.graphs.set("default", {
    graph: {
      schemaVersion: 1 as const,
      repo: "fake",
      generatedAt: new Date().toISOString(),
      stats: { nodes: nodes.length, edges: edges.length, claims: 0, domains: nodes.length },
      nodes,
      edges,
    },
    graphId: "fake-hub-graph-id",
    pipeline: "indexed" as const,
    bootstrappedAt: new Date().toISOString(),
    repoPath: null,
  })
}

test("limit: corta dependents em N, mas totalDependents preserva a contagem real (maior que a lista)", async () => {
  const s = startServer()
  try {
    seedHubGraph(s.state)
    const r = await callTool(s.url, "graph.impact", { id: "hub", limit: 3 })
    expect(r.dependents.length).toBe(3)
    expect(r.totalDependents).toBe(HUB_LEAVES)
    expect(r.totalDependents).toBeGreaterThan(r.dependents.length)
    expect(r.dependentsTruncated).toBe(true)
  } finally {
    s.stop()
  }
})

test("limit: cells também é cortado, mas totalCells preserva a contagem real e o indicador de corte aparece", async () => {
  const s = startServer()
  try {
    seedHubGraph(s.state)
    const r = await callTool(s.url, "graph.impact", { id: "hub", limit: 3 })
    // hub:5 + HUB_LEAVES células leafNN:5 = HUB_LEAVES + 1 células atingidas ao todo.
    expect(r.totalCells).toBe(HUB_LEAVES + 1)
    expect(r.cells.length).toBe(3)
    expect(r.totalCells).toBeGreaterThan(r.cells.length)
    expect(r.cellsTruncated).toBe(true)
  } finally {
    s.stop()
  }
})

test("sem corte: quando total <= limit, truncated é false e a lista não muda de comportamento", async () => {
  const s = startServer()
  try {
    seedHubGraph(s.state)
    const r = await callTool(s.url, "graph.impact", { id: "hub", limit: HUB_LEAVES + 5 })
    expect(r.dependents.length).toBe(HUB_LEAVES)
    expect(r.totalDependents).toBe(HUB_LEAVES)
    expect(r.dependentsTruncated).toBe(false)
    expect(r.cellsTruncated).toBe(false)
  } finally {
    s.stop()
  }
})

test("ordem determinística: depth crescente primeiro, desempate por id — estável entre chamadas", async () => {
  const s = startServer()
  try {
    seedHubGraph(s.state)
    const r1 = await callTool(s.url, "graph.impact", { id: "hub", limit: 5 })
    const r2 = await callTool(s.url, "graph.impact", { id: "hub", limit: 5 })
    expect(r1.dependents.map((h: any) => h.id)).toEqual(r2.dependents.map((h: any) => h.id))
    // todos depth 1 aqui — desempate por id ascendente: leaf00..leaf04.
    expect(r1.dependents.map((h: any) => h.id)).toEqual(["leaf00", "leaf01", "leaf02", "leaf03", "leaf04"])
    expect(r1.dependents.every((h: any) => h.depth === 1)).toBe(true)
  } finally {
    s.stop()
  }
})

test("limit padrão (default 100) devolve a lista inteira sem corte quando total <= default", async () => {
  const s = startServer()
  try {
    seedHubGraph(s.state)
    const r = await callTool(s.url, "graph.impact", { id: "hub" })
    expect(r.limit).toBe(100)
    expect(r.dependents.length).toBe(HUB_LEAVES)
    expect(r.dependentsTruncated).toBe(false)
  } finally {
    s.stop()
  }
})

test("limit inválido: não-inteiro, < 1, ou acima do teto dá erro nomeado (erro, não clamp — diverge de depth de propósito)", async () => {
  const s = startServer()
  try {
    seedHubGraph(s.state)
    await expect(callTool(s.url, "graph.impact", { id: "hub", limit: 0 })).rejects.toThrow(`graph.impact: limit deve ser um inteiro entre 1 e ${MAX_IMPACT_LIMIT}`)
    await expect(callTool(s.url, "graph.impact", { id: "hub", limit: 1.5 })).rejects.toThrow(`graph.impact: limit deve ser um inteiro entre 1 e ${MAX_IMPACT_LIMIT}`)
    await expect(callTool(s.url, "graph.impact", { id: "hub", limit: "10" })).rejects.toThrow(`graph.impact: limit deve ser um inteiro entre 1 e ${MAX_IMPACT_LIMIT}`)
    await expect(callTool(s.url, "graph.impact", { id: "hub", limit: MAX_IMPACT_LIMIT + 1 })).rejects.toThrow(`graph.impact: limit deve ser um inteiro entre 1 e ${MAX_IMPACT_LIMIT}`)
  } finally {
    s.stop()
  }
})
