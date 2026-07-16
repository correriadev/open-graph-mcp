// ---------------------------------------------------------------------------
// localStorage-backed TokenStore (browser-only). Implements the `{get(),
// set()}` shape from @open-graph-mcp/client's store.ts so it can be handed
// straight to connect()'s `store` option — WITHOUT importing that package's
// `./node-store` subpath (fileTokenStore), which pulls in `node:fs`/`node:os`/
// `node:path` and does not belong in a browser bundle (see vite.config.ts's
// node:fs/node:path stub-alias comment: those bindings exist only to satisfy
// an unrelated transitive import and throw if actually invoked).
//
// Keys mirror mcp-web's pre-existing localStorage usage (og.token/og.name/
// og.userId) plus two new ones (og.server/og.tenantId) needed to round-trip
// a full Credentials object. A localStorage written by a PRE-refactor build
// (missing og.server/og.tenantId) is treated as "no usable credentials" —
// get() returns null, same permissive "any problem → null" contract as
// node-store.ts's fileTokenStore — which just causes one fresh
// session.register on next load, not a crash.
// ---------------------------------------------------------------------------

import type { Credentials, TokenStore } from "@open-graph-mcp/client"

const KEYS = {
  server: "og.server",
  token: "og.token",
  userId: "og.userId",
  tenantId: "og.tenantId",
} as const

export function localStorageTokenStore(): TokenStore {
  return {
    get(): Credentials | null {
      try {
        const server = localStorage.getItem(KEYS.server)
        const token = localStorage.getItem(KEYS.token)
        const userId = localStorage.getItem(KEYS.userId)
        const tenantId = localStorage.getItem(KEYS.tenantId)
        if (!server || !token || !userId || !tenantId) return null
        return { server, token, userId, tenantId }
      } catch {
        return null // localStorage inaccessible (private mode, quota, ...) — treat as "nothing cached"
      }
    },
    set(creds: Credentials): void {
      localStorage.setItem(KEYS.server, creds.server)
      localStorage.setItem(KEYS.token, creds.token)
      localStorage.setItem(KEYS.userId, creds.userId)
      localStorage.setItem(KEYS.tenantId, creds.tenantId)
    },
  }
}
