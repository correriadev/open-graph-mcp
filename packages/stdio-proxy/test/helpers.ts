// helpers.ts — shared real-subprocess-against-real-server test scaffolding for cli.test.ts and
// credentials.test.ts: spawning the proxy as a child process, reading its stdout/stderr line by
// line, and the isolated-fake-$HOME credentials.json helpers. Mirrors the
// packages/mcp-server/test/helpers.ts pattern (a shared helpers module imported by every test file
// in the package) rather than each test file growing its own copy.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const CLI = path.join(import.meta.dir, "..", "src", "cli.ts")

/** A fresh, isolated fake $HOME per call — so credentials.json reads/writes during a test never touch
 * (or race with) the real ~/.open-graph-mcp/credentials.json on whatever machine runs this suite. */
export function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogmcp-proxy-test-"))
}

export function credentialsPathFor(home: string): string {
  return path.join(home, ".open-graph-mcp", "credentials.json")
}

export function readCredentials(home: string): { server: string; token: string; userId: string; tenantId: string } {
  return JSON.parse(fs.readFileSync(credentialsPathFor(home), "utf8"))
}

export type Proxy = {
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
export function makeLineReader(stream: ReadableStream<Uint8Array>) {
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

export function spawnProxy(serverUrl: string, opts: { extraArgs?: string[]; home?: string } = {}): Proxy {
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
