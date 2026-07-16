// Uses node:test + node:assert (not bun:test) deliberately — see ../README.md and index.test.ts.
//
// Exercises fileTokenStore()'s real fs behavior (read/write/0600 permissions) against a temp
// directory under os.tmpdir(), created fresh per test and removed afterward — NEVER against the real
// ~/.open-graph-mcp/credentials.json. The interface-contract behavior (get/set semantics as consumed
// by connect()) is covered with an in-memory fake in connect.test.ts; this file only proves the fs
// adapter itself does what it claims.
import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileTokenStore } from "../src/node-store.ts"
import type { Credentials } from "../src/store.ts"

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-client-node-store-test-"))
  file = path.join(dir, "credentials.json")
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

test("get() returns null when the file doesn't exist yet", () => {
  const store = fileTokenStore({ path: file })
  assert.equal(store.get(), null)
})

test("set() then get() round-trips credentials, and creates parent directories as needed", () => {
  const nested = path.join(dir, "nested", "sub", "credentials.json")
  const store = fileTokenStore({ path: nested })
  const creds: Credentials = { server: "http://x", token: "tok", userId: "u1", tenantId: "t1" }
  store.set(creds)
  assert.deepEqual(store.get(), creds)
})

test("set() persists the file at mode 0600", () => {
  const store = fileTokenStore({ path: file })
  store.set({ server: "http://x", token: "tok", userId: "u1", tenantId: "t1" })
  const mode = fs.statSync(file).mode & 0o777
  assert.equal(mode, 0o600)
})

test("set() re-asserts 0600 even when overwriting a file that previously had looser permissions", () => {
  const store = fileTokenStore({ path: file })
  store.set({ server: "http://x", token: "a", userId: "u1", tenantId: "t1" })
  fs.chmodSync(file, 0o644)
  store.set({ server: "http://x", token: "b", userId: "u1", tenantId: "t1" })
  const mode = fs.statSync(file).mode & 0o777
  assert.equal(mode, 0o600)
})

test("get() returns null for corrupt JSON instead of throwing", () => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, "{not json")
  const store = fileTokenStore({ path: file })
  assert.equal(store.get(), null)
})

test("get() returns null for well-formed JSON missing required fields", () => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ server: "http://x", token: "tok" })) // missing userId/tenantId
  const store = fileTokenStore({ path: file })
  assert.equal(store.get(), null)
})

test("fileTokenStore() with no options defaults to a path under the real home directory (not opened here)", () => {
  // Just prove the default-path branch doesn't throw at construction time — we do NOT call
  // get()/set() on the default store, to avoid ever touching the real ~/.open-graph-mcp directory.
  const store = fileTokenStore()
  assert.equal(typeof store.get, "function")
  assert.equal(typeof store.set, "function")
})
