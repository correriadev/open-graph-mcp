/**
 * skeleton-edges.test.ts — regressão do piso determinístico de arestas.
 *
 * `buildSkeleton` gravava `deps: []` fixo, então TODO grafo fresh saía com `edges: 0`: sem aresta
 * não há DAG de células (cell-dag.ts), e sem DAG a cascata de regeneração e a autoridade β não têm
 * sobre o que operar. Hoje as deps saem de `extractImports` (extract.ts, regex single-line, sem LLM)
 * com os specs RELATIVOS resolvidos p/ ids de nó conhecidos.
 *
 * Repo sintético e pequeno de propósito: as contagens abaixo são exatas e legíveis à mão, ao
 * contrário do teste em escala (target-repo-scale.test.ts), que assere propriedades.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, readResource, bootstrapAs } from "./helpers"
import { graphChecksum } from "@open-graph-mcp/graph-core/boot-gate"

/** Repo mínimo: a → b (mesma pasta), a → c (subpasta via index), a → pacote externo (não vira aresta). */
function miniRepo(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "og-edges-"))
  mkdirSync(path.join(root, "src", "sub"), { recursive: true })
  writeFileSync(
    path.join(root, "src", "a.ts"),
    ['import { b } from "./b"', 'import { c } from "./sub"', 'import { readFileSync } from "node:fs"', 'import x from "some-package"', "export const a = 1", ""].join("\n"),
  )
  writeFileSync(path.join(root, "src", "b.ts"), "export const b = 2\n")
  writeFileSync(path.join(root, "src", "sub", "index.ts"), "export const c = 3\n")
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test("esqueleto extrai imports relativos como arestas depends-on e ignora specs externos", async () => {
  const { root, cleanup } = miniRepo()
  const s = startServer({ repoPath: root, watch: false })
  try {
    const boot = await bootstrapAs(s.url, root)
    expect(boot.stats.nodes).toBe(3)
    // 2 arestas: a→b (extensão implícita .ts) e a→sub/index.ts (diretório → index).
    // `node:fs` e `some-package` NÃO viram aresta — não são relativos.
    expect(boot.stats.edges).toBe(2)

    const graph = (await readResource(s.url, "graph://snapshot")).graph
    const pairs = graph.edges.map((e: { from: string; to: string }) => `${e.from}->${e.to}`).sort()
    expect(pairs).toEqual(["src/a.ts->src/b.ts", "src/a.ts->src/sub/index.ts"])
    // toda aresta do esqueleto resolve p/ um nó conhecido (resolveRelative descarta o resto)
    expect(graph.edges.every((e: { resolved?: boolean }) => e.resolved === true)).toBe(true)
  } finally {
    s.stop()
    cleanup()
  }
})

test("graphChecksum muda quando a âncora de um nó muda, mesmo com o conjunto de arquivos igual", () => {
  const base = { nodes: [{ id: "src/a.ts", anchor: "export const a = 1" }], edges: [], authority: {} }
  const mesmo = { nodes: [{ id: "src/a.ts", anchor: "export const a = 1" }], edges: [], authority: {} }
  const editado = { nodes: [{ id: "src/a.ts", anchor: "export const a = 99" }], edges: [], authority: {} }

  expect(graphChecksum(base)).toBe(graphChecksum(mesmo)) // determinístico
  // Antes a âncora não entrava no hash: editar um arquivo existente reescrevia graph.json no disco
  // mas devolvia o MESMO graphId, e bootstrap() retornava cedo mantendo o grafo velho em memória.
  expect(graphChecksum(base)).not.toBe(graphChecksum(editado))
})
