import { SingleFlight } from "./single-flight"
import type { ClaimRecord } from "./store"

type Snapshot = { generation: number; claimsByCell: Record<string, ClaimRecord[]> }
type Dependencies = {
  snapshot: () => Snapshot
  read: (encodedId: string) => Promise<{ claim: unknown }>
  merge: (claim: ClaimRecord) => void
  navigate: (ownerCell: string, id: string) => void
  notifyMissing: (id: string) => void
  notifyFailure: (id: string) => void
  now?: () => number
  lookupTimeoutMs?: number
  setTimer?: (callback: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
}

export type RefLookupMetrics = { active: number; completed: number; timeouts: number; maxLatencyMs: number }

function normalizedLevel(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : null
  if (typeof value !== "string" || !/^P?\d+$/.test(value)) return null
  const level = Number(value.replace(/^P/, ""))
  return Number.isSafeInteger(level) ? level : null
}

function ownerCell(claim: ClaimRecord): string | null {
  const level = normalizedLevel(claim.level)
  return typeof claim.domain === "string" && claim.domain.trim() === claim.domain && claim.domain.length > 0
    && !/[:/\\\u0000-\u001f\u007f]/.test(claim.domain) && level !== null
    ? `${claim.domain}:P${level}`
    : null
}

function validClaim(value: unknown): value is ClaimRecord {
  if (!value || typeof value !== "object") return false
  const claim = value as Partial<ClaimRecord>
  return typeof claim.id === "string" && claim.id.length > 0 && !!ownerCell(claim as ClaimRecord)
    && typeof claim.seq === "number" && Number.isSafeInteger(claim.seq) && claim.seq >= 0
}

export function createRefNavigator(dependencies: Dependencies, ttlMs = 5_000, maxEntries = 128, maxInFlight = 16) {
  const requests = new SingleFlight<void>()
  const negative = new Map<string, { generation: number; expiresAt: number }>()
  const inFlightByGeneration = new Map<number, Set<string>>()
  const now = dependencies.now ?? Date.now
  const setTimer = dependencies.setTimer ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs))
  const clearTimer = dependencies.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const timeoutMs = dependencies.lookupTimeoutMs ?? 10_000
  const failureNoticeAt = new Map<number, number>()
  const lookupMetrics: RefLookupMetrics = { active: 0, completed: 0, timeouts: 0, maxLatencyMs: 0 }

  const rememberNegative = (refId: string, generation: number) => {
    if (negative.size >= maxEntries) {
      const oldest = negative.keys().next().value
      if (oldest !== undefined) negative.delete(oldest)
    }
    negative.set(refId, { generation, expiresAt: now() + ttlMs })
  }
  const notifyFailureOnce = (refId: string, generation: number) => {
    if (now() - (failureNoticeAt.get(generation) ?? -Infinity) < ttlMs) return
    failureNoticeAt.set(generation, now())
    dependencies.notifyFailure(refId)
  }

  const navigate = async (refId: string): Promise<void> => {
    const initial = dependencies.snapshot()
    const local = Object.entries(initial.claimsByCell).find(([, claims]) => claims.some((claim) => claim.id === refId))
    if (local) { dependencies.navigate(local[0], refId); return }
    const cached = negative.get(refId)
    if (cached?.generation === initial.generation && cached.expiresAt > now()) return

    const key = JSON.stringify([initial.generation, refId])
    let generationInFlight = inFlightByGeneration.get(initial.generation)
    if (!generationInFlight) inFlightByGeneration.set(initial.generation, generationInFlight = new Set())
    if (!generationInFlight.has(key) && generationInFlight.size >= maxInFlight) {
      rememberNegative(refId, initial.generation)
      notifyFailureOnce(refId, initial.generation)
      return
    }
    if (!generationInFlight.has(key)) generationInFlight.add(key)
    return requests.run(key, async () => {
      const startedAt = now()
      let timer: unknown
      let timedOut = false
      lookupMetrics.active++
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimer(() => {
            timedOut = true
            lookupMetrics.timeouts++
            reject(new Error("point lookup timeout"))
          }, timeoutMs)
        })
        const envelope = await Promise.race([dependencies.read(encodeURIComponent(refId)), timeout])
        if (dependencies.snapshot().generation !== initial.generation) return
        if (envelope.claim === null) {
          rememberNegative(refId, initial.generation)
          dependencies.notifyMissing(refId)
          return
        }
        if (!validClaim(envelope.claim) || envelope.claim.id !== refId) {
          rememberNegative(refId, initial.generation)
          notifyFailureOnce(refId, initial.generation)
          return
        }
        const cell = ownerCell(envelope.claim)!
        dependencies.merge(envelope.claim)
        dependencies.navigate(cell, refId)
      } catch {
        if (dependencies.snapshot().generation === initial.generation) {
          rememberNegative(refId, initial.generation)
          notifyFailureOnce(refId, initial.generation)
        }
      } finally {
        if (timer !== undefined && !timedOut) clearTimer(timer)
        generationInFlight!.delete(key)
        if (generationInFlight!.size === 0 && inFlightByGeneration.get(initial.generation) === generationInFlight) {
          inFlightByGeneration.delete(initial.generation)
        }
        lookupMetrics.active--
        lookupMetrics.completed++
        lookupMetrics.maxLatencyMs = Math.max(lookupMetrics.maxLatencyMs, now() - startedAt)
      }
    })
  }

  return {
    navigate,
    clear: () => { negative.clear(); failureNoticeAt.clear(); inFlightByGeneration.clear() },
    metrics: (): RefLookupMetrics => ({ ...lookupMetrics }),
  }
}
