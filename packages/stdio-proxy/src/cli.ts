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
 *
 * Auto re-register on expired token (Task 3): the server (pre-D10) keeps tokens in memory only, so a
 * restart silently invalidates every previously-issued token. For a `tools/call` where THIS proxy
 * injected the token (never for a caller-supplied one — see forwardInjectedToolCall), a response
 * matching the server's `"invalid or expired token"` convention triggers exactly one re-registration
 * (same --name/--tenant) and one retry of the original call, logged to stderr.
 *
 * Live-layer session interception (Task 4) / --live (INT-2): `presence.focus`/`presence.beat` require
 * a `sessionId` sourced from the server's SSE `/events` connection, which a vanilla stdio client never
 * has. Without --live, the proxy intercepts them unconditionally (independent of --name) and replies
 * with a clear proxy-originated error — see isLiveLayerToolCall/LIVE_LAYER_TOOLS below. WITH --live,
 * the proxy instead keeps a real `@open-graph-mcp/client` `OgHandle` alive for the process lifetime
 * (see main()'s `og` variable) and routes these two calls through it — see routeLiveLayerCall.
 */
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js"
import { isJSONRPCRequest, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import { connect, type OgHandle } from "@open-graph-mcp/client"
import { fileTokenStore } from "@open-graph-mcp/client/node-store"
import { type Credentials, postMcp, reregisterCredentials, resolveCredentials } from "./credentials"

function parseArgs(argv: string[]): { server: string; name?: string; tenant?: string; live: boolean } {
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
  const live = argv.includes("--live")
  if (live && !name) {
    process.stderr.write(
      "stdio-proxy: --live requires --name <name> (a live SSE session needs an identity to register/reconnect under)\n",
    )
    process.exit(1)
  }
  return { server: value.replace(/\/+$/, ""), name, tenant, live }
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

/** Synthesize a proxy-originated JSON-RPC success reply shaped like the server's own tool-execution
 * SUCCESS convention (structuredContent + a text mirror, isError omitted) — the --live counterpart to
 * sendProxyToolError above. Used by routeLiveLayerCall: the real server's presence.focus/beat tools
 * return `{ok:true}` (or `{ok:true, serverTs}` for beat) on success (packages/mcp-server/src/tools/
 * presence.ts), but `OgHandle.presence.focus`/`.beat()` deliberately discard that payload (Promise<void>
 * — see connect.ts), so this synthesizes the same `{ok:true}` shape rather than fabricating a serverTs
 * this proxy never actually saw. */
function sendProxyToolSuccess(id: string | number, structuredContent: Record<string, unknown>): void {
  const response: JSONRPCMessage = {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent },
  } as JSONRPCMessage
  process.stdout.write(serializeMessage(response))
}

/** POST `body` to `${server}/mcp` and parse the JSON-RPC response, correlated to `id` for error
 * reporting. On ANY failure (network, or a non-JSON/malformed response body) a proxy-originated
 * -32000 reply is written to stdout via sendProxyError and this returns `null` — the caller's only
 * job on `null` is to stop, since the stdout reply has already happened. This is the one place that
 * failure discipline lives; every request/response call site (forward()'s request path,
 * forwardInjectedToolCall()'s initial send AND its retry) goes through here instead of repeating the
 * postMcp→try/catch→.json()→try/catch shape inline. Request-shaped only — NOT for notifications,
 * which have no response body to parse and use their own (stderr-only, no stdout reply) failure
 * handling in forward(). */
async function postAndParse(server: string, body: unknown, id: string | number): Promise<JSONRPCMessage | null> {
  let httpResponse: Response
  try {
    httpResponse = await postMcp(server, body)
  } catch (err) {
    sendProxyError(id, `proxy: failed to reach server: ${errorReason(err)}`)
    return null
  }
  try {
    return (await httpResponse.json()) as JSONRPCMessage
  } catch (err) {
    sendProxyError(id, `proxy: invalid response from server: ${errorReason(err)}`)
    return null
  }
}

/** Clones `message` and sets `params.arguments.token` to `token`, leaving `message` itself untouched.
 * Shared by maybeInjectToken (the initial injection) and forwardInjectedToolCall's retry (swapping in
 * the freshly re-registered token) — both need the identical clone-and-stamp operation. */
function withToken(message: JSONRPCMessage, token: string): JSONRPCMessage {
  const cloned = structuredClone(message) as JSONRPCMessage & { params: { arguments?: Record<string, unknown> } }
  cloned.params.arguments = { ...(cloned.params.arguments ?? {}), token }
  return cloned
}

// ── live-layer session interception (presence.focus / presence.beat) ───────────────────────────
// These two tools require a `sessionId` sourced from the server's SSE `/events` connection (see
// packages/mcp-server/src/tools/presence.ts's presenceBeat/presenceFocus inline sessionId checks and
// packages/mcp-server/src/transport.ts's TOOLS entries for presence.focus/presence.beat) — a vanilla
// stdio-connected client has no SSE channel and thus no way to obtain one. Forwarding such a call
// to the server would fail with a cryptic "sessionId required" (or, if a caller somehow supplied a
// bogus sessionId, something even less obvious).
//
// WITHOUT --live: this proxy intercepts calls to these two SPECIFIC tools unconditionally — with or
// without --name — and answers with an unambiguous proxy-originated error, WITHOUT ever attempting to
// reach the server. This is checked before, and is entirely independent of, the --name token-bootstrap
// logic below: the sessionId gap is structural to the stdio transport itself, not a token-availability
// problem, and the two concerns must not get tangled. This is the INT-1-scoped placeholder behavior,
// unchanged since Task 4.
//
// WITH --live (INT-2): main() keeps a real `OgHandle` (`@open-graph-mcp/client`'s connect()) alive for
// the process, and routes calls to these two tools through it instead — see routeLiveLayerCall below.
// isLiveLayerToolCall/LIVE_LAYER_TOOLS themselves are unchanged; only what main() DOES once it
// recognizes one of these calls depends on --live.
//
// NOTE for whoever adds a tool later: graph.subscribe also requires sessionId (same structural gap)
// but is deliberately NOT in this set — the INT-1 DoD scopes this interception to presence.focus/beat
// only, and graph.subscribe's failure mode without a real sessionId is a silent no-op (writes a
// subscription entry nobody reads), not the cryptic-throw problem this stub exists to avoid. If a
// FUTURE tool structurally requires sessionId AND fails loudly/cryptically without one, check whether
// it belongs here too — don't assume this set is exhaustive over "every tool needing sessionId".
const LIVE_LAYER_TOOLS = new Set(["presence.focus", "presence.beat"])

/** True for a `tools/call` request whose target tool is one of LIVE_LAYER_TOOLS. Notifications and
 * every other method/tool are unaffected. */
function isLiveLayerToolCall(message: JSONRPCMessage): boolean {
  if (!isJSONRPCRequest(message) || message.method !== "tools/call") return false
  const toolName = (message as JSONRPCMessage & { params?: { name?: string } }).params?.name
  return typeof toolName === "string" && LIVE_LAYER_TOOLS.has(toolName)
}

/** --live's real fulfillment of a presence.focus/presence.beat tools/call (see isLiveLayerToolCall) —
 * only ever called when `og` is a live OgHandle (main()'s `--live` branch).
 *
 * Design Decision A (INT-2 task brief): `og.presence.focus(cell, opts)` is the natural fit for an
 * incoming `presence.focus` call — it already handles sessionId injection internally, exactly what a
 * vanilla stdio client structurally lacks. `presence.beat` had no equivalent exposed primitive before
 * this task (the automatic 15s beat was fully internal to connect()); rather than (a) silently no-op'ing
 * an explicit beat call from a real MCP client — wrong, per the task brief, since beat has a real
 * observable effect (the client's own liveness signal) it's entitled to expect — or (b) duplicating the
 * {sessionId, agentKind} argument-shape construction here, `OgHandle` gained a minimal `presence.beat()`
 * method (packages/client/src/connect.ts) that reuses the exact same `beatOnce()` internal the automatic
 * timer already calls. So both tools now route through real `OgHandle` methods, symmetrically.
 *
 * Success reply: `presence.focus` (Promise<void> — no server payload to relay) gets a synthesized
 * `{ok:true}` via sendProxyToolSuccess. `presence.beat` resolves to the server's REAL unwrapped result
 * (`{ok:true, serverTs}` — see OgHandle.presence.beat's doc comment) which is forwarded as-is, so the
 * calling client sees genuine server content, not a proxy fabrication. Failure (thrown by either method
 * — e.g. og.presence.beat()'s "no session id yet" error, or the underlying og.call()'s own RPC failure)
 * becomes an isError:true reply via sendProxyToolError, matching this file's existing failure-
 * translation convention (maybeInjectToken's resolveCredentials-failure branch does the identical
 * translation) rather than an uncaught rejection that would hang the stdio loop for this message. */
async function routeLiveLayerCall(og: OgHandle, message: JSONRPCMessage): Promise<void> {
  const req = message as JSONRPCMessage & { id: string | number; params: { name: string; arguments?: Record<string, unknown> } }
  const toolName = req.params.name
  const args = req.params.arguments ?? {}
  try {
    if (toolName === "presence.focus") {
      const cell = typeof args.cell === "string" ? args.cell : null
      await og.presence.focus(cell, { invisible: args.invisible === true })
      sendProxyToolSuccess(req.id, { ok: true })
    } else {
      // toolName === "presence.beat" — the only other member of LIVE_LAYER_TOOLS (isLiveLayerToolCall
      // guarantees this at the one call site in main()'s loop).
      const result = await og.presence.beat()
      const structuredContent = result && typeof result === "object" ? (result as Record<string, unknown>) : { ok: true }
      sendProxyToolSuccess(req.id, structuredContent)
    }
  } catch (err) {
    sendProxyToolError(req.id, `proxy: live layer call failed: ${errorReason(err)}`)
  }
}

// ── token bootstrap (--name / --tenant) ─────────────────────────────────────────────────────────
// Everything below only ever runs when --name was passed; see maybeInjectToken's early return.
// Credential I/O + registration + memoization live in ./credentials — this file only decides WHEN
// injection/retry applies and does the actual stdio/HTTP relaying.

type ToolDefinition = { name: string; inputSchema?: { properties?: Record<string, unknown> } }

// Tool-schema cache, populated lazily (first tools/call that needs it) from an internal tools/list —
// NOT relayed to the client, same "proxy's own bookkeeping" idea as ./credentials's registerSession.
// Cached for the process lifetime: schemas don't change mid-session. Left empty (rather than a
// "already tried" flag) on fetch failure, so a later call naturally retries instead of getting stuck.
const toolSchemaCache = new Map<string, ToolDefinition>()

async function ensureToolSchemaCache(server: string): Promise<void> {
  if (toolSchemaCache.size > 0) return
  try {
    const httpResponse = await postMcp(server, { jsonrpc: "2.0", id: "stdio-proxy-bootstrap-tools-list", method: "tools/list" })
    const body = (await httpResponse.json()) as { result?: { tools?: ToolDefinition[] } }
    for (const tool of body?.result?.tools ?? []) {
      if (tool && typeof tool.name === "string") toolSchemaCache.set(tool.name, tool)
    }
  } catch (err) {
    // Deliberately fails quiet, unlike resolveCredentials's loud isError reply: a tools/call arriving
    // while the cache is empty just falls through as "not token-declaring" (see maybeInjectToken) and
    // gets forwarded unmodified — the real server then rejects it for the missing token on its own,
    // and the next call gets a fresh attempt at this fetch since nothing here is cached as failed.
    process.stderr.write(`stdio-proxy: failed to fetch tool schemas for token bootstrap: ${errorReason(err)}\n`)
  }
}

/** Result of maybeInjectToken: `injected: true` tells the caller (main()'s loop) this specific
 * outgoing message carries a proxy-injected token, so a subsequent "invalid or expired token"
 * response is THIS proxy's own bootstrapped identity to re-register, not a caller-supplied token it
 * has no business touching. Explicit rather than re-derived from the message, since "was this
 * injected" isn't reliably recoverable from the outgoing JSON-RPC body alone (a caller-supplied token
 * looks identical on the wire to an injected one). */
type InjectionResult = { message: JSONRPCMessage; injected: boolean }

/** Decides whether an incoming tools/call needs a token injected, and does so. Returns:
 *  - `{ message, injected: false }` with the SAME message reference, unmodified, when no injection is
 *    needed (tool unknown/not token-aware, or the caller already supplied a token) — the common/
 *    default case;
 *  - `{ message, injected: true }` with a CLONE of the message with `params.arguments.token` set,
 *    when injection applies and credential resolution succeeded;
 *  - `null` when injection applies but credential resolution failed — in that case a proxy-side
 *    isError response has ALREADY been written to stdout and the caller must not forward anything.
 * Only ever called when --name is set (see main()'s call site). */
async function maybeInjectToken(server: string, name: string, tenant: string | undefined, message: JSONRPCMessage): Promise<InjectionResult | null> {
  const params = (message as { params?: { name?: string; arguments?: Record<string, unknown> } }).params
  const toolName = params?.name
  if (!toolName) return { message, injected: false }

  await ensureToolSchemaCache(server)
  const tool = toolSchemaCache.get(toolName)
  const declaresToken = !!tool?.inputSchema?.properties && Object.prototype.hasOwnProperty.call(tool.inputSchema.properties, "token")
  if (!declaresToken) return { message, injected: false }
  if (params?.arguments?.token) return { message, injected: false } // caller already supplied one — never overwrite it

  let creds: Credentials
  try {
    creds = await resolveCredentials(server, name, tenant)
  } catch (err) {
    sendProxyToolError((message as { id: string | number }).id, `proxy: failed to obtain a token: ${errorReason(err)}`)
    return null
  }

  const cloned = withToken(message, creds.token)
  process.stderr.write(`stdio-proxy: injected token for tools/call ${toolName}\n`)
  return { message: cloned, injected: true }
}

/** True when `body` is a JSON-RPC result shaped like the server's tool-execution-failure convention
 * (isError:true content) AND its message contains the server's exact "invalid or expired token"
 * phrase (see packages/mcp-server/src/tools/session.ts's requireToken) — a substring match, not a
 * full-string one, since the server message could in principle grow a suffix without changing meaning. */
function isExpiredTokenError(body: JSONRPCMessage): boolean {
  const result = (body as { result?: { isError?: boolean; content?: Array<{ text?: string }> } }).result
  if (!result?.isError) return false
  const text = result.content?.[0]?.text
  return typeof text === "string" && text.includes("invalid or expired token")
}

/** Forwards a `tools/call` whose token THIS proxy injected (never a caller-supplied one — see
 * InjectionResult), with auto re-register-and-retry-once on token expiry (Task 3's DoD). Mirrors
 * forward()'s own failure discipline for the network/parse-failure cases (still must produce SOME
 * stdout reply, via sendProxyError's -32000 convention) but additionally recognizes the
 * "invalid or expired token" tool-execution failure and, for exactly that case: re-registers fresh
 * (same name/tenant, never reusing the now-stale disk file), retries the ORIGINAL call once with the
 * new token, and writes whatever the retry produces — success or failure — as final. No second retry
 * under any circumstance, including another "invalid or expired token" from the retry itself. */
async function forwardInjectedToolCall(server: string, message: JSONRPCMessage, name: string, tenant: string | undefined): Promise<void> {
  const id = (message as JSONRPCMessage & { id: string | number }).id
  const toolName = (message as JSONRPCMessage & { params: { name: string } }).params.name

  const body = await postAndParse(server, message, id)
  if (body === null) return // network/parse failure — postAndParse already replied with -32000

  if (!isExpiredTokenError(body)) {
    process.stdout.write(serializeMessage(body))
    return
  }

  process.stderr.write(`stdio-proxy: token expired, re-registering and retrying tools/call ${toolName}\n`)

  let fresh: Credentials
  try {
    fresh = await reregisterCredentials(server, name, tenant)
  } catch (err) {
    sendProxyToolError(id, `proxy: token expired and re-registration failed: ${errorReason(err)}`)
    return
  }

  const retryBody = await postAndParse(server, withToken(message, fresh.token), id)
  if (retryBody === null) return // network/parse failure on the retry — no second retry either way

  process.stdout.write(serializeMessage(retryBody))
}

async function forward(server: string, message: JSONRPCMessage): Promise<void> {
  if (!isJSONRPCRequest(message)) {
    // Notifications get their own (lighter) failure handling: no `id` to correlate a stdout reply to,
    // no response body to parse (the server answers 204), so a network failure here just gets logged
    // to stderr — unlike postAndParse's -32000-to-stdout convention, which needs a request's `id`.
    try {
      await postMcp(server, message)
    } catch (err) {
      const method = "method" in message ? message.method : "unknown"
      process.stderr.write(`stdio-proxy: failed to forward notification (${method}): ${errorReason(err)}\n`)
    }
    return
  }

  const body = await postAndParse(server, message, message.id)
  if (body === null) return // network/parse failure — postAndParse already replied with -32000
  process.stdout.write(serializeMessage(body))
}

async function main(): Promise<void> {
  const { server, name, tenant, live } = parseArgs(process.argv.slice(2))
  process.stderr.write(`stdio-proxy: proxying stdio <-> ${server}/mcp\n`)

  // --live (INT-2): open a real live-layer session at startup and keep it alive for the process
  // lifetime, so presence.focus/presence.beat calls arriving over stdio can be routed through it
  // instead of hitting the LIVE_LAYER_TOOLS stub (see routeLiveLayerCall / main()'s loop below).
  // parseArgs already guarantees `name` is set whenever `live` is true (fails fast otherwise).
  //
  // agentKind: "unknown" — ID5 (docs/roadmap-integrations/README.md) lists agentKind as a closed
  // contract (web, claude-code, opencode, cursor, windsurf, copilot, zed, gemini-cli, unknown) that
  // "plugins DEVEM declarar o seu" (each plugin should declare its own). This generic stdio proxy has
  // no way to know which of those it's actually wrapping — it's a transport-level shim any MCP client
  // can point at it — so claiming a specific kind (e.g. "claude-code") would be a guess this proxy
  // cannot back up, and "unknown" is exactly the value ID5 reserves for precisely this case (it exists
  // in the enum for a reason). A `--agent-kind` flag was considered but rejected as over-engineering
  // for this task: nothing here currently depends on getting a MORE specific value than "unknown" (it
  // only affects system.message routing/UI labeling for non-web agents, per ID5), and a flag can be
  // added later without breaking this default if a concrete need shows up.
  let og: OgHandle | null = null
  if (live) {
    try {
      og = await connect({
        server,
        agentKind: "unknown",
        name,
        tenant,
        store: fileTokenStore(),
        onReattach: () => process.stderr.write("stdio-proxy: live layer session ready\n"),
        onReauth: (event) => {
          if (event.type === "reregistered") {
            process.stderr.write("stdio-proxy: live layer auto re-registered after an expired/invalid token\n")
          } else {
            process.stderr.write(`stdio-proxy: live layer re-registration failed: ${errorReason(event.error)}\n`)
          }
        },
      })
    } catch (err) {
      // Startup-time failure (e.g. session.register itself unreachable/broken) — fail fast rather than
      // limping into the stdin loop with a null `og` that would silently fall back to the non-live stub
      // for every presence.focus/beat call, contradicting what --live promised the caller.
      process.stderr.write(`stdio-proxy: failed to establish live layer session: ${errorReason(err)}\n`)
      process.exit(1)
    }
  }

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

      // Live-layer session interception (presence.focus / presence.beat): checked FIRST, before any
      // token-bootstrap decision, and regardless of whether --name was passed — see
      // isLiveLayerToolCall's doc. WITHOUT --live (`og` is null), this is still the unchanged
      // INT-1-scoped stub: never forwarded to the server, no fetch ever attempted. WITH --live, it's
      // routed through the real OgHandle instead — see routeLiveLayerCall.
      if (isLiveLayerToolCall(message)) {
        const id = (message as JSONRPCMessage & { id: string | number }).id
        if (og) {
          await routeLiveLayerCall(og, message)
        } else {
          sendProxyToolError(id, "live layer requires companion — see docs")
        }
        continue
      }

      // Opt-in token bootstrap: only ever touches tools/call requests, and only when --name was
      // passed. Without --name this block is skipped entirely — pure Task 1 pass-through, unchanged.
      let outgoing: JSONRPCMessage = message
      if (name && isJSONRPCRequest(message) && message.method === "tools/call") {
        const injectionResult = await maybeInjectToken(server, name, tenant, message)
        if (injectionResult === null) continue // injection failed; a proxy-side isError reply already went to stdout
        if (injectionResult.injected) {
          // Retry-on-expiry ONLY ever applies to calls where THIS proxy injected the token — a
          // caller-supplied token's expiry is not this proxy's identity to re-register for, and must
          // pass through forward()'s ordinary path unmodified (see forwardInjectedToolCall's doc).
          await forwardInjectedToolCall(server, injectionResult.message, name, tenant)
          continue
        }
        outgoing = injectionResult.message
      }

      // Deliberately sequential: awaiting each forward() before reading the next buffered message
      // means pipelined stdin requests are still processed one at a time, in order. Not an oversight —
      // don't parallelize this without checking whether later token/ordering logic depends on it.
      await forward(server, outgoing)
    }
  }
  og?.close()
  process.exit(0)
}

main()
