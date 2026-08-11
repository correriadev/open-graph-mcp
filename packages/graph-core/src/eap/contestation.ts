/**
 * Epistemic Admission Protocol (EAP) — Contestation Domain Model
 * Domain: cognitive_line
 */

export type ContestationSeverity = 'informative' | 'blocking' | 'invalidating'

export interface Contestation {
  id: string
  sourceHorizonId: string
  targetClaimIds: string[]
  evidenceRefs: string[]
  severity: ContestationSeverity
  reason?: string
  submittedAt: string
  seq?: number
  admitted: boolean
}

export interface KnowledgeContestedEvent {
  type: 'KnowledgeContested'
  contestationId: string
  sourceHorizonId: string
  targetClaimIds: string[]
  severity: ContestationSeverity
  evidenceRefs: string[]
  timestamp: string
  seq: number
}

export type ContestationRefusalCode =
  | 'EVIDENCE_REQUIRED'
  | 'DIRECT_EDIT_FORBIDDEN'
  | 'RECALL_UNPROVEN'
  | 'INVALID_TARGET_CLAIM'
  | 'CONTESTATION_REFUSED'

export interface RefusalDetail {
  code: ContestationRefusalCode
  clientObligation: string
  reason: string
}

export type ContestationAdmissionResult =
  | {
      status: 'ADMITTED'
      contestation: Contestation
      event: KnowledgeContestedEvent
    }
  | {
      status: 'REFUSED'
      refusal: RefusalDetail
    }

export interface RecallInitiationResult {
  status: 'INITIATED' | 'REFUSED'
  recallCaseId?: string
  targetClaimIds?: string[]
  contestationId?: string
  refusal?: RefusalDetail
}

export function validateEvidence(evidenceRefs: string[] | undefined | null): boolean {
  if (!evidenceRefs || !Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    return false
  }
  return evidenceRefs.some((ref) => typeof ref === 'string' && ref.trim().length > 0)
}

export function canInitiateRecall(contestation: Contestation | undefined | null): boolean {
  if (!contestation) return false
  return contestation.admitted === true && contestation.severity === 'invalidating'
}
