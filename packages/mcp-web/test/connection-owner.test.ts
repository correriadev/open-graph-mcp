import { expect, test } from "bun:test"
import { ConnectionOwner } from "../src/connection-owner"

test("late close from A cannot change replacement B state or timers", () => {
  const owner = new ConnectionOwner()
  let online = false
  let timersArmed = false
  let limiter: { cancel: () => void } | null = null
  const a = owner.replace()
  owner.ifCurrent(a, () => { online = true; timersArmed = true; limiter = { cancel() {} } })
  const b = owner.replace()
  owner.ifCurrent(b, () => { online = true; timersArmed = true; limiter = { cancel() {} } })
  expect(owner.ifCurrent(a, () => { online = false; timersArmed = false; limiter = null })).toBe(false)
  expect({ online, timersArmed, hasLimiter: !!limiter }).toEqual({ online: true, timersArmed: true, hasLimiter: true })
  expect(owner.ifCurrent(b, () => { online = false; timersArmed = false; limiter = null })).toBe(true)
  expect({ online, timersArmed, limiter }).toEqual({ online: false, timersArmed: false, limiter: null })
})

test("out-of-order connection resolution installs only the replacement owner", async () => {
  const owner = new ConnectionOwner()
  const installed: string[] = []
  const closed: string[] = []
  let resolveA!: (handle: string) => void
  let resolveB!: (handle: string) => void
  const connectionA = new Promise<string>((resolve) => { resolveA = resolve })
  const connectionB = new Promise<string>((resolve) => { resolveB = resolve })

  const acquire = async (connection: Promise<string>) => {
    const generation = owner.replace()
    const handle = await connection
    if (!owner.isCurrent(generation)) { closed.push(handle); return }
    installed.push(handle)
  }

  const a = acquire(connectionA)
  const b = acquire(connectionB)
  resolveB("B")
  await b
  resolveA("A")
  await a

  expect(installed).toEqual(["B"])
  expect(closed).toEqual(["A"])
})
