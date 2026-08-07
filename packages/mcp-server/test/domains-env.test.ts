import { expect, test } from "bun:test"
import { parseDomainsEnv, startServer } from "../src/index"
import { readResource, tempRepo, bootstrapAs, register } from "./helpers"

/**
 * Regressão do gap descrito no fix: `startServer()` sempre aceitou `domains`, mas o entrypoint de CLI
 * (`bun run dev`) nunca lia nada do ambiente pra preenchê-lo — configurar regras de posse de domínio
 * rodando o servidor da forma suportada era impossível, e silenciosamente (sem erro, sem aviso; tudo
 * caía em `(unassigned)`). Estes testes cobrem `parseDomainsEnv` (a função pura extraída do bloco
 * `import.meta.main` pra ficar testável sem spawnar processo) nos 4 casos que importam: unset, válido,
 * JSON malformado, e entradas estruturalmente inválidas.
 */

test("DOMAINS não setado: parseDomainsEnv devolve undefined (sem regras, comportamento de hoje)", () => {
  expect(parseDomainsEnv(undefined)).toBeUndefined()
})

test("DOMAINS válido: parseDomainsEnv devolve as regras parseadas", () => {
  const rules = parseDomainsEnv('[{"pattern":"src/*","domain":"payments"}]')
  expect(rules).toEqual([{ pattern: "src/*", domain: "payments" }])
})

test("DOMAINS com JSON malformado: parseDomainsEnv falha alto nomeando a variável", () => {
  expect(() => parseDomainsEnv("{not valid json")).toThrow(/DOMAINS inválido/)
})

test("DOMAINS não é array: parseDomainsEnv rejeita", () => {
  expect(() => parseDomainsEnv('{"pattern":"src/*","domain":"payments"}')).toThrow(/DOMAINS inválido/)
})

test("DOMAINS com entrada estruturalmente inválida (pattern ausente): parseDomainsEnv rejeita", () => {
  expect(() => parseDomainsEnv('[{"domain":"payments"}]')).toThrow(/item \[0\]/)
})

test("DOMAINS com entrada estruturalmente inválida (domain vazio): parseDomainsEnv rejeita", () => {
  expect(() => parseDomainsEnv('[{"pattern":"src/*","domain":""}]')).toThrow(/item \[0\]/)
})

test("DOMAINS com item que não é objeto: parseDomainsEnv rejeita", () => {
  expect(() => parseDomainsEnv('["src/*"]')).toThrow(/item \[0\]/)
})

/**
 * Fim-a-fim: regras parseadas de DOMAINS (via parseDomainsEnv, exatamente como o bloco
 * `import.meta.main` faria) chegando até o grafo indexado — não basta parsear certo, tem que
 * efetivamente influenciar `graph.bootstrap` como o `StartOptions.domains` programático já fazia.
 */
test("regras vindas de DOMAINS chegam ao grafo indexado (node.domain, não mais (unassigned))", async () => {
  const { root, cleanup } = tempRepo("demote") // tem src/app.ts, casa com o pattern abaixo
  const domains = parseDomainsEnv('[{"pattern":"src/*","domain":"payments"}]')
  const s = startServer({ repoPath: root, watch: false, domains })
  try {
    await bootstrapAs(s.url, root)
    const { token } = await register(s.url, "reader")
    const snap = await readResource(s.url, "graph://snapshot", token)
    const appNode = snap.graph.nodes.find((n: { file: string }) => n.file.includes("app.ts"))
    expect(appNode).toBeTruthy()
    expect(appNode.domain).toBe("payments")
  } finally {
    s.stop()
    cleanup()
  }
})
