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
    return this.initiateRecallAtomic(notice)
  }

  /**
   * Synchronous initiation — the SAME domain path as `initiateRecall`, callable from inside a
   * caller's serialized transaction.
   *
   * `eapRecall` establishes idempotency by asking whether a case exists for the contestation and
   * satisfies it by creating that case. While initiation was reachable only through an `async`
   * method, those two steps were separated by microtask boundaries: two concurrent
   * `cognitive.recall` calls in ONE process both observed "no case", both burned a `recalls`
   * sequence and both drove `processBatch` over the same closure. The read and the write now commit
   * as one BEGIN IMMEDIATE unit, which is what "idempotent by contestation" has to mean.
   */
  initiateRecallAtomic(notice: RecallNotice): RecallCase | RecallRefusal {
    const result = createRecallCase(notice, this.depQuery)
    if ("refused" in result) {
      return result
    }

    this.repo.createSync(result)
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
    const driven = this.stepSync(recallId, batchSize, ctx)
    for (const broadcast of driven.broadcasts) broadcast()
    return driven.progress
  }

  /**
   * Drives an unfinished case to completion, or to `maxBatches`, INSIDE ONE synchronous unit.
   *
   * WHY SYNCHRONOUS (retry #8, TL/QA: the gate's only modelled exit)
   * ---------------------------------------------------------------
   * `cognitive.recall` is idempotent by contestation, and its replay branch returned unconditionally
   * for any EXISTING case — so a case that stopped at the batch cap could never be re-driven through
   * the tool surface, while its own refusal instructed the operator to "re-drive the case with a
   * larger batchSize". Resuming instead of replaying is the fix, and it is only safe if the decision
   * to resume and the writes that satisfy it cannot interleave with a second caller's: every batch
   * here is load → step → checkpoint with NO await between them, and the whole drive runs inside the
   * caller's `serialTransaction`. Two concurrent resumes therefore cannot step separately loaded
   * copies of the same case.
   *
   * Returns the broadcasts to run once the caller's transaction has committed.
   */
  driveSync(
    recallId: string,
    batchSize: number,
    ctx: ExecutionContext,
    maxBatches: number,
  ): { progress: RecallProgress | null; batchLimitReached: boolean; broadcasts: Array<() => void> } {
    const broadcasts: Array<() => void> = []
    let progress: RecallProgress | null = null
    let batchLimitReached = true
    for (let i = 0; i < maxBatches; i++) {
      const stepped = this.stepSync(recallId, batchSize, ctx)
      broadcasts.push(...stepped.broadcasts)
      progress = stepped.progress
      if (!progress || progress.isComplete) {
        batchLimitReached = false
        break
      }
    }
    return { progress, batchLimitReached, broadcasts }
  }

  /** One batch: load, step, checkpoint, complete-if-done. Synchronous by construction. */
  private stepSync(
    recallId: string,
    batchSize: number,
    ctx: ExecutionContext,
  ): { progress: RecallProgress | null; broadcasts: Array<() => void> } {
    const broadcasts: Array<() => void> = []
    const record = this.repo.getSync(recallId)
    if (!record) return { progress: null, broadcasts }

    const { recallCase } = record
    if (recallCase.status === "completed") {
      return { progress: exportRecallProgress(recallCase, true), broadcasts }
    }

    const progress = stepRecall(recallCase, batchSize, ctx)

    broadcasts.push(this.repo.checkpointSync(recallId, recallCase.checkpoint, recallCase))

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
      broadcasts.push(this.repo.completeSync(recallId, recallCase.scarHistory, recallCase))
    }

    return { progress, broadcasts }
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
