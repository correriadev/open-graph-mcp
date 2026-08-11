/**
 * recall-worker.ts — Worker and Repository for Resumable Recall (Task 09, Feature F001)
 */

import {
  createRecallCase,
  stepRecall,
  resumeRecallFromCheckpoint,
  exportRecallProgress,
  type RecallNotice,
  type RecallCase,
  type RecallCheckpoint,
  type RecallScarRecord,
  type RecallProgress,
  type RecallRefusal,
  type DependencyQuery,
  type ExecutionContext,
  InMemoryDependencyQuery,
} from "@open-graph-mcp/graph-core/eap/recall"

export interface EventEnvelope {
  type: "KnowledgeContested" | "RecallProgressed" | "TruthOwnershipSuspended"
  payload: Record<string, unknown>
}

export class InMemoryRecallRepository {
  private cases = new Map<string, RecallCase>()
  private checkpoints = new Map<string, RecallCheckpoint>()
  private scars = new Map<string, RecallScarRecord>()

  async create(recallCase: RecallCase): Promise<void> {
    this.cases.set(recallCase.id, recallCase)
    this.checkpoints.set(recallCase.id, recallCase.checkpoint)
  }

  async checkpoint(recallId: string, checkpoint: RecallCheckpoint): Promise<void> {
    this.checkpoints.set(recallId, checkpoint)
    const c = this.cases.get(recallId)
    if (c) {
      c.checkpoint = checkpoint
    }
  }

  async complete(recallId: string, scar: RecallScarRecord): Promise<void> {
    this.scars.set(recallId, scar)
    const c = this.cases.get(recallId)
    if (c) {
      c.status = "completed"
      c.scarHistory = scar
    }
  }

  async get(recallId: string): Promise<{ recallCase: RecallCase; checkpoint: RecallCheckpoint } | null> {
    const recallCase = this.cases.get(recallId)
    const checkpoint = this.checkpoints.get(recallId)
    if (!recallCase || !checkpoint) return null
    return { recallCase, checkpoint }
  }

  async getScar(recallId: string): Promise<RecallScarRecord | null> {
    return this.scars.get(recallId) ?? null
  }
}

export class RecallWorker {
  private repo: InMemoryRecallRepository
  private depQuery: DependencyQuery
  private events: EventEnvelope[] = []

  constructor(repo?: InMemoryRecallRepository, depQuery?: DependencyQuery) {
    this.repo = repo ?? new InMemoryRecallRepository()
    this.depQuery = depQuery ?? new InMemoryDependencyQuery()
  }

  getEmittedEvents(): EventEnvelope[] {
    return this.events
  }

  async initiateRecall(
    notice: RecallNotice
  ): Promise<RecallCase | RecallRefusal> {
    const result = createRecallCase(notice, this.depQuery)
    if ("refused" in result) {
      return result
    }

    await this.repo.create(result)
    this.events.push({
      type: "KnowledgeContested",
      payload: {
        contestationId: notice.contestationId,
        targetClaimIds: notice.targetClaimIds,
        severity: notice.severity,
      },
    })
    return result
  }

  async processBatch(
    recallId: string,
    batchSize: number = 1,
    ctx: ExecutionContext = {}
  ): Promise<RecallProgress | null> {
    const record = await this.repo.get(recallId)
    if (!record) return null

    const { recallCase } = record
    const progress = stepRecall(recallCase, batchSize, ctx)

    await this.repo.checkpoint(recallId, recallCase.checkpoint)

    this.events.push({
      type: "RecallProgressed",
      payload: {
        recallId: recallCase.id,
        checkpoint: recallCase.checkpoint,
        affectedClaimIds: progress.affectedClaimIds,
      },
    })

    for (const cellKey of progress.suspendedCells) {
      this.events.push({
        type: "TruthOwnershipSuspended",
        payload: {
          recallId: recallCase.id,
          cellKey,
          seq: recallCase.checkpoint.sequence,
        },
      })
    }

    if (progress.isComplete && recallCase.scarHistory) {
      await this.repo.complete(recallId, recallCase.scarHistory)
    }

    return progress
  }

  async interruptAndResume(
    recallId: string,
    batchSize: number = 1,
    ctx: ExecutionContext = {}
  ): Promise<{ uninterrupted: RecallProgress; resumed: RecallProgress }> {
    const record = await this.repo.get(recallId)
    if (!record) throw new Error(`Recall case ${recallId} not found`)

    const resumedCase = resumeRecallFromCheckpoint(
      record.checkpoint,
      record.recallCase.notice,
      record.recallCase.closure,
      record.recallCase.scarHistory
    )

    let lastProgress: RecallProgress = exportRecallProgress(resumedCase, resumedCase.status === "completed")
    while (resumedCase.status !== "completed") {
      lastProgress = stepRecall(resumedCase, batchSize, ctx)
      await this.repo.checkpoint(recallId, resumedCase.checkpoint)
    }

    if (resumedCase.scarHistory) {
      await this.repo.complete(recallId, resumedCase.scarHistory)
    }

    return {
      uninterrupted: exportRecallProgress(record.recallCase, true),
      resumed: lastProgress,
    }
  }

  async getScar(recallId: string): Promise<RecallScarRecord | null> {
    return this.repo.getScar(recallId)
  }
}
