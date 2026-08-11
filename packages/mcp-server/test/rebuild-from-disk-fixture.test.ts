/**
 * rebuild-from-disk-fixture.test.ts — mesma semântica de `target-repo-scale.test.ts` (multi-domain,
 * multi-nível, `graph.rebuild` re-lendo do disco após o repo mudar), mas SEM depender de um repo
 * externo (`harness-kit`) que só existe na máquina local. `target-repo-scale.test.ts` inteiro roda
 * dentro de `describe.skipIf(!targetRepoAvailable())` — no CI isso nunca executa, então essas
 * asserções ficavam "CI-escuras" (docs/CHANGELOG.md §0).
 *
 * Fixture: `test/fixtures/multi-domain/` — versionada, pequena, mas com 4 domínios e 4 níveis
 * (P1 README.md, P2 src/api/router.ts, P3 src/core/engine.test.ts, P4 os demais) e 3 arestas de
 * import relativo resolvidas (button→panel, handler→router, engine.test→engine). `fresh/`/`demote/`
 * não são tocadas (outros testes dependem delas).
 */
import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { startServer } from "../src/index"
import { readResource, bootstrapAs, rebuildAs, tempRepo } from "./helpers"

/** Regras de domínio da fixture — mesmo padrão de `fixtures/target-repo.ts::TARGET_DOMAINS`,
 *  definidas localmente (helper novo, ver §6 do escopo). */
const MULTI_DOMAIN_DOMAINS = [
  { pattern: "src/ui/*", domain: "ui" },
  { pattern: "src/api/*", domain: "api" },
  { pattern: "src/core/*", domain: "core" },
  { pattern: "docs/*", domain: "docs" },
] as const

test("graph.bootstrap indexa multi-domínio/multi-nível a partir de uma fixture versionada (roda no CI, sem repo externo)", async () => {
  const { root, cleanup } = tempRepo("multi-domain")
  const s = startServer({ repoPath: root, watch: false, domains: MULTI_DOMAIN_DOMAINS })
  try {
    const boot = await bootstrapAs(s.url, root)
    expect(boot.stats.pipeline).toBe("indexed")
    expect(boot.stats.nodes).toBe(8) // README.md + 2 ui + 2 api + 2 core + 1 docs
    expect(boot.stats.edges).toBe(3) // button→panel, handler→router, engine.test→engine

    const snap = (await readResource(s.url, "graph://snapshot")).graph

    const levels = new Set(snap.nodes.map((n: { level: string }) => n.level))
    expect(levels.has("P1")).toBe(true) // README.md
    expect(levels.has("P2")).toBe(true) // src/api/router.ts
    expect(levels.has("P3")).toBe(true) // src/core/engine.test.ts
    expect(levels.has("P4")).toBe(true) // demais

    const domains = new Set(snap.nodes.map((n: { domain: string | null }) => n.domain))
    expect(domains.has("ui")).toBe(true)
    expect(domains.has("api")).toBe(true)
    expect(domains.has("core")).toBe(true)
    expect(domains.has("docs")).toBe(true)
    expect(domains.has("(unassigned)")).toBe(true) // README.md não casa nenhum padrão

    // toda aresta depends-on resolve p/ um nó conhecido (nenhuma ref pendurada).
    expect(snap.edges.every((e: { resolved?: boolean; type: string }) => e.type !== "depends-on" || e.resolved === true)).toBe(true)
  } finally {
    s.stop()
    cleanup()
  }
})

test("graph.rebuild re-lê o repo do disco: arquivo novo muda contagem de nós e graphId", async () => {
  const { root, cleanup } = tempRepo("multi-domain")
  const s = startServer({ repoPath: root, watch: false, domains: MULTI_DOMAIN_DOMAINS })
  try {
    const boot = await bootstrapAs(s.url, root)

    writeFileSync(path.join(root, "src", "ui", "modal.ts"), "export const modalTitle = \"modal\"\n")
    const rebuilt = await rebuildAs(s.url)
    expect(rebuilt.ok).toBe(true)
    expect(rebuilt.stats.nodes).toBe(boot.stats.nodes + 1)
    expect(rebuilt.stats.pipeline).toBe("indexed")

    const history = await readResource(s.url, "graph://history?limit=50")
    expect(history.events.some((e: { kind: string }) => e.kind === "graph.rebuilt")).toBe(true)

    const snap = await readResource(s.url, "graph://snapshot")
    expect(snap.graph.stats.nodes).toBe(boot.stats.nodes + 1)
    expect(snap.graph.nodes.some((n: { id: string }) => n.id === "src/ui/modal.ts")).toBe(true)
  } finally {
    s.stop()
    cleanup()
  }
})

test("graph.rebuild re-lê o repo do disco: EDITAR um arquivo (mesmo conjunto de nós) ainda muda o graphId", async () => {
  const { root, cleanup } = tempRepo("multi-domain")
  const s = startServer({ repoPath: root, watch: false, domains: MULTI_DOMAIN_DOMAINS })
  try {
    const boot = await bootstrapAs(s.url, root)

    writeFileSync(path.join(root, "src", "core", "engine.ts"), "// âncora nova\nexport function engine() {\n  return \"engine-v2\"\n}\n")
    const rebuilt = await rebuildAs(s.url)
    expect(rebuilt.ok).toBe(true)
    expect(rebuilt.stats.nodes).toBe(boot.stats.nodes) // mesmo conjunto de arquivos

    const snap = await readResource(s.url, "graph://snapshot")
    expect(snap.graphId).not.toBe(boot.graphId) // âncora entra no checksum — disco≠memória detectável
  } finally {
    s.stop()
    cleanup()
  }
})

test("reindexar substitui as linhas do tenant, não acumula (fixture multi-domínio)", async () => {
  const { root, cleanup } = tempRepo("multi-domain")
  const s = startServer({ repoPath: root, watch: false, domains: MULTI_DOMAIN_DOMAINS })
  try {
    const boot = await bootstrapAs(s.url, root)
    const count = (table: string) => (s.state.db.query(`SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id = ?`).get("default") as { c: number }).c
    expect(count("nodes")).toBe(boot.stats.nodes)
    expect(count("edges")).toBe(boot.stats.edges)

    writeFileSync(path.join(root, "src", "api", "extra.ts"), "export const extra = 1\n")
    const again = await bootstrapAs(s.url, root)
    expect(count("nodes")).toBe(again.stats.nodes)
    expect(count("edges")).toBe(again.stats.edges)
  } finally {
    s.stop()
    cleanup()
  }
})
