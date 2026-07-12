/**
 * watch-bridge.ts — o zíper com opencode/graph/watch. A cada tick roda o ciclo herdado sobre o
 * repo-alvo (re-checa âncoras, propaga drift, demote células β), recarrega o graph.json que o watch
 * carimbou e publica os eventos novos no log/SSE. Ciclo sem novidade que sucede um com novidade
 * emite `watch.converged` (telemetria, spec §4.4). Estado 100% em memória.
 *
 * `tick` é exportado p/ os testes dispararem um ciclo determinístico sem esperar o intervalo de 5s;
 * `startWatchLoop` é o mesmo tick num setInterval p/ produção.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import type { Graph } from "@open-graph-mcp/graph-core/build"
import { watch, type WatchEvent } from "@open-graph-mcp/graph-core/watch"
import { publish, nodeCell, type ServerState } from "./state"

/** WatchEvent herdado → envelope MCP (kinds da spec §4.4). */
function toEnvelope(state: ServerState, e: WatchEvent): { kind: string; target: string | null; payload: Record<string, unknown> } {
  const base = { ts: e.ts, cause: e.cause, status: e.type }
  if (e.kind === "cell") {
    // demoted → gone (β→source); suspended → structural (β→suspended). grade incluída (spec §4.4).
    const domain = e.id.slice(0, e.id.lastIndexOf(":"))
    return {
      kind: "authority.demoted",
      target: e.id,
      payload: { ...base, cell: e.id, domain, grade: e.type === "demoted" ? "gone" : "structural" },
    }
  }
  if (e.type === "recovered") {
    const cell = nodeCell(state, e.id)
    return { kind: "watch.healed", target: e.id, payload: { ...base, ...(cell ?? {}) } }
  }
  const cell = nodeCell(state, e.id)
  return { kind: "drift.node", target: e.id, payload: { ...base, refKind: e.kind, ...(cell ?? {}) } }
}

export async function tick(state: ServerState): Promise<WatchEvent[]> {
  if (!state.repoPath) return []
  const { newEvents } = await watch(state.repoPath)

  // watch carimbou stale/demotion no graph.json — recarrega p/ o snapshot refletir.
  try {
    state.graph = JSON.parse(readFileSync(path.join(state.repoPath, ".graph", "graph.json"), "utf8")) as Graph
  } catch {
    /* graph.json ausente/malformado — mantém o corrente */
  }

  for (const e of newEvents) publish(state, toEnvelope(state, e))

  if (newEvents.length) state.lastTickHadEvents = true
  else if (state.lastTickHadEvents) {
    publish(state, { kind: "watch.converged", target: null, payload: {} })
    state.lastTickHadEvents = false
  }
  return newEvents
}

export function startWatchLoop(state: ServerState, intervalMs = 5000): () => void {
  let running = false
  const timer = setInterval(async () => {
    if (running) return
    running = true
    try {
      await tick(state)
    } catch {
      /* um ciclo que falha não derruba o loop */
    } finally {
      running = false
    }
  }, intervalMs)
  return () => clearInterval(timer)
}
