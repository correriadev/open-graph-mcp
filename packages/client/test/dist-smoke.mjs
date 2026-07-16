// Proves the package's real Node compatibility floor: Node >=20, no TS/type-stripping involved
// at all, because this imports the plain-JS build output (dist/), not TS source.
//
// Deliberately named without ".test." so bun's default test-file glob (*.test.{js,jsx,ts,tsx} etc.)
// never auto-discovers it — `bun test` at the repo root must stay green without a prior build step.
// Run explicitly, after `bun run build`:
//   node --test test/dist-smoke.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { initials, dotColor, connect } from "../dist/index.js"

test("built dist output: presence helpers work", () => {
  assert.equal(initials("Ada Lovelace"), "AL")
  assert.equal(dotColor(Date.now()), "green")
})

test("built dist output: connect() is exported and returns a call/close handle (INT-2 T3)", async () => {
  assert.equal(typeof connect, "function")
  const og = await connect({ server: "http://example.invalid", agentKind: "web", token: "tok" })
  assert.equal(typeof og.call, "function")
  assert.equal(typeof og.close, "function")
  og.close()
})
