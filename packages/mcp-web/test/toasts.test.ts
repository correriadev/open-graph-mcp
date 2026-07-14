import { expect, test } from "bun:test"
import { ToastQueue } from "../src/toasts"

test("push adds a new toast", () => {
  const q = new ToastQueue()
  const t = q.push("cs_abc", "cs_abc abortado por TTL", { now: 0 })
  expect(t.count).toBe(1)
  expect(t.text).toBe("cs_abc abortado por TTL")
  expect(q.all().length).toBe(1)
})

test("coalesces same-key toasts within the window (spec §7.4)", () => {
  const q = new ToastQueue()
  q.push("cs_abc", "delta 1 em cs_abc", { now: 0 })
  q.push("cs_abc", "delta 2 em cs_abc", { now: 100 })
  q.push("cs_abc", "delta 3 em cs_abc", { now: 400 })
  expect(q.all().length).toBe(1)
  const top = q.all()[0]
  expect(top.count).toBe(3)
  expect(top.text).toBe("3 eventos em cs_abc")
})

test("does not coalesce once the window has elapsed", () => {
  const q = new ToastQueue()
  q.push("cs_abc", "delta 1 em cs_abc", { now: 0 })
  q.push("cs_abc", "delta 2 em cs_abc", { now: 600 })
  expect(q.all().length).toBe(2)
})

test("does not coalesce a different key even within the window", () => {
  const q = new ToastQueue()
  q.push("cs_abc", "a", { now: 0 })
  q.push("cs_def", "b", { now: 50 })
  expect(q.all().length).toBe(2)
})

test("keeps only the most recent 10 toasts", () => {
  const q = new ToastQueue()
  for (let i = 0; i < 15; i++) q.push(`cs_${i}`, `event ${i}`, { now: i * 1000 })
  expect(q.all().length).toBe(10)
  // most recent (cs_14) is first, oldest kept is cs_5
  expect(q.all()[0].key).toBe("cs_14")
  expect(q.all()[9].key).toBe("cs_5")
})

test("visible caps the on-screen count and reports overflow", () => {
  const q = new ToastQueue()
  for (let i = 0; i < 8; i++) q.push(`cs_${i}`, `event ${i}`, { now: i * 1000 })
  const { toasts, overflow } = q.visible(5)
  expect(toasts.length).toBe(5)
  expect(overflow).toBe(3)
})

test("remove drops a toast by id", () => {
  const q = new ToastQueue()
  const a = q.push("cs_a", "a", { now: 0 })
  q.push("cs_b", "b", { now: 1000 })
  q.remove(a.id)
  expect(q.all().length).toBe(1)
  expect(q.all()[0].key).toBe("cs_b")
})

test("push carries an optional target for click-to-jump", () => {
  const q = new ToastQueue()
  const t = q.push("cs_abc", "Alice commitou cs_abc em [ui:3]", { now: 0, target: "ui:3" })
  expect(t.target).toBe("ui:3")
})
