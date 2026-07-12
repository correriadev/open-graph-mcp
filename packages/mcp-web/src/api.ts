import type { Graph } from "@open-graph-mcp/graph-core/build"

export function serverBase(): string {
  const q = new URLSearchParams(location.search).get("server")
  return (q || "http://localhost:8787").replace(/\/$/, "")
}

let rpcId = 0

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
  return rpc("tools/call", { name, arguments: args }).then(unwrap)
}

export function resourceRead(uri: string): Promise<any> {
  return rpc("resources/read", { uri }).then(unwrap)
}

export const readSnapshot = (): Promise<Graph> => resourceRead("graph://snapshot")
export const rebuild = (): Promise<any> => toolCall("graph.rebuild", {})
export const bootstrap = (repoPath: string): Promise<any> => toolCall("graph.bootstrap", { repoPath })
