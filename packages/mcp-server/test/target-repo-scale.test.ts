/**
 * target-repo-scale.test.ts — QA-7 Fase 2: mcp-server bootstrap/query em escala contra o
 * repo-alvo real (harness-kit, ~186 arquivos-fonte), não a fixture mínima `fresh/` que os
 * outros 39 arquivos de teste usam. Servidor real, sem mocks — mesmos padrões de
 * bootstrap-fresh.test.ts / query.test.ts / resources.test.ts.
 *
 * Guarda: se o repo-alvo não existir localmente, todo describe abaixo faz skip com motivo
 * explícito (ver fixtures/target-repo.ts) — nunca falha por ambiente ausente.
 *
 * §0 do plano (docs/CHANGELOG.md) dizia que `edges: 0` era a asserção correta. Isso valia
 * enquanto buildSkeleton gravava `deps: []` fixo. Desde que o esqueleto passou a extrair imports
 * relativos (extract.ts — determinístico, sem LLM), ARESTAS são esperadas e sua ausência é
 * regressão. O que segue valendo de §0: `claims: 0`, porque claim com subject/verdict é trabalho
 * de agente LLM (Pass A/B/C) e não do piso determinístico.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, readResource, bootstrapAs, rebuildAs } from "./helpers"
import { prepareTargetRepo, targetRepoAvailable, targetRepoPath, TARGET_DOMAINS } from "./fixtures/target-repo"

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".md"])
const DEFAULT_IGNORE = ["node_modules", ".next", "dist", "build", ".git", ".graph"]

/** Mesma poda + seleção de graph-bootstrap.ts::walkSource, reimplementada localmente (não é
 *  exportada de lá) — usada só para calcular a contagem esperada de nós EM RUNTIME, nunca um
 *  número mágico fixo (o repo-alvo pode mudar). */
function expectedIndexedNodeCount(root: string): number {
  let count = 0
  const walk = (dir: string) => {
    let entries: import("node:fs").Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      if (DEFAULT_IGNORE.includes(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile() && SOURCE_EXT.has(path.extname(e.name))) {
        // indexRepo só cria um nó se houver âncora (1a linha não-vazia) — arquivo
        // vazio não conta.
        let content: string
        try {
          content = readFileSync(full, "utf8")
        } catch {
          continue
        }
        if (content.replace(/\r\n/g, "\n").split("\n").some((l) => l.trim())) count++
      }
    }
  }
  walk(root)
  return count
}

describe.skipIf(!targetRepoAvailable())(`mcp-server bootstrap/query em escala (${targetRepoPath()})`, () => {
  test("graph.bootstrap indexa o repo e persiste no tenant, com stats.nodes derivado em runtime", async () => {
    const { root, cleanup } = prepareTargetRepo()
    try {
      const expectedNodes = expectedIndexedNodeCount(root)
      expect(expectedNodes).toBeGreaterThan(100) // repo-alvo tem ~186 arquivos-fonte

      const s = startServer({ repoPath: root, watch: false, domains: TARGET_DOMAINS })
      try {
        const boot = await bootstrapAs(s.url, root)
        expect(boot.stats.pipeline).toBe("indexed")
        expect(boot.stats.nodes).toBe(expectedNodes)
        // ARESTAS: o esqueleto extrai imports relativos (extract.ts, determinístico) e os resolve
        // p/ ids conhecidos — um repo TS real tem centenas. Era `toBe(0)` enquanto buildSkeleton
        // gravava `deps: []` fixo; hoje 0 aresta num repo com 131 .ts significaria regressão da
        // extração, não "esqueleto honesto".
        expect(boot.stats.edges).toBeGreaterThan(100)
        // toda aresta do esqueleto aponta p/ um nó conhecido: `resolveRelative` descarta o que não
        // casa, então nenhuma ref pendurada deve escapar.
        const graphAfterBoot = (await readResource(s.url, "graph://snapshot")).graph
        expect(graphAfterBoot.edges.every((e: { resolved?: boolean; type: string }) => e.type !== "depends-on" || e.resolved === true)).toBe(true)
        // CLAIMS: seguem 0 e isso É a asserção correta — claims com subject/verdict são trabalho de
        // agente LLM (Pass A/B/C), não do piso determinístico. Ver §0 do plano QA-7.
        expect(boot.stats.claims).toBe(0)

        const snap = await readResource(s.url, "graph://snapshot")
        expect(snap.graph.stats.nodes).toBe(expectedNodes)
        expect(snap.graph.nodes).toHaveLength(expectedNodes)

        // domínio explícito (via StartOptions.domains — config do servidor) realmente aplicado:
        // pelo menos um nó por domínio esperado, e nenhum id com separador Windows vazando.
        const byDomain = new Map<string, number>()
        for (const n of snap.graph.nodes) byDomain.set(n.domain ?? "(null)", (byDomain.get(n.domain ?? "(null)") ?? 0) + 1)
        for (const rule of TARGET_DOMAINS) expect(byDomain.get(rule.domain) ?? 0).toBeGreaterThan(0)
        expect(snap.graph.nodes.every((n: { id: string }) => !n.id.includes("\\"))).toBe(true)
      } finally {
        s.stop()
      }
    } finally {
      cleanup()
    }
  })

  test("idempotência: reindexar conteúdo inalterado mantém graphId e não emite evento; adicionar ou EDITAR um arquivo muda o graphId", async () => {
    const { root, cleanup } = prepareTargetRepo()
    try {
      const s = startServer({ repoPath: root, watch: false, domains: TARGET_DOMAINS })
      try {
        const boot1 = await bootstrapAs(s.url, root)
        const historyAfterFirst = await readResource(s.url, "graph://history?limit=500")
        const countBootstrapEvents = (events: any[]) => events.filter((e) => e.kind === "graph.bootstrapped").length
        const before = countBootstrapEvents(historyAfterFirst.events)

        const boot2 = await bootstrapAs(s.url, root)
        expect(boot2.graphId).toBe(boot1.graphId)
        expect(boot2.stats.pipeline).toBe("indexed")
        const historyAfterSecond = await readResource(s.url, "graph://history?limit=500")
        expect(countBootstrapEvents(historyAfterSecond.events)).toBe(before) // idempotente: nenhum evento novo

        // arquivo NOVO → conjunto de nós muda → graphId muda
        const target = path.join(root, "sdk", "src")
        writeFileSync(path.join(target, "qa7-drift-marker.ts"), "export const qa7DriftMarker = true\n")
        const boot3 = await bootstrapAs(s.url, root)
        expect(boot3.stats.nodes).toBe(boot1.stats.nodes + 1)
        expect(boot3.graphId).not.toBe(boot1.graphId)

        // EDITAR um arquivo existente (sem mudar o conjunto de nós) também muda o graphId, porque
        // a âncora entra no graphChecksum. Era a lacuna registrada aqui antes: o checksum só via
        // ids/arestas/authority, então editar conteúdo devolvia o MESMO graphId e o servidor
        // mantinha em memória o grafo antigo — disco e memória divergiam em silêncio.
        writeFileSync(path.join(target, "qa7-drift-marker.ts"), "// âncora nova\nexport const qa7DriftMarker = true\n")
        const boot4 = await bootstrapAs(s.url, root)
        expect(boot4.stats.nodes).toBe(boot3.stats.nodes) // mesmo conjunto de arquivos
        expect(boot4.graphId).not.toBe(boot3.graphId)
      } finally {
        s.stop()
      }
    } finally {
      cleanup()
    }
  })

  /**
   * Substitui "bootstrap existing: .graph/graph.json já presente → pipeline existing". Reindexar
   * SUBSTITUI as linhas do tenant em vez de acumulá-las — sem isto, cada reindexação duplicaria
   * 186 nós e 376 arestas no banco.
   */
  test("reindexar substitui as linhas do tenant, não acumula", async () => {
    const { root, cleanup } = prepareTargetRepo()
    try {
      const s = startServer({ repoPath: root, watch: false, domains: TARGET_DOMAINS })
      try {
        const boot = await bootstrapAs(s.url, root)
        const count = (table: string) => (s.state.db.query(`SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id = ?`).get("default") as { c: number }).c
        expect(count("nodes")).toBe(boot.stats.nodes)
        expect(count("edges")).toBe(boot.stats.edges)

        writeFileSync(path.join(root, "sdk", "src", "qa7-extra.ts"), "export const extra = 1\n")
        const again = await bootstrapAs(s.url, root)
        expect(count("nodes")).toBe(again.stats.nodes) // substituído, não somado
        expect(count("edges")).toBe(again.stats.edges)
      } finally {
        s.stop()
      }
    } finally {
      cleanup()
    }
  })

  /**
   * Substitui "graph.json truncado → corrupt": não há mais graph.json p/ corromper. O invariante
   * que ficou no lugar é mais forte e é a razão desta mudança inteira (ADR D1) — indexar um repo
   * de 186 arquivos não deixa NADA para trás nele.
   */
  test("indexar não escreve NADA no repo-alvo", async () => {
    const { root, cleanup } = prepareTargetRepo()
    try {
      const before = readdirSync(root).sort()
      const s = startServer({ repoPath: root, watch: false, domains: TARGET_DOMAINS })
      try {
        const boot = await bootstrapAs(s.url, root)
        expect(boot.stats.nodes).toBeGreaterThan(100)
        expect(existsSync(path.join(root, ".graph"))).toBe(false)
        expect(readdirSync(root).sort()).toEqual(before) // nem um arquivo a mais na raiz
      } finally {
        s.stop()
      }
    } finally {
      cleanup()
    }
  })

  test("graph.query e resources (graph://snapshot, graph://cell, graph://domain) sobre os domínios reais do repo-alvo", async () => {
    const { root, cleanup } = prepareTargetRepo()
    try {
      const s = startServer({ repoPath: root, watch: false, domains: TARGET_DOMAINS })
      try {
        await bootstrapAs(s.url, root)
        const snap = await readResource(s.url, "graph://snapshot")

        // deriva a célula real (domínio:level) do próprio grafo publicado, em vez de assumir um
        // level fixo — classify.ts pode mudar a torre P1-P5 de um arquivo sem que este teste minta.
        const sdkNode = snap.graph.nodes.find((n: any) => n.domain === "sdk")
        expect(sdkNode).toBeDefined()
        const cellKey = `sdk:${String(sdkNode.level).replace(/^P/, "")}`
        const cell = await readResource(s.url, `graph://cell/${cellKey}`)
        expect(cell.cell).toBe(cellKey)
        expect(cell.nodeCount).toBeGreaterThan(0)
        expect(cell.nodeCount).toBe(snap.graph.nodes.filter((n: any) => n.domain === "sdk" && String(n.level) === sdkNode.level).length)

        const domainView = await readResource(s.url, "graph://domain/sdk")
        expect(domainView.domain).toBe("sdk")
        expect(domainView.cells.length).toBeGreaterThan(0)
        expect(domainView.cells.reduce((sum: number, c: any) => sum + c.nodeCount, 0)).toBe(snap.graph.nodes.filter((n: any) => n.domain === "sdk").length)

        // graph.query real: termo presente em vários nomes de arquivo do sdk (ex.: "index")
        const hit = await callTool(s.url, "graph.query", { terms: ["index"] })
        expect(hit.candidates.length).toBeGreaterThan(0)
      } finally {
        s.stop()
      }
    } finally {
      cleanup()
    }
  })

  test("paginação graph://claims atravessa a fronteira de 100 (default limit) com nextCursor + hasMore", async () => {
    const { root, cleanup } = prepareTargetRepo()
    try {
      const s = startServer({ repoPath: root, watch: false, domains: TARGET_DOMAINS })
      try {
        await bootstrapAs(s.url, root)
        // O esqueleto fresh não gera claims (§0) — para exercitar a paginação de verdade (default
        // 100, max 500) usamos os domínios REAIS do repo-alvo como base de 150 claims sintéticos,
        // igual ao padrão já usado em query.test.ts / resources.test.ts (insert direto no SQLite).
        const insert = s.state.db.query(
          "INSERT INTO claims (tenant_id,id,seq,subject,domain,level,refs,anchor) VALUES (?,?,?,?,?,?,?,?)",
        )
        for (let i = 1; i <= 150; i++) insert.run("default", `qa7-${i}`, i, `s${i}`, "sdk", "P4", "[]", "")

        const page1 = await readResource(s.url, "graph://claims?scope=snapshot")
        expect(page1.claims.length).toBe(100) // default limit
        expect(page1.hasMore).toBe(true)
        expect(page1.nextCursor).toBe(100)

        const page2 = await readResource(s.url, `graph://claims?scope=snapshot&since=${page1.nextCursor}`)
        expect(page2.claims.length).toBe(50) // resto dos 150
        expect(page2.hasMore).toBe(false)

        const seen = new Set([...page1.claims, ...page2.claims].map((c: any) => c.id))
        expect(seen.size).toBe(150)

        // max limit=500 é aceito, limit>500 é rejeitado (contrato de resources.ts)
        const wide = await readResource(s.url, "graph://claims?scope=snapshot&limit=500")
        expect(wide.claims.length).toBe(150)
        await expect(readResource(s.url, "graph://claims?scope=snapshot&limit=501")).rejects.toThrow()

        const cellPage = await readResource(s.url, "graph://claims?cell=sdk:P4")
        expect(cellPage.claims.length).toBe(100)
        expect(cellPage.hasMore).toBe(true)
      } finally {
        s.stop()
      }
    } finally {
      cleanup()
    }
  })

  test("graph.rebuild re-lê .graph/ do disco e re-emite snapshot", async () => {
    const { root, cleanup } = prepareTargetRepo()
    try {
      const s = startServer({ repoPath: root, watch: false, domains: TARGET_DOMAINS })
      try {
        const boot = await bootstrapAs(s.url, root)
        const rebuilt = await rebuildAs(s.url)
        expect(rebuilt.ok).toBe(true)
        expect(rebuilt.stats.nodes).toBe(boot.stats.nodes)

        const history = await readResource(s.url, "graph://history?limit=500")
        expect(history.events.some((e: any) => e.kind === "graph.rebuilt")).toBe(true)

        const snap = await readResource(s.url, "graph://snapshot")
        expect(snap.graph.stats.nodes).toBe(boot.stats.nodes)
      } finally {
        s.stop()
      }
    } finally {
      cleanup()
    }
  })
})
