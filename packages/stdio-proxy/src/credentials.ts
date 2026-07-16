/**
 * credentials.ts — the proxy's own bootstrap-identity cluster: on-disk credential I/O
 * (~/.open-graph-mcp/credentials.json, 0600), calling `session.register` itself, and in-process
 * memoization of the result. Everything here is the proxy's own bookkeeping — never relayed to the
 * calling MCP client, which never needs to know a token exists (see cli.ts's maybeInjectToken).
 *
 * Split out of cli.ts (Task 3) — a pure extraction, no behavior change — once code review on the
 * --name bootstrap flow flagged this as a natural module boundary distinct from cli.ts's
 * stdio-framing/injection-decision logic.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

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

/** Reads+validates the on-disk credentials file. Any problem at all (missing, unreadable, corrupt
 * JSON, wrong shape) is treated the same way: "no usable credentials on disk" — caller falls back to
 * registering fresh. This is deliberately permissive about the failure mode; it's not this function's
 * job to distinguish "file doesn't exist" from "file is garbage". */
export function loadCredentials(): Credentials | null {
  try {
    const raw = fs.readFileSync(credentialsPath(), "utf8")
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed.server === "string" &&
      typeof parsed.token === "string" &&
      typeof parsed.userId === "string" &&
      typeof parsed.tenantId === "string"
    ) {
      return parsed as Credentials
    }
    return null
  } catch {
    return null
  }
}

/** Persists credentials at 0600, regardless of whether the file previously existed. `writeFileSync`'s
 * `mode` option only reliably applies via the underlying open() flags on FIRST creation — an existing
 * file's mode is NOT guaranteed to be reset by a plain overwrite — so `chmodSync` is called explicitly
 * every time as a belt-and-suspenders guarantee of the 0600 invariant regardless of prior state. */
export function saveCredentials(creds: Credentials): void {
  const file = credentialsPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(creds, null, 2), { mode: 0o600 })
  fs.chmodSync(file, 0o600)
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
