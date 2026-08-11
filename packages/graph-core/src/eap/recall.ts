/**
 * recall.ts — Domain Aggregate and Models for Resumable Recall (Task 09, Feature F001)
 */

export type RecallSeverity = "invalidating" | "blocking" | "informative"
export type ContestationStatus = "admitted" | "refused" | "pending"
export type TruthOwnership = "source" | "graph" | "suspended"

export interface RecallNotice {
  recallId: string
  contestationId: string
  targetClaimIds: string[]
  severity: RecallSeverity
  contestationStatus: ContestationStatus
  tenantId?: string
  initiatedAt: string
  faultySinceSeq?: number
}

export interface RecallRefusal {
  refused: true
  code: "INVALID_CONTESTATION_FOR_RECALL" | "CONTESTATION_NOT_ADMITTED" | "NOT_INVALIDATING"
  message: string
}

export interface RecallCheckpoint {
  recallId: string
  sequence: number
  processedClaimIds: string[]
  remainingClaimIds: string[]
  lastProcessedClaimId: string | null
  suspendedCells: string[]
  updatedAt: string
}

export interface RecallProgress {
  recallId: string
  checkpoint: RecallCheckpoint
  affectedClaimIds: string[]
  isComplete: boolean
  degradedClaims: Array<{ claimId: string; previousState: string; newState: string }>
  suspendedCells: string[]
}

export interface RecallScarRecord {
  recallId: string
  contestationId: string
  targetClaimIds: string[]
  affectedClaimIds: string[]
  degradedClaimStates: Record<string, { previousState: string; normativelyResolvedState: string }>
  suspendedCells: string[]
  initiatedAt: string
  completedAt: string
}

export interface RecallCase {
  id: string
  notice: RecallNotice
  status: "active" | "checkpointed" | "completed" | "refused"
  closure: string[]
  processedClaimIds: Set<string>
  checkpoint: RecallCheckpoint
  degradedClaimStates: Map<string, { previousState: string; normativelyResolvedState: string }>
  degradationCounts: Map<string, number>
  suspendedCells: Set<string>
  scarHistory?: RecallScarRecord
}

export interface DependencyQuery {
  reverseClosure(targetClaimIds: string[]): string[]
}

export class InMemoryDependencyQuery implements DependencyQuery {
  private reverseEdges = new Map<string, Set<string>>()

  constructor(edges: Array<{ from: string; to: string }> = []) {
    for (const edge of edges) {
      this.addDependency(edge.from, edge.to)
    }
  }

  addDependency(dependentId: string, targetId: string): void {
    if (!this.reverseEdges.has(targetId)) {
      this.reverseEdges.set(targetId, new Set())
    }
    this.reverseEdges.get(targetId)!.add(dependentId)
  }

  reverseClosure(targetClaimIds: string[]): string[] {
    const visited = new Set<string>()
    const queue = [...targetClaimIds]

    for (const id of targetClaimIds) {
      visited.add(id)
    }

    let head = 0
    while (head < queue.length) {
      const current = queue[head++]
      const dependents = this.reverseEdges.get(current)
      if (dependents) {
        for (const dep of dependents) {
          if (!visited.has(dep)) {
            visited.add(dep)
            queue.push(dep)
          }
        }
      }
    }

    return Array.from(visited).sort()
  }
}

export function createRecallCase(
  notice: RecallNotice,
  depQuery: DependencyQuery
): RecallCase | RecallRefusal {
  if (notice.contestationStatus !== "admitted") {
    return {
      refused: true,
      code: "CONTESTATION_NOT_ADMITTED",
      message: "Only admitted contestations can initiate recall",
    }
  }

  if (notice.severity !== "invalidating") {
    return {
      refused: true,
      code: "NOT_INVALIDATING",
      message: "Only invalidating contestations can initiate recall",
    }
  }

  const closure = depQuery.reverseClosure(notice.targetClaimIds)
  const now = new Date().toISOString()

  const checkpoint: RecallCheckpoint = {
    recallId: notice.recallId,
    sequence: 0,
    processedClaimIds: [],
    remainingClaimIds: [...closure],
    lastProcessedClaimId: null,
    suspendedCells: [],
    updatedAt: now,
  }

  return {
    id: notice.recallId,
    notice,
    status: "active",
    closure,
    processedClaimIds: new Set<string>(),
    checkpoint,
    degradedClaimStates: new Map(),
    degradationCounts: new Map(),
    suspendedCells: new Set<string>(),
  }
}

export interface ExecutionContext {
  claimStates?: Map<string, string>
  cellOwners?: Map<string, TruthOwnership>
  claimCells?: Map<string, string>
}

export function stepRecall(
  recallCase: RecallCase,
  batchSize: number = 1,
  ctx: ExecutionContext = {}
): RecallProgress {
  if (recallCase.status === "completed" || recallCase.status === "refused") {
    return exportRecallProgress(recallCase, true)
  }

  const remaining = recallCase.checkpoint.remainingClaimIds
  const batch = remaining.slice(0, batchSize)
  const newRemaining = remaining.slice(batchSize)

  const claimStates = ctx.claimStates ?? new Map()
  const cellOwners = ctx.cellOwners ?? new Map()
  const claimCells = ctx.claimCells ?? new Map()

  const batchDegraded: Array<{ claimId: string; previousState: string; newState: string }> = []
  const newlySuspendedCells: string[] = []

  for (const claimId of batch) {
    if (recallCase.processedClaimIds.has(claimId)) {
      continue
    }

    recallCase.processedClaimIds.add(claimId)
    const currentCount = recallCase.degradationCounts.get(claimId) ?? 0
    recallCase.degradationCounts.set(claimId, currentCount + 1)

    const previousState = claimStates.get(claimId) ?? "admitted"
    const normativelyResolvedState = "recalled"

    claimStates.set(claimId, normativelyResolvedState)
    recallCase.degradedClaimStates.set(claimId, {
      previousState,
      normativelyResolvedState,
    })
    batchDegraded.push({ claimId, previousState, newState: normativelyResolvedState })

    const cellKey = claimCells.get(claimId)
    if (cellKey) {
      const owner = cellOwners.get(cellKey)
      if (owner === "graph" && !recallCase.suspendedCells.has(cellKey)) {
        cellOwners.set(cellKey, "suspended")
        recallCase.suspendedCells.add(cellKey)
        newlySuspendedCells.push(cellKey)
      }
    }
  }

  const seq = recallCase.checkpoint.sequence + 1
  const lastProcessed = batch.length > 0 ? batch[batch.length - 1] : recallCase.checkpoint.lastProcessedClaimId

  recallCase.checkpoint = {
    recallId: recallCase.id,
    sequence: seq,
    processedClaimIds: Array.from(recallCase.processedClaimIds),
    remainingClaimIds: newRemaining,
    lastProcessedClaimId: lastProcessed,
    suspendedCells: Array.from(recallCase.suspendedCells),
    updatedAt: new Date().toISOString(),
  }

  const isComplete = newRemaining.length === 0
  if (isComplete) {
    recallCase.status = "completed"
    const scar: RecallScarRecord = {
      recallId: recallCase.id,
      contestationId: recallCase.notice.contestationId,
      targetClaimIds: recallCase.notice.targetClaimIds,
      affectedClaimIds: recallCase.closure,
      degradedClaimStates: Object.fromEntries(
        Array.from(recallCase.degradedClaimStates.entries()).map(([k, v]) => [k, v])
      ),
      suspendedCells: Array.from(recallCase.suspendedCells),
      initiatedAt: recallCase.notice.initiatedAt,
      completedAt: new Date().toISOString(),
    }
    recallCase.scarHistory = scar
  } else {
    recallCase.status = "checkpointed"
  }

  return {
    recallId: recallCase.id,
    checkpoint: recallCase.checkpoint,
    affectedClaimIds: recallCase.closure,
    isComplete,
    degradedClaims: batchDegraded,
    suspendedCells: newlySuspendedCells,
  }
}

export function resumeRecallFromCheckpoint(
  checkpoint: RecallCheckpoint,
  notice: RecallNotice,
  closure: string[],
  existingScar?: RecallScarRecord
): RecallCase {
  const processedSet = new Set(checkpoint.processedClaimIds)
  const suspendedSet = new Set(checkpoint.suspendedCells)
  const degradedMap = new Map<string, { previousState: string; normativelyResolvedState: string }>()
  const countMap = new Map<string, number>()

  for (const claimId of checkpoint.processedClaimIds) {
    degradedMap.set(claimId, { previousState: "admitted", normativelyResolvedState: "recalled" })
    countMap.set(claimId, 1)
  }

  const isComplete = checkpoint.remainingClaimIds.length === 0

  return {
    id: checkpoint.recallId,
    notice,
    status: isComplete ? "completed" : "checkpointed",
    closure,
    processedClaimIds: processedSet,
    checkpoint: { ...checkpoint },
    degradedClaimStates: degradedMap,
    degradationCounts: countMap,
    suspendedCells: suspendedSet,
    scarHistory: existingScar,
  }
}

export function queryRecallScar(recallCase: RecallCase): RecallScarRecord | null {
  return recallCase.scarHistory ?? null
}

export function exportRecallProgress(recallCase: RecallCase, isComplete: boolean): RecallProgress {
  return {
    recallId: recallCase.id,
    checkpoint: recallCase.checkpoint,
    affectedClaimIds: recallCase.closure,
    isComplete,
    degradedClaims: Array.from(recallCase.degradedClaimStates.entries()).map(([claimId, v]) => ({
      claimId,
      previousState: v.previousState,
      newState: v.normativelyResolvedState,
    })),
    suspendedCells: Array.from(recallCase.suspendedCells),
  }
}
