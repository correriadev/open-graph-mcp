import { expect, test } from "bun:test"
import fs from "node:fs"
import { startServer } from "@open-graph-mcp/mcp-server/index"
import { credentialsPathFor, readCredentials, spawnProxy, tmpHome } from "./helpers"

test("initialize request round-trips through stdio to a correct JSON-RPC response", async () => {
  const server = startServer()
  const proxy = spawnProxy(server.url)
  try {
    proxy.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })
    const line = await proxy.readLine()
    expect(line).not.toBeNull()
    const parsed = JSON.parse(line!)
    expect(parsed.jsonrpc).toBe("2.0")
    expect(parsed.id).toBe(1)
    expect(parsed.result.protocolVersion).toBeString()
  } finally {
    proxy.kill()
    server.stop()
  }
})

test("notifications/initialized (no id) produces no stdout response", async () => {
  const server = startServer()
  const proxy = spawnProxy(server.url)
  try {
    proxy.send({ jsonrpc: "2.0", method: "notifications/initialized" })
    const line = await proxy.readLine(500)
    expect(line).toBeNull()
  } finally {
    proxy.kill()
    server.stop()
  }
})

test("tools/list request returns the known tool list", async () => {
  const server = startServer()
  const proxy = spawnProxy(server.url)
  try {
    proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    const line = await proxy.readLine()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(2)
    const names = parsed.result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain("graph.bootstrap")
    expect(names).toContain("session.register")
  } finally {
    proxy.kill()
    server.stop()
  }
})

test("tools/call for a token-free tool (session.register) round-trips a success response", async () => {
  const server = startServer()
  const proxy = spawnProxy(server.url)
  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "session.register", arguments: { name: "alice" } },
    })
    const line = await proxy.readLine()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(3)
    expect(parsed.error).toBeUndefined()
    expect(parsed.result.isError).toBeUndefined()
    expect(parsed.result.structuredContent.userId).toBeString()
    expect(parsed.result.structuredContent.token).toBeString()
  } finally {
    proxy.kill()
    server.stop()
  }
})

test("a request against an unreachable server gets a proxy-originated -32000 error on stdout, not a hang", async () => {
  // Start and immediately stop a server to get a URL nothing is listening on (a genuinely closed port,
  // not a guessed/arbitrary one that might collide with something else).
  const server = startServer()
  const deadUrl = server.url
  server.stop()

  const proxy = spawnProxy(deadUrl)
  try {
    proxy.send({ jsonrpc: "2.0", id: 4, method: "tools/list" })
    const line = await proxy.readLine()
    expect(line).not.toBeNull()
    const parsed = JSON.parse(line!)
    expect(parsed.jsonrpc).toBe("2.0")
    expect(parsed.id).toBe(4)
    expect(parsed.result).toBeUndefined()
    expect(parsed.error.code).toBe(-32000)
    expect(parsed.error.message).toContain("proxy: failed to reach server")
  } finally {
    proxy.kill()
  }
})

test("a notification against an unreachable server is logged to stderr and produces no stdout output", async () => {
  const server = startServer()
  const deadUrl = server.url
  server.stop()

  const proxy = spawnProxy(deadUrl)
  try {
    await proxy.readStderrLine() // startup log line
    proxy.send({ jsonrpc: "2.0", method: "notifications/initialized" })
    const errLine = await proxy.readStderrLine()
    expect(errLine).toContain("failed to forward notification")

    const stdoutLine = await proxy.readLine(400)
    expect(stdoutLine).toBeNull()
  } finally {
    proxy.kill()
  }
})

test("stderr gets a startup log line, but stdout stays silent until an actual JSON-RPC response is due", async () => {
  const server = startServer()
  const proxy = spawnProxy(server.url)
  try {
    // Something lands on stderr promptly on startup.
    const stderrLine = await proxy.readStderrLine()
    expect(stderrLine).not.toBeNull()
    expect(stderrLine).toContain(server.url)

    // Nothing has been sent on stdin yet — stdout must stay silent (no stray banner/log leaked
    // into the protocol channel).
    const prematureStdout = await proxy.readLine(400)
    expect(prematureStdout).toBeNull()

    // Only once we actually send a request does stdout produce exactly the JSON-RPC response.
    proxy.send({ jsonrpc: "2.0", id: 5, method: "tools/list" })
    const responseLine = await proxy.readLine()
    expect(responseLine).not.toBeNull()
    const parsed = JSON.parse(responseLine!)
    expect(parsed.id).toBe(5)
  } finally {
    proxy.kill()
    server.stop()
  }
})

test("proxy exits cleanly (code 0) once stdin closes", async () => {
  const server = startServer()
  const proxy = spawnProxy(server.url)
  try {
    proxy.proc.stdin.end()
    const code = await proxy.proc.exited
    expect(code).toBe(0)
  } finally {
    proxy.kill()
    server.stop()
  }
})

test("a non-JSON HTTP response from --server yields a proxy-originated -32000 error, not a crash", async () => {
  // Point the proxy at something that answers HTTP but isn't this MCP server at all — the server
  // contract (always JSON body for a request-with-id) doesn't hold, so `httpResponse.json()` in
  // forward() must be guarded the same way the fetch() failure itself is.
  const plainServer = Bun.serve({ port: 0, fetch: () => new Response("not json", { status: 200 }) })
  const proxy = spawnProxy(`http://localhost:${plainServer.port}`)
  try {
    proxy.send({ jsonrpc: "2.0", id: 7, method: "tools/list" })
    const line = await proxy.readLine()
    expect(line).not.toBeNull()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(7)
    expect(parsed.result).toBeUndefined()
    expect(parsed.error.code).toBe(-32000)
    expect(parsed.error.message).toContain("proxy: invalid response from server")
  } finally {
    proxy.kill()
    plainServer.stop(true)
  }
})

test("a blank/malformed stdin line is dropped (logged to stderr) without crashing the proxy or breaking subsequent messages", async () => {
  const server = startServer()
  const proxy = spawnProxy(server.url)
  try {
    // A bare newline is a blank line once split by ReadBuffer — `deserializeMessage("")` throws
    // (JSON.parse("") is a parse error). That must not take down the read loop for what follows.
    const startupLine = await proxy.readStderrLine() // the "proxying stdio <-> ..." startup log
    expect(startupLine).not.toBeNull()

    proxy.proc.stdin.write("\n")
    const errLine = await proxy.readStderrLine()
    expect(errLine).toContain("malformed")

    proxy.send({ jsonrpc: "2.0", id: 6, method: "tools/list" })
    const line = await proxy.readLine()
    expect(line).not.toBeNull()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(6)
    expect(parsed.result.tools).toBeArray()
  } finally {
    proxy.kill()
    server.stop()
  }
})

// ── --name token bootstrap ──────────────────────────────────────────────────────────────────────
// (moved to credentials.test.ts alongside the src/credentials.ts extraction — Task 3)

// ── auto re-register on expired token (Task 3) ──────────────────────────────────────────────────
// Retry-on-expiry is scoped EXACTLY to tools/call requests where this proxy itself injected the
// token (--name bootstrap). It must never trigger for a caller-supplied token, and must never retry
// more than once under any circumstance.

test("token expires (server restart, pre-D10) mid-session: proxy re-registers with the same name/tenant and retries once, succeeding", async () => {
  const server = startServer()
  const home = tmpHome()
  const proxy = spawnProxy(server.url, { extraArgs: ["--name", "Alice"], home })
  try {
    await proxy.readStderrLine() // startup log

    // First call: establishes a valid token, injected and persisted normally.
    proxy.send({ jsonrpc: "2.0", id: 30, method: "tools/call", params: { name: "changeset.list_mine", arguments: {} } })
    await proxy.readStderrLine() // "injected token ..." line
    const first = JSON.parse((await proxy.readLine())!)
    expect(first.result.isError).toBeUndefined()
    const credsAfterFirst = readCredentials(home)

    // Simulate a server restart: tokens live purely in-memory (pre-D10, see session.ts), so a
    // restart wipes them while the SQLite-backed user persists. Clearing the in-memory map directly
    // is a deterministic, in-process stand-in for "the server restarted" — the proxy is a black-box
    // HTTP client either way, and the response it gets back is byte-identical to a real restart.
    server.state.tokens.clear()

    proxy.send({ jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "changeset.list_mine", arguments: {} } })

    // The proxy still believes its memoized token is good, so maybeInjectToken injects it as usual
    // BEFORE forwardInjectedToolCall discovers (from the server's response) that it's now stale.
    const injectLine = await proxy.readStderrLine()
    expect(injectLine).toContain("injected token for tools/call changeset.list_mine")

    const expiredLine = await proxy.readStderrLine()
    expect(expiredLine).toContain("token expired, re-registering and retrying tools/call changeset.list_mine")

    // Exactly one retry: no second "token expired" (or third "injected token") line follows.
    const anotherLine = await proxy.readStderrLine(500)
    expect(anotherLine).toBeNull()

    const retryResult = JSON.parse((await proxy.readLine())!)
    expect(retryResult.id).toBe(31)
    expect(retryResult.error).toBeUndefined()
    expect(retryResult.result.isError).toBeUndefined()
    expect(retryResult.result.structuredContent.changesets).toBeArray()

    // The re-registration persisted a NEW token, different from the one that just failed.
    const credsAfterRetry = readCredentials(home)
    expect(credsAfterRetry.token).not.toBe(credsAfterFirst.token)
  } finally {
    proxy.kill()
    server.stop()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("a caller-supplied token that comes back expired is NOT retried — passes through unmodified, no re-registration", async () => {
  const server = startServer()
  const home = tmpHome()
  const proxy = spawnProxy(server.url, { extraArgs: ["--name", "Alice"], home })
  try {
    await proxy.readStderrLine() // startup log

    proxy.send({
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: { name: "changeset.list_mine", arguments: { token: "not-a-real-token" } },
    })

    // No injection line (caller supplied their own token) and, crucially, no re-registration line
    // either — this is the hard boundary: the proxy has no business re-registering on behalf of a
    // caller-supplied identity it never issued.
    const maybeLine = await proxy.readStderrLine(500)
    expect(maybeLine).toBeNull()

    const line = await proxy.readLine()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(32)
    expect(parsed.result.isError).toBe(true)
    expect(parsed.result.content[0].text).toContain("invalid or expired token")

    // No credentials file was ever created — the proxy never touched its own bootstrap identity.
    expect(fs.existsSync(credentialsPathFor(home))).toBe(false)
  } finally {
    proxy.kill()
    server.stop()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("when the retry itself fails for a reason other than token expiry, that failure is written to stdout as final — no second retry", async () => {
  // A mock server driving the exact sequence: first tools/call succeeds (establishes credentials),
  // second tools/call comes back "invalid or expired token" (triggering re-registration + retry),
  // and the RETRY's own tools/call fails for a wholly unrelated reason. The proxy must surface that
  // failure as-is, without attempting yet another retry.
  let registerCalls = 0
  let toolCalls = 0
  const mock = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const body = (await req.json()) as { id?: string | number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }
      if (body.method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          id: "x",
          result: { tools: [{ name: "changeset.list_mine", inputSchema: { type: "object", properties: { token: { type: "string" } } } }] },
        })
      }
      if (body.method === "tools/call" && body.params?.name === "session.register") {
        registerCalls++
        return Response.json({
          jsonrpc: "2.0",
          id: "x",
          result: { structuredContent: { token: `token-${registerCalls}`, userId: "u_1", tenantId: "default" } },
        })
      }
      if (body.method === "tools/call" && body.params?.name === "changeset.list_mine") {
        toolCalls++
        if (toolCalls === 1) {
          return Response.json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { changesets: [] } } })
        }
        if (toolCalls === 2) {
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: { content: [{ type: "text", text: "invalid or expired token — call session.register" }], isError: true },
          })
        }
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "boom: unrelated tool failure" }], isError: true } })
      }
      return Response.json({ jsonrpc: "2.0", id: "x", result: {} })
    },
  })
  const home = tmpHome()
  const proxy = spawnProxy(`http://localhost:${mock.port}`, { extraArgs: ["--name", "Alice"], home })
  try {
    await proxy.readStderrLine() // startup log

    // First call: succeeds, establishes credentials in-process.
    proxy.send({ jsonrpc: "2.0", id: 33, method: "tools/call", params: { name: "changeset.list_mine", arguments: {} } })
    await proxy.readStderrLine() // injected line
    const first = JSON.parse((await proxy.readLine())!)
    expect(first.result.isError).toBeUndefined()

    // Second call: reuses the memoized token (no new "injected" prerequisite beyond the log line),
    // gets the expired-token response, re-registers, retries — and the retry itself fails.
    proxy.send({ jsonrpc: "2.0", id: 34, method: "tools/call", params: { name: "changeset.list_mine", arguments: {} } })
    await proxy.readStderrLine() // injected line (reused token)
    const expiredLine = await proxy.readStderrLine()
    expect(expiredLine).toContain("token expired, re-registering and retrying tools/call changeset.list_mine")

    // No second "token expired" line — the retry's own failure does not trigger yet another retry.
    const anotherLine = await proxy.readStderrLine(500)
    expect(anotherLine).toBeNull()

    const retryResult = JSON.parse((await proxy.readLine())!)
    expect(retryResult.id).toBe(34)
    expect(retryResult.result.isError).toBe(true)
    expect(retryResult.result.content[0].text).toBe("boom: unrelated tool failure")
    expect(retryResult.result.content[0].text).not.toContain("invalid or expired token")

    expect(toolCalls).toBe(3) // success, expired, failed-retry — never a 4th attempt
    expect(registerCalls).toBe(2) // initial bootstrap + exactly one re-registration
  } finally {
    proxy.kill()
    mock.stop(true)
    fs.rmSync(home, { recursive: true, force: true })
  }
})
