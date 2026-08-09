/**
 * graph-impact-cursor.test.ts — resíduo §7.5 de docs/roadmap-server-beta/01-evidencias-fluxo-completo.md:
 * `graph.impact` cortava em `limit` sem mentir sobre o total, mas não havia como pedir o resto.
 *
 * Mesma fixture `impact-chain` do graph-impact.test.ts: billing/invoice.ts → auth/verify.ts →
 * auth/login.ts. Com depth 2 a partir de login há 2 dependentes; `limit: 1` força paginação real sem
 * precisar de repo grande.
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, tempRepo, bootstrapAs } from "./helpers"

const IMPACT_CHAIN_DOMAINS = [
  { pattern: "auth/*", domain: "auth" },
  { pattern: "billing/*", domain: "billing" },
] as const

test("cursor pagina dependents sem repetir nem pular, e termina em nextCursor null", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root)
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const args: any = cursor === null ? { id: "auth/login.ts", depth: 2, limit: 1 } : { cursor }
      const r = await callTool(s.url, "graph.impact", args)
      // O total real nunca depende da página: 2 dependentes em depth 2, sempre.
      expect(r.totalDependents).toBe(2)
      for (const h of r.dependents) seen.push(h.id)
      cursor = r.nextCursor
      pages++
      expect(pages).toBeLessThan(10) // laço de paginação não pode girar para sempre
    } while (cursor !== null)

    // União exata das páginas = o conjunto completo, sem duplicata.
    expect(seen.sort()).toEqual(["auth/verify.ts", "billing/invoice.ts"])
    expect(new Set(seen).size).toBe(seen.length)
  } finally {
    s.stop()
    cleanup()
  }
})

test("primeira página preserva o contrato antigo: truncated true e cursor presente", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root)
    const r = await callTool(s.url, "graph.impact", { id: "auth/login.ts", depth: 2, limit: 1 })
    expect(r.dependents.length).toBe(1)
    // Ordenação determinística: depth crescente — o salto direto vem primeiro, sempre.
    expect(r.dependents[0].id).toBe("auth/verify.ts")
    expect(r.dependentsTruncated).toBe(true)
    expect(typeof r.nextCursor).toBe("string")
  } finally {
    s.stop()
    cleanup()
  }
})

test("resultado que cabe inteiro numa página não emite cursor", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root)
    const r = await callTool(s.url, "graph.impact", { id: "auth/login.ts", depth: 2 })
    expect(r.dependentsTruncated).toBe(false)
    expect(r.nextCursor).toBe(null)
  } finally {
    s.stop()
    cleanup()
  }
})

test("nó inexistente devolve gap e nenhum cursor — não convida a paginar o vazio", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root)
    const r = await callTool(s.url, "graph.impact", { id: "nao/existe.ts" })
    expect(r.gaps.length).toBe(1)
    expect(r.nextCursor).toBe(null)
  } finally {
    s.stop()
    cleanup()
  }
})

test("cursor corrompido é erro nomeado, nunca um reinício silencioso da paginação", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root)
    for (const bad of ["", "nao-e-base64!!", Buffer.from('{"i":"x"}', "utf8").toString("base64url")]) {
      await expect(callTool(s.url, "graph.impact", { cursor: bad })).rejects.toThrow(/cursor/)
    }
  } finally {
    s.stop()
    cleanup()
  }
})

test("mudar a pergunta junto com o cursor é erro, não reparametrização silenciosa", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root)
    const first = await callTool(s.url, "graph.impact", { id: "auth/login.ts", depth: 2, limit: 1 })
    expect(first.nextCursor).toBeTruthy()
    await expect(callTool(s.url, "graph.impact", { cursor: first.nextCursor, depth: 1 })).rejects.toThrow(/depth/)
    // Reenviar os MESMOS valores junto com o cursor é legítimo — não é divergência.
    const same = await callTool(s.url, "graph.impact", { cursor: first.nextCursor, id: "auth/login.ts", depth: 2, limit: 1 })
    expect(same.dependents[0].id).toBe("billing/invoice.ts")
  } finally {
    s.stop()
    cleanup()
  }
})

test("cursor forjado não escapa do teto de limit", async () => {
  const { root, cleanup } = tempRepo("impact-chain")
  const s = startServer({ repoPath: root, watch: false, domains: IMPACT_CHAIN_DOMAINS })
  try {
    await bootstrapAs(s.url, root)
    const forged = Buffer.from(JSON.stringify({ i: "auth/login.ts", d: 2, l: 100000 }), "utf8").toString("base64url")
    await expect(callTool(s.url, "graph.impact", { cursor: forged })).rejects.toThrow(/cursor/)
  } finally {
    s.stop()
    cleanup()
  }
})
