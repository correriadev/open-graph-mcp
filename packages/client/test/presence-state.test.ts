// Uses node:test + node:assert (not bun:test) deliberately — see ../README.md and index.test.ts.
// Moved from packages/mcp-web/test/presence-state.test.ts (INT-2 T2 extraction) with no behavior
// change, only the assertion library swapped (bun:test's expect().toEqual/toBe → node:assert/strict).
import { test } from "node:test"
import assert from "node:assert/strict"
import { dotColor, initials, PresenceStore } from "../src/presence-state.ts"

const ev = (kind: string, payload: any) => ({ kind, payload })

test("dotColor derives status from last-seen age (spec §7.1)", () => {
  const now = 1_000_000
  assert.equal(dotColor(now - 1_000, now), "green")
  assert.equal(dotColor(now - 29_999, now), "green")
  assert.equal(dotColor(now - 30_000, now), "yellow")
  assert.equal(dotColor(now - 59_999, now), "yellow")
  assert.equal(dotColor(now - 60_000, now), "gray")
  assert.equal(dotColor(now - 120_000, now), "gray")
})

test("PresenceStore.apply adds a user on user.joined", () => {
  const s = new PresenceStore()
  s.apply(ev("user.joined", { userId: "u1", name: "Alice", agentKind: "web" }), 100)
  assert.deepEqual(s.users.get("u1"), {
    userId: "u1",
    name: "Alice",
    agentKind: "web",
    focusCell: null,
    openCount: 0,
    lastSeen: 100,
    typingState: "quiet",
  })
})

test("PresenceStore.apply updates focusCell on user.focused without clobbering name", () => {
  const s = new PresenceStore()
  s.apply(ev("user.joined", { userId: "u1", name: "Alice" }), 100)
  s.apply(ev("user.focused", { userId: "u1", cell: "ui:P4" }), 200)
  const u = s.users.get("u1")!
  assert.equal(u.name, "Alice")
  assert.equal(u.focusCell, "ui:P4")
  assert.equal(u.lastSeen, 200)
})

test("PresenceStore.apply removes the user on user.left", () => {
  const s = new PresenceStore()
  s.apply(ev("user.joined", { userId: "u1", name: "Alice" }), 100)
  s.apply(ev("user.left", { userId: "u1" }), 200)
  assert.equal(s.users.has("u1"), false)
})

test("PresenceStore.apply tracks typingState transitions", () => {
  const s = new PresenceStore()
  s.apply(ev("user.joined", { userId: "u1", name: "Alice" }), 100)
  s.apply(ev("user.typing_state", { userId: "u1", cell: "ui:P4", state: "typing" }), 150)
  assert.equal(s.users.get("u1")?.typingState, "typing")
  s.apply(ev("user.typing_state", { userId: "u1", cell: "ui:P4", state: "quiet" }), 300)
  assert.equal(s.users.get("u1")?.typingState, "quiet")
})

test("PresenceStore.apply ignores unrelated kinds and missing userId", () => {
  const s = new PresenceStore()
  s.apply(ev("changeset.opened", { csId: "cs1" }))
  s.apply(ev("user.focused", { cell: "ui:P4" }))
  assert.equal(s.users.size, 0)
})

test("PresenceStore.mergeWho drops users missing from the snapshot and preserves typingState", () => {
  const s = new PresenceStore()
  s.apply(ev("user.joined", { userId: "u1", name: "Alice" }), 100)
  s.apply(ev("user.typing_state", { userId: "u1", cell: "ui:P4", state: "typing" }), 100)
  s.apply(ev("user.joined", { userId: "u2", name: "Bob" }), 100)
  s.mergeWho([{ id: "u1", name: "Alice", agentKind: "web", focusCell: "ui:P4", openCount: 1 }], 500)
  assert.equal(s.users.has("u2"), false)
  const u1 = s.users.get("u1")!
  assert.equal(u1.openCount, 1)
  assert.equal(u1.typingState, "typing")
  assert.equal(u1.lastSeen, 500)
})

test("PresenceStore.mergeWho adds users we never saw a user.joined for", () => {
  const s = new PresenceStore()
  s.mergeWho([{ id: "u3", name: "Charlie", agentKind: "opencode", focusCell: null, openCount: 0 }], 42)
  assert.equal(s.users.get("u3")?.name, "Charlie")
  assert.equal(s.users.get("u3")?.typingState, "quiet")
})

test("initials picks first two words' first letters, falling back sanely", () => {
  assert.equal(initials("Alice Smith"), "AS")
  assert.equal(initials("Bob"), "BO")
  assert.equal(initials("  "), "?")
  assert.equal(initials("charlie"), "CH")
})

test("PresenceStore.list is sorted by name", () => {
  const s = new PresenceStore()
  s.apply(ev("user.joined", { userId: "u1", name: "Zed" }), 1)
  s.apply(ev("user.joined", { userId: "u2", name: "Alice" }), 1)
  assert.deepEqual(s.list().map((u) => u.name), ["Alice", "Zed"])
})
