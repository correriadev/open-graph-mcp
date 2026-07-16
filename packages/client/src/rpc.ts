// ---------------------------------------------------------------------------
// Shared JSON-RPC-over-HTTP primitive: POST {server}/mcp, `tools/call`.
// Generalized (server passed as a param, not read from `location.search`)
// version of mcp-web's src/api.ts `rpc()`/`unwrap()`/`toolCall()` — see that
// file for the pattern this mirrors byte-for-byte on the error/unwrap
// conditions (throw on `body.error`, throw on `body.result?.isError`, unwrap
// `structuredContent` / `contents[0].text` / `content[0].text`, JSON-parse
// the text if possible). Deliberately NOT imported from mcp-web (app-specific,
// would create a cycle since mcp-web already depends on this package).
//
// This module does no token injection — that's `connect()`'s job (og.call
// injects a resolved token; the internal session.register bootstrap call
// deliberately does NOT, since there is no token yet). Kept as a bare
// "call this tool, unwrap the result" primitive so both call sites share it.
// ---------------------------------------------------------------------------

let rpcId = 0

async function rpc(server: string, method: string, params: unknown): Promise<any> {
  const res = await fetch(`${server}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  })
  if (!res.ok) throw new Error(`${method} → HTTP ${res.status}`)
  const body: any = await res.json()
  if (body.error) throw new Error(`${method} → ${body.error.message ?? "rpc error"}`)
  if (body.result?.isError === true) throw new Error(`${method} → ${body.result.content?.[0]?.text ?? "tool error"}`)
  return body.result
}

/** Unwrap an MCP tools/call (or resources/read) result to its payload, tolerant of the usual shapes. */
function unwrap(result: any): any {
  if (result == null) return null
  if (result.structuredContent !== undefined) return result.structuredContent
  const text = result.contents?.[0]?.text ?? result.content?.[0]?.text
  if (typeof text === "string") {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return result
}

/** Call `{server}/mcp` `tools/call {name, arguments}` and unwrap the result. No token injection. */
export function toolCall(server: string, name: string, args: Record<string, unknown> = {}): Promise<any> {
  return rpc(server, "tools/call", { name, arguments: args }).then(unwrap)
}

/** Call `{server}/mcp` `resources/read {uri, token?}` and unwrap the result (mirrors mcp-web's
 * api.ts `resourceRead()`, generalized the same way `toolCall` already is — server passed as a param
 * instead of read from `location.search`). No token injection beyond the param given here — that's
 * `connect()`'s job, same split as `toolCall`. Used by `connect({live:false})` (T5) to poll
 * `graph://history?since=N` instead of opening an SSE connection. */
export function resourceRead(server: string, uri: string, token?: string): Promise<any> {
  return rpc(server, "resources/read", token ? { uri, token } : { uri }).then(unwrap)
}
