import { describe, expect, test, beforeEach } from 'bun:test'
import { ContestationService } from '../src/eap/contestation-service'
import { canInitiateRecall, validateEvidence } from '@open-graph-mcp/graph-core/eap/contestation'

describe('Task 08 — Contestation Admission (EAP)', () => {
  let service: ContestationService

  beforeEach(() => {
    service = new ContestationService([
      { id: 'claim-101', content: 'Original admitted knowledge A', status: 'admitted' },
    ])
  })

  test('A contestation cannot directly edit an admitted claim', () => {
    const result = service.attemptDirectClaimMutation('claim-101', 'edit')
    expect(result.status).toBe('REFUSED')
    if (result.status === 'REFUSED') {
      expect(result.refusal.code).toBe('DIRECT_EDIT_FORBIDDEN')
    }
  })

  test('Missing evidence returns normative terminal refusal EVIDENCE_REQUIRED', () => {
    const outcome = service.contestKnowledge({
      sourceHorizonId: 'horizon-alpha',
      targetClaimIds: ['claim-101'],
      evidenceRefs: [],
      severity: 'blocking',
    })

    expect(outcome.status).toBe('REFUSED')
    if (outcome.status === 'REFUSED') {
      expect(outcome.refusal.code).toBe('EVIDENCE_REQUIRED')
    }
  })

  test('Only admitted invalidating contestations can initiate recall', () => {
    const contestationResult = service.contestKnowledge({
      id: 'contest-inv-1',
      sourceHorizonId: 'horizon-beta',
      targetClaimIds: ['claim-101'],
      evidenceRefs: ['proof-url-999'],
      severity: 'invalidating',
    })

    expect(contestationResult.status).toBe('ADMITTED')

    const recallResult = service.initiateRecall('contest-inv-1')
    expect(recallResult.status).toBe('INITIATED')
  })
})
