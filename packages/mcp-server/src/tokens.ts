/**
 * tokens.ts — D10-lite: a camada de credencial, separada de `tools/session.ts` de propósito.
 *
 * Ela mora aqui, e não junto do `session.register`, porque `state.ts` precisa hidratar os tokens ao
 * construir o `ServerState` — e `tools/session.ts` importa `DEFAULT_TENANT` de `state.ts` como
 * VALOR. `state.ts → tools/session.ts → state.ts` é um ciclo de import com valor no meio, que o Bun
 * resolve com um segfault na inicialização do módulo, não com um erro legível. Este arquivo importa
 * `ServerState` só como TIPO (apagado na compilação), então não há ciclo.
 *
 * O que muda em relação ao pré-D10-lite: o token era um `Map` em memória e um restart do servidor
 * invalidava silenciosamente todos. Agora ele persiste no SQLite — mas NÃO no espelho JSONL, e essa
 * é a decisão que vale registrar. Token é credencial, não conhecimento: o JSONL é append-only e a
 * verdade durável do sistema é o grafo; espelhar tokens ali seria guardar toda credencial já emitida,
 * para sempre, sem caminho de revogação. Perder o SQLite não perde trabalho — o cliente re-registra
 * sob o mesmo `name`, o `userId` é determinístico (`sha256(tenant:name)`) e os changesets continuam
 * lá. Esse é o caminho de recuperação QA-1 que o `packages/client` já implementa.
 *
 * Guardado como `sha256(token)`: um `state.sqlite` vazado não entrega credencial utilizável.
 */
import { createHash } from "node:crypto"
import type { ServerState, TokenInfo } from "./state"

/** 90 dias — o horizonte do D10 original. Um beta local dura semanas; um token que vence no meio de
 *  uma sessão de trabalho é pior que um token longo numa máquina que já contém o grafo inteiro. */
export const DEFAULT_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/**
 * Hidrata `state.tokens` do SQLite e apaga o que já venceu. Chamado UMA vez, ao construir o
 * `ServerState` (state.ts `createState`) — e não no `import.meta.main` de index.ts, senão um teste
 * que reabre o mesmo `STATE_DIR` não veria os próprios tokens de volta, que é exatamente o
 * comportamento sob prova.
 *
 * Todo token que vem daqui nasce `staleBoot: true`: foi emitido por um processo anterior, logo a
 * primeira conexão SSE que o apresentar deve receber o aviso de restart — a presença foi zerada,
 * ainda que a credencial tenha sobrevivido.
 */
export function hydrateTokens(state: ServerState, now = Date.now()): number {
  const nowIso = new Date(now).toISOString()
  state.db.query("DELETE FROM tokens WHERE expires_at <= ?").run(nowIso)
  const rows = state.db.query("SELECT tenant_id, token_hash, user_id, name, expires_at FROM tokens").all() as {
    tenant_id: string
    token_hash: string
    user_id: string
    name: string
    expires_at: string
  }[]
  for (const r of rows) {
    // A chave do Map quente é o HASH, não o token em claro — o servidor não guarda nada que permita
    // reconstruir o token original depois de emiti-lo. `lookupToken` hasheia o que o cliente
    // apresenta e procura por aqui.
    state.tokens.set(r.token_hash, {
      token: r.token_hash,
      userId: r.user_id,
      tenantId: r.tenant_id,
      name: r.name,
      expiresAt: Date.parse(r.expires_at),
      staleBoot: true,
    })
  }
  return rows.length
}

/**
 * Lookup canônico token→identidade. Hasheia o que o cliente apresentou, procura no Map quente e
 * REJEITA (removendo de vez) o que já venceu — a checagem de expiração é aqui, e não só na varredura
 * de boot, porque um processo que fica meses de pé nunca reexecutaria aquela varredura.
 */
export function lookupToken(state: ServerState, token: unknown, now = Date.now()): TokenInfo | undefined {
  if (typeof token !== "string" || !token) return undefined
  const hash = hashToken(token)
  const info = state.tokens.get(hash)
  if (!info) return undefined
  if (info.expiresAt <= now) {
    state.tokens.delete(hash)
    state.db.query("DELETE FROM tokens WHERE token_hash = ?").run(hash)
    return undefined
  }
  return info
}
