// ---------------------------------------------------------------------------
// fileTokenStore() — a Node/Bun-only `TokenStore` (see ./store.ts) backed by
// `~/.open-graph-mcp/credentials.json` at mode 0600. Adapted from (not
// literally copy-pasted from) stdio-proxy's src/credentials.ts read/write/
// permissions pattern: same file location, same 0600 belt-and-suspenders
// (mode on write + explicit chmodSync), same "any problem at all → null"
// permissive read. Deliberately narrower than stdio-proxy's file: no
// `registerSession`/`resolveCredentials`/`reregisterCredentials`/`postMcp` —
// those are RPC-level bootstrap concerns that belong to `connect()` (see
// ./connect.ts), not to a pure storage primitive.
//
// This is a SEPARATE package subpath entry ("@open-graph-mcp/client/node-store",
// see package.json#exports) specifically so importing the main entry point
// (`@open-graph-mcp/client`) never pulls `node:fs`/`node:os`/`node:path` into
// a browser bundle graph. Only import this module from Node/Bun code that
// wants on-disk token persistence (e.g. a future stdio-proxy consolidation —
// out of scope here, see T3's task brief).
// ---------------------------------------------------------------------------

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Credentials, TokenStore } from "./store.ts"

export type FileTokenStoreOptions = {
  /** Override the credentials file path — primarily a test affordance (point at a temp dir instead of
   * the real `~/.open-graph-mcp/credentials.json`). Also doubles as the roadmap's `credentialsFile`
   * connect() option, if/when that's wired up. Defaults to `~/.open-graph-mcp/credentials.json`. */
  path?: string
}

function defaultCredentialsPath(): string {
  return path.join(os.homedir(), ".open-graph-mcp", "credentials.json")
}

function isCredentials(v: any): v is Credentials {
  return (
    v &&
    typeof v.server === "string" &&
    typeof v.token === "string" &&
    typeof v.userId === "string" &&
    typeof v.tenantId === "string"
  )
}

/** Build a `TokenStore` backed by a JSON file on disk at mode 0600. Any read problem (missing file,
 * unreadable, corrupt JSON, wrong shape) is treated as "no usable credentials" — same permissive
 * failure mode as stdio-proxy's `loadCredentials`. */
export function fileTokenStore(opts: FileTokenStoreOptions = {}): TokenStore {
  const file = opts.path ?? defaultCredentialsPath()

  return {
    get(): Credentials | null {
      try {
        const raw = fs.readFileSync(file, "utf8")
        const parsed = JSON.parse(raw)
        return isCredentials(parsed) ? parsed : null
      } catch {
        return null
      }
    },
    set(creds: Credentials): void {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(creds, null, 2), { mode: 0o600 })
      // writeFileSync's `mode` only reliably applies on FIRST creation of the file — an existing
      // file's mode is not guaranteed to be reset by a plain overwrite — so chmod explicitly every
      // time as a belt-and-suspenders guarantee of the 0600 invariant regardless of prior state.
      fs.chmodSync(file, 0o600)
    },
  }
}
