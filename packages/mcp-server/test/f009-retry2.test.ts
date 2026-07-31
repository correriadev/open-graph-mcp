/**
 * f009-retry2.test.ts — atomicidade do espelho durável (SQLite + JSONL) numa mutação grande.
 *
 * Este arquivo tinha 3 testes sobre `graph.import`, a tool que migrava um `.graph/` do repo-alvo
 * para o banco. Ela foi absorvida por `graph.bootstrap` (um comando só: indexa + persiste) quando
 * o grafo passou a viver no MCP e o repo deixou de hospedar estado (ADR D1).
 *
 * Dos 3, sobreviveu o que testava uma propriedade e não uma tool: se um append ao espelho JSONL
 * falha no meio, TUDO volta atrás — SQLite e todos os espelhos tocados. Retargetado para
 * `graph.bootstrap`, que hoje é a mutação que escreve mais linhas de uma vez (nodes + edges +
 * authority + changeset). Os outros dois cobriam canonicalização de `level` de claim na entrada do
 * import; esse caminho não existe mais (bootstrap não produz claims — elas entram por
 * `changeset.claim`, cuja normalização é coberta por claim-level.test.ts).
 */
import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { injectMirrorAppendFailure } from "../src/db"
import { startServer } from "../src/index"
import { tenantGraph } from "../src/state"
import { callTool, register, tempRepo } from "./helpers"

function durableBytes(stateDir: string, tenant = "default") {
  const dir = path.join(stateDir, "tenants", tenant)
  const result: Record<string, string> = {}
  for (const table of ["users", "nodes", "edges", "claims", "authority", "changesets", "cs_deltas", "events"]) {
    const file = path.join(dir, `${table}.jsonl`)
    result[table] = existsSync(file) ? readFileSync(file, "utf8") : ""
  }
  return result
}

test("falha de append no espelho reverte o graph.bootstrap inteiro — SQLite e todos os espelhos", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false })
  try {
    const actor = await register(s.url, "alice")
    const before = durableBytes(s.state.stateDir)
    const beforeGraph = structuredClone(tenantGraph(s.state, "default").graph)
    const tables = ["nodes", "edges", "claims", "authority", "changesets", "events"]
    const beforeCounts = Object.fromEntries(
      tables.map((table) => [table, (s.state.db.query(`SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id=?`).get("default") as { c: number }).c]),
    )

    const restore = injectMirrorAppendFailure(s.state.db, 2)
    try {
      await expect(callTool(s.url, "graph.bootstrap", { token: actor.token, repoPath: root })).rejects.toThrow("injected mirror append failure")
    } finally {
      restore()
    }

    expect(durableBytes(s.state.stateDir)).toEqual(before)
    for (const table of tables) {
      expect(s.state.db.query(`SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id=?`).get("default")).toEqual({ c: beforeCounts[table] })
    }
    // a cópia quente também não pode ter avançado: persistência falhou, memória não pode mentir
    expect(tenantGraph(s.state, "default").graph).toEqual(beforeGraph)
  } finally {
    s.stop()
    cleanup()
  }
})
