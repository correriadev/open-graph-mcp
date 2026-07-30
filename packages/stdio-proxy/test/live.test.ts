// live.test.ts — the --live flag (INT-2): closes the sessionId gap that Task 4's LIVE_LAYER_TOOLS stub
// (see cli.test.ts) exists to paper over. Same real-subprocess-against-real-server pattern as
// cli.test.ts/credentials.test.ts. cli.test.ts already covers "without --live, presence.focus/beat get
// the stub error" (and does so even with --name passed) — not duplicated here; this file only covers
// what's NEW: --live's fail-fast validation and --live's actual routing through a live OgHandle.
import { expect, test } from "bun:test"
import fs from "node:fs"
import { startServer } from "@open-graph-mcp/mcp-server/index"
import { spawnProxy, tmpHome } from "./helpers"
import { prepareTargetRepo, targetRepoAvailable, targetRepoPath } from "../../mcp-server/test/fixtures/target-repo"

test("--live without --name fails fast with a clear stderr error and a non-zero exit", async () => {
  const server = startServer()
  try {
    const proxy = spawnProxy(server.url, { extraArgs: ["--live"] })
    try {
      const errLine = await proxy.readStderrLine()
      expect(errLine).toContain("--live requires --name")
      const code = await proxy.proc.exited
      expect(code).toBe(1)
    } finally {
      proxy.kill()
    }
  } finally {
    server.stop()
  }
})

test("--live --name X: presence.focus genuinely reaches the real server (sessionId gap closed, not re-stubbed)", async () => {
  const server = startServer()
  const home = tmpHome()
  const proxy = spawnProxy(server.url, { extraArgs: ["--live", "--name", "Alice"], home })
  try {
    await proxy.readStderrLine() // startup log ("proxying stdio <-> ...")
    const readyLine = await proxy.readStderrLine(10_000) // "live layer session ready" (onReattach)
    expect(readyLine).toContain("live layer session ready")

    proxy.send({
      jsonrpc: "2.0",
      id: 50,
      method: "tools/call",
      params: { name: "presence.focus", arguments: { cell: "console::Foo" } },
    })
    const line = await proxy.readLine()
    expect(line).not.toBeNull()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(50)
    expect(parsed.error).toBeUndefined()
    expect(parsed.result.isError).toBeUndefined()
    expect(parsed.result.structuredContent.ok).toBe(true)

    // The decisive proof this isn't just a differently-shaped stub: the real server's own Presence map
    // (packages/mcp-server/src/state.ts) now has an entry whose focusCell is EXACTLY what we sent. The
    // automatic redeclarePresence() that fires once the SSE session is established (connect.ts's
    // onFreshSession) only ever declares cell:null — so a "console::Foo" focusCell can only have
    // resulted from THIS call's arguments genuinely round-tripping through OgHandle.presence.focus() to
    // the server's presence.focus tool, sessionId and all.
    const presences = [...server.state.presence.values()] as Array<{ focusCell: string | null }>
    expect(presences.some((p) => p.focusCell === "console::Foo")).toBe(true)
  } finally {
    proxy.kill()
    server.stop()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("--live --name X: presence.beat genuinely reaches the real server (sessionId gap closed, not re-stubbed)", async () => {
  const server = startServer()
  const home = tmpHome()
  const proxy = spawnProxy(server.url, { extraArgs: ["--live", "--name", "Bob"], home })
  try {
    await proxy.readStderrLine() // startup log
    const readyLine = await proxy.readStderrLine(10_000) // "live layer session ready" (onReattach)
    expect(readyLine).toContain("live layer session ready")

    const beforeSend = Date.now()
    proxy.send({
      jsonrpc: "2.0",
      id: 51,
      method: "tools/call",
      params: { name: "presence.beat", arguments: {} },
    })
    const line = await proxy.readLine()
    expect(line).not.toBeNull()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(51)
    expect(parsed.error).toBeUndefined()
    expect(parsed.result.isError).toBeUndefined()
    expect(parsed.result.structuredContent.ok).toBe(true)

    // The decisive proof: `serverTs` is the REAL server's own presence.beat return value (packages/
    // mcp-server/src/tools/presence.ts's presenceBeat returns `{ok:true, serverTs: Date.now()}`),
    // forwarded through OgHandle.presence.beat() and routeLiveLayerCall UNMODIFIED (see cli.ts's doc
    // comment on why beat's payload is relayed as-is rather than fabricated like focus's `{ok:true}`).
    // A stub or a locally-swallowed no-op has no way to produce a timestamp minted by the server AFTER
    // this test sent its request.
    const serverTs = parsed.result.structuredContent.serverTs
    expect(typeof serverTs).toBe("number")
    expect(serverTs).toBeGreaterThanOrEqual(beforeSend)
  } finally {
    proxy.kill()
    server.stop()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// ── QA-7 Fase 4: enquadramento de mensagem JSON-RPC sob payload GRANDE ──────────────────────────
// Todos os testes acima trocam mensagens de poucas linhas — não provam nada sobre o ReadBuffer do
// proxy (helpers.ts's makeLineReader / o parser real do MCP SDK usado por cli.ts) quando UMA única
// linha JSON-RPC carrega dezenas de KB. `graph://snapshot` sobre o repo-alvo real (~186 nós) é o
// payload mais realista disponível neste monorepo para isso.
test.skipIf(!targetRepoAvailable())(
  `QA-7 Fase 4: resources/read graph://snapshot com payload grande (~186 nós de ${targetRepoPath()}) atravessa o enquadramento stdio sem corromper a linha JSON-RPC`,
  async () => {
    const { root, cleanup } = prepareTargetRepo()
    const server = startServer({ repoPath: root, watch: false, autoBootstrap: true })
    const proxy = spawnProxy(server.url)
    try {
      await proxy.readStderrLine() // startup log

      proxy.send({ jsonrpc: "2.0", id: 60, method: "resources/read", params: { uri: "graph://snapshot" } })
      const line = await proxy.readLine(10_000)
      expect(line).not.toBeNull()
      // Se o proxy tivesse partido a mensagem em múltiplos frames (ou concatenado com outra),
      // JSON.parse já teria lançado aqui — a asserção mais forte é essa exceção nunca acontecer.
      const parsed = JSON.parse(line!)
      expect(parsed.id).toBe(60)
      expect(parsed.error).toBeUndefined()

      const contents = JSON.parse(parsed.result.contents[0].text)
      expect(contents.graph.nodes.length).toBeGreaterThan(100) // ~186 no harness-kit, derivado em runtime pelo próprio servidor

      // Exatamente UMA linha chegou para esta resposta — sem uma segunda linha residual de um
      // frame partido ao meio.
      const followUp = await proxy.readLine(500)
      expect(followUp).toBeNull()
    } finally {
      proxy.kill()
      server.stop()
      cleanup()
    }
  },
)
