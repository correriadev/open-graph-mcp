import { expect, test } from "bun:test"
import { createRefNavigator } from "../src/ref-lookup"
import type { ClaimRecord } from "../src/store"

const claim = (id: string): ClaimRecord => ({ id, subject: id, domain: "billing", level: 4, refs: [], anchor: "a", seq: 7 })

function harness() {
  let generation = 1
  let now = 0
  let claimsByCell: Record<string, ClaimRecord[]> = { "auth:P3": [claim("local")] }
  let reads = 0
  const effects: string[] = []
  const responses: Promise<{ claim: unknown }>[] = []
  let timerId = 0
  const timers = new Map<number, () => void>()
  const navigator = createRefNavigator({
    snapshot: () => ({ generation, claimsByCell }),
    read: () => { reads++; return responses.shift() ?? Promise.resolve({ claim: null }) },
    merge: (item) => { claimsByCell = { ...claimsByCell, "billing:P4": [...(claimsByCell["billing:P4"] ?? []), item] }; effects.push(`merge:${item.id}`) },
    navigate: (cell, id) => effects.push(`navigate:${cell}:${id}`),
    notifyMissing: (id) => effects.push(`missing:${id}`),
    notifyFailure: (id) => effects.push(`failure:${id}`),
    now: () => now,
    lookupTimeoutMs: 100,
    setTimer: (callback) => { const id = ++timerId; timers.set(id, callback); return id },
    clearTimer: (id) => { timers.delete(id as number) },
  })
  return {
    navigator, effects,
    get reads() { return reads },
    setGeneration: (value: number) => { generation = value },
    setNow: (value: number) => { now = value },
    advance: (value: number) => { now += value; const due = [...timers.values()]; timers.clear(); due.forEach((callback) => callback()) },
    defer: () => {
      let finish!: (value: { claim: unknown }) => void
      responses.push(new Promise((resolve) => { finish = resolve }))
      return finish
    },
    rejectNext: () => { responses.push(Promise.reject(new Error("temporary"))) },
    claims: () => claimsByCell,
  }
}

test("local claim navigates without a resource read", async () => {
  const h = harness()
  await h.navigator.navigate("local")
  expect(h.reads).toBe(0)
  expect(h.effects).toEqual(["navigate:auth:P3:local"])
})

test("uncached duplicate clicks share one lookup, merge once, and preserve existing pages", async () => {
  const h = harness(); const finish = h.defer()
  const first = h.navigator.navigate("remote")
  const second = h.navigator.navigate("remote")
  expect(h.reads).toBe(1)
  finish({ claim: claim("remote") })
  await Promise.all([first, second])
  expect(h.effects).toEqual(["merge:remote", "navigate:billing:P4:remote"])
  expect(h.claims()["auth:P3"]?.map((item) => item.id)).toEqual(["local"])
})

test("miss is cached for five seconds and retries after expiry", async () => {
  const h = harness()
  await h.navigator.navigate("missing"); await h.navigator.navigate("missing")
  expect(h.reads).toBe(1); expect(h.effects).toEqual(["missing:missing"])
  h.setNow(5001); await h.navigator.navigate("missing")
  expect(h.reads).toBe(2); expect(h.effects).toEqual(["missing:missing", "missing:missing"])
})

test("stale hit and miss create no projection, navigation, cache, or notification", async () => {
  const hit = harness(); const finishHit = hit.defer(); const pendingHit = hit.navigator.navigate("late-hit")
  hit.setGeneration(2); hit.navigator.clear(); finishHit({ claim: claim("late-hit") }); await pendingHit
  expect(hit.effects).toEqual([])

  const miss = harness(); const finishMiss = miss.defer(); const pendingMiss = miss.navigator.navigate("late-miss")
  miss.setGeneration(2); miss.navigator.clear(); finishMiss({ claim: null }); await pendingMiss
  expect(miss.effects).toEqual([])
  await miss.navigator.navigate("late-miss")
  expect(miss.reads).toBe(2)
})

test("invalid response is contained without corrupting claims", async () => {
  const h = harness(); const finish = h.defer(); const before = h.claims()
  const pending = h.navigator.navigate("invalid"); finish({ claim: { id: "invalid" } }); await pending
  expect(h.claims()).toBe(before)
  expect(h.effects).toEqual(["failure:invalid"])
})

test("strict validation rejects hostile domains, levels, and sequences and caches failures", async () => {
  const invalid = [
    { ...claim("bad"), domain: " " }, { ...claim("bad"), domain: {} },
    { ...claim("bad"), level: -1 }, { ...claim("bad"), level: 1.5 }, { ...claim("bad"), level: {} },
    { ...claim("bad"), domain: "bad:cell" }, { ...claim("bad"), domain: "bad\ncell" }, { ...claim("bad"), domain: "bad/cell" },
    { ...claim("bad"), level: "P4:evil" },
    { ...claim("bad"), seq: Infinity }, { ...claim("bad"), seq: -1 }, { ...claim("bad"), seq: 1.5 },
    { ...claim("bad"), seq: Number.MAX_SAFE_INTEGER + 1 },
  ]
  for (const response of invalid) {
    const h = harness(); const finish = h.defer(); const pending = h.navigator.navigate("bad")
    finish({ claim: response }); await pending; await h.navigator.navigate("bad")
    expect(h.reads).toBe(1)
    expect(h.effects).toEqual(["failure:bad"])
  }
})

test("distinct delayed lookups and failure notifications are globally bounded", async () => {
  const h = harness()
  const finishes = Array.from({ length: 20 }, () => h.defer())
  const pending = Array.from({ length: 20 }, (_, index) => h.navigator.navigate(`delayed-${index}`))
  expect(h.reads).toBe(16)
  expect(h.effects.filter((effect) => effect.startsWith("failure:"))).toHaveLength(1)
  for (let index = 0; index < 16; index++) finishes[index]({ claim: null })
  await Promise.all(pending)
})

test("transient failures are cached and cannot amplify reads or toasts", async () => {
  const h = harness(); h.rejectNext()
  await h.navigator.navigate("temporary")
  await h.navigator.navigate("temporary")
  expect(h.reads).toBe(1)
  expect(h.effects).toEqual(["failure:temporary"])
})

test("invalidation reclaims capacity for the new generation before stale reads settle", async () => {
  const h = harness()
  const staleFinishes = Array.from({ length: 16 }, () => h.defer())
  const stale = Array.from({ length: 16 }, (_, index) => h.navigator.navigate(`stale-${index}`))
  expect(h.reads).toBe(16)
  h.setGeneration(2); h.navigator.clear()
  const finishCurrent = h.defer()
  const current = h.navigator.navigate("current")
  expect(h.reads).toBe(17)
  finishCurrent({ claim: { ...claim("current"), id: "current" } })
  await current
  expect(h.effects).toContain("navigate:billing:P4:current")
  staleFinishes.forEach((finish) => finish({ claim: null }))
  await Promise.all(stale)
})

test("hung reads time out, release capacity, and expose identifier-free tail metrics", async () => {
  const h = harness(); h.defer()
  const pending = h.navigator.navigate("hung")
  expect(h.navigator.metrics()).toEqual({ active: 1, completed: 0, timeouts: 0, maxLatencyMs: 0 })
  h.advance(100)
  await pending
  expect(h.effects).toEqual(["failure:hung"])
  expect(h.navigator.metrics()).toEqual({ active: 0, completed: 1, timeouts: 1, maxLatencyMs: 100 })
  expect(Object.keys(h.navigator.metrics())).not.toContain("id")
})

test("failure notification throttling resets for a replacement generation", async () => {
  const h = harness(); let finish = h.defer(); let pending = h.navigator.navigate("bad-one")
  finish({ claim: { id: "bad-one" } }); await pending
  h.setGeneration(2); h.navigator.clear()
  finish = h.defer(); pending = h.navigator.navigate("bad-two")
  finish({ claim: { id: "bad-two" } }); await pending
  expect(h.effects).toEqual(["failure:bad-one", "failure:bad-two"])
})

test("negative cache stays bounded and safely evicts its oldest entry", async () => {
  const h = harness()
  for (let index = 0; index < 129; index++) await h.navigator.navigate(`missing-${index}`)
  expect(h.reads).toBe(129)
  await h.navigator.navigate("missing-0")
  expect(h.reads).toBe(130)
})
