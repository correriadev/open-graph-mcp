import { expect, test } from "bun:test"
import { route } from "../src/affinity"
import type { EventEnvelope, Filter, Presence, Session } from "../src/state"

const TENANT = "acme"

function session(id: string, filters: Filter[], userId: string | null = null): Session {
  return { id, tenant: TENANT, filters, userId, push: () => {}, restartPending: false }
}

function presence(sessionId: string, userId: string, focusCell: string | null): Presence {
  return { sessionId, tenant: TENANT, userId, agentKind: "web", lastSeen: Date.now(), focusCell, openCsIds: [], invisible: false, lastDeltaAt: 0, typingState: "quiet" }
}

function env(kind: string, target: string | null, payload: Record<string, unknown>): EventEnvelope {
  return { schemaVersion: 1, seq: 1, ts: new Date().toISOString(), kind, target, payload, graphId: "g1" }
}

// S1: subscribed to cell ui:4 (e.g. observing that cell's canvas).
// S2: subscribed to domain "ui" (broader net, any cell in the ui domain).
// S3: no filter at all (implicit "all" per spec §4.4 — sees everything unrestricted).
const S1 = session("s1", [{ kind: "cell", cell: "ui:4" }], "u_holder")
const S2 = session("s2", [{ kind: "domain", domain: "ui" }], "u_other")
const S3 = session("s3", [], "u_bystander")
const sessions = new Map([
  [S1.id, S1],
  [S2.id, S2],
  [S3.id, S3],
])

test("changeset.opened: reaches cell observers (S1 cell, S2 domain, S3 unfiltered) — no admin fanout yet", () => {
  const e = env("changeset.opened", "cs_1", { csId: "cs_1", cells: ["ui:4"], domain: "ui", byUser: "u_holder" })
  expect(route(e, sessions, new Map(), TENANT)).toEqual(new Set(["s1", "s2", "s3"]))
})

test("changeset.delta: cell/cs_id observers + the holder (even if the holder itself has no matching filter)", () => {
  const noneMatch = new Map([
    ["s1", session("s1", [{ kind: "cell", cell: "other:9" }])],
    ["s2", session("s2", [{ kind: "changeset", id: "cs_9" }], "u_holder")], // holder, but subscribed elsewhere
    ["s3", session("s3", [{ kind: "domain", domain: "unrelated" }])],
  ])
  const e = env("changeset.delta", "cs_1", { csId: "cs_1", cells: ["ui:4"], byUser: "u_holder", delta_count_since_last: 3 })
  // s1: filter doesn't match cell/csId → excluded. s2: filter doesn't match either, but IS the holder → included.
  // s3: filter doesn't match → excluded.
  expect(route(e, noneMatch, new Map(), TENANT)).toEqual(new Set(["s2"]))
})

test("changeset.committed: cell/cs_id observers + everyone with presence focus on the cell, even unsubscribed", () => {
  const e = env("changeset.committed", "cs_1", { csId: "cs_1", cells: ["ui:4"], blastRadius: 1 })
  // S3 (empty filters = "all" per spec §4.4) would also match the base case regardless of presence, so it
  // can't isolate the presence-only path; use sessions with a non-matching filter instead.
  const narrow = new Map([
    [S1.id, S1], // cell:ui:4 → matches
    ["s4", session("s4", [{ kind: "domain", domain: "unrelated" }], "u_elsewhere")], // no match, no focus
    ["s5", session("s5", [{ kind: "domain", domain: "unrelated" }], "u_focused")], // no match, but focused on ui:4
  ])
  const pres2 = new Map([["s5", presence("s5", "u_focused", "ui:4")]])
  expect(route(e, narrow, pres2, TENANT)).toEqual(new Set(["s1", "s5"]))
})

test("changeset.aborted: ONLY cs_id observers + holder — cell-only observers are excluded", () => {
  const set = new Map([
    ["cellOnly", session("cellOnly", [{ kind: "cell", cell: "ui:4" }])], // would match via cell, but spec excludes it
    ["csObserver", session("csObserver", [{ kind: "changeset", id: "cs_1" }])],
    ["holderNoFilter", session("holderNoFilter", [{ kind: "domain", domain: "unrelated" }], "u_holder")],
  ])
  // REAL production payload shape (sweeper.ts TTL expiry): byUser = holder in the PAYLOAD is what routes
  // the event to the holder's session(s) — EventInput.byUser only reaches the audit column, not the envelope.
  const e = env("changeset.aborted", "cs_1", { csId: "cs_1", reason: "ttl_expired", cells: ["ui:4"], byUser: "u_holder" })
  expect(route(e, set, new Map(), TENANT)).toEqual(new Set(["csObserver", "holderNoFilter"]))
})

test("lock.denied: ONLY the attempting user's session(s) — never a broadcast", () => {
  const e = env("lock.denied", "ui:4", { cell: "ui:4", attempted_by: "u_other", holder: "u_holder", csId: "cs_1" })
  // S1 subscribes to cell ui:4 (would normally observe lock events on that cell) but is NOT the attempter.
  expect(route(e, sessions, new Map(), TENANT)).toEqual(new Set(["s2"])) // s2's userId is u_other
})

test("lock.acquired / lock.released: cell observers only (unchanged Fase 2 semantics)", () => {
  const acquired = env("lock.acquired", "ui:4", { cell: "ui:4", csId: "cs_1", domain: "ui", holder: "u_holder" })
  expect(route(acquired, sessions, new Map(), TENANT)).toEqual(new Set(["s1", "s2", "s3"]))
  const released = env("lock.released", "ui:4", { cell: "ui:4", csId: "cs_1", domain: "ui", reason: "committed" })
  expect(route(released, sessions, new Map(), TENANT)).toEqual(new Set(["s1", "s2", "s3"]))
})

test("authority.flipped: reaches everyone connected regardless of filter", () => {
  const narrowlyFiltered = new Map([
    ["a", session("a", [{ kind: "cell", cell: "zzz:1" }])],
    ["b", session("b", [{ kind: "event", events: ["changeset.opened"] }])],
  ])
  const e = env("authority.flipped", "somecell:5", { cell: "somecell:5", to: "graph" })
  expect(route(e, narrowlyFiltered, new Map(), TENANT)).toEqual(new Set(["a", "b"]))
})

test("user.focused: observers of the same cell only", () => {
  const e = env("user.focused", "ui:4", { sessionId: "sX", userId: "u_x", cell: "ui:4", domain: "ui" })
  expect(route(e, sessions, new Map(), TENANT)).toEqual(new Set(["s1", "s2", "s3"]))
})

test("user.left: cell observers + observers of any cs_id the user had open", () => {
  const set = new Map([
    ["cellObs", session("cellObs", [{ kind: "cell", cell: "ui:4" }])],
    ["csObs", session("csObs", [{ kind: "changeset", id: "cs_open_1" }])],
    ["unrelated", session("unrelated", [{ kind: "domain", domain: "nope" }])],
  ])
  const e = env("user.left", "ui:4", { sessionId: "sX", userId: "u_x", cell: "ui:4", reason: "left", openCsIds: ["cs_open_1"] })
  expect(route(e, set, new Map(), TENANT)).toEqual(new Set(["cellObs", "csObs"]))
})

test("user.typing_state: observers of the cell the user is focused on", () => {
  const e = env("user.typing_state", "ui:4", { sessionId: "sX", userId: "u_x", cell: "ui:4", domain: "ui", state: "typing" })
  expect(route(e, sessions, new Map(), TENANT)).toEqual(new Set(["s1", "s2", "s3"]))
})

test("user.joined: broadcast to everyone regardless of filter (unchanged)", () => {
  const narrowlyFiltered = new Map([["a", session("a", [{ kind: "cell", cell: "zzz:1" }])]])
  const e = env("user.joined", "sX", { sessionId: "sX", userId: "u_x" })
  expect(route(e, narrowlyFiltered, new Map(), TENANT)).toEqual(new Set(["a"]))
})

test("tenant isolation: sessions in another tenant never receive, even with a matching filter", () => {
  const otherTenantSession: Session = { id: "other", tenant: "other-tenant", filters: [{ kind: "cell", cell: "ui:4" }], userId: null, push: () => {}, restartPending: false }
  const mixed = new Map([[S1.id, S1], [otherTenantSession.id, otherTenantSession]])
  const e = env("lock.acquired", "ui:4", { cell: "ui:4", csId: "cs_1", domain: "ui", holder: "u_holder" })
  expect(route(e, mixed, new Map(), TENANT)).toEqual(new Set(["s1"]))
})
