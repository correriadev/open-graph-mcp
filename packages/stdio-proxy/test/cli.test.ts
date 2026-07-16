import { expect, test } from "bun:test"
import path from "node:path"
import { startServer } from "@open-graph-mcp/mcp-server/index"

const CLI = path.join(import.meta.dir, "..", "src", "cli.ts")

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

function spawnProxy(serverUrl: string): Proxy {
  const proc = Bun.spawn({
    cmd: ["bun", "run", CLI, "--server", serverUrl],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
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
