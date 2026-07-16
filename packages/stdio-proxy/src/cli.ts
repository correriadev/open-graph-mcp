#!/usr/bin/env bun
/**
 * cli.ts — thin stdio↔HTTP proxy. Reads newline-delimited JSON-RPC messages from stdin (MCP's stdio
 * framing — no Content-Length headers, unlike LSP), forwards each one to a running `/mcp` HTTP
 * endpoint (see packages/mcp-server), and writes the JSON-RPC response back to stdout for requests
 * (messages with an `id`). Notifications (no `id`) are forwarded but produce no stdout output, per
 * JSON-RPC semantics — the server itself answers those with an empty 204.
 *
 * stdout is EXCLUSIVELY the JSON-RPC channel back to the calling MCP client. All diagnostics/logging
 * go to stderr — anything stray on stdout corrupts the protocol stream for every real MCP client.
 *
 * Opt-in token bootstrap (--name [--tenant]): on the first tools/call whose target tool declares
 * `token` in its inputSchema and whose arguments don't already carry one, the proxy transparently
 * resolves credentials (reusing ~/.open-graph-mcp/credentials.json when it matches --server, else
 * calling session.register itself) and injects the token — the calling agent never needs to know a
 * token exists. Without --name, none of this activates: pure Task 1 pass-through.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js"
import { isJSONRPCRequest, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"

function parseArgs(argv: string[]): { server: string; name?: string; tenant?: string } {
  const idx = argv.indexOf("--server")
  const value = idx === -1 ? undefined : argv[idx + 1]
  if (!value) {
    process.stderr.write("stdio-proxy: missing required --server <url> (e.g. --server http://localhost:8787)\n")
    process.exit(1)
  }
  const nameIdx = argv.indexOf("--name")
  const name = nameIdx === -1 ? undefined : argv[nameIdx + 1]
  const tenantIdx = argv.indexOf("--tenant")
  const tenant = tenantIdx === -1 ? undefined : argv[tenantIdx + 1]
  return { server: value.replace(/\/+$/, ""), name, tenant }
}

/** Forward one JSON-RPC message over HTTP to `${server}/mcp`. Requests (have `id`) get their response
 * written to stdout; notifications (no `id`) never produce stdout output, matching the server's own
 * 204-for-notifications behavior. A network failure forwarding a REQUEST still needs a stdout reply
 * (else the calling client hangs forever) — synthesize a proxy-originated JSON-RPC error locally.
 * A network failure forwarding a NOTIFICATION just gets logged to stderr; still no stdout output. */
function errorReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Synthesize a proxy-originated JSON-RPC error reply to stdout, correlated to the failed request's id. */
function sendProxyError(id: string | number, reason: string): void {
  const errorResponse: JSONRPCMessage = {
    jsonrpc: "2.0",
    id,
    error: { code: -32000, message: reason },
  }
  process.stdout.write(serializeMessage(errorResponse))
}

/** Synthesize a proxy-originated JSON-RPC SUCCESS reply shaped like the server's own tool-execution
 * failure convention (isError:true content, not a protocol-level `error`) — see the -32000 sibling
 * above for the "unreachable server" case; this one is for "we couldn't get a token to attach to your
 * call" specifically, which is a tool-execution-shaped failure, not a transport one. Keeps the calling
 * client's error-handling path uniform with how the real server reports tool failures. */
function sendProxyToolError(id: string | number, text: string): void {
  const response: JSONRPCMessage = {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text }], isError: true },
  } as JSONRPCMessage
  process.stdout.write(serializeMessage(response))
}

// ── token bootstrap (--name / --tenant) ─────────────────────────────────────────────────────────
// Everything below only ever runs when --name was passed; see maybeInjectToken's early return.

type Credentials = { server: string; token: string; userId: string; tenantId: string }
type ToolDefinition = { name: string; inputSchema?: { properties?: Record<string, unknown> } }

function credentialsPath(): string {
  return path.join(os.homedir(), ".open-graph-mcp", "credentials.json")
}

/** Reads+validates the on-disk credentials file. Any problem at all (missing, unreadable, corrupt
 * JSON, wrong shape) is treated the same way: "no usable credentials on disk" — caller falls back to
 * registering fresh. This is deliberately permissive about the failure mode; it's not this function's
 * job to distinguish "file doesn't exist" from "file is garbage". */
function loadCredentials(): Credentials | null {
  try {
    const raw = fs.readFileSync(credentialsPath(), "utf8")
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed.server === "string" &&
      typeof parsed.token === "string" &&
      typeof parsed.userId === "string" &&
      typeof parsed.tenantId === "string"
    ) {
      return parsed as Credentials
    }
    return null
  } catch {
    return null
  }
}

/** Persists credentials at 0600, regardless of whether the file previously existed. `writeFileSync`'s
 * `mode` option only reliably applies via the underlying open() flags on FIRST creation — an existing
 * file's mode is NOT guaranteed to be reset by a plain overwrite — so `chmodSync` is called explicitly
 * every time as a belt-and-suspenders guarantee of the 0600 invariant regardless of prior state. */
function saveCredentials(creds: Credentials): void {
  const file = credentialsPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(creds, null, 2), { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}

/** Calls session.register itself via the same raw-fetch-to-/mcp pattern forward() uses — this is the
 * proxy's own internal bookkeeping call, never relayed to the client (the client didn't ask for it). */
async function registerSession(server: string, name: string, tenant: string | undefined): Promise<Credentials> {
  const args: Record<string, string> = { name }
  if (tenant) args.tenant = tenant
  const httpResponse = await fetch(`${server}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "stdio-proxy-bootstrap-register",
      method: "tools/call",
      params: { name: "session.register", arguments: args },
    }),
  })
  const body = (await httpResponse.json()) as { result?: { isError?: boolean; structuredContent?: Partial<Credentials> } }
  const structured = body?.result?.structuredContent
  if (body?.result?.isError || !structured?.token || !structured?.userId || !structured?.tenantId) {
    throw new Error("session.register returned no usable token")
  }
  return { server, token: structured.token, userId: structured.userId, tenantId: structured.tenantId }
}

// Memoized for the process lifetime — but ONLY once resolution actually succeeds. A failed attempt is
// deliberately NOT cached as a permanent failure: a transient network blip on the first call shouldn't
// wedge every subsequent tools/call in this process into failing forever with no way to recover short
// of a restart. (This is separate from Task 3's retry-on-expired-token; this is just "don't poison the
// cache with a failure".) Safe without extra locking because the main stdin loop awaits each message's
// handling — including this — before reading the next, so calls here are never concurrent.
let cachedCredentials: Credentials | null = null

async function resolveCredentials(server: string, name: string, tenant: string | undefined): Promise<Credentials> {
  if (cachedCredentials) return cachedCredentials
  const existing = loadCredentials()
  if (existing && existing.server === server) {
    cachedCredentials = existing
    return existing
  }
  const fresh = await registerSession(server, name, tenant)
  saveCredentials(fresh)
  cachedCredentials = fresh
  return fresh
}

// Tool-schema cache, populated lazily (first tools/call that needs it) from an internal tools/list —
// NOT relayed to the client, same "proxy's own bookkeeping" idea as registerSession above. Cached for
// the process lifetime: schemas don't change mid-session. Left empty (rather than a "already tried"
// flag) on fetch failure, so a later call naturally retries instead of getting permanently stuck.
const toolSchemaCache = new Map<string, ToolDefinition>()

async function ensureToolSchemaCache(server: string): Promise<void> {
  if (toolSchemaCache.size > 0) return
  try {
    const httpResponse = await fetch(`${server}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "stdio-proxy-bootstrap-tools-list", method: "tools/list" }),
    })
    const body = (await httpResponse.json()) as { result?: { tools?: ToolDefinition[] } }
    for (const tool of body?.result?.tools ?? []) {
      if (tool && typeof tool.name === "string") toolSchemaCache.set(tool.name, tool)
    }
  } catch (err) {
    process.stderr.write(`stdio-proxy: failed to fetch tool schemas for token bootstrap: ${errorReason(err)}\n`)
  }
}

/** Decides whether an incoming tools/call needs a token injected, and does so. Returns:
 *  - the SAME message reference, unmodified, when no injection is needed (tool unknown/not
 *    token-aware, or the caller already supplied a token) — the common/default case;
 *  - a CLONE of the message with `params.arguments.token` set, when injection applies and
 *    credential resolution succeeded;
 *  - `null` when injection applies but credential resolution failed — in that case a proxy-side
 *    isError response has ALREADY been written to stdout and the caller must not forward anything.
 * Only ever called when --name is set (see main()'s call site). */
async function maybeInjectToken(server: string, name: string, tenant: string | undefined, message: JSONRPCMessage): Promise<JSONRPCMessage | null> {
  const params = (message as { params?: { name?: string; arguments?: Record<string, unknown> } }).params
  const toolName = params?.name
  if (!toolName) return message

  await ensureToolSchemaCache(server)
  const tool = toolSchemaCache.get(toolName)
  const declaresToken = !!tool?.inputSchema?.properties && Object.prototype.hasOwnProperty.call(tool.inputSchema.properties, "token")
  if (!declaresToken) return message
  if (params?.arguments?.token) return message // caller already supplied one — never overwrite it

  let creds: Credentials
  try {
    creds = await resolveCredentials(server, name, tenant)
  } catch (err) {
    sendProxyToolError((message as { id: string | number }).id, `proxy: failed to obtain a token: ${errorReason(err)}`)
    return null
  }

  const cloned = structuredClone(message) as JSONRPCMessage & { params: { arguments?: Record<string, unknown> } }
  cloned.params.arguments = { ...(cloned.params.arguments ?? {}), token: creds.token }
  process.stderr.write(`stdio-proxy: injected token for tools/call ${toolName}\n`)
  return cloned
}

async function forward(server: string, message: JSONRPCMessage): Promise<void> {
  const isRequest = isJSONRPCRequest(message)

  let httpResponse: Response
  try {
    httpResponse = await fetch(`${server}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    })
  } catch (err) {
    const reason = errorReason(err)
    if (!isRequest) {
      const method = "method" in message ? message.method : "unknown"
      process.stderr.write(`stdio-proxy: failed to forward notification (${method}): ${reason}\n`)
      return
    }
    sendProxyError(message.id, `proxy: failed to reach server: ${reason}`)
    return
  }

  if (!isRequest) return // notification: server answers 204, nothing to relay to stdout

  // Same reasoning as the fetch() catch above: this server always answers a request-with-id with a
  // JSON body, but `--server` could point at something else entirely (wrong port, a plain web server,
  // an empty body) — `.json()` rejecting must not escape uncaught and take the whole proxy down.
  try {
    const body = await httpResponse.json()
    process.stdout.write(serializeMessage(body as JSONRPCMessage))
  } catch (err) {
    sendProxyError(message.id, `proxy: invalid response from server: ${errorReason(err)}`)
  }
}

async function main(): Promise<void> {
  const { server, name, tenant } = parseArgs(process.argv.slice(2))
  process.stderr.write(`stdio-proxy: proxying stdio <-> ${server}/mcp\n`)

  const readBuffer = new ReadBuffer()
  for await (const chunk of process.stdin) {
    readBuffer.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    for (;;) {
      // Mirrors the SDK's own StdioServerTransport.processReadBuffer(): parsing/validating one line
      // (readMessage → deserializeMessage → JSONRPCMessageSchema.parse) can throw on a blank or
      // malformed line. That must not crash the whole proxy process — an uncaught throw here would
      // kill the stdin loop for every SUBSEQUENT message too, not just the bad one. Log and skip.
      let message: JSONRPCMessage | null
      try {
        message = readBuffer.readMessage()
      } catch (err) {
        process.stderr.write(`stdio-proxy: dropping malformed stdin line: ${errorReason(err)}\n`)
        continue
      }
      if (message === null) break

      // Opt-in token bootstrap: only ever touches tools/call requests, and only when --name was
      // passed. Without --name this block is skipped entirely — pure Task 1 pass-through, unchanged.
      let outgoing: JSONRPCMessage | null = message
      if (name && isJSONRPCRequest(message) && message.method === "tools/call") {
        outgoing = await maybeInjectToken(server, name, tenant, message)
      }
      if (outgoing === null) continue // injection failed; a proxy-side isError reply already went to stdout

      // Deliberately sequential: awaiting each forward() before reading the next buffered message
      // means pipelined stdin requests are still processed one at a time, in order. Not an oversight —
      // don't parallelize this without checking whether later token/ordering logic depends on it.
      await forward(server, outgoing)
    }
  }
  process.exit(0)
}

main()
