// target-repo.test.ts — QA-7 Fase 4: tools/list e tools/call via JSON-RPC por stdin/stdout, contra
// um servidor real apontado para uma cópia do repo-alvo (~186 nós), não a fixture mínima de 1
// arquivo que cli.test.ts usa. Mesmo padrão real-subprocesso-contra-servidor-real de
// cli.test.ts/credentials.test.ts/live.test.ts — só troca a fixture.
//
// Bootstrap de credenciais (--name/--tenant/persistência/reuso/re-registro em `server` divergente)
// já está coberto em credentials.test.ts com a fixture mínima — não duplicado aqui; este arquivo cobre
// só o que a fixture mínima não distingue: tools/list e tools/call correndo contra um grafo real de
// escala, através do proxy stdio.
import { expect, test } from "bun:test"
import { startServer } from "@open-graph-mcp/mcp-server/index"
import { spawnProxy } from "./helpers"
import { prepareTargetRepo, targetRepoAvailable, targetRepoPath } from "../../mcp-server/test/fixtures/target-repo"

test.skipIf(!targetRepoAvailable())(
  `QA-7 Fase 4: tools/list e tools/call via stdio contra servidor real apontado ao repo-alvo (${targetRepoPath()})`,
  async () => {
    const { root, cleanup } = prepareTargetRepo()
    const server = startServer({ repoPath: root, watch: false, autoBootstrap: true })
    const proxy = spawnProxy(server.url)
    try {
      await proxy.readStderrLine() // startup log

      proxy.send({ jsonrpc: "2.0", id: 100, method: "tools/list" })
      const listLine = await proxy.readLine()
      expect(listLine).not.toBeNull()
      const list = JSON.parse(listLine!)
      expect(list.id).toBe(100)
      const names = list.result.tools.map((t: { name: string }) => t.name)
      expect(names).toContain("graph.query")
      expect(names).toContain("graph.bootstrap")
      expect(names).toContain("graph.rebuild")

      // graph.query real contra o grafo real (não a fixture de 1 arquivo) — "index" casa vários
      // arquivos do sdk (index.ts é convenção comum no repo-alvo).
      proxy.send({ jsonrpc: "2.0", id: 101, method: "tools/call", params: { name: "graph.query", arguments: { terms: ["index"] } } })
      const line = await proxy.readLine()
      expect(line).not.toBeNull()
      const parsed = JSON.parse(line!)
      expect(parsed.id).toBe(101)
      expect(parsed.error).toBeUndefined()
      expect(parsed.result.isError).toBeUndefined()
      expect(parsed.result.structuredContent.candidates.length).toBeGreaterThan(0)
    } finally {
      proxy.kill()
      server.stop()
      cleanup()
    }
  },
)
