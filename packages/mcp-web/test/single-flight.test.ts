import { expect, test } from "bun:test"
import { SingleFlight } from "../src/single-flight"

test("same generation and cursor share one request", async () => {
  const flights = new SingleFlight<number>()
  let starts = 0
  let resolve!: (value: number) => void
  const start = () => { starts++; return new Promise<number>((done) => { resolve = done }) }
  const first = flights.run("4:0", start)
  const duplicate = flights.run("4:0", start)
  expect(first).toBe(duplicate)
  expect(starts).toBe(1)
  resolve(7)
  expect(await duplicate).toBe(7)
})

test("old generation completion cannot clear a newer generation request", async () => {
  const flights = new SingleFlight<number>()
  let resolveOld!: (value: number) => void
  let resolveNew!: (value: number) => void
  const old = flights.run("4:0", () => new Promise((done) => { resolveOld = done }))
  const fresh = flights.run("5:0", () => new Promise((done) => { resolveNew = done }))
  resolveOld(4)
  await old
  expect(flights.run("5:0", () => Promise.resolve(99))).toBe(fresh)
  resolveNew(5)
  expect(await fresh).toBe(5)
})

test("different history cursors own distinct flights while duplicates collapse", async () => {
  const flights = new SingleFlight<number>()
  let starts = 0
  const first = flights.run("history:0:100", async () => ++starts)
  const duplicate = flights.run("history:0:100", async () => ++starts)
  const continuation = flights.run("history:100:100", async () => ++starts)
  expect(first).toBe(duplicate)
  expect(continuation).not.toBe(first)
  expect(await Promise.all([first, duplicate, continuation])).toEqual([1, 1, 2])
})
