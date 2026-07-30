import { expect, test } from "bun:test"
import { assignDomain, UNASSIGNED } from "../src/domains"

// QA-7 P2: regressão do bug de separador de path. graph-bootstrap.ts (mcp-server) gerava ids
// de nó com `path.relative()` cru — no Windows isso produz `sdk\src\foo.ts`, que nunca casava
// contra um padrão `.graph/domains.json` escrito em POSIX (`sdk/src/*`), colapsando todo nó em
// (unassigned). O fix normaliza na fonte (graph-bootstrap.ts) e defensivamente em matchesPattern
// (aqui) p/ um graph.json legado gerado no Windows ainda mapear corretamente em qualquer SO.

test("id com separador Windows (\\) casa com padrão POSIX prefix*", () => {
  const map = [{ pattern: "sdk/src/*", domain: "sdk" }]
  expect(assignDomain("sdk\\src\\foo.ts", [], map)).toBe("sdk")
})

test("id com separador Windows em nível único ainda casa com prefix*", () => {
  const map = [{ pattern: "sdk/src/*", domain: "sdk" }]
  expect(assignDomain("sdk\\src\\nested\\bar.ts", [], map)).toBe("sdk")
})

test("id POSIX continua funcionando normalmente (sem regressão)", () => {
  const map = [{ pattern: "sdk/src/*", domain: "sdk" }]
  expect(assignDomain("sdk/src/foo.ts", [], map)).toBe("sdk")
})

test("sem padrão casando (mesmo após normalizar) cai em (unassigned)", () => {
  const map = [{ pattern: "sdk/src/*", domain: "sdk" }]
  expect(assignDomain("docs\\readme.md", [], map)).toBe(UNASSIGNED)
})

test("sem .graph/domains.json (map null): fallback de sort alfabético, ileso ao bug de separador", () => {
  expect(assignDomain("sdk\\src\\foo.ts", ["billing", "auth"], null)).toBe("auth")
})
