/**
 * target-repo.test.ts — QA-7 Fase 1: graph-core direto contra o repo-alvo real (harness-kit),
 * não fixtures sintéticas de 2-3 arquivos. Usa o mesmo harness de cópia da Fase 0
 * (mcp-server/test/fixtures/target-repo.ts) — cópia sempre, nunca o repo-alvo original.
 *
 * Guarda: se o repo-alvo não existir localmente (ex.: CI sem o clone), todo describe abaixo
 * faz skip com motivo explícito — nunca falha por ambiente ausente, nunca passa em silêncio.
 */
import { readdirSync, symlinkSync, existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { prepareTargetRepo, targetRepoAvailable, targetRepoPath, TARGET_DOMAINS } from "../../mcp-server/test/fixtures/target-repo"
import { census, DEFAULT_IGNORE } from "../src/scan"
import { classifyFile } from "../src/classify"
import { assignDomain, loadDomains, UNASSIGNED } from "../src/domains"
import { assembleGraph, buildGraph } from "../src/build"
import { graphChecksum } from "../src/boot-gate"
import { appendShard, type MetaRecord } from "../src/meta"
import type { ClaimRecord } from "../src/claim-store"
import type { SurveyPattern } from "../src/build"

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".md"])

/** Reimplementação mínima e local do walk usado por graph-bootstrap.ts (não exportado de lá) —
 *  mesma poda (DEFAULT_IGNORE), mesmos separadores POSIX normalizados. */
function listSourceFiles(root: string): string[] {
  const out: string[] = []
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
      if (e.isDirectory()) walk(full)
      else if (e.isFile() && SOURCE_EXT.has(path.extname(e.name))) out.push(path.relative(root, full).split(path.sep).join("/"))
    }
  }
  walk(root)
  return out.sort()
}

describe.skipIf(!targetRepoAvailable())(`graph-core vs repo-alvo (${targetRepoPath()})`, () => {
  test("census: encontra arquivos-fonte reais e exclui node_modules/.git/dist por padrão", () => {
    const { root, cleanup } = prepareTargetRepo()
    try {
      const { totalFiles, totalDirs } = census(root)
      // harness-kit tem 186 arquivos-fonte (.ts/.md/.json) documentados no plano; census conta
      // TODOS os arquivos (não só source), então o piso é o número de arquivos-fonte.
      expect(totalFiles).toBeGreaterThan(100)
      expect(totalDirs).toBeGreaterThan(0)
      // a cópia nunca deveria conter .git (git não é copiado pelo prepareTargetRepo, que já
      // filtra DEFAULT_IGNORE) — confirma que a exclusão realmente aconteceu na cópia
      expect(existsSync(path.join(root, ".git"))).toBe(false)
      expect(existsSync(path.join(root, "node_modules"))).toBe(false)
    } finally {
      cleanup()
    }
  })

  test("census não segue symlink (evita loop/duplicidade)", () => {
    const { root, cleanup } = prepareTargetRepo()
    try {
      const before = census(root)
      // symlink apontando pro próprio root — se census seguisse, entraria em loop infinito ou
      // contaria tudo de novo; como ele pula (e.isSymbolicLink() continue), a contagem não muda
      // além do próprio link (que não é arquivo nem dir contado).
      const linkPath = path.join(root, "self-link")
      try {
        symlinkSync(root, linkPath, "junction")
      } catch {
        // symlink pode exigir privilégio elevado no Windows — se não for possível criar, o teste
        // não pode afirmar nada sobre o comportamento; pula sem falso-positivo nem falso-negativo.
        return
      }
      const after = census(root)
      expect(after.totalFiles).toBe(before.totalFiles)
    } finally {
      cleanup()
    }
  })

  test("classify.ts: distribuição P1-P5 é determinística entre duas execuções", () => {
    const { root, cleanup } = prepareTargetRepo()
    try {
      const files = listSourceFiles(root)
      expect(files.length).toBeGreaterThan(100)
      const distOf = () => {
        const dist: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0 }
        for (const f of files) dist[classifyFile(f)]++
        return dist
      }
      const first = distOf()
      const second = distOf()
      expect(second).toEqual(first)
      // sanidade: classifyFile cobre 100% (nenhum arquivo cai fora do enum P1-P5)
      expect(Object.values(first).reduce((a, b) => a + b, 0)).toBe(files.length)
    } finally {
      cleanup()
    }
  })

  test("domains.ts: cada arquivo do repo-alvo mapeia para o domínio esperado via .graph/domains.json", () => {
    const { root, cleanup } = prepareTargetRepo()
    try {
      const map = loadDomains(root)
      expect(map).not.toBeNull()
      expect(map).toEqual(TARGET_DOMAINS as any)

      const files = listSourceFiles(root)
      const byDomain: Record<string, number> = {}
      for (const f of files) {
        const d = assignDomain(f, [], map)!
        byDomain[d] = (byDomain[d] ?? 0) + 1
        // toda regra é prefix-match; confirma que o arquivo realmente começa com o prefixo do
        // domínio atribuído — não é um match "por acidente" de outra regra
        if (d !== UNASSIGNED) {
          const rule = TARGET_DOMAINS.find((r) => r.domain === d)!
          const prefix = rule.pattern.slice(0, -1) // remove o "*" final
          expect(f.startsWith(prefix)).toBe(true)
        }
      }
      // pelo menos um arquivo real em cada domínio esperado (sdk/src, sdk/tests, agents, skills, docs
      // existem de verdade no repo-alvo — não é um mapeamento vazio)
      for (const rule of TARGET_DOMAINS) expect(byDomain[rule.domain] ?? 0).toBeGreaterThan(0)
      // "(unassigned)" é esperado e por design (sem catch-all "*" — README.md, LICENSE, plugin.json
      // etc. na raiz do repo-alvo não casam nenhum padrão prefix); só verificamos que ele existe
      // pelo motivo certo — todo arquivo unassigned não deveria começar com nenhum dos 5 prefixos.
      const unassignedFiles = files.filter((f) => assignDomain(f, [], map) === UNASSIGNED)
      for (const f of unassignedFiles) {
        expect(TARGET_DOMAINS.some((r) => f.startsWith(r.pattern.slice(0, -1)))).toBe(false)
      }
    } finally {
      cleanup()
    }
  })

  test("build.ts assembleGraph: função pura (sem fs) — stats batem com os arrays de entrada", () => {
    const meta: MetaRecord[] = [
      { id: "sdk/a", file: "sdk/src/a.ts", kind: "File", responsibility: "sdk/src/a.ts", exposed: false, deps: [], anchor: "export const a = 1" },
      { id: "sdk/b", file: "sdk/src/b.ts", kind: "File", responsibility: "sdk/src/b.ts", exposed: false, deps: ["sdk/a"], anchor: "export const b = 2" },
      { id: "docs/readme", file: "docs/x.md", kind: "File", responsibility: "docs/x.md", exposed: false, deps: [], anchor: "# x" },
    ]
    const claims: ClaimRecord[] = [
      { id: "c1", subject: "a", domain: "sdk", refs: ["sdk/a"], anchor: "export const a = 1", verdict: { confidence: 0.9, overclaim: false } },
      { id: "c1", subject: "a-dup", domain: "sdk", refs: ["sdk/a"], anchor: "export const a = 1" }, // mesmo id → Set dedup em stats.claims
    ]
    const survey: SurveyPattern[] = [{ domainA: "sdk", domainB: "docs", relationship: "documents", strength: 0.7, summary: "docs cobre sdk" }]
    const domainMap = [
      { pattern: "sdk/src/*", domain: "sdk" },
      { pattern: "docs/*", domain: "docs" },
    ]

    const graph = assembleGraph({ repo: "synthetic", meta, claims, survey, domainMap, generatedAt: "2026-07-30T00:00:00.000Z" })

    expect(graph.nodes).toHaveLength(meta.length)
    // edges = 1 depends-on (sdk/b -> sdk/a) + 1 survey (sdk -> docs)
    expect(graph.edges).toHaveLength(2)
    expect(graph.edges.some((e) => e.type === "depends-on" && e.from === "sdk/b" && e.to === "sdk/a" && e.resolved)).toBe(true)
    expect(graph.edges.some((e) => e.type === "survey" && e.from === "sdk" && e.to === "docs")).toBe(true)
    expect(graph.stats).toEqual({ nodes: meta.length, edges: graph.edges.length, claims: 1, domains: 2 })
    // domínio atribuído por posse explícita (domainMap), não pelos claims
    expect(graph.nodes.find((n) => n.id === "sdk/a")!.domain).toBe("sdk")
    expect(graph.nodes.find((n) => n.id === "docs/readme")!.domain).toBe("docs")
  })

  test("boot-gate.ts graphChecksum: idêntico p/ mesmo conteúdo (ordem de campos indiferente); muda quando um nó muda", () => {
    const base = {
      schemaVersion: 1,
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ from: "a", to: "b", type: "depends-on" }],
      authority: { "sdk:P4": "source" },
    }
    const reordered = {
      authority: { "sdk:P4": "source" },
      edges: [{ from: "a", to: "b", type: "depends-on" }],
      nodes: [{ id: "b" }, { id: "a" }], // ordem de array trocada
      schemaVersion: 1,
    }
    expect(graphChecksum(base)).toBe(graphChecksum(reordered))

    const changed = { ...base, nodes: [{ id: "a" }, { id: "c" }] } // um nó diferente
    expect(graphChecksum(changed)).not.toBe(graphChecksum(base))
  })

  test("determinismo: dois buildGraph(root) seguidos sobre o repo-alvo → JSON byte-idêntico exceto generatedAt", () => {
    const { root, cleanup } = prepareTargetRepo()
    try {
      // popula .graph/meta com um record por arquivo-fonte real (mesma forma do esqueleto do
      // mcp-server, mas local: graph-core não deve depender do mcp-server em runtime, só nos testes)
      const files = listSourceFiles(root)
      expect(files.length).toBeGreaterThan(100)
      const byModule = new Map<string, MetaRecord[]>()
      for (const f of files) {
        const module = f.split("/")[0] || "root"
        const list = byModule.get(module) ?? []
        list.push({ id: f, file: f, kind: "File", responsibility: f, exposed: false, deps: [], anchor: f })
        byModule.set(module, list)
      }
      for (const [module, records] of byModule) appendShard(root, module, records)

      const g1 = buildGraph(root)
      const g2 = buildGraph(root)

      expect(g1.nodes.length).toBe(files.length)
      const strip = (g: typeof g1) => JSON.stringify({ ...g, generatedAt: undefined })
      expect(strip(g1)).toBe(strip(g2))
      // generatedAt em si pode divergir (Date.now() entre as duas chamadas) — não faz parte do
      // contrato de determinismo, é só o timestamp de emissão
      expect(typeof g1.generatedAt).toBe("string")
      expect(typeof g2.generatedAt).toBe("string")
    } finally {
      cleanup()
    }
  })
})
