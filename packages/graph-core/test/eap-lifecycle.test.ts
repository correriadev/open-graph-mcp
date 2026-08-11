import { describe, test, expect } from 'bun:test'
import { EpistemicLifecycle } from '../src/eap/lifecycle'
import { Refusal } from '../src/eap/refusals'

describe('Epistemic Lifecycle Aggregate (Task 02)', () => {
  const dummyEvidence = [{ id: 'ev-1', type: 'test-evidence', payload: { ok: true } }]

  test('1. Should complete Relative Authority when full normative sequence succeeds in order', () => {
    const lifecycle = new EpistemicLifecycle('cand-101', 'horizon-alpha')
    expect(lifecycle.getState()).toBe('proposed')
    expect(lifecycle.hasRelativeAuthority()).toBe(false)

    const res1 = lifecycle.transition('DELIBERATE', dummyEvidence)
    expect(res1.success).toBe(true)
    expect(lifecycle.getState()).toBe('deliberated')

    const res2 = lifecycle.transition('ADMIT', dummyEvidence)
    expect(res2.success).toBe(true)
    expect(lifecycle.getState()).toBe('admitted')

    const res3 = lifecycle.transition('CONCRETIZE', dummyEvidence)
    expect(res3.success).toBe(true)
    expect(lifecycle.getState()).toBe('concretized')

    const res4 = lifecycle.transition('VERIFY', dummyEvidence)
    expect(res4.success).toBe(true)
    expect(lifecycle.getState()).toBe('verified')
    expect(lifecycle.hasRelativeAuthority()).toBe(true)
  })

  test('2. Should return a typed Refusal when a lifecycle transition is out of order', () => {
    const lifecycle = new EpistemicLifecycle('cand-102', 'horizon-alpha')
    const result = lifecycle.transition('VERIFY', dummyEvidence)

    expect(result.success).toBe(false)
    expect(lifecycle.getState()).toBe('proposed')

    if (!result.success) {
      const refusal: Refusal = result.refusal
      expect(refusal.code).toBe('ILLEGAL_TRANSITION')
      expect(refusal.obligation).toContain('Follow the normative')
    }
  })

  test('3. Should reject boundary commands (PROMOTE, CONTEST, INITIATE) when presented as lifecycle states', () => {
    const boundaryCommands = ['PROMOTE', 'CONTEST', 'INITIATE']

    for (const boundaryCmd of boundaryCommands) {
      const lifecycle = new EpistemicLifecycle('cand-103', 'horizon-alpha')
      const result = lifecycle.transition(boundaryCmd, dummyEvidence)

      expect(result.success).toBe(false)
      expect(lifecycle.getState()).toBe('proposed')

      if (!result.success) {
        expect(result.refusal.code).toBe('BOUNDARY_COMMAND_REJECTED')
      }
    }
  })

  test('4. Should return EVIDENCE_REQUIRED refusal when evidence is omitted', () => {
    const lifecycle = new EpistemicLifecycle('cand-104', 'horizon-alpha')
    const result = lifecycle.transition('DELIBERATE')

    expect(result.success).toBe(false)
    expect(lifecycle.getState()).toBe('proposed')
    if (!result.success) {
      expect(result.refusal.code).toBe('EVIDENCE_REQUIRED')
    }
  })
})
