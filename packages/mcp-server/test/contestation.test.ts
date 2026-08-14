import { describe, expect, beforeEach, afterEach } from 'bun:test'
import { ContestationService } from '../src/eap/contestation-service'
import { createEapEnv, type EapEnv } from './eap-env'
import { annotatedTest } from './verification/annotate'

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

  annotatedTest(
    'A contestation cannot directly edit an admitted claim',
    // EAP-SVCS-006's Then pairs "KnowledgeContested is recorded" with "the target claims are not
    // directly edited or deleted". Only the second half is observed here, and only as a refusal of
    // an attempted mutation.
    { coversPartially: ['EAP-SVCS-006'] },
    () => {
    const result = service.attemptDirectClaimMutation('claim-101', 'edit')
    expect(result.status).toBe('REFUSED')
    if (result.status === 'REFUSED') {
      expect(result.refusal.code).toBe('DIRECT_EDIT_FORBIDDEN')
    }
    },
  )

  annotatedTest(
    'Missing evidence returns normative terminal refusal EVIDENCE_REQUIRED',
    // EAP-SVCS-007 also requires that admitted knowledge is unchanged, which is not observed here.
    // f001-transport-delegation's `[null]` evidence case asserts that half against the durable row
    // count, so this one stays partial.
    { coversPartially: ['EAP-SVCS-007'] },
    () => {
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
    },
  )

  annotatedTest(
    'An empty target claim set is refused before any durable write',
    // EAP-ADMS-002 requires EXACTLY ONE refusal carrying its client obligation; this case shows a
    // typed refusal and the absence of a durable row, not the cardinality or the obligation.
    { coversPartially: ['EAP-ADMS-002'] },
    () => {
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
    },
  )

  annotatedTest(
    'Only admitted invalidating contestations can initiate recall',
    // EAP-RECL-001 also requires the case to be created "for deterministic traversal of registered
    // admitted reverse dependencies". No dependency graph exists in this environment, so only the
    // admission precondition is proven here; recall.test.ts asserts the traversal clause.
    { coversPartially: ['EAP-RECL-001'] },
    () => {
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
    },
  )

  annotatedTest(
    'A blocking contestation cannot initiate recall',
    // EAP-RECL-002 spans missing, refused, informative AND blocking contestations, and requires
    // that no Recall Case is created. Only the blocking severity is exercised, and no absence of a
    // case is checked — epistemic-write-atomicity-and-authz asserts the scenario in full.
    { coversPartially: ['EAP-RECL-002'] },
    () => {
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
    },
  )

  annotatedTest(
    'An admitted contestation identifier cannot be overwritten',
    // The admitted record is not directly rewritten by a second submission under the same id —
    // EAP-SVCS-006's "not directly edited or deleted" clause, on the Contestation itself rather
    // than on its target claims, so partial.
    { coversPartially: ['EAP-SVCS-006'] },
    () => {
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
    },
  )
})
