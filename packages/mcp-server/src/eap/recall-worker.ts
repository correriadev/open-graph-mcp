/**
 * recall-worker.ts — Worker for Resumable Recall (Task 09, Feature F001).
 *
 * Retry#5 / REWORK-LOG defect 1 and 2: `InMemoryRecallRepository` kept cases, checkpoints and scars
 * in volatile `Map`s, so a host restart mid-recall lost the checkpoint entirely — the exact failure
 * a *resumable* recall exists to prevent — and the worker's `events` array grew without bound.
 * The worker now writes through `SqliteRecallRepository`, reloads the case from durable state on
 * every batch, and keeps only a bounded observation ring in memory.
 */

import {
  createRecallCase,
  stepRecall,
  resumeRecallFromCheckpoint,
  exportRecallProgress,
  type RecallNotice,
  type RecallCase,
  type RecallScarRecord,
  type RecallProgress,
  type RecallRefusal,
  type DependencyQuery,
  type ExecutionContext,
  InMemoryDependencyQuery,
} from "@open-graph-mcp/graph-core/eap/recall"
import type { SqliteRecallRepository } from "./eap-repositories"

export interface EventEnvelope {
  type: "KnowledgeContested" | "RecallProgressed" | "TruthOwnershipSuspended"
  payload: Record<string, unknown>
}

/** Observation ring bound. Durable recall progress lives in SQLite; this is a debug tail only. */
export const DEFAULT_MAX_RETAINED_EVENTS = 500

export class RecallWorker {
  private events: EventEnvelope[] = []
  private readonly maxRetainedEvents: number

  constructor(
    private readonly repo: SqliteRecallRepository,
    private depQuery: DependencyQuery = new InMemoryDependencyQuery(),
    opts?: { maxRetainedEvents?: number },
  ) {
    if (!repo) throw new Error("RecallWorker requires a durable recall repository")
    this.maxRetainedEvents = opts?.maxRetainedEvents ?? DEFAULT_MAX_RETAINED_EVENTS
  }

  private emit(event: EventEnvelope): void {
    this.events.push(event)
    if (this.events.length > this.maxRetainedEvents) {
      this.events.splice(0, this.events.length - this.maxRetainedEvents)
    }
  }

  getEmittedEvents(): EventEnvelope[] {
    return [...this.events]
  }

  async initiateRecall(notice: RecallNotice): Promise<RecallCase | RecallRefusal> {
    const result = createRecallCase(notice, this.depQuery)
    if ("refused" in result) {
      return result
    }

    await this.repo.create(result)
    this.emit({
      type: "KnowledgeContested",
      payload: {
        contestationId: notice.contestationId,
        targetClaimIds: notice.targetClaimIds,
        severity: notice.severity,
      },
    })
    return result
  }

  /**
   * Loads the case from durable state, applies one batch, and checkpoints it back. Reloading per
   * batch is what makes the worker restart-safe: nothing about the case is cached across calls.
   */
  async processBatch(
    recallId: string,
    batchSize: number = 1,
    ctx: ExecutionContext = {},
  ): Promise<RecallProgress | null> {
    const record = await this.repo.get(recallId)
    if (!record) return null

    const { recallCase } = record
    if (recallCase.status === "completed") {
      return exportRecallProgress(recallCase, true)
    }

    const progress = stepRecall(recallCase, batchSize, ctx)

    await this.repo.checkpoint(recallId, recallCase.checkpoint, recallCase)

    this.emit({
      type: "RecallProgressed",
      payload: {
        recallId: recallCase.id,
        checkpoint: recallCase.checkpoint,
        affectedClaimIds: progress.affectedClaimIds,
      },
    })

    for (const cellKey of progress.suspendedCells) {
      this.emit({
        type: "TruthOwnershipSuspended",
        payload: {
          recallId: recallCase.id,
          cellKey,
          seq: recallCase.checkpoint.sequence,
        },
      })
    }

    if (progress.isComplete && recallCase.scarHistory) {
      await this.repo.complete(recallId, recallCase.scarHistory, recallCase)
    }

    return progress
  }

  async interruptAndResume(
    recallId: string,
    batchSize: number = 1,
    ctx: ExecutionContext = {},
  ): Promise<{ uninterrupted: RecallProgress; resumed: RecallProgress }> {
    const record = await this.repo.get(recallId)
    if (!record) throw new Error(`Recall case ${recallId} not found`)

    const resumedCase = resumeRecallFromCheckpoint(
      record.checkpoint,
      record.recallCase.notice,
      record.recallCase.closure,
      record.recallCase.scarHistory,
    )

    let lastProgress: RecallProgress = exportRecallProgress(resumedCase, resumedCase.status === "completed")
    while (resumedCase.status !== "completed") {
      lastProgress = stepRecall(resumedCase, batchSize, ctx)
      await this.repo.checkpoint(recallId, resumedCase.checkpoint, resumedCase)
    }

    if (resumedCase.scarHistory) {
      await this.repo.complete(recallId, resumedCase.scarHistory, resumedCase)
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
