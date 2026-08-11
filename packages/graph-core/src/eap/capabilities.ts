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
  providerAction?: () => Promise<unknown> | unknown
}

export type CapabilityRefusalCode =
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

  const expiresAtMs = typeof approval.expiresAt === 'string' ? Date.parse(approval.expiresAt) : approval.expiresAt
  if (now > expiresAtMs) {
    return {
      valid: false,
      refusal: {
        code: 'APPROVAL_EXPIRED',
        reason: `Approval expired at ${new Date(expiresAtMs).toISOString()}`,
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
