// Uses node:test + node:assert (not bun:test) deliberately: this exact syntax runs unmodified
// under `bun test` (Bun implements the node:test module) AND under plain `node --test` on
// Node >=22.18 (unflagged native TS type-stripping) or Node >=22.6 with --experimental-strip-types.
// See ../README.md for the full compatibility matrix and the separate dist-smoke proof that
// covers the true Node >=20 floor (built JS, no type-stripping involved).
//
// Smoke test only — proves the barrel (`src/index.ts`) actually re-exports the real API surface
// under both runtimes. Full behavioral coverage lives in subscribe.test.ts / presence-state.test.ts.
import { test } from "node:test"
import assert from "node:assert/strict"
import { dotColor, initials, PresenceStore, EventStream, parseEnvelope } from "../src/index.ts"

test("index barrel re-exports the presence and subscribe API", () => {
  assert.equal(typeof dotColor, "function")
  assert.equal(typeof initials, "function")
  assert.equal(typeof PresenceStore, "function")
  assert.equal(typeof EventStream, "function")
  assert.equal(typeof parseEnvelope, "function")
  assert.equal(initials("Ada Lovelace"), "AL")
})
