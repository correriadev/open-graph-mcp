export type TypingClock = {
  now: () => number
  set: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clear: (timer: ReturnType<typeof setTimeout>) => void
}

const systemClock: TypingClock = { now: Date.now, set: setTimeout, clear: clearTimeout }

export function createTypingRateLimiter(send: () => void, clock: TypingClock = systemClock, windowMs = 400) {
  let lastSent = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false
  let generation = 0

  const emit = () => { lastSent = clock.now(); pending = false; send() }
  const signal = () => {
    const elapsed = clock.now() - lastSent
    if (elapsed >= windowMs && timer === null) { emit(); return }
    pending = true
    if (timer !== null) return
    const owner = generation
    timer = clock.set(() => {
      timer = null
      if (owner === generation && pending) emit()
    }, Math.max(0, windowMs - elapsed))
  }
  const cancel = () => {
    generation++
    pending = false
    if (timer !== null) clock.clear(timer)
    timer = null
    lastSent = -Infinity
  }
  return { signal, cancel }
}
