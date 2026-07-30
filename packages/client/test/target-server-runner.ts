// target-server-runner.ts — subprocesso Bun-only para o mcp-server real, disparado por
// target-repo.test.ts (QA-7 Fase 3). `node --test` não consegue importar bun:sqlite/Bun.serve
// (que startServer() usa), então este arquivo é a fronteira de processo — mesmo padrão de
// packages/mcp-web/e2e/server-runner.ts.
//
// Protocolo: argv[2] = repoPath (já preparado — cópia do repo-alvo + .graph/domains.json injetado
// por prepareTargetRepo, chamada pelo processo Node pai). Imprime exatamente uma linha
// `READY <url>` assim que o servidor está escutando.
import { startServer } from "@open-graph-mcp/mcp-server/index"

const repoPath = process.argv[2]
if (!repoPath) throw new Error("target-server-runner: argv[2] (repoPath) é obrigatório")

const server = startServer({ repoPath, watch: false, autoBootstrap: true })
process.stdout.write(`READY ${server.url}\n`)

process.on("SIGTERM", () => {
  server.stop()
  process.exit(0)
})
