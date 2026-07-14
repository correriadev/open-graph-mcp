import { expect, test } from "bun:test"
import { dotColor, initials, PresenceStore } from "../src/presence-state"

const ev = (kind: string, payload: any) => ({ kind, payload })

test("dotColor derives status from last-seen age (spec §7.1)", () => {
  const now = 1_000_000
  expect(dotColor(now - 1_000, now)).toBe("green")
  expect(dotColor(now - 29_999, now)).toBe("green")
  expect(dotColor(now - 30_000, now)).toBe("yellow")
  expect(dotColor(now - 59_999, now)).toBe("yellow")
  expect(dotColor(now - 60_000, now)).toBe("gray")
  expect(dotColor(now - 120_000, now)).toBe("gray")
})

test("PresenceStore.apply adds a user on user.joined", () => {
  const s = new PresenceStore()
  s.apply(ev("user.joined", { userId: "u1", name: "Alice", agentKind: "web" }), 100)
  expect(s.users.get("u1")).toEqual({
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
  expect(u.name).toBe("Alice")
  expect(u.focusCell).toBe("ui:P4")
  expect(u.lastSeen).toBe(200)
})

test("PresenceStore.apply removes the user on user.left", () => {
  const s = new PresenceStore()
  s.apply(ev("user.joined", { userId: "u1", name: "Alice" }), 100)
  s.apply(ev("user.left", { userId: "u1" }), 200)
  expect(s.users.has("u1")).toBe(false)
})

test("PresenceStore.apply tracks typingState transitions", () => {
  const s = new PresenceStore()
  s.apply(ev("user.joined", { userId: "u1", name: "Alice" }), 100)
  s.apply(ev("user.typing_state", { userId: "u1", cell: "ui:P4", state: "typing" }), 150)
  expect(s.users.get("u1")?.typingState).toBe("typing")
  s.apply(ev("user.typing_state", { userId: "u1", cell: "ui:P4", state: "quiet" }), 300)
  expect(s.users.get("u1")?.typingState).toBe("quiet")
})

test("PresenceStore.apply ignores unrelated kinds and missing userId", () => {
  const s = new PresenceStore()
  s.apply(ev("changeset.opened", { csId: "cs1" }))
  s.apply(ev("user.focused", { cell: "ui:P4" }))
  expect(s.users.size).toBe(0)
})

test("PresenceStore.mergeWho drops users missing from the snapshot and preserves typingState", () => {
  const s = new PresenceStore()
  s.apply(ev("user.joined", { userId: "u1", name: "Alice" }), 100)
  s.apply(ev("user.typing_state", { userId: "u1", cell: "ui:P4", state: "typing" }), 100)
  s.apply(ev("user.joined", { userId: "u2", name: "Bob" }), 100)
  s.mergeWho([{ id: "u1", name: "Alice", agentKind: "web", focusCell: "ui:P4", openCount: 1 }], 500)
  expect(s.users.has("u2")).toBe(false)
  const u1 = s.users.get("u1")!
  expect(u1.openCount).toBe(1)
  expect(u1.typingState).toBe("typing")
  expect(u1.lastSeen).toBe(500)
})

test("PresenceStore.mergeWho adds users we never saw a user.joined for", () => {
  const s = new PresenceStore()
  s.mergeWho([{ id: "u3", name: "Charlie", agentKind: "opencode", focusCell: null, openCount: 0 }], 42)
  expect(s.users.get("u3")?.name).toBe("Charlie")
  expect(s.users.get("u3")?.typingState).toBe("quiet")
})

test("initials picks first two words' first letters, falling back sanely", () => {
  expect(initials("Alice Smith")).toBe("AS")
  expect(initials("Bob")).toBe("BO")
  expect(initials("  ")).toBe("?")
  expect(initials("charlie")).toBe("CH")
})

test("PresenceStore.list is sorted by name", () => {
  const s = new PresenceStore()
  s.apply(ev("user.joined", { userId: "u1", name: "Zed" }), 1)
  s.apply(ev("user.joined", { userId: "u2", name: "Alice" }), 1)
  expect(s.list().map((u) => u.name)).toEqual(["Alice", "Zed"])
})
