import { expect, test } from "bun:test"
import { classifyEnvelope, parseEnvelope, parseFrame, type Envelope } from "../src/subscribe"

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
  expect(parseEnvelope(JSON.stringify(env()))).toEqual(env())
})

test("parseEnvelope rejects malformed / wrong-schema payloads", () => {
  expect(parseEnvelope("{bad json")).toBeNull()
  expect(parseEnvelope(JSON.stringify({ ...env(), schemaVersion: 2 }))).toBeNull()
  expect(parseEnvelope(JSON.stringify({ ...env(), seq: "x" }))).toBeNull()
  expect(parseEnvelope(JSON.stringify({ kind: "drift.node" }))).toBeNull()
})

test("classifyEnvelope resets on a graphId mismatch (spec §6)", () => {
  expect(classifyEnvelope(env({ graphId: "g2", seq: 999 }), "g1", 5)).toBe("reset")
})

test("classifyEnvelope drops duplicates and applies fresh seqs", () => {
  expect(classifyEnvelope(env({ seq: 5 }), "g1", 5)).toBe("duplicate")
  expect(classifyEnvelope(env({ seq: 4 }), "g1", 5)).toBe("duplicate")
  expect(classifyEnvelope(env({ seq: 6 }), "g1", 5)).toBe("apply")
})

test("classifyEnvelope applies first event when no graphId is known yet", () => {
  expect(classifyEnvelope(env({ kind: "session.created", seq: 0 }), null, 0)).toBe("duplicate")
  expect(classifyEnvelope(env({ kind: "session.created", seq: 1 }), null, 0)).toBe("apply")
})

test("classifyEnvelope exempts ephemeral envelopes from seq dedup (presence contract)", () => {
  // Ephemeral (presence) events reuse the current durable seq — seq <= lastSeq must still apply...
  expect(classifyEnvelope(env({ kind: "user.focused", seq: 5, ephemeral: true }), "g1", 5)).toBe("apply")
  expect(classifyEnvelope(env({ kind: "user.joined", seq: 0, ephemeral: true }), "g1", 5)).toBe("apply")
  // ...while a durable envelope with the same stale seq is still a duplicate.
  expect(classifyEnvelope(env({ seq: 5 }), "g1", 5)).toBe("duplicate")
  // graphId reset still wins over the ephemeral exemption.
  expect(classifyEnvelope(env({ kind: "user.focused", seq: 5, ephemeral: true, graphId: "g2" }), "g1", 5)).toBe("reset")
})

test("parseFrame reads the named SSE event + its data line (server names frames after the envelope kind)", () => {
  expect(parseFrame(`event: drift.node\ndata: ${JSON.stringify(env())}`)).toEqual({
    event: "drift.node",
    data: JSON.stringify(env()),
  })
})

test("parseFrame defaults to 'message' when no event: line is present", () => {
  expect(parseFrame(`data: ${JSON.stringify(env())}`)).toEqual({ event: "message", data: JSON.stringify(env()) })
})

test("parseFrame joins multi-line data: fields and returns null with no data at all", () => {
  expect(parseFrame("event: session.created\ndata: {\"sessionId\":\ndata: \"s1\"}")).toEqual({
    event: "session.created",
    data: '{"sessionId":\n"s1"}',
  })
  expect(parseFrame("event: ping\n")).toBeNull()
})
