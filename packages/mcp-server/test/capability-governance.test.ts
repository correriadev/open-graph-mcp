import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { CapabilityExecutionRequest, OperatorApproval } from '@open-graph-mcp/graph-core/eap/capabilities'
import { CapabilityGateway } from '../src/eap/capability-gateway'
import { createEapEnv, type EapEnv } from './eap-env'

describe('Capability Classification & Governance Boundary (Task 10)', () => {
  let env: EapEnv

  const validApproval: OperatorApproval = {
    id: 'appr-001',
    approver: 'operator-alice',
    scope: 'deploy.production',
    expiresAt: Date.now() + 60000,
    basedOnSeq: 42,
  }

  const baseContract = {
    contractRef: 'contract-deploy-01',
    targetScope: 'deploy.production',
  }

  beforeEach(() => {
    env = createEapEnv()
  })

  afterEach(() => {
    env.cleanup()
  })

  it('1. Irreversible execution requires a valid matching single-use authorization', async () => {
    // The gateway reads the sequence from durable governed state, never from the request, so the
    // world this approval is bound to has to actually exist.
    env.setObservedSeq(42)
    const gateway = new CapabilityGateway(env.approvals, env.audit, env.sequences)
    gateway.registerClassification('deploy_tool', 'irreversible')
    gateway.getApprovalRepo().registerApproval(validApproval)

    const req: CapabilityExecutionRequest = {
      capabilityId: 'deploy_tool',
      idempotencyKey: 'idem-1',
      contract: baseContract,
      currentSeq: 42,
      approval: validApproval,
      providerAction: () => ({ status: 'deployed' }),
    }

    const res = await gateway.execute(req)
    expect(res.status).toBe('COMPLETED')
    expect(env.approvals.getApproval('appr-001')?.consumed).toBe(true)
  })

  it('2. Expired, stale, or out-of-scope approval is refused', async () => {
    const gateway = new CapabilityGateway(env.approvals, env.audit, env.sequences)
    gateway.registerClassification('deploy_tool', 'irreversible')

    const staleApproval: OperatorApproval = {
      ...validApproval,
      id: 'appr-stale',
      basedOnSeq: 10,
    }
    gateway.getApprovalRepo().registerApproval(staleApproval)

    const req: CapabilityExecutionRequest = {
      capabilityId: 'deploy_tool',
      idempotencyKey: 'idem-stale',
      contract: baseContract,
      currentSeq: 42,
      approval: staleApproval,
    }

    const res = await gateway.execute(req)
    expect(res.status).toBe('REFUSED')
    if (res.status === 'REFUSED') {
      expect(res.refusal.code).toBe('APPROVAL_STALE_SEQ')
    }
  })

  it('3. An expired approval is refused and the single-use grant is not consumed', async () => {
    const gateway = new CapabilityGateway(env.approvals, env.audit, env.sequences)
    gateway.registerClassification('deploy_tool', 'irreversible')
    gateway.getApprovalRepo().registerApproval({
      ...validApproval,
      id: 'appr-expired',
      expiresAt: Date.now() - 1_000,
    })

    const res = await gateway.execute({
      capabilityId: 'deploy_tool',
      idempotencyKey: 'idem-expired',
      contract: baseContract,
      currentSeq: 42,
      approval: { ...validApproval, id: 'appr-expired' },
    })

    expect(res.status).toBe('REFUSED')
    if (res.status === 'REFUSED') expect(res.refusal.code).toBe('APPROVAL_EXPIRED')
    expect(env.approvals.getApproval('appr-expired')?.consumed).toBe(false)
  })

  it('4. A consumed irreversible authorization cannot be reused', async () => {
    env.setObservedSeq(42)
    const gateway = new CapabilityGateway(env.approvals, env.audit, env.sequences)
    gateway.registerClassification('deploy_tool', 'irreversible')
    gateway.getApprovalRepo().registerApproval({ ...validApproval, id: 'appr-once' })

    const first = await gateway.execute({
      capabilityId: 'deploy_tool',
      idempotencyKey: 'idem-once-1',
      contract: baseContract,
      currentSeq: 42,
      approval: { ...validApproval, id: 'appr-once' },
      providerAction: () => ({ ok: true }),
    })
    expect(first.status).toBe('COMPLETED')

    let providerRan = false
    const second = await gateway.execute({
      capabilityId: 'deploy_tool',
      idempotencyKey: 'idem-once-2',
      contract: baseContract,
      currentSeq: 42,
      approval: { ...validApproval, id: 'appr-once' },
      providerAction: () => {
        providerRan = true
        return { ok: true }
      },
    })
    expect(second.status).toBe('REFUSED')
    if (second.status === 'REFUSED') expect(second.refusal.code).toBe('APPROVAL_ALREADY_USED')
    expect(providerRan).toBe(false)
  })

  it('5. A reversible capability executes without an operator approval and is idempotency-keyed', async () => {
    const gateway = new CapabilityGateway(env.approvals, env.audit, env.sequences)
    gateway.registerClassification('read_tool', 'reversible')

    let runs = 0
    const req: CapabilityExecutionRequest = {
      capabilityId: 'read_tool',
      idempotencyKey: 'idem-reversible',
      contract: { contractRef: 'contract-read', targetScope: 'read.scope' },
      currentSeq: 1,
      providerAction: () => {
        runs++
        return { runs }
      },
    }

    const first = await gateway.execute(req)
    const second = await gateway.execute(req)
    expect(first.status).toBe('COMPLETED')
    expect(second.status).toBe('COMPLETED')
    if (second.status === 'COMPLETED') expect(second.isCached).toBe(true)
    expect(runs).toBe(1)
  })

  it('6. An unclassified capability defaults to irreversible and therefore requires approval', async () => {
    const gateway = new CapabilityGateway(env.approvals, env.audit, env.sequences)
    expect(gateway.classify('unknown_tool')).toBe('irreversible')

    const res = await gateway.execute({
      capabilityId: 'unknown_tool',
      idempotencyKey: 'idem-unclassified',
      contract: baseContract,
      currentSeq: 1,
    })
    expect(res.status).toBe('REFUSED')
    if (res.status === 'REFUSED') expect(res.refusal.code).toBe('APPROVAL_MISSING')
  })
})
