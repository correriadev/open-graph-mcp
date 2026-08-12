/**
 * EAP Capability Classification and Authorization Domain Model
 * Domain: cognitive_line
 */

export type CapabilityClassification = 'reversible' | 'irreversible'

export interface OperatorApproval {
  id: string
  approver: string
  scope: string
  expiresAt: string | number
  basedOnSeq: number
  consumed?: boolean
}

export interface ChangeContract {
  contractRef: string
  targetScope: string
  payload?: Record<string, unknown>
}

export interface CapabilityExecutionRequest {
  capabilityId: string
  classification?: CapabilityClassification
  idempotencyKey: string
  contract: ChangeContract
  currentSeq: number
  approval?: OperatorApproval
  /**
   * The external effect. Receives the gateway's `AbortSignal`: a provider that outlives the
   * gateway's execution timeout must be cancellable, otherwise a hung call keeps a socket or worker
   * alive for as long as the remote side wants it to.
   */
  providerAction?: (signal?: AbortSignal) => Promise<unknown> | unknown
}

export type CapabilityRefusalCode =
  | 'IDEMPOTENCY_CONFLICT'
  | 'SCOPE_EXCEEDED'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_STALE_SEQ'
  | 'APPROVAL_MISSING'
  | 'APPROVAL_ALREADY_USED'
  | 'TOOL_UNCLASSIFIED'
  | 'TOOL_OUT_OF_CONTRACT'
  | 'PROVIDER_UNAVAILABLE'

export interface CapabilityRefusal {
  code: CapabilityRefusalCode
  reason: string
  obligation: string
}

export type AuthorizationResult =
  | { success: true; classification: CapabilityClassification }
  | { success: false; refusal: CapabilityRefusal }

export function classifyCapability(
  toolName?: string,
  classificationMap?: Map<string, CapabilityClassification>
): CapabilityClassification {
  if (toolName && classificationMap && classificationMap.has(toolName)) {
    return classificationMap.get(toolName)!
  }
  return 'irreversible'
}

/**
 * Resolves an approval deadline to epoch milliseconds, or `null` when it does not denote an instant.
 * Shared by the authorization check (which fails closed on `null`) and by registration (which
 * refuses to store an approval whose expiry can never be evaluated).
 */
export function resolveExpiry(expiresAt: string | number | undefined | null): number | null {
  if (typeof expiresAt === 'number') return Number.isFinite(expiresAt) ? expiresAt : null
  if (typeof expiresAt !== 'string' || expiresAt.trim() === '') return null
  const numeric = Number(expiresAt)
  if (Number.isFinite(numeric) && String(numeric) === expiresAt.trim()) return numeric
  const parsed = Date.parse(expiresAt)
  return Number.isNaN(parsed) ? null : parsed
}

export function validateOperatorApproval(
  approval: OperatorApproval | undefined,
  targetScope: string,
  currentSeq: number,
  currentTime?: number
): { valid: true } | { valid: false; refusal: CapabilityRefusal } {
  const now = currentTime ?? Date.now()

  if (!approval) {
    return {
      valid: false,
      refusal: {
        code: 'APPROVAL_MISSING',
        reason: 'Irreversible capability requires an operator approval',
        obligation: 'Obtain operator approval for irreversible capability',
      },
    }
  }

  if (approval.consumed) {
    return {
      valid: false,
      refusal: {
        code: 'APPROVAL_ALREADY_USED',
        reason: 'Operator approval has already been consumed (single-use)',
        obligation: 'Obtain a new single-use operator approval',
      },
    }
  }

  if (approval.scope !== targetScope) {
    return {
      valid: false,
      refusal: {
        code: 'SCOPE_EXCEEDED',
        reason: `Approval scope '${approval.scope}' does not match target scope '${targetScope}'`,
        obligation: 'Re-escalate request with correct scope',
      },
    }
  }

  // FAIL CLOSED on an expiry that does not resolve to a real instant. `Date.parse` returns NaN for
  // an unparseable timestamp, and EVERY comparison against NaN is false — including `now > NaN`, so
  // the old check silently granted such an approval eternal life. An expiry that cannot be evaluated
  // is not an expiry, and an authorization whose deadline is unknown must not authorize anything.
  const expiresAtMs = resolveExpiry(approval.expiresAt)
  if (expiresAtMs === null || now > expiresAtMs) {
    return {
      valid: false,
      refusal: {
        code: 'APPROVAL_EXPIRED',
        reason:
          expiresAtMs === null
            ? `Approval expiry '${String(approval.expiresAt)}' is not a valid instant; treated as expired`
            : `Approval expired at ${new Date(expiresAtMs).toISOString()}`,
        obligation: 'Obtain a new non-expired operator approval',
      },
    }
  }

  if (approval.basedOnSeq !== currentSeq) {
    return {
      valid: false,
      refusal: {
        code: 'APPROVAL_STALE_SEQ',
        reason: `Approval based on sequence ${approval.basedOnSeq} but current sequence is ${currentSeq}`,
        obligation: 'Rebase or obtain operator approval for current sequence',
      },
    }
  }

  return { valid: true }
}

export function authorizeCapability(
  request: CapabilityExecutionRequest,
  options?: { classificationMap?: Map<string, CapabilityClassification>; currentTime?: number }
): AuthorizationResult {
  if (!request.contract || !request.contract.targetScope || !request.contract.contractRef) {
    return {
      success: false,
      refusal: {
        code: 'TOOL_OUT_OF_CONTRACT',
        reason: 'Change contract is missing or malformed',
        obligation: 'Escalate contract mismatch to operator',
      },
    }
  }

  const classification = classifyCapability(request.capabilityId, options?.classificationMap)

  if (classification === 'irreversible') {
    const val = validateOperatorApproval(
      request.approval,
      request.contract.targetScope,
      request.currentSeq,
      options?.currentTime
    )
    if (!val.valid) {
      return { success: false, refusal: val.refusal }
    }
  }

  return { success: true, classification }
}
