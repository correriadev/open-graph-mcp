import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { ContestationService } from '../src/eap/contestation-service'
import { createEapEnv, type EapEnv } from './eap-env'

describe('Task 08 — Contestation Admission (EAP)', () => {
  let env: EapEnv
  let service: ContestationService

  beforeEach(() => {
    env = createEapEnv()
    service = new ContestationService(env.contestations)
  })

  afterEach(() => {
    env.cleanup()
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

  test('An empty target claim set is refused before any durable write', () => {
    const outcome = service.contestKnowledge({
      sourceHorizonId: 'horizon-alpha',
      targetClaimIds: [],
      evidenceRefs: ['proof'],
      severity: 'blocking',
    })
    expect(outcome.status).toBe('REFUSED')
    if (outcome.status === 'REFUSED') {
      expect(outcome.refusal.code).toBe('INVALID_TARGET_CLAIM')
    }
    const rows = env.db
      .query('SELECT COUNT(*) AS n FROM contestations WHERE tenant_id = ?')
      .get(env.tenantId) as { n: number }
    expect(rows.n).toBe(0)
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

  test('A blocking contestation cannot initiate recall', () => {
    service.contestKnowledge({
      id: 'contest-blk-1',
      sourceHorizonId: 'horizon-beta',
      targetClaimIds: ['claim-101'],
      evidenceRefs: ['proof-url-999'],
      severity: 'blocking',
    })

    const recallResult = service.initiateRecall('contest-blk-1')
    expect(recallResult.status).toBe('REFUSED')
    expect(recallResult.refusal?.code).toBe('RECALL_UNPROVEN')
  })

  test('An admitted contestation identifier cannot be overwritten', () => {
    const req = {
      id: 'contest-dup',
      sourceHorizonId: 'horizon-beta',
      targetClaimIds: ['claim-101'],
      evidenceRefs: ['proof'],
      severity: 'invalidating' as const,
    }
    expect(service.contestKnowledge(req).status).toBe('ADMITTED')
    const second = service.contestKnowledge({ ...req, targetClaimIds: ['claim-999'] })
    expect(second.status).toBe('REFUSED')
    expect(service.getContestation('contest-dup')?.targetClaimIds).toEqual(['claim-101'])
  })
})
