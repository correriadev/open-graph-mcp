/**
 * session.ts — `session.register { name, tenant? }` → `{ token, userId, tenantId, expiresAt }`. O user
 * persiste no SQLite (id determinístico por tenant+name, então re-registrar o mesmo nome reusa o user
 * e a auditoria). Tenant default "default" (D13).
 *
 * D10-lite (2026-08-07): o TOKEN também persiste — antes era só em memória e um restart do servidor
 * invalidava silenciosamente todo token emitido. A mecânica de credencial (hash, expiração,
 * hidratação) mora em `../tokens`, separada daqui para não fechar um ciclo de import com `state.ts`;
 * o porquê está no doc comment de lá.
 */
import { randomBytes, createHash } from "node:crypto"
import { insertRow, write } from "../db"
import { DEFAULT_TENANT, type ServerState } from "../state"
import { hashToken, lookupToken } from "../tokens"

export function sessionRegister(
  state: ServerState,
  args: { name: string; tenant?: string },
): { token: string; userId: string; tenantId: string; expiresAt: string } {
  const name = args?.name
  if (!name || typeof name !== "string") throw new Error("session.register: name required")
  const tenantId = args.tenant && typeof args.tenant === "string" ? args.tenant : DEFAULT_TENANT
  const userId = "u_" + createHash("sha256").update(`${tenantId}:${name}`).digest("hex").slice(0, 16)

  const exists = state.db.query("SELECT id FROM users WHERE tenant_id = ? AND id = ?").get(tenantId, userId)
  if (!exists) write(state.db, state.stateDir, tenantId, "users", { tenant_id: tenantId, id: userId, name, created_at: new Date().toISOString() })

  const token = randomBytes(16).toString("hex") // 32 hex chars
  const hash = hashToken(token)
  const now = Date.now()
  const expiresAt = new Date(now + state.tokenTtlMs).toISOString()
  // SQLite direto (`insertRow`), NÃO `write`: tokens não vão pro espelho JSONL — ver ../tokens.ts.
  insertRow(state.db, "tokens", { tenant_id: tenantId, token_hash: hash, user_id: userId, name, created_at: new Date(now).toISOString(), expires_at: expiresAt })
  state.tokens.set(hash, { token: hash, userId, tenantId, name, expiresAt: Date.parse(expiresAt) })
  return { token, userId, tenantId, expiresAt }
}

/** Resolve token → identidade (lança se desconhecido/vencido). Usado pelas tools de mutação. */
export function requireToken(state: ServerState, token: string): { userId: string; tenantId: string; name: string } {
  const info = lookupToken(state, token)
  if (!info) throw new Error("invalid or expired token — call session.register")
  return { userId: info.userId, tenantId: info.tenantId, name: info.name }
}
