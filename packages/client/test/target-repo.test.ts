// target-repo.test.ts — QA-7 Fase 3: packages/client (Node LTS real, node:test) contra um
// mcp-server real apontado para uma cópia do repo-alvo (~186 nós), não o mock de fetch que
// connect.test.ts usa. Cobre:
//   - connect() + /events contra um servidor real: snapshot inicial com ~186 nós, envelope
//     íntegro (schemaVersion/seq/ts/kind/target/payload/graphId), seq monotônico.
//   - Reconexão: quando o CONTEÚDO do repo muda entre restarts, o graphId muda (é
//     sha256(root+checksum) — determinístico, não aleatório por processo — ver
//     packages/mcp-server/src/tools/graph-bootstrap.ts:103) e o EventStream (subscribe.ts)
//     descarta `since`/refaz snapshot a partir de 0 (comportamento documentado no README do
//     mcp-server: "Estado 100% em memória... Restart -> novo graphId -> cliente descarta since").
//
// Node não importa bun:sqlite/Bun.serve — o servidor real roda como subprocesso Bun
// (target-server-runner.ts), mesmo padrão de packages/mcp-web/e2e/fixture.ts. `prepareTargetRepo`
// (mcp-server/test/fixtures/target-repo.ts) é puro node:fs — importável direto por este processo
// Node (verificado: Node 24 resolve .ts nativamente via os `exports` de graph-core/package.json).
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { EventStream, type Envelope } from "../src/subscribe.ts"
import { connect, registerSession } from "../src/connect.ts"
import { resourceRead } from "../src/rpc.ts"
import { prepareTargetRepo, targetRepoAvailable, targetRepoPath } from "../../mcp-server/test/fixtures/target-repo.ts"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNNER = path.join(HERE, "target-server-runner.ts")

type TargetServer = { url: string; stop: () => Promise<void> }

/** Sobe target-server-runner.ts como subprocesso Bun; espera a linha `READY <url>` no stdout —
 * mesmo padrão de spawnServer em packages/mcp-web/e2e/fixture.ts. */
function spawnTargetServer(repoPath: string): Promise<TargetServer> {
  // stdin: "ignore" (o runner não lê nada) => o tipo é ChildProcessByStdio<null, ...>, não
  // ChildProcessWithoutNullStreams — só stdout/stderr são pipes aqui.
  const child = spawn("bun", [RUNNER, repoPath], { stdio: ["ignore", "pipe", "pipe"] })
  let stderr = ""
  child.stderr.on("data", (d) => (stderr += String(d)))
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: child.stdout })
    const onExit = (code: number | null) => reject(new Error(`target-server-runner exited (${code}) before READY:\n${stderr}`))
    child.once("exit", onExit)
    rl.on("line", (line) => {
      const m = line.match(/^READY (\S+)$/)
      if (!m) return
      child.off("exit", onExit)
      resolve({
        url: m[1]!,
        stop: () =>
          new Promise<void>((res) => {
            child.once("exit", () => res())
            child.kill("SIGTERM")
          }),
      })
    })
  })
}

async function waitFor(pred: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor: timeout após ${timeoutMs}ms`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

const available = targetRepoAvailable()
const skipReason = available ? false : `repo-alvo ausente em ${targetRepoPath()} — defina OG_TARGET_REPO ou clone harness-kit`

test(
  "connect() + /events contra servidor real: snapshot inicial com ~186 nós, envelope íntegro e seq monotônico",
  { skip: skipReason },
  async () => {
    const { root, cleanup } = prepareTargetRepo()
    const server = await spawnTargetServer(root)
    let og: Awaited<ReturnType<typeof connect>> | null = null
    try {
      // snapshot inicial: publicado no bootstrap automático do servidor (autoBootstrap:true), não
      // via SSE — lido como resource, contagem derivada em runtime (nunca um número mágico).
      const snap = (await resourceRead(server.url, "graph://snapshot")) as { graph: { nodes: unknown[] } }
      const expectedNodes = snap.graph.nodes.length
      assert.ok(expectedNodes > 100, `repo-alvo deveria produzir dezenas de nós (~186 no harness-kit); obteve ${expectedNodes}`)

      const envelopes: Envelope[] = []
      // `graph.rebuild` escreve (publica no log do tenant do chamador), então exige token. Um handle
      // sem `token` nem `store` resolve token = null (resolveToken) e só consegue chamar as tools
      // abertas — daí o registro explícito aqui.
      const creds = await registerSession(server.url, "qa7-client-node-test")
      og = await connect({ server: server.url, token: creds.token, agentKind: "qa7-client-node-test" })
      og.on("*", (env) => envelopes.push(env))

      // graph.rebuild publica incondicionalmente a cada chamada (graph-bootstrap.ts) — dispara N
      // envelopes distinguíveis e reais sobre o /events real para testar seq monotônico.
      for (let i = 0; i < 5; i++) await og.call("graph.rebuild", {})
      await waitFor(() => envelopes.filter((e) => e.kind === "graph.rebuilt").length >= 5)

      const rebuilt = envelopes.filter((e) => e.kind === "graph.rebuilt")
      assert.ok(rebuilt.length >= 5, `esperava >=5 envelopes graph.rebuilt via /events, recebeu ${rebuilt.length}`)

      for (const env of rebuilt) {
        assert.equal(env.schemaVersion, 1)
        assert.equal(typeof env.seq, "number")
        // `ts` é string ISO no fio. Este teste ACHOU a divergência: `Envelope.ts` estava tipado
        // `number` e mentia sobre o contrato — corrigido em subscribe.ts, e o consumidor que
        // dependia disso (mcp-web/src/og.ts, mapa `demotions`) passou a converter explicitamente.
        assert.equal(typeof env.ts, "string")
        assert.ok(!Number.isNaN(Date.parse(env.ts)))
        assert.equal(env.kind, "graph.rebuilt")
        assert.ok("target" in env)
        assert.ok("payload" in env)
        assert.equal(typeof env.graphId, "string")
        assert.ok(env.graphId.length > 0)
      }
      for (let i = 1; i < rebuilt.length; i++) {
        assert.ok(rebuilt[i]!.seq > rebuilt[i - 1]!.seq, `seq deve ser estritamente crescente: ${rebuilt[i - 1]!.seq} -> ${rebuilt[i]!.seq}`)
      }

      // o payload do graph.rebuilt carrega as stats reais — bate com o snapshot lido no início.
      const lastRebuilt = rebuilt.at(-1) as Envelope & { payload: { stats: { nodes: number } } }
      assert.equal(lastRebuilt.payload.stats.nodes, expectedNodes)
    } finally {
      og?.close()
      await server.stop()
      cleanup()
    }
  },
)

test(
  "reconexão: graphId muda quando o conteúdo do repo muda entre restarts; EventStream (subscribe.ts) descarta since e refaz snapshot a partir de 0",
  { skip: skipReason },
  async () => {
    const { root, cleanup } = prepareTargetRepo()
    let server = await spawnTargetServer(root)
    let curUrl = server.url

    const events: Envelope[] = []
    let resetCount = 0
    const sessionIds: string[] = []
    const stream = new EventStream(
      {
        onEvent: (env) => events.push(env),
        onReset: () => resetCount++,
        onOpen: () => {},
        onClose: () => {},
        onSessionId: (id) => sessionIds.push(id),
      },
      { serverBase: () => curUrl },
    )
    try {
      stream.start()
      await waitFor(() => events.some((e) => e.kind === "graph.bootstrapped"))
      const graphId1 = events.find((e) => e.kind === "graph.bootstrapped")!.graphId
      assert.equal(stream.graphId, graphId1)

      await server.stop()

      // graphId é sha256(repoPath + checksum-semântico-do-grafo) — determinístico, NÃO aleatório
      // por processo (graph-bootstrap.ts:103). Um restart puro sobre conteúdo idêntico produziria o
      // MESMO graphId; para exercitar de fato "restart -> graphId novo -> descarta since", o
      // CONJUNTO de nós precisa mudar entre os dois processos — mesmo padrão do teste de
      // idempotência em packages/mcp-server/test/target-repo-scale.test.ts.
      fs.writeFileSync(path.join(root, "sdk", "src", "qa7-reconnect-marker.ts"), "export const qa7ReconnectMarker = true\n")
      fs.rmSync(path.join(root, ".graph"), { recursive: true, force: true })

      server = await spawnTargetServer(root)
      curUrl = server.url

      // EventStream reconecta sozinho (backoff a partir de 500ms — subscribe.ts) contra a NOVA url
      // (serverBase() é lido a cada tentativa); o primeiro envelope da nova sessão carrega um
      // graphId diferente do conhecido -> classifyEnvelope devolve "reset" -> onReset() dispara e o
      // cursor local é zerado (subscribe.ts's reset()).
      await waitFor(() => resetCount >= 1, 15_000)
      await waitFor(() => events.some((e) => e.kind === "graph.bootstrapped" && e.graphId !== graphId1), 15_000)

      const graphId2 = events.filter((e) => e.kind === "graph.bootstrapped").at(-1)!.graphId
      assert.notEqual(graphId2, graphId1, "graphId deveria mudar quando o conjunto de nós muda entre restarts")
      assert.equal(stream.graphId, graphId2, "o cursor do EventStream deveria adotar o graphId novo, não ficar preso ao antigo")

      // prova concreta de "refaz snapshot": o snapshot lido AGORA (pós-reset) reflete o graphId
      // novo — o cliente não está mais confiando em nenhum `since` calculado contra o graphId velho.
      const snap = (await resourceRead(curUrl, "graph://snapshot")) as { graphId: string }
      assert.equal(snap.graphId, graphId2)
    } finally {
      stream.stop()
      await server.stop()
      cleanup()
    }
  },
)
