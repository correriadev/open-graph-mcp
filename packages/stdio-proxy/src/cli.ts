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
 * No token/auth logic yet (a later task) and no --name/--tenant flags yet — only --server <url>.
 */
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js"
import { isJSONRPCRequest, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"

function parseArgs(argv: string[]): { server: string } {
  const idx = argv.indexOf("--server")
  const value = idx === -1 ? undefined : argv[idx + 1]
  if (!value) {
    process.stderr.write("stdio-proxy: missing required --server <url> (e.g. --server http://localhost:8787)\n")
    process.exit(1)
  }
  return { server: value.replace(/\/+$/, "") }
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
  const { server } = parseArgs(process.argv.slice(2))
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
      // Deliberately sequential: awaiting each forward() before reading the next buffered message
      // means pipelined stdin requests are still processed one at a time, in order. Not an oversight —
      // don't parallelize this without checking whether later token/ordering logic depends on it.
      await forward(server, message)
    }
  }
  process.exit(0)
}

main()
