/**
 * system-message.ts — Fase 3 §8.1: clientes MCP não-web (opencode e companhia) não têm canvas — presença
 * e notificação só existem pra eles como TEXTO. Decisão de arquitetura (documentada aqui em vez de num
 * ADR separado, escopo pequeno): NÃO usamos o mecanismo `notifications` do SDK MCP — o transport deste
 * server é feito à mão sobre JSON-RPC/HTTP + um SSE próprio (transport.ts, sse.ts), sem sessão
 * long-lived do SDK sobre a qual pendurar notification handlers. O caminho pragmático que já se encaixa
 * na arquitetura existente: um envelope SSE adicional, kind `system.message`, `{ text }`, endereçado
 * a UMA sessão específica (nunca roteado/broadcast de novo) — text pt-BR, humano-legível, JAMAIS prompt
 * injection (§8.1: "não é prompt — é notification p/ humano decidir").
 *
 * Quem recebe: a MESMA sessão que já receberia o evento original via affinity router (route(), Task 3) —
 * `system.message` é uma RENDERIZAÇÃO EM TEXTO desse evento, não uma rota nova. `pushEnvelope` (state.ts)
 * chama `maybeSystemMessage` pra cada destinatário depois de entregar o envelope cru; se a Presence dessa
 * sessão tem `agentKind !== "web"`, a versão texto é gerada e empurrada em cima.
 *
 * Gate de agentKind: agentKind só existe depois do primeiro `presence.beat`/`presence.focus` (spec §3) —
 * a Session (sse.ts) não carrega isso. Sessões sem Presence ainda (nunca chamaram beat/focus) não recebem
 * system message: sem saber o agentKind, tratamos como "desconhecido" e não desduplicamos incorretamente
 * pro caso comum (web, que já tem toasts — Task 4). Isto é consistente com `touch()` (presence.ts)
 * default de agentKind "web" quando omitido.
 *
 * Kinds renderizados: só os "prioritários" citados no spec (§8: turno aberto em cell observada, commit
 * em cell observada, seu changeset abortado) + lock.denied (você tentou e não conseguiu) +
 * authority.flipped (sempre broadcast, todo mundo quer saber). DELIBERADAMENTE fora: user.joined/
 * focused/typing_state/left — são ambient presence chatter (barulho pra um agente sem canvas), não
 * "pare e preste atenção".
 */
import { insertRow } from "./db"
import { nextSeq, tenantGraph, type EventEnvelope, type ServerState, type Session } from "./state"
import { requireToken } from "./tools/session"

function userName(state: ServerState, tenant: string, userId: string | null | undefined): string {
  if (!userId) return "alguém"
  const row = state.db.query("SELECT name FROM users WHERE tenant_id = ? AND id = ?").get(tenant, userId) as { name: string } | null
  return row?.name ?? userId
}

/** Texto pt-BR pra um evento, ou null se este kind não vira system message (§8.1). Pura — sem I/O de rede. */
export function renderSystemMessage(state: ServerState, tenant: string, env: EventEnvelope, recipientUserId: string | null): string | null {
  const p = env.payload ?? {}
  switch (env.kind) {
    case "changeset.opened": {
      const cell = (p.cells as string[] | undefined)?.[0] ?? env.target ?? "?"
      if (p.byUser === recipientUserId) return null // seu próprio turno não vira notificação pra você
      return `[open-graph] ${userName(state, tenant, p.byUser as string)} abriu turno em [${cell}]. Sua edição concorrente pode depender de mudanças dele — considere esperar ou focar outra cell.`
    }
    case "changeset.committed": {
      const cell = (p.cells as string[] | undefined)?.[0] ?? "?"
      return `[open-graph] Alguém commitou ${p.csId} em [${cell}].`
    }
    case "changeset.aborted": {
      const reasonTxt = p.reason === "ttl_expired" ? "por TTL expirado" : p.reason === "rejected" ? "pelo gate final" : "manualmente"
      const mine = !!recipientUserId && p.byUser === recipientUserId
      return mine
        ? `[open-graph] Seu changeset ${p.csId} foi abortado ${reasonTxt}.`
        : `[open-graph] O changeset ${p.csId} de ${userName(state, tenant, p.byUser as string)} foi abortado ${reasonTxt}.`
    }
    case "lock.denied":
      return `[open-graph] Não foi possível abrir turno em [${p.cell}] — já travada por ${userName(state, tenant, p.holder as string)} (${p.csId}).`
    case "authority.flipped":
      return `[open-graph] Autoridade de [${p.cell}] mudou para "${p.to}" (por ${userName(state, tenant, p.byUser as string)}).`
    case "server.restarted":
      return `[open-graph] Servidor reiniciou — sua presença foi resetada; redeclare foco.`
    default:
      return null
  }
}

/** Empurra `system.message { text }` direto pra UMA sessão (nunca roteado de novo — o destinatário já
 *  foi decidido por quem chamou). Efêmero: reusa o seq durável corrente, igual toda presença (state.ts). */
export function pushSystemMessage(state: ServerState, tenant: string, session: Session, text: string, target: string | null = null): void {
  // INT-3: also persist for stateless poll-based drain (system.pending) — a Claude Code hook is a
  // fresh process per tool call and can't read this SSE push directly (see system.pending's callers).
  if (session.userId) insertRow(state.db, "system_messages", { tenant_id: tenant, user_id: session.userId, text, created_at: new Date().toISOString() })
  session.push({
    schemaVersion: 1,
    seq: nextSeq(state, tenant) - 1,
    ephemeral: true,
    ts: new Date().toISOString(),
    kind: "system.message",
    target,
    payload: { text },
    graphId: tenantGraph(state, tenant).graphId,
  })
}

/** `system.pending { token }` — stateless poll-based drain (INT-3). Returns every persisted
 *  system.message for the caller's user, oldest first, and deletes them: a message is returned once.
 *
 *  SELECT+DELETE numa ÚNICA transação (SB-0/REPORT-D3). Não era, e hoje isso ainda não entrega
 *  errado — as duas statements são síncronas, sem `await` entre elas, e o loop de eventos do Bun não
 *  intercala outra chamada no meio; `system_messages` também não é durável (não está em
 *  DURABLE_TABLES, db.ts), então não há espelho JSONL pra divergir. A transação existe pra que a
 *  invariante seja ESTRUTURAL em vez de depender de ninguém nunca introduzir um `await` aqui: sem
 *  ela, uma leitura assíncrona no meio faria dois drenos concorrentes devolverem a MESMA mensagem
 *  duas vezes, quebrando a garantia de entrega-uma-vez que é a razão de ser desta tool. */
export function systemPending(state: ServerState, args: { token: string }): { messages: { text: string; createdAt: string }[] } {
  const { userId, tenantId: tenant } = requireToken(state, args.token)
  const rows = state.db.transaction(() => {
    const found = state.db.query("SELECT id, text, created_at FROM system_messages WHERE tenant_id = ? AND user_id = ? ORDER BY id").all(tenant, userId) as {
      id: number
      text: string
      created_at: string
    }[]
    if (found.length) {
      const ids = found.map((r) => r.id)
      state.db.query(`DELETE FROM system_messages WHERE tenant_id = ? AND id IN (${ids.map(() => "?").join(",")})`).run(tenant, ...ids)
    }
    return found
  })()
  return { messages: rows.map((r) => ({ text: r.text, createdAt: r.created_at })) }
}
