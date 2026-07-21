import { expect, test } from "bun:test"
import { createTypingRateLimiter, type TypingClock } from "../src/typing-rate-limit"

function harness() {
  let now = 0
  let id = 0
  const timers = new Map<number, { at: number; callback: () => void }>()
  const clock: TypingClock = {
    now: () => now,
    set: (callback, delay) => { const key = ++id; timers.set(key, { at: now + delay, callback }); return key as any },
    clear: (key) => { timers.delete(key as any) },
  }
  const advance = (ms: number) => {
    const target = now + ms
    while (true) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      now = next[1].at; timers.delete(next[0]); next[1].callback()
    }
    now = target
  }
  return { clock, advance, timers }
}

test("100 synchronous edits emit one leading and one trailing call at 400ms", () => {
  const h = harness(); let calls = 0
  const limiter = createTypingRateLimiter(() => calls++, h.clock)
  for (let i = 0; i < 100; i++) limiter.signal()
  expect(calls).toBe(1); h.advance(399); expect(calls).toBe(1); h.advance(1); expect(calls).toBe(2)
})

test("continuous activity stays bounded and idle activity restarts immediately", () => {
  const h = harness(); const sent: number[] = []
  const limiter = createTypingRateLimiter(() => sent.push(h.clock.now()), h.clock)
  for (let elapsed = 0; elapsed < 2000; elapsed += 50) { limiter.signal(); h.advance(50) }
  expect(sent.every((at, i) => i === 0 || at - sent[i - 1] >= 400)).toBe(true)
  h.advance(400); const before = sent.length; limiter.signal(); expect(sent.length).toBe(before + 1)
})

test("cancel drops trailing work and a new limiter owns reconnect activity", () => {
  const h = harness(); let a = 0; let b = 0
  const old = createTypingRateLimiter(() => a++, h.clock); old.signal(); old.signal(); old.cancel()
  const fresh = createTypingRateLimiter(() => b++, h.clock); fresh.signal(); h.advance(400)
  expect(a).toBe(1); expect(b).toBe(1); expect(h.timers.size).toBe(0)
})

test("send rejection isolation belongs to the injected callback", async () => {
  const h = harness(); let attempts = 0
  const limiter = createTypingRateLimiter(() => { attempts++; Promise.reject(new Error("nope")).catch(() => {}) }, h.clock)
  expect(() => limiter.signal()).not.toThrow(); limiter.signal(); h.advance(400); await Promise.resolve()
  expect(attempts).toBe(2)
})
