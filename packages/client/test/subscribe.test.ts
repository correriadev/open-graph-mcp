// Uses node:test + node:assert (not bun:test) deliberately — see ../README.md and index.test.ts.
// Moved from packages/mcp-web/test/envelope.test.ts (INT-2 T2 extraction) with no behavior change,
// only the assertion library swapped (bun:test's expect().toEqual/toBeNull/toBe → node:assert/strict).
import { test } from "node:test"
import assert from "node:assert/strict"
import { classifyEnvelope, parseEnvelope, parseFrame, type Envelope } from "../src/subscribe.ts"

const env = (over: Partial<Envelope> = {}): Envelope => ({
  schemaVersion: 1,
  seq: 1,
  ts: 0,
  kind: "drift.node",
  target: "ui:P4",
  payload: {},
  graphId: "g1",
  ...over,
})

test("parseEnvelope accepts a well-formed envelope", () => {
  assert.deepEqual(parseEnvelope(JSON.stringify(env())), env())
})

test("parseEnvelope rejects malformed / wrong-schema payloads", () => {
  assert.equal(parseEnvelope("{bad json"), null)
  assert.equal(parseEnvelope(JSON.stringify({ ...env(), schemaVersion: 2 })), null)
  assert.equal(parseEnvelope(JSON.stringify({ ...env(), seq: "x" })), null)
  assert.equal(parseEnvelope(JSON.stringify({ kind: "drift.node" })), null)
})

test("classifyEnvelope resets on a graphId mismatch (spec §6)", () => {
  assert.equal(classifyEnvelope(env({ graphId: "g2", seq: 999 }), "g1", 5), "reset")
})

test("classifyEnvelope drops duplicates and applies fresh seqs", () => {
  assert.equal(classifyEnvelope(env({ seq: 5 }), "g1", 5), "duplicate")
  assert.equal(classifyEnvelope(env({ seq: 4 }), "g1", 5), "duplicate")
  assert.equal(classifyEnvelope(env({ seq: 6 }), "g1", 5), "apply")
})

test("classifyEnvelope applies first event when no graphId is known yet", () => {
  assert.equal(classifyEnvelope(env({ kind: "session.created", seq: 0 }), null, 0), "duplicate")
  assert.equal(classifyEnvelope(env({ kind: "session.created", seq: 1 }), null, 0), "apply")
})

test("classifyEnvelope exempts ephemeral envelopes from seq dedup (presence contract)", () => {
  // Ephemeral (presence) events reuse the current durable seq — seq <= lastSeq must still apply...
  assert.equal(classifyEnvelope(env({ kind: "user.focused", seq: 5, ephemeral: true }), "g1", 5), "apply")
  assert.equal(classifyEnvelope(env({ kind: "user.joined", seq: 0, ephemeral: true }), "g1", 5), "apply")
  // ...while a durable envelope with the same stale seq is still a duplicate.
  assert.equal(classifyEnvelope(env({ seq: 5 }), "g1", 5), "duplicate")
  // graphId reset still wins over the ephemeral exemption.
  assert.equal(classifyEnvelope(env({ kind: "user.focused", seq: 5, ephemeral: true, graphId: "g2" }), "g1", 5), "reset")
})

test("parseFrame reads the named SSE event + its data line (server names frames after the envelope kind)", () => {
  assert.deepEqual(parseFrame(`event: drift.node\ndata: ${JSON.stringify(env())}`), {
    event: "drift.node",
    data: JSON.stringify(env()),
  })
})

test("parseFrame defaults to 'message' when no event: line is present", () => {
  assert.deepEqual(parseFrame(`data: ${JSON.stringify(env())}`), { event: "message", data: JSON.stringify(env()) })
})

test("parseFrame joins multi-line data: fields and returns null with no data at all", () => {
  assert.deepEqual(parseFrame("event: session.created\ndata: {\"sessionId\":\ndata: \"s1\"}"), {
    event: "session.created",
    data: '{"sessionId":\n"s1"}',
  })
  assert.equal(parseFrame("event: ping\n"), null)
})

test("parseFrame strips only ONE leading space from data (SSE spec), preserving further whitespace", () => {
  // "data:  x " → drop one space → " x " (leading space + trailing space significant)
  assert.deepEqual(parseFrame("data:  x "), { event: "message", data: " x " })
  // "data:x" (no space) is left intact
  assert.deepEqual(parseFrame("data:x"), { event: "message", data: "x" })
})
