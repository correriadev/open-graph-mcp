/**
 * watch-bridge.ts — detecção de drift SOBRE O GRAFO DO SERVIDOR.
 *
 * Antes isto era um zíper com `graph-core/watch`, que roda sobre `.graph/` no repo-alvo: ele
 * recarimbava `graph.json` no disco e o bridge relia esse arquivo para a memória. Com o grafo
 * vivendo no servidor (ADR D1 — o repo não hospeda mais estado de grafo), a checagem passa a ser
 * feita aqui, contra os nós do tenant: o repo é só LIDO.
 *
 * Mecânica: cada nó carrega uma âncora verbatim. A cada tick lê-se o arquivo e verifica-se se a
 * âncora ainda está lá (`excerptCheck`). Sumiu → `drift.node`. Voltou → `watch.healed`. Se a célula
 * do nó é β (authority "graph"), o drift também a DEMOVE (`authority.demoted`, authority vira
 * "suspended"): o código mudou embaixo de um grafo que se dizia autoritativo.
 *
 * O conjunto de nós em drift é índice VIVO (memória, por tenant) — recomputável do disco + banco a
 * qualquer momento, e por isso não precisa de durabilidade (ADR §4.1: locks/presença/índice vivo
 * são perdíveis; o log JSONL é que é a verdade).
 *
 * `tick` é exportado p/ os testes dispararem um ciclo determinístico sem esperar o intervalo;
 * `startWatchLoop` é o mesmo tick num setInterval p/ produção.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { excerptCheck } from "@open-graph-mcp/graph-core/extract"
import { appendEvent, tenantGraph, DEFAULT_TENANT, type ServerState } from "./state"
import { write } from "./db"

export type WatchEvent = { kind: "node" | "cell"; id: string; type: string; cause: string; ts: string }

/**
 * Nós em drift por tenant. Índice vivo — some no restart, recomputado no primeiro tick.
 *
 * Vive no ServerState, NÃO num Map de módulo: dois servidores no mesmo processo (o que todo teste
 * faz, e o que um host multi-instância faria) compartilhariam o conjunto, e o segundo já nasceria
 * achando que os nós estão em drift — logo não emitiria `drift.node` nenhum.
 */
function staleSet(state: ServerState, tenant: string): Set<string> {
  let set = state.driftStale.get(tenant)
  if (!set) state.driftStale.set(tenant, (set = new Set()))
  return set
}

const cellOf = (domain: string | null, level: unknown): string => `${domain ?? "(unassigned)"}:${String(level).replace(/^P/, "")}`

export async function tick(state: ServerState, tenant = DEFAULT_TENANT): Promise<WatchEvent[]> {
  const tg = tenantGraph(state, tenant)
  const graph = tg.graph
  const root = tg.repoPath ?? state.repoPath
  if (!graph || !root) return []

  const ts = new Date().toISOString()
  const stale = staleSet(state, tenant)
  const events: WatchEvent[] = []
  /** célula β → pior grade de drift nela neste tick */
  const demote = new Map<string, "gone" | "structural">()

  for (const node of graph.nodes) {
    if (!node.anchor) continue // nó sem âncora não é verificável
    let content: string | null = null
    try {
      content = readFileSync(path.join(root, node.file), "utf8")
    } catch {
      content = null
    }
    // arquivo sumiu = "gone"; arquivo existe mas a âncora não está mais lá = "structural"
    const grade = content === null ? "gone" : excerptCheck(content, node.anchor) ? null : "structural"
    const wasStale = stale.has(node.id)

    if (grade && !wasStale) {
      stale.add(node.id)
      const cell = cellOf(node.domain, node.level)
      events.push({ kind: "node", id: node.id, type: "stale", cause: grade, ts })
      appendEvent(state, tenant, {
        kind: "drift.node",
        targetId: node.id,
        payload: { ts, cause: grade, status: "stale", refKind: "anchor", domain: node.domain ?? "(unassigned)", cell },
      })
      if ((graph.authority?.[cell] ?? "source") === "graph") {
        demote.set(cell, demote.get(cell) === "gone" ? "gone" : grade)
      }
    } else if (!grade && wasStale) {
      stale.delete(node.id)
      events.push({ kind: "node", id: node.id, type: "recovered", cause: "anchor", ts })
      appendEvent(state, tenant, {
        kind: "watch.healed",
        targetId: node.id,
        payload: { ts, cause: "anchor", status: "recovered", domain: node.domain ?? "(unassigned)", cell: cellOf(node.domain, node.level) },
      })
    }
  }

  // Demoção de célula β: o grafo deixou de ser autoritativo ali. Persiste (authority é durável) e
  // reflete na cópia quente, senão o snapshot seguiria dizendo "graph".
  for (const [cell, grade] of demote) {
    write(state.db, state.stateDir, tenant, "authority", { tenant_id: tenant, cell, value: "suspended", last_flip_seq: 0, last_flip_by: "watch" })
    graph.authority = { ...(graph.authority ?? {}), [cell]: "suspended" }
    events.push({ kind: "cell", id: cell, type: "suspended", cause: grade, ts })
    appendEvent(state, tenant, {
      kind: "authority.demoted",
      targetId: cell,
      payload: { ts, cause: grade, status: "suspended", cell, domain: cell.slice(0, cell.lastIndexOf(":")), grade },
    })
  }

  if (events.length) state.lastTickHadEvents = true
  else if (state.lastTickHadEvents) {
    appendEvent(state, tenant, { kind: "watch.converged", targetId: null, payload: {} })
    state.lastTickHadEvents = false
  }
  return events
}

export function startWatchLoop(state: ServerState, intervalMs = 5000, tenant = DEFAULT_TENANT): () => void {
  let running = false
  const timer = setInterval(async () => {
    if (running) return
    running = true
    try {
      await tick(state, tenant)
    } catch {
      /* um ciclo que falha não derruba o loop */
    } finally {
      running = false
    }
  }, intervalMs)
  return () => clearInterval(timer)
}
