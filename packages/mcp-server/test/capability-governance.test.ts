import { describe, expect, it } from 'bun:test'
import {
  authorizeCapability,
  classifyCapability,
  type CapabilityExecutionRequest,
  type OperatorApproval,
} from '@open-graph-mcp/graph-core/eap/capabilities'
import { CapabilityGateway } from '../src/eap/capability-gateway'

describe('Capability Classification & Governance Boundary (Task 10)', () => {
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

  it('1. Irreversible execution requires a valid matching single-use authorization', async () => {
    const gateway = new CapabilityGateway()
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
  })

  it('2. Expired, stale, or out-of-scope approval is refused', async () => {
    const gateway = new CapabilityGateway()
    gateway.registerClassification('deploy_tool', 'irreversible')

    const staleApproval: OperatorApproval = {
      ...validApproval,
      id: 'appr-stale',
      basedOnSeq: 10,
    }

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
})
