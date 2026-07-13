/**
 * session.ts — `session.register { name, tenant? }` → `{ token, userId, tenantId }`. O token é 32-hex
 * EM MEMÓRIA (some no restart, spec §9); o user persiste no SQLite (id determinístico por tenant+name,
 * então re-registrar o mesmo nome reusa o user e a auditoria). Tenant default "default" (D13).
 */
import { randomBytes, createHash } from "node:crypto"
import { write } from "../db"
import { DEFAULT_TENANT, type ServerState } from "../state"

export function sessionRegister(state: ServerState, args: { name: string; tenant?: string }): { token: string; userId: string; tenantId: string } {
  const name = args?.name
  if (!name || typeof name !== "string") throw new Error("session.register: name required")
  const tenantId = args.tenant && typeof args.tenant === "string" ? args.tenant : DEFAULT_TENANT
  const userId = "u_" + createHash("sha256").update(`${tenantId}:${name}`).digest("hex").slice(0, 16)

  const exists = state.db.query("SELECT id FROM users WHERE tenant_id = ? AND id = ?").get(tenantId, userId)
  if (!exists) write(state.db, state.stateDir, tenantId, "users", { tenant_id: tenantId, id: userId, name, created_at: new Date().toISOString() })

  const token = randomBytes(16).toString("hex") // 32 hex chars
  state.tokens.set(token, { token, userId, tenantId, name })
  return { token, userId, tenantId }
}

/** Resolve token → identidade (lança se desconhecido). Usado pelas tools de mutação. */
export function requireToken(state: ServerState, token: string): { userId: string; tenantId: string; name: string } {
  const info = token ? state.tokens.get(token) : undefined
  if (!info) throw new Error("invalid or expired token — call session.register")
  return { userId: info.userId, tenantId: info.tenantId, name: info.name }
}
