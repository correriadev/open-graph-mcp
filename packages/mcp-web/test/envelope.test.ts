import { expect, test } from "bun:test"
import { classifyEnvelope, parseEnvelope, type Envelope } from "../src/subscribe"

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
