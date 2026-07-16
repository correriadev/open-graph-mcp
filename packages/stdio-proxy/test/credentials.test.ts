// credentials.test.ts — the --name token-bootstrap cluster: on-disk credentials.json (0600),
// session.register bootstrapping, and in-process reuse/memoization. Split out of cli.test.ts
// (Task 3) alongside the src/credentials.ts extraction — cli.test.ts keeps the pure stdio-framing/
// pass-through behavior tests; this file owns everything that touches credential I/O or identity.
//
// Same real-subprocess-against-real-server pattern as cli.test.ts, with an isolated fake $HOME per
// test so credentials.json reads/writes never touch (or race with) the real
// ~/.open-graph-mcp/credentials.json on whatever machine runs this suite.
import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { startServer } from "@open-graph-mcp/mcp-server/index"

const CLI = path.join(import.meta.dir, "..", "src", "cli.ts")

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogmcp-proxy-test-"))
}

function credentialsPathFor(home: string): string {
  return path.join(home, ".open-graph-mcp", "credentials.json")
}

function readCredentials(home: string): { server: string; token: string; userId: string; tenantId: string } {
  return JSON.parse(fs.readFileSync(credentialsPathFor(home), "utf8"))
}

type Proxy = {
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">
  send: (message: unknown) => void
  readLine: (timeoutMs?: number) => Promise<string | null>
  readStderrLine: (timeoutMs?: number) => Promise<string | null>
  kill: () => void
}

/** Incrementally reads newline-delimited text off a ReadableStream, with a per-call timeout so tests
 * can assert "nothing arrived" without hanging forever. Crucially, a timed-out call must NOT abandon
 * its in-flight `reader.read()` — a fresh call to `.read()` cannot run concurrently with one still
 * pending, and worse, whichever of the two resolves first "steals" that chunk, silently dropping data
 * a later call expected to see. So the pending read is memoized and reused across timeouts instead of
 * being restarted. */
function makeLineReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  let pendingRead: ReturnType<typeof reader.read> | null = null

  async function readLine(timeoutMs: number): Promise<string | null> {
    const nl = buf.indexOf("\n")
    if (nl !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      return line
    }
    if (!pendingRead) pendingRead = reader.read()
    const timedOut = Symbol("timeout")
    const result = await Promise.race([
      pendingRead,
      new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), timeoutMs)),
    ])
    if (result === timedOut) return null
    pendingRead = null
    const { value, done } = result as ReadableStreamReadResult<Uint8Array>
    if (done) return null
    buf += decoder.decode(value, { stream: true })
    return readLine(timeoutMs)
  }

  return { readLine }
}

function spawnProxy(serverUrl: string, opts: { extraArgs?: string[]; home?: string } = {}): Proxy {
  const proc = Bun.spawn({
    cmd: ["bun", "run", CLI, "--server", serverUrl, ...(opts.extraArgs ?? [])],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    // Overriding HOME (rather than the default full process.env) is what isolates credentials.json
    // reads/writes to the test's own tmpHome() — os.homedir() on POSIX resolves from $HOME.
    env: opts.home ? { ...process.env, HOME: opts.home } : process.env,
  })
  const stdout = makeLineReader(proc.stdout as ReadableStream<Uint8Array>)
  const stderr = makeLineReader(proc.stderr as ReadableStream<Uint8Array>)
  return {
    proc,
    send: (message: unknown) => {
      proc.stdin.write(JSON.stringify(message) + "\n")
    },
    readLine: (timeoutMs = 5000) => stdout.readLine(timeoutMs),
    readStderrLine: (timeoutMs = 5000) => stderr.readLine(timeoutMs),
    kill: () => {
      try {
        proc.stdin.end()
      } catch {
        /* already closed */
      }
      proc.kill()
    },
  }
}

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
    const mode = fs.statSync(credPath).mode & 0o777
    expect(mode).toBe(0o600)

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
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogmcp-proxy-test-repo-"))
  fs.writeFileSync(path.join(repoDir, "index.ts"), "export const x = 1\n")
  const proxy = spawnProxy(server.url, { extraArgs: ["--name", "Alice"], home })
  try {
    await proxy.readStderrLine() // startup log

    proxy.send({ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "graph.bootstrap", arguments: { repoPath: repoDir } } })

    // graph.bootstrap has no `token` in its inputSchema — no injection line should ever appear.
    const maybeInject = await proxy.readStderrLine(500)
    expect(maybeInject).toBeNull()

    const line = await proxy.readLine()
    const parsed = JSON.parse(line!)
    expect(parsed.id).toBe(13)
    expect(parsed.result.isError).toBeUndefined()

    // Bootstrap was never needed, so the proxy never even called resolveCredentials.
    expect(fs.existsSync(credentialsPathFor(home))).toBe(false)
  } finally {
    proxy.kill()
    server.stop()
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(repoDir, { recursive: true, force: true })
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
    const mode = fs.statSync(credPath).mode & 0o777
    expect(mode).toBe(0o600)
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
