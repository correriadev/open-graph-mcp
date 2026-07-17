/**
 * credentials.ts — the proxy's own bootstrap-identity cluster: on-disk credential I/O
 * (~/.open-graph-mcp/credentials.json, 0600), calling `session.register` itself, and in-process
 * memoization of the result. Everything here is the proxy's own bookkeeping — never relayed to the
 * calling MCP client, which never needs to know a token exists (see cli.ts's maybeInjectToken).
 *
 * Split out of cli.ts (Task 3) once the cluster grew a second caller of "get me a usable token":
 * resolveCredentials for the normal opt-in bootstrap path, and reregisterCredentials for cli.ts's
 * retry-on-expired-token path — same underlying I/O and memoization, so it belongs in one place
 * rather than being duplicated or reached into from outside.
 *
 * Do NOT import anything from ./cli here. cli.ts calls main() unconditionally at module top level
 * (no `import.meta.main` guard) — importing it, even just for a helper like postMcp, would run the
 * stdin proxy loop as a side effect of importing this module (e.g. a future standalone test of this
 * file would hang reading stdin). postMcp lives here for that reason, even though cli.ts is its main
 * caller — the dependency direction only works one way.
 *
 * INT-2 consolidation decision: `loadCredentials`/`saveCredentials`' file I/O now DELEGATES to
 * `@open-graph-mcp/client/node-store`'s `fileTokenStore()` (same 0600-on-every-write, same
 * any-problem-at-all→null-on-read permissiveness — `fileTokenStore` was explicitly written to mirror
 * this file's original behavior, see its doc comment) instead of duplicating the fs glue here. This is
 * a PARTIAL consolidation, not a full file-level replacement: `postMcp`/`registerSession`/
 * `resolveCredentials`/`reregisterCredentials` stay put, because they're RPC-level bootstrap concerns
 * (raw `${server}/mcp` POSTs, `session.register` calls, in-process memoization) that have nothing to do
 * with credential storage specifically — `postMcp` in particular is reused by cli.ts for schema-list
 * bootstrap and notification forwarding, neither of which is about credentials at all. A full swap to
 * `@open-graph-mcp/client`'s `connect()`/`registerSession()` would need to absorb or re-home all of
 * that, which isn't a clean type-swap the way the storage half was. `--live`'s own `connect()` call
 * (cli.ts) already depends on `@open-graph-mcp/client`, so reusing its `/node-store` subpath here adds
 * no new dependency — just removes ~15 lines of duplicated fs/chmod logic that would otherwise drift
 * from `fileTokenStore`'s copy over time. `credentialsPath()` stays a plain path computation (not I/O),
 * so it's left as-is rather than routed through the store.
 */
import * as os from "node:os"
import * as path from "node:path"
import { fileTokenStore } from "@open-graph-mcp/client/node-store"

export type Credentials = { server: string; token: string; userId: string; tenantId: string }

/** POST a JSON-RPC body to `${server}/mcp`. Just the fetch-construction boilerplate shared by every
 * call site (cli.ts's forward()/ensureToolSchemaCache(), and registerSession() below) — each caller
 * still owns its own response-parsing and error handling, which genuinely diverge. Not a full
 * "post+parse" abstraction on purpose. */
export function postMcp(server: string, body: unknown): Promise<Response> {
  return fetch(`${server}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

export function credentialsPath(): string {
  return path.join(os.homedir(), ".open-graph-mcp", "credentials.json")
}

// Single store instance for this process — `fileTokenStore()` itself does no eager I/O (only
// `get()`/`set()` touch disk), so building it once at module load, pointed at the same path
// `credentialsPath()` always computed, is equivalent to the old per-call `fs` access below.
const store = fileTokenStore({ path: credentialsPath() })

/** Reads+validates the on-disk credentials file. Any problem at all (missing, unreadable, corrupt
 * JSON, wrong shape) is treated the same way: "no usable credentials on disk" — caller falls back to
 * registering fresh. This is deliberately permissive about the failure mode; it's not this function's
 * job to distinguish "file doesn't exist" from "file is garbage". Delegates to `fileTokenStore().get()`
 * — see the file-level doc comment for why. */
export function loadCredentials(): Credentials | null {
  return store.get()
}

/** Persists credentials at 0600, regardless of whether the file previously existed. Delegates to
 * `fileTokenStore().set()`, which does the identical mkdir+writeFileSync(mode:0600)+chmodSync
 * belt-and-suspenders dance this function used to do inline — see the file-level doc comment. */
export function saveCredentials(creds: Credentials): void {
  store.set(creds)
}

/** Calls session.register itself via the same raw-fetch-to-/mcp pattern cli.ts's forward() uses —
 * this is the proxy's own internal bookkeeping call, never relayed to the client (the client didn't
 * ask for it). Throws on any unusable outcome (isError, or a shape missing the fields we need). */
export async function registerSession(server: string, name: string, tenant: string | undefined): Promise<Credentials> {
  const args: Record<string, string> = { name }
  if (tenant) args.tenant = tenant
  const httpResponse = await postMcp(server, {
    jsonrpc: "2.0",
    id: "stdio-proxy-bootstrap-register",
    method: "tools/call",
    params: { name: "session.register", arguments: args },
  })
  const body = (await httpResponse.json()) as { result?: { isError?: boolean; structuredContent?: Partial<Credentials> } }
  const structured = body?.result?.structuredContent
  if (body?.result?.isError || !structured?.token || !structured?.userId || !structured?.tenantId) {
    throw new Error("session.register returned no usable token")
  }
  return { server, token: structured.token, userId: structured.userId, tenantId: structured.tenantId }
}

// Memoized for the process lifetime — but ONLY once resolution actually succeeds. A failed attempt is
// deliberately NOT cached as a permanent failure: a transient network blip on the first call shouldn't
// wedge every subsequent tools/call in this process into failing forever with no way to recover short
// of a restart. Safe without extra locking because cli.ts's main stdin loop awaits each message's
// handling — including this — before reading the next, so calls here are never concurrent.
let cachedCredentials: Credentials | null = null

/** Reuse-from-memory, else reuse-from-disk-if-it-matches-`server`, else register fresh. The normal
 * opt-in bootstrap path (cli.ts's maybeInjectToken). */
export async function resolveCredentials(server: string, name: string, tenant: string | undefined): Promise<Credentials> {
  if (cachedCredentials) return cachedCredentials
  const existing = loadCredentials()
  if (existing && existing.server === server) {
    cachedCredentials = existing
    return existing
  }
  const fresh = await registerSession(server, name, tenant)
  saveCredentials(fresh)
  cachedCredentials = fresh
  return fresh
}

/** Unconditionally registers a FRESH token and replaces whatever was memoized/on-disk — used by
 * cli.ts's retry-on-expired-token path. Deliberately does NOT consult the on-disk file first (unlike
 * resolveCredentials): the disk file almost certainly holds the SAME stale token that just failed (it
 * was persisted by this process or a prior run against the same now-dead server session), so reusing
 * it would just reproduce the failure that triggered this call in the first place. The stale in-memory
 * cache is cleared before registering (rather than just overwritten after) so a concurrent/re-entrant
 * read during registration can't observe the known-stale value as if it were still good — moot today
 * since the stdin loop is strictly sequential (see the memoization note above), but cheap to get right. */
export async function reregisterCredentials(server: string, name: string, tenant: string | undefined): Promise<Credentials> {
  cachedCredentials = null
  const fresh = await registerSession(server, name, tenant)
  saveCredentials(fresh)
  cachedCredentials = fresh
  return fresh
}
