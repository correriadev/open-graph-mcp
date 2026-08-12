/**
 * EAP Capability Gateway (Task 10).
 *
 * Retry#5 / REWORK-LOG defects 1, 2 and 4. Four things changed and each closes a named finding:
 *
 *  1. DURABILITY — `executedOutcomes`, `auditLog` and the approvals `Map` are gone. Idempotency and
 *     audit live in `SqliteCapabilityAuditRepository`; approvals live in `SqliteApprovalRepository`.
 *     A restart no longer re-enables a replay of an irreversible external effect.
 *  2. BOUNDED GROWTH — the audit table carries an explicit retention policy (see the repository).
 *  3. AUTHORIZATION — the gateway validates the approval as the OPERATOR STORED IT, never the copy
 *     the client attached to the request. A client-supplied approval is now only an *identifier
 *     claim*; its scope, expiry and `basedOnSeq` are read from durable storage. An id that no
 *     operator registered is `APPROVAL_MISSING`, and the provider is never called.
 *  4. PROJECTION — `getAuditLog` requires a principal and returns a redacted projection unless that
 *     principal holds `audit:read`. It no longer hands contract references and provider outcomes to
 *     any caller that asks.
 *
 * Plus: `execute` has an explicit timeout and passes an `AbortSignal` to the provider, so a
 * timed-out call is actively cancelled instead of being abandoned still running.
 */

import {
  authorizeCapability,
  classifyCapability,
  type CapabilityClassification,
  type CapabilityExecutionRequest,
  type CapabilityRefusal,
  type OperatorApproval,
} from '@open-graph-mcp/graph-core/eap/capabilities'
import type {
  CapabilityExecutedEvent,
  RedactedCapabilityAuditEntry,
  SqliteApprovalRepository,
  SqliteCapabilityAuditRepository,
} from './eap-repositories'

export type { CapabilityExecutedEvent } from './eap-repositories'

export const DEFAULT_CAPABILITY_TIMEOUT_MS = 5_000

/** Scope a principal must hold to read unredacted capability audit entries. */
export const AUDIT_READ_SCOPE = 'audit:read'

export interface AuditPrincipal {
  principal: string
  scopes: readonly string[]
}

/**
 * Tagged so a caller cannot mistake a redacted list for the full one. An untagged union of two
 * array types is exactly the shape that lets a projection filter be forgotten downstream.
 */
export type CapabilityAuditProjection =
  | { projection: 'full'; entries: readonly CapabilityExecutedEvent[] }
  | { projection: 'redacted'; entries: readonly RedactedCapabilityAuditEntry[] }

export type CapabilityGatewayResult =
  | { status: 'COMPLETED'; event: CapabilityExecutedEvent; isCached?: boolean }
  | { status: 'REFUSED'; refusal: CapabilityRefusal }
  | { status: 'FAILED'; refusal: CapabilityRefusal; error: Error }

export interface CapabilityExecuteOptions {
  currentTime?: number
  timeoutMs?: number
}

export class CapabilityGateway {
  private classificationMap = new Map<string, CapabilityClassification>()

  constructor(
    private readonly approvals: SqliteApprovalRepository,
    private readonly audit: SqliteCapabilityAuditRepository,
  ) {
    if (!approvals || !audit) {
      throw new Error('CapabilityGateway requires durable approval and audit repositories')
    }
  }

  getApprovalRepo(): SqliteApprovalRepository {
    return this.approvals
  }

  /**
   * Static effect classification for a capability id. This is deterministic host policy, not
   * epistemic state: it is configuration reloaded at boot, so it is deliberately in-process and
   * bounded by the number of registered capabilities.
   */
  registerClassification(capabilityId: string, classification: CapabilityClassification): void {
    this.classificationMap.set(capabilityId, classification)
  }

  classify(capabilityId: string): CapabilityClassification {
    return classifyCapability(capabilityId, this.classificationMap)
  }

  async execute(
    request: CapabilityExecutionRequest,
    options?: CapabilityExecuteOptions,
  ): Promise<CapabilityGatewayResult> {
    const cached = this.audit.findByIdempotencyKey(request.idempotencyKey)
    if (cached) {
      return { status: 'COMPLETED', event: cached, isCached: true }
    }

    const classification = this.classify(request.capabilityId)

    // The stored grant is the only authority. A request may name an approval id; it may not define
    // that approval's scope, expiry or sequence binding.
    let storedApproval: OperatorApproval | undefined
    if (classification === 'irreversible') {
      const claimedId = request.approval?.id
      if (!claimedId) {
        return {
          status: 'REFUSED',
          refusal: {
            code: 'APPROVAL_MISSING',
            reason: 'Irreversible capability execution requires an operator approval',
            obligation: 'Obtain operator approval for irreversible capability',
          },
        }
      }
      storedApproval = this.approvals.getApproval(claimedId)
      if (!storedApproval) {
        return {
          status: 'REFUSED',
          refusal: {
            code: 'APPROVAL_MISSING',
            reason: `Approval '${claimedId}' was never registered by an operator`,
            obligation: 'Obtain valid operator approval',
          },
        }
      }
    }

    const authResult = authorizeCapability(
      { ...request, approval: storedApproval },
      { classificationMap: this.classificationMap, currentTime: options?.currentTime },
    )

    if (!authResult.success) {
      return { status: 'REFUSED', refusal: authResult.refusal }
    }

    if (authResult.classification === 'irreversible') {
      const consumeResult = this.approvals.consumeAuthorization(storedApproval!.id)
      if (!consumeResult.success) {
        return { status: 'REFUSED', refusal: consumeResult.refusal }
      }
    }

    let providerOutcome: unknown = null
    if (request.providerAction) {
      const timeoutMs = options?.timeoutMs ?? DEFAULT_CAPABILITY_TIMEOUT_MS
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            // Cancel first, then reject: an abandoned provider promise is a socket/worker leak, and
            // a provider that honours the signal stops doing external work immediately.
            controller.abort(new Error(`Capability execution timed out after ${timeoutMs}ms`))
            reject(new Error(`Capability execution timed out after ${timeoutMs}ms`))
          }, timeoutMs)
        })
        providerOutcome = await Promise.race([
          Promise.resolve(request.providerAction(controller.signal)),
          timeoutPromise,
        ])
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        if (!controller.signal.aborted) controller.abort(error)
        return {
          status: 'FAILED',
          refusal: {
            code: 'PROVIDER_UNAVAILABLE',
            reason: `Capability provider execution failed: ${error.message}`,
            obligation: 'Audit failure and retry provider when available',
          },
          error,
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer)
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

    this.audit.record(event, { capabilityId: request.capabilityId, approvalId: storedApproval?.id })

    return { status: 'COMPLETED', event }
  }

  /**
   * Audit projection. A caller without `audit:read` gets execution identity and classification
   * only — never contract references or provider outcomes, which can carry approval provenance and
   * evidence detail. There is no unauthenticated overload on purpose.
   */
  getAuditLog(requester: AuditPrincipal): CapabilityAuditProjection {
    if (!requester || typeof requester.principal !== 'string' || requester.principal.trim() === '') {
      throw new Error('getAuditLog requires an authenticated principal')
    }
    if (!Array.isArray(requester.scopes) || !requester.scopes.includes(AUDIT_READ_SCOPE)) {
      return { projection: 'redacted', entries: this.audit.listRedacted() }
    }
    return { projection: 'full', entries: this.audit.list() }
  }
}
