// Uses node:test + node:assert (not bun:test) deliberately: this exact syntax runs unmodified
// under `bun test` (Bun implements the node:test module) AND under plain `node --test` on
// Node >=22.18 (unflagged native TS type-stripping) or Node >=22.6 with --experimental-strip-types.
// See ../README.md for the full compatibility matrix and the separate dist-smoke proof that
// covers the true Node >=20 floor (built JS, no type-stripping involved).
import { test } from "node:test"
import assert from "node:assert/strict"
import { ping } from "../src/index.ts"

test("ping returns pong", () => {
  assert.equal(ping(), "pong")
})
