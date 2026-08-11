/**
 * packages/graph-core/src/eap/types.ts
 * Epistemic Admission Protocol (EAP) Contract Types and Value Objects.
 * Implements Task 01 of Feature F001 (cognitive_line domain).
 */

export const SUPPORTED_LEVELS = [1, 2, 3, 4, 5] as const
export type SupportedLevel = typeof SUPPORTED_LEVELS[number]

const LEVEL_NAME_MAP: Record<string, SupportedLevel> = {
  system: 1,
  container: 2,
  component: 3,
  file: 4,
  code: 5,
}

export type CellKeyCanonical = `${string}:${SupportedLevel}`

export class CellKey {
  public readonly domain: string
  public readonly level: SupportedLevel
  public readonly canonical: CellKeyCanonical

  private constructor(domain: string, level: SupportedLevel) {
    this.domain = domain
    this.level = level
    this.canonical = `${domain}:${level}`
  }

  public static create(domain: string, levelInput: number | string): CellKey {
    const trimmedDomain = domain?.trim()
    if (!trimmedDomain || trimmedDomain.length === 0) {
      throw new Error("CellKey domain must be a non-empty string")
    }

    let parsedLevel: SupportedLevel | null = null

    if (typeof levelInput === "number") {
      if (SUPPORTED_LEVELS.includes(levelInput as SupportedLevel)) {
        parsedLevel = levelInput as SupportedLevel
      }
    } else if (typeof levelInput === "string") {
      const trimmedLevel = levelInput.trim().toLowerCase()
      if (LEVEL_NAME_MAP[trimmedLevel]) {
        parsedLevel = LEVEL_NAME_MAP[trimmedLevel]
      } else {
        const num = Number(trimmedLevel)
        if (Number.isInteger(num) && SUPPORTED_LEVELS.includes(num as SupportedLevel)) {
          parsedLevel = num as SupportedLevel
        }
      }
    }

    if (parsedLevel === null) {
      throw new Error(`Unsupported CellKey level: ${levelInput}. Supported levels are 1..5 or legacy names (system, container, component, file, code).`)
    }

    return new CellKey(trimmedDomain, parsedLevel)
  }

  public static parse(input: string): CellKey {
    if (!input || typeof input !== "string") {
      throw new Error("CellKey parse input must be a non-empty string")
    }
    const sep = input.includes(":") ? ":" : input.includes("/") ? "/" : null
    if (!sep) {
      throw new Error(`Invalid CellKey format: ${input}`)
    }
    const idx = input.lastIndexOf(sep)
    const domain = input.slice(0, idx)
    const levelStr = input.slice(idx + 1)
    return CellKey.create(domain, levelStr)
  }

  public equals(other: CellKey | string): boolean {
    if (typeof other === "string") {
      try {
        return this.canonical === CellKey.parse(other).canonical
      } catch {
        return false
      }
    }
    return this.canonical === other.canonical
  }

  public toString(): string {
    return this.canonical
  }
}

export function canonicalCellKey(domain: string, level: number | string): string {
  return CellKey.create(domain, level).canonical
}

export const TRUTH_OWNERSHIP_VALUES = ["source", "graph", "suspended"] as const
export type TruthOwnership = typeof TRUTH_OWNERSHIP_VALUES[number]

export function isValidTruthOwnership(val: unknown): val is TruthOwnership {
  return typeof val === "string" && (TRUTH_OWNERSHIP_VALUES as readonly string[]).includes(val)
}

export function updateLegacyStatusWithoutChangingOwnership<TStatus>(
  currentOwnership: TruthOwnership,
  _newStatus: TStatus
): TruthOwnership {
  return currentOwnership
}

export const LEGACY_CLAIM_STATUS_VALUES = [
  "pending-verification",
  "verified",
  "contradicts-floor",
  "test-spec",
] as const
export type LegacyClaimStatus = typeof LEGACY_CLAIM_STATUS_VALUES[number]

export function isValidLegacyClaimStatus(val: unknown): val is LegacyClaimStatus {
  return typeof val === "string" && (LEGACY_CLAIM_STATUS_VALUES as readonly string[]).includes(val)
}

export const MAP_LEGACY_CLAIM_STATUS_DEFERRED = {
  isDeferred: true,
  reason: "Mapping LegacyClaimStatus values into proposed Epistemic Lifecycle is explicitly deferred and forbidden from inferred mapping."
} as const

export function mapLegacyClaimStatusToEpistemicLifecycle(_status: LegacyClaimStatus): never {
  throw new Error(MAP_LEGACY_CLAIM_STATUS_DEFERRED.reason)
}

export const EPISTEMIC_LIFECYCLE_STATES = [
  "proposed",
  "deliberated",
  "admitted",
  "concretized",
  "verified",
] as const
export type EpistemicLifecycleState = typeof EPISTEMIC_LIFECYCLE_STATES[number]

export function isValidEpistemicLifecycleState(val: unknown): val is EpistemicLifecycleState {
  return typeof val === "string" && (EPISTEMIC_LIFECYCLE_STATES as readonly string[]).includes(val)
}

export const BOUNDARY_COMMANDS = ["PROMOTE", "CONTEST", "INITIATE"] as const
export type BoundaryCommand = typeof BOUNDARY_COMMANDS[number]

export function isBoundaryCommand(val: unknown): val is BoundaryCommand {
  return typeof val === "string" && (BOUNDARY_COMMANDS as readonly string[]).includes(val)
}

export type HorizonId = string & { readonly __brand: unique symbol }

export function createHorizonId(id: string): HorizonId {
  if (!id || typeof id !== "string" || id.trim().length === 0) {
    throw new Error("HorizonId cannot be empty")
  }
  return id.trim() as HorizonId
}

export type Sequence = number & { readonly __brand: unique symbol }

export function createSequence(seq: number): Sequence {
  if (!Number.isInteger(seq) || seq < 0) {
    throw new Error("Sequence must be a non-negative integer")
  }
  return seq as Sequence
}

export function validateSequenceAdvance(current: Sequence, next: number): Sequence {
  const nextSeq = createSequence(next)
  if (nextSeq <= current) {
    throw new Error(`Sequence must strictly increase within its scope. Current: ${current}, Proposed: ${nextSeq}`)
  }
  return nextSeq
}

export interface EvidenceRef {
  id: string
  type: string
  uri?: string
}

export interface ClaimRef {
  id: string
  cellKey: string
}

export interface NegotiationSeed {
  provenance: readonly EvidenceRef[]
  references: readonly ClaimRef[]
}

export function validateNegotiationSeed(seed: unknown): NegotiationSeed {
  if (!seed || typeof seed !== "object") {
    throw new Error("NegotiationSeed must be a valid object")
  }
  const obj = seed as Record<string, unknown>

  if ("admitted" in obj || "admission" in obj || "relativeAuthority" in obj || "authority" in obj) {
    throw new Error("NegotiationSeed cannot carry admission or Relative Authority")
  }

  if (!Array.isArray(obj.provenance) || !Array.isArray(obj.references)) {
    throw new Error("NegotiationSeed must contain provenance and references arrays")
  }

  return seed as NegotiationSeed
}

export type RollbackSemantics = "atomic" | "all_or_nothing"

export interface Candidate {
  id: string
  content: string
  evidenceRefs: readonly EvidenceRef[]
  isRequired?: boolean
}

export interface PersistentDelta {
  candidates: readonly Candidate[]
  rollback: RollbackSemantics
}

export function validatePersistentDelta(delta: unknown): PersistentDelta {
  if (!delta || typeof delta !== "object") {
    throw new Error("PersistentDelta must be a valid object")
  }
  const obj = delta as Record<string, unknown>
  if (!Array.isArray(obj.candidates) || !obj.rollback) {
    throw new Error("PersistentDelta must contain candidates array and rollback semantics")
  }
  return delta as PersistentDelta
}

export interface OperatorApproval {
  approver: string
  scope: string
  expiresAt: string
  basedOnSeq: Sequence
  provenance: readonly EvidenceRef[]
}

export interface OperatorApprovalValidationParams {
  requiredScope: string
  currentSeq: Sequence
  now?: Date
}

export function validateOperatorApproval(
  approval: OperatorApproval,
  params: OperatorApprovalValidationParams
): { valid: boolean; reason?: string } {
  if (!approval || !approval.approver || !approval.scope) {
    return { valid: false, reason: "Invalid approval structure" }
  }

  if (approval.scope !== params.requiredScope) {
    return { valid: false, reason: `Approval scope mismatch. Required: ${params.requiredScope}, Provided: ${approval.scope}` }
  }

  if (approval.basedOnSeq !== params.currentSeq) {
    return { valid: false, reason: `Approval Sequence mismatch. Current: ${params.currentSeq}, Provided: ${approval.basedOnSeq}` }
  }

  const now = params.now ?? new Date()
  const expiry = new Date(approval.expiresAt)
  if (isNaN(expiry.getTime()) || expiry <= now) {
    return { valid: false, reason: "Operator Approval has expired" }
  }

  return { valid: true }
}

export const CAPABILITY_CLASSIFICATIONS = ["reversible", "irreversible"] as const
export type CapabilityClassification = typeof CAPABILITY_CLASSIFICATIONS[number]

export function isValidCapabilityClassification(val: unknown): val is CapabilityClassification {
  return typeof val === "string" && (CAPABILITY_CLASSIFICATIONS as readonly string[]).includes(val)
}

export function requiresSingleUseAuthorization(classification: CapabilityClassification): boolean {
  return classification === "irreversible"
}
