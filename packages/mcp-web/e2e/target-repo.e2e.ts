// target-repo.e2e.ts — a UI web contra o repo-alvo REAL (harness-kit: ~186 nós, ~376
// arestas, 6 domínios), não a fixture sintética de 2 domínios/6 arquivos que os outros
// specs usam. O plano QA-7 cobriu o backend em escala e deixou o web de fora por escopo;
// isto fecha esse buraco.
//
// O que só aparece nesta escala:
//   - a árvore lateral com domínios reais e níveis P1-P5 (a fixture só tem P4/P5)
//   - LOD de verdade: fitView sobre 186 nós começa em zoom baixo, não em "node"
//   - arestas depends-on renderizadas (a fixture não tem NENHUMA — deps: [])
//   - custo de primeiro render com o grafo inteiro montado
//
// Guarda: sem o repo-alvo local, todo o describe faz skip com motivo (fixtures/target-repo.ts).
import { expect, test } from "@playwright/test"
import { type Harness, startHarness } from "./fixture"
import { prepareTargetRepo, targetRepoAvailable, targetRepoPath, TARGET_DOMAINS } from "../../mcp-server/test/fixtures/target-repo"

const available = targetRepoAvailable()

test.describe(`web contra repo-alvo real (${targetRepoPath()})`, () => {
  test.skip(!available, `repo-alvo ausente — defina OG_TARGET_REPO ou clone harness-kit`)

  let h: Harness
  let repo: { root: string; cleanup: () => void }

  test.beforeAll(async () => {
    repo = prepareTargetRepo()
    // startHarness espalha serverOptions DEPOIS de `repoPath: <fixture sintética>`,
    // então passar repoPath aqui substitui a fixture pelo repo-alvo.
    h = await startHarness({ repoPath: repo.root, domains: TARGET_DOMAINS })
  })
  test.afterAll(async () => {
    await h?.stop()
    repo?.cleanup()
  })

  test("snapshot real chega inteiro no browser: nós, arestas e domínios do harness-kit", async ({ browser }) => {
    const snap = await h.readResource("graph://snapshot")
    const { nodes, edges, stats } = snap.graph

    // contagens derivadas do próprio snapshot — nunca número mágico (o repo-alvo pode mudar)
    expect(nodes.length).toBeGreaterThan(100)
    expect(edges.length).toBeGreaterThan(100) // regressão do piso determinístico de imports
    expect(stats.domains).toBe(new Set(nodes.map((n: { domain: string | null }) => n.domain).filter(Boolean)).size)

    const s = await h.openSession(browser, "alice")
    // canvas montou cards de verdade. Não dá p/ assertar count === nodes.length:
    // `onlyRenderVisibleElements` monta só o que está no viewport, e é justamente
    // isso que torna 186 nós viável — o número exato depende do zoom do fitView.
    await expect(s.page.locator(".og-card").first()).toBeVisible()
    expect(await s.page.locator(".og-card").count()).toBeGreaterThan(10)

    // containers de célula: um por cell real do grafo, desenhados atrás dos cards
    expect(await s.page.locator(".og-cell-container").count()).toBeGreaterThan(1)
  })

  test("árvore lateral lista os domínios reais e navega para uma célula", async ({ browser }) => {
    const s = await h.openSession(browser, "alice")
    const tree = s.page.locator("#sidebar-tree")
    await expect(tree).toBeVisible()

    // todo domínio de TARGET_DOMAINS que tem nó no grafo tem que aparecer na árvore
    const snap = await h.readResource("graph://snapshot")
    const present = new Set(snap.graph.nodes.map((n: { domain: string | null }) => n.domain).filter(Boolean))
    for (const rule of TARGET_DOMAINS) {
      if (!present.has(rule.domain)) continue
      await expect(tree.getByText(rule.domain, { exact: true }).first()).toBeVisible()
    }

    // clicar numa célula seleciona (a árvore é o caminho de navegação em escala:
    // com 186 nós, achar a célula no canvas a olho não é viável)
    const cell = tree.locator(".sidebar-cell").first()
    await cell.click()
    await expect(cell).toHaveClass(/selected/)
  })

  test("fitView sobre o grafo inteiro entra em LOD agregado, e aproximar volta pra card", async ({ browser }) => {
    const s = await h.openSession(browser, "alice")
    const wrap = s.page.locator(".canvas-wrap")

    // 186 nós não cabem em zoom 1: o fitView inicial tem que cair num LOD agregado
    // (floor/tower), não em "node" — é exatamente o caso que a fixture de 6 arquivos
    // nunca exercita, porque lá tudo cabe na tela.
    const initialLod = await wrap.getAttribute("data-lod")
    expect(["floor", "tower"]).toContain(initialLod)

    // aproximar num nó específico devolve o card cheio. zoom 1.5 e não 1: o regime
    // "node" começa em LOD_FLOOR_MAX_ZOOM = 1.2 (graph-core/layout.ts), então zoom 1
    // ainda é "floor".
    const id = await s.page.locator(".og-card").first().getAttribute("data-id")
    await s.page.evaluate((nodeId) => (window as any).__og_e2e.focusNode(nodeId, 1.5), id)
    await expect(wrap).toHaveAttribute("data-lod", "node")
    await expect(s.page.locator(`.og-card[data-id="${id}"] .og-markdown`)).toBeVisible()
  })

  test("clicar num card abre o painel com um nó real do repo-alvo", async ({ browser }) => {
    const s = await h.openSession(browser, "alice")
    const snap = await h.readResource("graph://snapshot")
    const ids = new Set(snap.graph.nodes.map((n: { id: string }) => n.id))

    await s.page.locator(".og-card").first().click()
    const panelId = await s.page.locator("#panel h3").textContent()
    expect(ids.has(panelId!)).toBe(true)
    // ids do repo-alvo são relpaths POSIX — nenhum `\` pode vazar até a UI
    expect(panelId).not.toContain("\\")
  })

  test("presença ao vivo continua funcionando com o grafo grande montado", async ({ browser }) => {
    const alice = await h.openSession(browser, "alice")
    await h.openSession(browser, "bob")
    await expect(alice.page.locator("#pcount")).toContainText("2")
    await expect(alice.page.locator("#plist")).toContainText("bob")
  })
})
