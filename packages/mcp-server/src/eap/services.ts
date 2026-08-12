/**
 * services.ts — the EAP composition root.
 *
 * WHY THIS FILE EXISTS (Retry #5 Validation Audit, root cause across all five retries)
 * ------------------------------------------------------------------------------------
 * `capability-gateway.ts`, `promotion-service.ts`, `contestation-service.ts`, `recall-worker.ts`
 * and `persistent-delta.ts` were imported by nothing outside the test suite. The MCP tool adapters
 * in `tools/eap.ts` reimplemented contestation, promotion and recall against the same SQLite tables
 * with their own, weaker rules — so every hardening pass landed on a layer production traffic never
 * reached. This module constructs the governed aggregates for a tenant; `tools/eap.ts` delegates to
 * them and owns nothing but argument validation and refusal mapping, and `index.ts` exposes the
 * factory so the capability gateway and persistent-delta admission are reachable from the server
 * composition root.
 *
 * The repositories are stateless wrappers over `(db, stateDir, tenantId)`; constructing a set per
 * call is deliberate. Caching them per tenant would reintroduce exactly the cross-request in-memory
 * state this feature spent five retries deleting.
 */
import { appendEvent, type ServerState } from "../state"
import { HorizonStore, AdmissionLedgerStore } from "./horizon-store"
import {
  SqliteApprovalRepository,
  SqliteCapabilityAuditRepository,
  SqliteContestationRepository,
  SqlitePromotionRepository,
  SqliteObservedSequenceSource,
  SqliteRecallRepository,
} from "./eap-repositories"
import { PromotionService } from "./promotion-service"
import { ContestationService } from "./contestation-service"
import { RecallWorker } from "./recall-worker"
import { CapabilityGateway } from "./capability-gateway"
import { SqliteDependencyQuery, buildRecallExecutionContext } from "./dependency-query"
import { admitPersistentDelta, type PersistentDelta, type PersistentDeltaAdmissionResult } from "./persistent-delta"
import type { ExecutionContext } from "@open-graph-mcp/graph-core/eap/recall"

export interface EapServices {
  tenantId: string
  horizons: HorizonStore
  ledger: AdmissionLedgerStore
  promotionRepo: SqlitePromotionRepository
  contestationRepo: SqliteContestationRepository
  recallRepo: SqliteRecallRepository
  approvalRepo: SqliteApprovalRepository
  auditRepo: SqliteCapabilityAuditRepository
  promotions: PromotionService
  contestations: ContestationService
  recalls: RecallWorker
  capabilities: CapabilityGateway
  /** Current claim states, claim→cell map and cell ownership for a recall batch. */
  recallContext: () => ExecutionContext
  /** Persistent Delta admission — one envelope, one transaction, through the single Admission Gate. */
  admitPersistentDelta: (args: { token: string; delta: PersistentDelta }) => PersistentDeltaAdmissionResult
}

export function eapServices(state: ServerState, tenantId: string): EapServices {
  const { db, stateDir } = state

  const promotionRepo = new SqlitePromotionRepository(db, stateDir, tenantId)
  const contestationRepo = new SqliteContestationRepository(db, stateDir, tenantId)
  // The read model's notification port (003 §Events: `TruthOwnershipSuspended` → "Persistent
  // Knowledge, authority view, subscribers"). Bound here rather than inside the repository so the
  // repository stays a pure persistence adapter with no knowledge of the event log.
  const recallRepo = new SqliteRecallRepository(db, stateDir, tenantId, {
    truthOwnershipSuspended(cells, recallCase) {
      for (const cellKey of cells) {
        appendEvent(state, tenantId, {
          kind: "TruthOwnershipSuspended",
          targetKind: "cell",
          targetId: cellKey,
          payload: { recallId: recallCase.id, cellKey, seq: recallCase.checkpoint.sequence },
        })
      }
    },
  })
  const approvalRepo = new SqliteApprovalRepository(db, stateDir, tenantId)
  const auditRepo = new SqliteCapabilityAuditRepository(db, stateDir, tenantId)

  return {
    tenantId,
    horizons: new HorizonStore(db, stateDir),
    ledger: new AdmissionLedgerStore(db, stateDir),
    promotionRepo,
    contestationRepo,
    recallRepo,
    approvalRepo,
    auditRepo,
    promotions: new PromotionService(promotionRepo),
    contestations: new ContestationService(contestationRepo),
    recalls: new RecallWorker(recallRepo, new SqliteDependencyQuery(db, tenantId)),
    capabilities: new CapabilityGateway(approvalRepo, auditRepo, new SqliteObservedSequenceSource(db, tenantId)),
    recallContext: () => buildRecallExecutionContext(db, tenantId),
    admitPersistentDelta: (args) => admitPersistentDelta(state, args),
  }
}
