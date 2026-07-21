export type CanonicalClaimLevel = 0 | 1 | 2 | 3 | 4 | 5
export type LevelNormalizationResult =
  | { ok: true; numeric: CanonicalClaimLevel; stored: `P${CanonicalClaimLevel}` }
  | { ok: false; reason: "claim.add: invalid level" }

const acceptedInteger = (value: unknown): value is CanonicalClaimLevel =>
  typeof value === "number" && !Object.is(value, -0) && Number.isInteger(value) && value >= 0 && value <= 5

export function normalizeClaimLevel(value: unknown): LevelNormalizationResult {
  let numeric: CanonicalClaimLevel | null = null
  if (acceptedInteger(value)) numeric = value
  else if (typeof value === "string" && /^P[0-5]$/.test(value)) numeric = Number(value.slice(1)) as CanonicalClaimLevel
  return numeric === null
    ? { ok: false, reason: "claim.add: invalid level" }
    : { ok: true, numeric, stored: `P${numeric}` }
}

export function normalizeRecoveredClaimLevel(value: unknown): LevelNormalizationResult {
  if (typeof value === "string" && /^[0-5]$/.test(value)) return normalizeClaimLevel(Number(value))
  return normalizeClaimLevel(value)
}
