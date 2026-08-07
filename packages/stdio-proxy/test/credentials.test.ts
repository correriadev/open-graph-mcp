// credentials.test.ts — the --name token-bootstrap cluster: on-disk credentials.json (0600),
// session.register bootstrapping, and in-process reuse/memoization. Split out of cli.test.ts
// (Task 3) alongside the src/credentials.ts extraction — cli.test.ts keeps the pure stdio-framing/
// pass-through behavior tests, plus the retry-on-expiry orchestration tests (those exercise
// forwardInjectedToolCall's retry decision, not credentials.ts's I/O primitives directly). This file
// owns the credentials.json bootstrap/persistence/reuse behavior itself.
//
// Same real-subprocess-against-real-server pattern as cli.test.ts, with an isolated fake $HOME per
// test so credentials.json reads/writes never touch (or race with) the real
// ~/.open-graph-mcp/credentials.json on whatever machine runs this suite.
import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { startServer } from "@open-graph-mcp/mcp-server/index"
import { credentialsPathFor, readCredentials, spawnProxy, tmpHome } from "./helpers"

// ── --name token bootstrap ──────────────────────────────────────────────────────────────────────

test("--name bootstraps credentials on first token-needing call: registers, injects, and persists 0600 credentials.json", async () => {
  const server = startServer()
  const home = tmpHome()
  const proxy = spawnProxy(server.url, { extraArgs: ["--name", "Alice"], home })
  try {
    await proxy.readStderrLine() // startup log

    proxy.send({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "changeset.list_mine", arguments: {} } })

    const injectLine = await proxy.readStderrLine()
    expect(injectLine).toContain("injected token for tools/call changeset.list_mine")

    const line = await proxy.readLine()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(10)
    expect(parsed.error).toBeUndefined()
    expect(parsed.result.isError).toBeUndefined()
    expect(parsed.result.structuredContent.changesets).toBeArray()

    const credPath = credentialsPathFor(home)
    expect(fs.existsSync(credPath)).toBe(true)
    // Regardless of whether the file was freshly created here (as it is in this test), mode must be
    // exactly 0600 — no group/other bits, since the token inside is a bearer credential.
    // chmod has no permission semantics on Windows (fs.statSync(...).mode is a fabricated
    // read/write-only-ish value there, not a real POSIX bitmask), so this assertion is POSIX-only.
    if (process.platform !== "win32") {
      const mode = fs.statSync(credPath).mode & 0o777
      expect(mode).toBe(0o600)
    }

    const creds = readCredentials(home)
    expect(creds.server).toBe(server.url)
    expect(creds.token).toBeString()
    expect(creds.userId).toBeString()
    expect(creds.tenantId).toBeString()
  } finally {
    proxy.kill()
    server.stop()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("a second tools/call needing a token (different tool) reuses the same in-process credentials — no second session.register", async () => {
  const server = startServer()
  const home = tmpHome()
  const proxy = spawnProxy(server.url, { extraArgs: ["--name", "Alice"], home })
  try {
    await proxy.readStderrLine() // startup log

    proxy.send({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "changeset.list_mine", arguments: {} } })
    await proxy.readStderrLine() // injected line
    const first = JSON.parse((await proxy.readLine())!)
    expect(first.result.isError).toBeUndefined()

    const credsAfterFirst = readCredentials(home)

    // A DIFFERENT token-needing tool, still with no explicit token in its arguments.
    proxy.send({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "changeset.open", arguments: { cells: ["console::Foo"], intent: "second call" } },
    })
    const injectLine2 = await proxy.readStderrLine()
    expect(injectLine2).toContain("injected token for tools/call changeset.open")
    const second = JSON.parse((await proxy.readLine())!)
    expect(second.id).toBe(12)
    expect(second.result.isError).toBeUndefined()
    expect(second.result.structuredContent.ok).toBe(true)

    // The on-disk credentials are byte-for-byte unchanged after the second call — a fresh
    // session.register would have rewritten the file via saveCredentials, so identical content
    // proves the second call reused the memoized identity instead of registering again.
    const credsAfterSecond = readCredentials(home)
    expect(credsAfterSecond).toEqual(credsAfterFirst)
  } finally {
    proxy.kill()
    server.stop()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("--name present but the called tool doesn't declare token: no injection, no credentials file, call passes through", async () => {
  const server = startServer()
  const home = tmpHome()
  const proxy = spawnProxy(server.url, { extraArgs: ["--name", "Alice"], home })
  try {
    await proxy.readStderrLine() // startup log

    // `graph.query` é a tool aberta usada aqui. Foi `graph.bootstrap` até ele passar a exigir token
    // (publica um grafo no tenant do chamador), e depois `graph.subscribe` até SB-0 §5 lhe dar um
    // `token` OPCIONAL no inputSchema (binding sessionId→token). O que este teste cobre é o
    // COMPORTAMENTO do proxy diante de uma tool sem `token` no inputSchema, então basta apontar
    // para uma que ainda seja assim — `graph.query` é read-only e não tem para onde crescer um token.
    proxy.send({ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "graph.query", arguments: { terms: ["nada"] } } })

    // graph.query has no `token` in its inputSchema — no injection line should ever appear.
    const maybeInject = await proxy.readStderrLine(500)
    expect(maybeInject).toBeNull()

    const line = await proxy.readLine()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(13)

    // O proxy nunca chamou resolveCredentials — é isto que o teste prova. O veredito da tool em si
    // (grafo não publicado) é irrelevante aqui: o que importa é que a chamada passou direto, sem
    // injeção de token e sem materializar credentials.json.
    expect(fs.existsSync(credentialsPathFor(home))).toBe(false)
  } finally {
    proxy.kill()
    server.stop()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("a caller-supplied token in arguments is never overwritten by injection", async () => {
  const server = startServer()
  const home = tmpHome()
  const proxy = spawnProxy(server.url, { extraArgs: ["--name", "Alice"], home })
  try {
    await proxy.readStderrLine() // startup log

    proxy.send({
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: { name: "changeset.list_mine", arguments: { token: "not-a-real-token" } },
    })

    // No injection line — the caller already supplied a (bogus, but present) token.
    const maybeInject = await proxy.readStderrLine(500)
    expect(maybeInject).toBeNull()

    const line = await proxy.readLine()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(15)
    // The bogus token reached the real server unmodified and was rejected there — proof it was
    // never swapped out for a proxy-registered one.
    expect(parsed.result.isError).toBe(true)
    expect(parsed.result.content[0].text).toContain("invalid or expired token")

    // No bootstrap happened either: the proxy never needed to resolve credentials for this call.
    expect(fs.existsSync(credentialsPathFor(home))).toBe(false)
  } finally {
    proxy.kill()
    server.stop()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("without --name, a token-needing tools/call passes through unmodified — no injection, no crash", async () => {
  const server = startServer()
  const proxy = spawnProxy(server.url) // no --name: Task 1 pure pass-through
  try {
    proxy.send({ jsonrpc: "2.0", id: 14, method: "tools/call", params: { name: "changeset.list_mine", arguments: {} } })
    const line = await proxy.readLine()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(14)
    expect(parsed.error).toBeUndefined()
    // The real server rejects the missing token itself — the proxy never touched arguments.
    expect(parsed.result.isError).toBe(true)
    expect(parsed.result.content[0].text).toContain("invalid or expired token")
  } finally {
    proxy.kill()
    server.stop()
  }
})

test("a second proxy process sharing the same fake HOME reuses the on-disk credentials instead of registering fresh", async () => {
  const server = startServer()
  const home = tmpHome()

  const proxy1 = spawnProxy(server.url, { extraArgs: ["--name", "Alice"], home })
  try {
    await proxy1.readStderrLine() // startup log
    proxy1.send({ jsonrpc: "2.0", id: 16, method: "tools/call", params: { name: "changeset.list_mine", arguments: {} } })
    await proxy1.readStderrLine() // injected line
    const first = JSON.parse((await proxy1.readLine())!)
    expect(first.result.isError).toBeUndefined()
  } finally {
    proxy1.kill()
  }

  const credsAfterFirstRun = readCredentials(home)

  const proxy2 = spawnProxy(server.url, { extraArgs: ["--name", "Alice"], home })
  try {
    await proxy2.readStderrLine() // startup log
    proxy2.send({ jsonrpc: "2.0", id: 17, method: "tools/call", params: { name: "changeset.list_mine", arguments: {} } })
    const injectLine = await proxy2.readStderrLine()
    expect(injectLine).toContain("injected token for tools/call changeset.list_mine")
    const second = JSON.parse((await proxy2.readLine())!)
    expect(second.id).toBe(17)
    expect(second.result.isError).toBeUndefined()
  } finally {
    proxy2.kill()
  }

  // The credentials file from the SECOND process's run is identical to the first's — proving the
  // second proxy launch reused what was on disk instead of calling session.register again.
  const credsAfterSecondRun = readCredentials(home)
  expect(credsAfterSecondRun).toEqual(credsAfterFirstRun)

  server.stop()
  fs.rmSync(home, { recursive: true, force: true })
})

test("a credentials.json with a mismatched server field is ignored — proxy registers fresh and overwrites it", async () => {
  const server = startServer()
  const home = tmpHome()
  const credPath = credentialsPathFor(home)
  fs.mkdirSync(path.dirname(credPath), { recursive: true })
  const stale = { server: "http://somewhere-else:9999", token: "stale-token", userId: "u_stale", tenantId: "default" }
  // Deliberately world-readable, to exercise the "overwrite must still end up 0600" guarantee —
  // writeFileSync's `mode` option alone does not reliably reset an EXISTING file's permission bits.
  fs.writeFileSync(credPath, JSON.stringify(stale), { mode: 0o644 })

  const proxy = spawnProxy(server.url, { extraArgs: ["--name", "Alice"], home })
  try {
    await proxy.readStderrLine() // startup log
    proxy.send({ jsonrpc: "2.0", id: 18, method: "tools/call", params: { name: "changeset.list_mine", arguments: {} } })
    const injectLine = await proxy.readStderrLine()
    expect(injectLine).toContain("injected token for tools/call changeset.list_mine")
    const line = await proxy.readLine()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(18)
    expect(parsed.result.isError).toBeUndefined()

    const fresh = readCredentials(home)
    expect(fresh.server).toBe(server.url)
    expect(fresh.token).not.toBe(stale.token)

    // Overwriting an existing (previously 0644) file must still land on exactly 0600 — the explicit
    // chmodSync after writeFileSync is what guarantees this, not the writeFileSync mode option alone.
    // chmod has no permission semantics on Windows, so this assertion is POSIX-only (see the other
    // 0600 assertion above for why).
    if (process.platform !== "win32") {
      const mode = fs.statSync(credPath).mode & 0o777
      expect(mode).toBe(0o600)
    }
  } finally {
    proxy.kill()
    server.stop()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("when session.register itself fails, the proxy replies with a proxy-side isError result (not a hang, not a -32000)", async () => {
  // A mock server that answers tools/list with a real-shaped tool list (so the proxy's schema cache
  // decides injection IS needed) but makes session.register itself fail — this is the only way to
  // actually reach maybeInjectToken's resolveCredentials-failure branch: a fully dead --server never
  // gets past ensureToolSchemaCache, so the tool would look non-token-declaring and skip injection
  // entirely (falling through to forward()'s own -32000, a different code path already covered above).
  const mock = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const body = (await req.json()) as { method?: string; params?: { name?: string } }
      if (body.method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          id: "x",
          result: {
            tools: [{ name: "changeset.list_mine", inputSchema: { type: "object", required: ["token"], properties: { token: { type: "string" } } } }],
          },
        })
      }
      if (body.method === "tools/call" && body.params?.name === "session.register") {
        // Mimics the real server's own tool-execution-failure convention for a broken registration.
        return Response.json({ jsonrpc: "2.0", id: "x", result: { content: [{ type: "text", text: "boom" }], isError: true } })
      }
      return Response.json({ jsonrpc: "2.0", id: "x", result: {} })
    },
  })
  const home = tmpHome()
  const proxy = spawnProxy(`http://localhost:${mock.port}`, { extraArgs: ["--name", "Alice"], home })
  try {
    await proxy.readStderrLine() // startup log

    proxy.send({ jsonrpc: "2.0", id: 19, method: "tools/call", params: { name: "changeset.list_mine", arguments: {} } })

    // No "injected token" line — resolution failed before injection could happen.
    const maybeInject = await proxy.readStderrLine(500)
    expect(maybeInject).toBeNull()

    const line = await proxy.readLine()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(19)
    expect(parsed.error).toBeUndefined() // isError result, NOT a JSON-RPC protocol error
    expect(parsed.result.isError).toBe(true)
    expect(parsed.result.content[0].text).toContain("proxy: failed to obtain a token")

    // Nothing should have been persisted on a failed resolution.
    expect(fs.existsSync(credentialsPathFor(home))).toBe(false)
  } finally {
    proxy.kill()
    mock.stop(true)
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("--tenant threads through registration into the persisted credentials", async () => {
  const server = startServer()
  const home = tmpHome()
  const proxy = spawnProxy(server.url, { extraArgs: ["--name", "Alice", "--tenant", "acme"], home })
  try {
    await proxy.readStderrLine() // startup log
    proxy.send({ jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "changeset.list_mine", arguments: {} } })
    await proxy.readStderrLine() // injected line
    const line = await proxy.readLine()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(20)
    expect(parsed.result.isError).toBeUndefined()

    const creds = readCredentials(home)
    expect(creds.tenantId).toBe("acme")
  } finally {
    proxy.kill()
    server.stop()
    fs.rmSync(home, { recursive: true, force: true })
  }
})
