/**
 * Epistemic Lifecycle Aggregate
 * Scope: packages/graph-core/src/eap/lifecycle.ts
 */

import { EpistemicLifecycleState, BoundaryCommand } from './types'
import { Refusal, createRefusal } from './refusals'

export interface EvidenceRef {
  id: string
  type: string
  payload?: unknown
}

export interface LifecycleTransitionSuccess {
  success: true
  previousState: EpistemicLifecycleState
  currentState: EpistemicLifecycleState
  hasRelativeAuthority: boolean
  horizonId: string
  candidateId: string
  evidence?: EvidenceRef[]
}

export interface LifecycleTransitionRefusal {
  success: false
  refusal: Refusal
  currentState: EpistemicLifecycleState
}

export type LifecycleOutcome = LifecycleTransitionSuccess | LifecycleTransitionRefusal

const NORMATIVE_SEQUENCE: Record<EpistemicLifecycleState, { nextCommand: string; nextState: EpistemicLifecycleState }> = {
  proposed: { nextCommand: 'DELIBERATE', nextState: 'deliberated' },
  deliberated: { nextCommand: 'ADMIT', nextState: 'admitted' },
  admitted: { nextCommand: 'CONCRETIZE', nextState: 'concretized' },
  concretized: { nextCommand: 'VERIFY', nextState: 'verified' },
  verified: { nextCommand: 'VERIFY', nextState: 'verified' }, // terminal
}

const BOUNDARY_COMMANDS: ReadonlySet<string> = new Set<BoundaryCommand>([
  'PROMOTE',
  'CONTEST',
  'INITIATE',
])

export class EpistemicLifecycle {
  public readonly candidateId: string
  public readonly horizonId: string
  private state: EpistemicLifecycleState
  private relativeAuthority: boolean
  private readonly history: Array<{ command: string; from: EpistemicLifecycleState; to: EpistemicLifecycleState; timestamp: number }>

  constructor(candidateId: string, horizonId: string, initialState: EpistemicLifecycleState = 'proposed') {
    if (!candidateId || candidateId.trim().length === 0) {
      throw new Error('candidateId must be non-empty string')
    }
    if (!horizonId || horizonId.trim().length === 0) {
      throw new Error('horizonId must be non-empty string')
    }
    this.candidateId = candidateId
    this.horizonId = horizonId
    this.state = initialState
    this.relativeAuthority = false
    this.history = []
  }

  public getState(): EpistemicLifecycleState {
    return this.state
  }

  public hasRelativeAuthority(): boolean {
    return this.relativeAuthority
  }

  public transition(command: string, evidence?: EvidenceRef[]): LifecycleOutcome {
    const uppercaseCmd = command.toUpperCase()

    if (BOUNDARY_COMMANDS.has(uppercaseCmd as BoundaryCommand)) {
      return {
        success: false,
        currentState: this.state,
        refusal: createRefusal(
          'BOUNDARY_COMMAND_REJECTED',
          `Command '${uppercaseCmd}' is a boundary command and cannot be used as a lifecycle state transition.`
        ),
      }
    }

    if (this.state === 'verified') {
      return {
        success: false,
        currentState: this.state,
        refusal: createRefusal(
          'ILLEGAL_TRANSITION',
          `Candidate '${this.candidateId}' is already in verified state and cannot undergo further lifecycle transitions.`
        ),
      }
    }

    const expected = NORMATIVE_SEQUENCE[this.state]

    if (uppercaseCmd !== expected.nextCommand) {
      return {
        success: false,
        currentState: this.state,
        refusal: createRefusal(
          'ILLEGAL_TRANSITION',
          `Cannot execute '${uppercaseCmd}' when candidate is in '${this.state}' state. Expected '${expected.nextCommand}'.`
        ),
      }
    }

    if (!evidence || evidence.length === 0) {
      return {
        success: false,
        currentState: this.state,
        refusal: createRefusal(
          'EVIDENCE_REQUIRED',
          `Transition '${this.state}' -> '${expected.nextState}' via '${uppercaseCmd}' requires non-empty evidence.`
        ),
      }
    }

    const previousState = this.state
    this.state = expected.nextState

    if (this.state === 'verified') {
      this.relativeAuthority = true
    }

    this.history.push({
      command: uppercaseCmd,
      from: previousState,
      to: this.state,
      timestamp: Date.now(),
    })

    return {
      success: true,
      previousState,
      currentState: this.state,
      hasRelativeAuthority: this.relativeAuthority,
      horizonId: this.horizonId,
      candidateId: this.candidateId,
      evidence,
    }
  }
}
