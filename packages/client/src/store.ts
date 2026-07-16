// ---------------------------------------------------------------------------
// TokenStore — pure interface, no I/O. Deliberately kept dependency-free (no
// `node:fs`/`node:os`/`node:path`, no fetch) so it's safe to import from the
// package's main entry point (index.ts) and therefore safe inside a browser
// bundle (mcp-web/Vite). The two concrete implementations live elsewhere:
//   - a caller-supplied in-memory/localStorage-backed store (browser), or
//   - `fileTokenStore()` from the separate `./node-store.ts` subpath entry
//     (Node/Bun only, never imported by the main entry point's graph).
//
// `Credentials` intentionally matches the shape of stdio-proxy's own
// `Credentials` type (packages/stdio-proxy/src/credentials.ts:
// `{ server, token, userId, tenantId }`) byte-for-byte. That's not
// coincidence — a later task (T6) may consolidate stdio-proxy onto this
// store, and matching the shape now means that's a type swap, not a
// reshape, if/when that happens.
// ---------------------------------------------------------------------------

export type Credentials = { server: string; token: string; userId: string; tenantId: string }

export type TokenStore = {
  /** Return the persisted credentials, or null if none exist / are unreadable / are malformed.
   * Implementations should be permissive about failure (missing file, corrupt JSON, etc.) and
   * just report "nothing usable" rather than throwing — mirrors stdio-proxy's `loadCredentials`. */
  get(): Credentials | null
  /** Persist credentials, replacing whatever was previously stored. */
  set(creds: Credentials): void
}
