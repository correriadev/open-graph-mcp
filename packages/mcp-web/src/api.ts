import type { Graph } from "@open-graph-mcp/graph-core/build"

export function serverBase(): string {
  const q = new URLSearchParams(location.search).get("server")
  return (q || "http://localhost:8787").replace(/\/$/, "")
}

let rpcId = 0
let token: string | null = null

export function setToken(t: string | null): void {
  token = t
}
export function getToken(): string | null {
  return token
}

async function rpc(method: string, params: unknown): Promise<any> {
  const res = await fetch(`${serverBase()}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  })
  if (!res.ok) throw new Error(`${method} → HTTP ${res.status}`)
  const body = await res.json()
  if (body.error) throw new Error(`${method} → ${body.error.message ?? "rpc error"}`)
  return body.result
}

/** Unwrap an MCP tools/call result to its structured payload, tolerant of the usual shapes. */
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

export function toolCall(name: string, args: Record<string, unknown> = {}): Promise<any> {
  // Every Phase-2 tool takes `token`; auto-inject the live one (server ignores it for Phase-1 tools).
  const withToken = token && args.token === undefined ? { ...args, token } : args
  return rpc("tools/call", { name, arguments: withToken }).then(unwrap)
}

export function resourceRead(uri: string): Promise<any> {
  // resources/read accepts an extra `token` param in Phase 2.
  return rpc("resources/read", token ? { uri, token } : { uri }).then(unwrap)
}

export const readSnapshot = (): Promise<Graph> => resourceRead("graph://snapshot")
export const rebuild = (): Promise<any> => toolCall("graph.rebuild", {})
export const bootstrap = (repoPath: string): Promise<any> => toolCall("graph.bootstrap", { repoPath })

// ---- Phase 2: session / changesets / audit --------------------------------

export type Session = { token: string; userId: string; tenantId: string }

export const registerSession = (name: string, tenant: string): Promise<Session> =>
  toolCall("session.register", { name, tenant })

export const openChangeset = (cells: string[], intent: string): Promise<any> =>
  toolCall("changeset.open", { cells, intent })
export const claimDelta = (csId: string, delta: { kind: string; payload: unknown }): Promise<any> =>
  toolCall("changeset.claim", { csId, delta })
export const commitChangeset = (csId: string): Promise<any> => toolCall("changeset.commit", { csId })
export const abortChangeset = (csId: string): Promise<any> => toolCall("changeset.abort", { csId })
export const extendChangeset = (csId: string): Promise<any> => toolCall("changeset.extend", { csId })
export const listMine = (): Promise<any> => toolCall("changeset.list_mine", {})

export const readChangeset = (csId: string): Promise<any> => resourceRead(`graph://changeset/${csId}`)
export const readOpenChangesets = (): Promise<any> => resourceRead("graph://changesets?status=open")
export const readHistory = (since = 0): Promise<any> => resourceRead(`graph://history?since=${since}`)
