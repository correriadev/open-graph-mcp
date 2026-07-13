import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

export function tempRepo(fixture: string): { root: string; cleanup: () => void } {
  const src = path.join(import.meta.dir, "fixtures", fixture)
  const root = mkdtempSync(path.join(tmpdir(), "og-mcp-"))
  cpSync(src, root, { recursive: true })
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

export async function rpc(base: string, method: string, params?: unknown): Promise<any> {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const body: any = await res.json()
  if (body.error) throw new Error(body.error.message)
  return body.result
}

export const callTool = (base: string, name: string, args?: unknown) =>
  rpc(base, "tools/call", { name, arguments: args ?? {} }).then((r) => r.structuredContent)

export const readResource = (base: string, uri: string, token?: string) =>
  rpc(base, "resources/read", { uri, token }).then((r) => JSON.parse(r.contents[0].text))

export const register = (base: string, name: string, tenant?: string) =>
  callTool(base, "session.register", { name, tenant }) as Promise<{ token: string; userId: string; tenantId: string }>

/** Bootstrap the fixture to produce a Phase-1 .graph/, so graph.import has something to migrate. */
export const buildPhase1Graph = (base: string, repoPath: string) => callTool(base, "graph.bootstrap", { repoPath })

export type SseClient = {
  events: any[]
  waitFor: (pred: (e: any) => boolean, timeoutMs?: number) => Promise<any>
  close: () => void
}

/** Cliente SSE cru (fetch + parser de frames) — sem depender de EventSource global. */
export async function openSse(base: string, since = 0, token?: string, filter?: string): Promise<SseClient> {
  const q = new URLSearchParams({ since: String(since) })
  if (token) q.set("token", token)
  if (filter) q.set("filter", filter)
  const res = await fetch(`${base}/events?${q}`)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const events: any[] = []
  const waiters: { pred: (e: any) => boolean; resolve: (e: any) => void }[] = []
  let buf = ""
  const pump = async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buf += decoder.decode(value, { stream: true })
      let cut: number
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, cut)
        buf = buf.slice(cut + 2)
        const dataLine = raw.split("\n").find((l) => l.startsWith("data: "))
        if (!dataLine) continue
        const evt = JSON.parse(dataLine.slice(6))
        events.push(evt)
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].pred(evt)) {
            waiters[i].resolve(evt)
            waiters.splice(i, 1)
          }
        }
      }
    }
  }
  pump().catch(() => {})
  return {
    events,
    waitFor(pred, timeoutMs = 5000) {
      const hit = events.find(pred)
      if (hit) return Promise.resolve(hit)
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("sse waitFor timeout")), timeoutMs)
        waiters.push({
          pred,
          resolve: (e) => {
            clearTimeout(t)
            resolve(e)
          },
        })
      })
    },
    close: () => {
      reader.cancel().catch(() => {})
    },
  }
}
