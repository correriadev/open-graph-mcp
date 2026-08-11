import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { readFileSync } from "node:fs"
import path from "node:path"
import { callTool, register, tempRepo } from "./helpers"

/**
 * store.ts::makeReadFile — pré-classificado Tier 1, "maior valor da campanha"
 * (SB-0 §4, ver docs/CHANGELOG.md). No caminho de PRODUÇÃO (`bun run dev`, index.ts
 * `import.meta.main`) `repoPath` NUNCA é passado a `startServer` — o repo é argumento de
 * `graph.bootstrap`, não config de processo (D1). Este teste reproduz exatamente essa forma:
 * `startServer({})` sem repoPath, tenant indexa via `graph.bootstrap`, então testa o gate de âncora.
 *
 * Comportamento ANTES do fix (verificado empiricamente rodando este teste contra o store.ts original):
 * `state.repoPath` era `""` (falsy) neste shape, então `makeReadFile` devolvia `undefined` p/ TODO
 * arquivo — e `incrementalGate` (gates.ts) recusa qualquer claim com âncora+arquivo quando
 * `ctx.readFile(file) === undefined`, âncora genuína ou não. Ou seja: o modo quebrado era "RECUSA
 * TUDO", não "admite tudo silenciosamente" — o caso POSITIVO (âncora genuína) falhava com
 * `anchor not found verbatim in <file>`, e o caso NEGATIVO (âncora falsa) "passava" pelo motivo
 * errado (mascarado pelo mesmo erro, não por detectar a âncora ausente).
 */
test("changeset.claim com anchor+file genuíno é ADMITIDO quando repoPath só existe no tenant (não no processo)", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({}) // shape de produção: SEM repoPath no processo
  try {
    const a = await register(s.url, "alice")
    await callTool(s.url, "graph.bootstrap", { token: a.token, repoPath: root })

    const realAnchor = readFileSync(path.join(root, "src/audit.ts"), "utf8").split("\n")[0]
    expect(realAnchor.trim().length).toBeGreaterThan(0)

    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:5"], intent: "anchor-repo-path" })
    const r = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "c1", subject: "s", domain: "ui", level: 5, refs: [], anchor: realAnchor, file: "src/audit.ts" } },
    })
    expect(r.ok).toBe(true)
  } finally {
    s.stop()
    cleanup()
  }
})

test("changeset.claim com anchor que não existe verbatim no arquivo é RECUSADO (mesmo shape de produção)", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({})
  try {
    const a = await register(s.url, "alice")
    await callTool(s.url, "graph.bootstrap", { token: a.token, repoPath: root })

    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:5"], intent: "anchor-repo-path-neg" })
    const r = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "c1", subject: "s", domain: "ui", level: 5, refs: [], anchor: "THIS ANCHOR IS NOT IN THE FILE", file: "src/audit.ts" } },
    })
    expect(r.ok).toBe(false)
    expect(r.reasons.some((x: string) => x.includes("anchor not found verbatim in src/audit.ts"))).toBe(true)
  } finally {
    s.stop()
    cleanup()
  }
})
