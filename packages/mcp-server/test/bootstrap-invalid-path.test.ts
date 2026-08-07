import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { startServer } from "../src/index"
import { readResource, tempRepo, bootstrapAs, callTool, register } from "./helpers"

/**
 * Regressão do bug de perda de dados: `graph.bootstrap` com um `repoPath` inválido NÃO PODE devolver
 * sucesso (nem, pior, apagar um grafo bom que já existia no tenant). Antes, `walkSource` engolia o
 * ENOENT da raiz no mesmo `catch` que tolera subdiretório ilegível no meio do walk, então
 * `indexRepo` devolvia `files = []` → `Graph{nodes:0}` "válido" → `persistGraph` fazia
 * DELETE+INSERT incondicional e zerava o tenant em silêncio.
 */

test("bootstrap com path inexistente lança erro (isError), não devolve stats vazias como sucesso", async () => {
  const s = startServer({ watch: false })
  try {
    await expect(bootstrapAs(s.url, path.join(s.state.stateDir, "definitely-does-not-exist-xyz"), "alice")).rejects.toThrow()
  } finally {
    s.stop()
  }
})

test("bootstrap com path-traversal p/ diretório real sem arquivos-fonte (ex.: `..\\..\\Windows`) lança erro em vez de indexar 0 nós", async () => {
  const s = startServer({ watch: false })
  // Não apontamos de fato p/ C:\Windows (varrer uma árvore real do SO recursivamente seria lento e
  // frágil entre máquinas) — simulamos a MESMA condição do relato: um diretório que EXISTE, é
  // legível, mas não contém nada que bata `SOURCE_EXT`. É exatamente o que `..\..\Windows` produz.
  const noSourceDir = mkdtempSync(path.join(tmpdir(), "og-no-source-"))
  writeFileSync(path.join(noSourceDir, "readme.txt"), "nada de fonte aqui")
  try {
    await expect(bootstrapAs(s.url, noSourceDir, "bob")).rejects.toThrow()
  } finally {
    s.stop()
    rmSync(noSourceDir, { recursive: true, force: true })
  }
})

test("bootstrap com um ARQUIVO (não diretório) como repoPath lança erro", async () => {
  const s = startServer({ watch: false })
  const tmpFile = path.join(mkdtempSync(path.join(tmpdir(), "og-file-")), "not-a-dir.txt")
  writeFileSync(tmpFile, "hello")
  try {
    await expect(bootstrapAs(s.url, tmpFile, "carol")).rejects.toThrow()
  } finally {
    s.stop()
    rmSync(path.dirname(tmpFile), { recursive: true, force: true })
  }
})

/**
 * O teste crítico: um grafo bom, já persistido, deve SOBREVIVER a uma tentativa de bootstrap
 * malsucedida no MESMO tenant. É exatamente a reprodução relatada — bootstrap bom (186/376 no caso
 * real), depois bootstrap ruim, e o grafo bom continuava lá.
 */
test("um grafo bom sobrevive a uma tentativa de bootstrap falha no mesmo tenant", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const stateDir = mkdtempSync(path.join(tmpdir(), "og-survive-"))
  const s = startServer({ stateDir, watch: false })
  try {
    const { token } = await register(s.url, "dave")

    const good = await callTool(s.url, "graph.bootstrap", { token, repoPath: root })
    expect(good.stats.nodes).toBeGreaterThan(0)

    const badPath = path.join(stateDir, "still-does-not-exist")
    await expect(callTool(s.url, "graph.bootstrap", { token, repoPath: badPath })).rejects.toThrow()

    // o grafo do tenant precisa continuar exatamente como estava antes da tentativa falha
    const snap = await readResource(s.url, "graph://snapshot", token)
    expect(snap.graph.stats.nodes).toBe(good.stats.nodes)
    expect(snap.graph.stats.edges).toBe(good.stats.edges)
  } finally {
    s.stop()
    rmSync(stateDir, { recursive: true, force: true })
    cleanup()
  }
})
