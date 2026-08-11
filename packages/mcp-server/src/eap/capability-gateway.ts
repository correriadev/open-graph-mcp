/**
 * EAP Capability Gateway Service and Approval Repository
 * Domain: cognitive_line
 */

import {
  authorizeCapability,
  classifyCapability,
  type CapabilityClassification,
  type CapabilityExecutionRequest,
  type CapabilityRefusal,
  type OperatorApproval,
} from '@open-graph-mcp/graph-core/eap/capabilities'

export interface CapabilityExecutedEvent {
  executionId: string
  classification: CapabilityClassification
  contractRef: string
  outcome: unknown
  idempotencyKey: string
  timestamp: number
}

export type CapabilityGatewayResult =
  | { status: 'COMPLETED'; event: CapabilityExecutedEvent; isCached?: boolean }
  | { status: 'REFUSED'; refusal: CapabilityRefusal }
  | { status: 'FAILED'; refusal: CapabilityRefusal; error: Error }

export class ApprovalRepository {
  private approvals = new Map<string, OperatorApproval>()

  registerApproval(approval: OperatorApproval): void {
    this.approvals.set(approval.id, { ...approval, consumed: approval.consumed ?? false })
  }

  getApproval(id: string): OperatorApproval | undefined {
    return this.approvals.get(id)
  }

  consumeAuthorization(id: string): { success: true } | { success: false; refusal: CapabilityRefusal } {
    const approval = this.approvals.get(id)
    if (!approval) {
      return {
        success: false,
        refusal: {
          code: 'APPROVAL_MISSING',
          reason: `Approval '${id}' not found in repository`,
          obligation: 'Obtain valid operator approval',
        },
      }
    }

    if (approval.consumed) {
      return {
        success: false,
        refusal: {
          code: 'APPROVAL_ALREADY_USED',
          reason: `Approval '${id}' has already been consumed (single-use)`,
          obligation: 'Obtain a new single-use operator approval',
        },
      }
    }

    approval.consumed = true
    return { success: true }
  }
}

export class CapabilityGateway {
  private approvals: ApprovalRepository
  private executedOutcomes = new Map<string, CapabilityExecutedEvent>()
  private auditLog: CapabilityExecutedEvent[] = []
  private classificationMap = new Map<string, CapabilityClassification>()

  constructor(approvalRepo?: ApprovalRepository) {
    this.approvals = approvalRepo ?? new ApprovalRepository()
  }

  getApprovalRepo(): ApprovalRepository {
    return this.approvals
  }

  registerClassification(capabilityId: string, classification: CapabilityClassification): void {
    this.classificationMap.set(capabilityId, classification)
  }

  classify(capabilityId: string): CapabilityClassification {
    return classifyCapability(capabilityId, this.classificationMap)
  }

  async execute(
    request: CapabilityExecutionRequest,
    options?: { currentTime?: number }
  ): Promise<CapabilityGatewayResult> {
    if (this.executedOutcomes.has(request.idempotencyKey)) {
      return {
        status: 'COMPLETED',
        event: this.executedOutcomes.get(request.idempotencyKey)!,
        isCached: true,
      }
    }

    const authResult = authorizeCapability(request, {
      classificationMap: this.classificationMap,
      currentTime: options?.currentTime,
    })

    if (!authResult.success) {
      return { status: 'REFUSED', refusal: authResult.refusal }
    }

    if (authResult.classification === 'irreversible') {
      if (!request.approval) {
        return {
          status: 'REFUSED',
          refusal: {
            code: 'APPROVAL_MISSING',
            reason: 'Irreversible capability execution requires an operator approval',
            obligation: 'Obtain operator approval for irreversible capability',
          },
        }
      }

      const consumeResult = this.approvals.consumeAuthorization(request.approval.id)
      if (!consumeResult.success) {
        return { status: 'REFUSED', refusal: consumeResult.refusal }
      }
    }

    let providerOutcome: unknown = null
    if (request.providerAction) {
      try {
        const timeoutMs = options?.timeoutMs ?? 5000
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Capability execution timed out after ${timeoutMs}ms`)), timeoutMs)
        )
        providerOutcome = await Promise.race([Promise.resolve(request.providerAction()), timeoutPromise])
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        return {
          status: 'FAILED',
          refusal: {
            code: 'PROVIDER_UNAVAILABLE',
            reason: `Capability provider execution failed: ${error.message}`,
            obligation: 'Audit failure and retry provider when available',
          },
          error,
        }
      }
    }

    const event: CapabilityExecutedEvent = {
      executionId: crypto.randomUUID(),
      classification: authResult.classification,
      contractRef: request.contract.contractRef,
      outcome: providerOutcome,
      idempotencyKey: request.idempotencyKey,
      timestamp: options?.currentTime ?? Date.now(),
    }

    this.executedOutcomes.set(request.idempotencyKey, event)
    this.auditLog.push(event)

    return { status: 'COMPLETED', event }
  }

  getAuditLog(): readonly CapabilityExecutedEvent[] {
    return [...this.auditLog]
  }
}
