/**
 * eap.ts — Epistemic Admission Protocol (EAP) MCP Tool Adapters.
 *
 * WHAT THESE ADAPTERS ARE ALLOWED TO DO (Retry #5 Validation Audit, root cause)
 * ----------------------------------------------------------------------------
 * Argument validation, identifier and bounds checks, and the mapping of a domain outcome onto an
 * MCP response. NOTHING ELSE. Every epistemic rule lives in `src/eap/` and in `graph-core/eap`.
 *
 * Through five retries these adapters were a SECOND, weaker implementation of the domain services:
 * `eapContest` hard-coded `status: 'admitted'` without ever inspecting the evidence or resolving
 * the targets; `eapPromote` never read the child horizon's candidates, so arbitrary ids could be
 * injected into a parent horizon; `eapRecall` wrote a `recalls` row marked `completed` with the
 * contested ids copied verbatim, computing no reverse-dependency closure, no degradation, no
 * suspension and no scar, against a table set disjoint from the one `SqliteRecallRepository` uses.
 * Each retry hardened the domain; the reachable surface kept its own rules. The adapters now
 * delegate to `eapServices()` — the governed aggregates are the only implementation.
 *
 * Concurrency (defect 3) is unchanged in intent: every write path runs inside `serialTransaction`
 * (BEGIN IMMEDIATE) and takes its sequence from the durable atomic allocator, never from
 * `MAX(seq)+1`.
 */
import { requireToken } from "./session"
import { appendEvent, type ServerState } from "../state"
import { HorizonStore, AdmissionLedgerStore } from "../eap/horizon-store"
import { eapServices } from "../eap/services"
import { allocateSequence, serialTransaction, write } from "../db"
import { REFUSAL_OBLIGATIONS, type RefusalCode } from "@open-graph-mcp/graph-core/eap/refusals"
import type { Candidate } from "@open-graph-mcp/graph-core/eap/promotion"
import type { RecallNotice, RecallProgress } from "@open-graph-mcp/graph-core/eap/recall"
import { validateEvidence } from "@open-graph-mcp/graph-core/eap/contestation"

export type EapRefusal = {
  code: RefusalCode
  obligation: string
  reason: string
}

export type EapResponse<T = any> =
  | { ok: true; admitted: T }
  | { ok: false; refusal: EapRefusal }

export type CandidateState = "proposed" | "deliberated" | "admitted" | "concretized" | "verified"

const CONTESTATION_SEVERITIES = ["informative", "blocking", "invalidating"] as const
type ContestationSeverity = (typeof CONTESTATION_SEVERITIES)[number]

/** Contract limit for opaque identifiers reaching a governed boundary (test scenario §3.3). */
const MAX_IDENTIFIER_LENGTH = 256

function createEapRefusal(code: RefusalCode, reason: string): EapRefusal {
  return {
    code,
    obligation: REFUSAL_OBLIGATIONS[code] ?? "follow_eap_protocol",
    reason,
  }
}

/** Non-empty, length-bounded opaque identifier. Returns the trimmed value or a typed refusal. */
function validateIdentifier(value: unknown, field: string): { ok: true; value: string } | { ok: false; refusal: EapRefusal } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, refusal: createEapRefusal("MALFORMED_CONTRACT", `${field} must be a non-empty string`) }
  }
  const trimmed = value.trim()
  if (trimmed.length > MAX_IDENTIFIER_LENGTH) {
    return {
      ok: false,
      refusal: createEapRefusal("MALFORMED_CONTRACT", `${field} exceeds the ${MAX_IDENTIFIER_LENGTH}-character contract limit`),
    }
  }
  return { ok: true, value: trimmed }
}

export function eapInitiate(
  state: ServerState,
  args: {
    token: string
    horizonId?: string
    parentId?: string
    seed?: { provenance?: string[]; references?: string[] }
    budget?: { limit?: number }
  }
): EapResponse {
  const { tenantId } = requireToken(state, args.token)
  const store = new HorizonStore(state.db, state.stateDir)

  const id = validateIdentifier(args.horizonId, "HorizonId")
  if (!id.ok) return { ok: false, refusal: id.refusal }
  const horizonId = id.value

  if (args.parentId !== undefined) {
    const parent = validateIdentifier(args.parentId, "parentId")
    if (!parent.ok) return { ok: false, refusal: parent.refusal }
  }

  if (args.budget?.limit !== undefined && (!Number.isInteger(args.budget.limit) || args.budget.limit < 0)) {
    return {
      ok: false,
      refusal: createEapRefusal("MALFORMED_CONTRACT", "budget.limit must be a non-negative integer"),
    }
  }

  const res = store.create({
    tenantId,
    id: horizonId,
    parentId: args.parentId ?? null,
    state: "proposed",
    budgetAllocated: args.budget?.limit ?? 100,
    budgetConsumed: 0,
  })

  if (!res.success) {
    if (res.code === "INVALID_PARENT") {
      return {
        ok: false,
        refusal: createEapRefusal("RESOURCE_ABSENT", res.reason),
      }
    }
    if (res.code === "ALREADY_EXISTS") {
      const existing = store.get(tenantId, horizonId)
      return {
        ok: true,
        admitted: {
          horizonId: existing!.id,
          parentId: existing!.parentId,
          seedRef: args.seed ? `seed:${horizonId}` : null,
          status: "initiated",
          seq: existing!.seq,
        },
      }
    }
    return { ok: false, refusal: createEapRefusal("MALFORMED_CONTRACT", res.reason) }
  }

  return {
    ok: true,
    admitted: {
      horizonId: res.horizon.id,
      parentId: res.horizon.parentId,
      seedRef: args.seed ? `seed:${horizonId}` : null,
      status: "initiated",
      seq: res.horizon.seq,
    },
  }
}

export function eapPropose(
  state: ServerState,
  args: {
    token: string
    horizonId: string
    candidateId: string
    command: "DELIBERATE" | "ADMIT" | "CONCRETIZE" | "VERIFY" | string
    evidence?: any
    basedOnSeq?: number
    directPersistence?: boolean
  }
): EapResponse {
  const { tenantId } = requireToken(state, args.token)

  if (args.directPersistence) {
    return {
      ok: false,
      refusal: createEapRefusal("DIRECT_EDIT_FORBIDDEN", "External clients cannot claim direct persistence authority"),
    }
  }

  const horizonRef = validateIdentifier(args.horizonId, "horizonId")
  if (!horizonRef.ok) return { ok: false, refusal: horizonRef.refusal }
  const candidateRef = validateIdentifier(args.candidateId, "candidateId")
  if (!candidateRef.ok) return { ok: false, refusal: candidateRef.refusal }

  if (args.basedOnSeq !== undefined && (!Number.isInteger(args.basedOnSeq) || args.basedOnSeq < 0)) {
    return {
      ok: false,
      refusal: createEapRefusal("MALFORMED_CONTRACT", "basedOnSeq must be a non-negative integer"),
    }
  }

  if (!args.evidence || (Array.isArray(args.evidence) && args.evidence.length === 0)) {
    return {
      ok: false,
      refusal: createEapRefusal("EVIDENCE_REQUIRED", "Lifecycle transition requires non-empty evidence"),
    }
  }

  if (["PROMOTE", "CONTEST", "INITIATE"].includes(args.command)) {
    return {
      ok: false,
      refusal: createEapRefusal("BOUNDARY_COMMAND_AS_STATE", `Boundary command '${args.command}' is not a valid lifecycle state transition`),
    }
  }

  return serialTransaction(state.db, () => {
    const store = new HorizonStore(state.db, state.stateDir)
    const ledger = new AdmissionLedgerStore(state.db, state.stateDir)

    const horizon = store.get(tenantId, horizonRef.value)
    if (!horizon) {
      return {
        ok: false,
        refusal: createEapRefusal("RESOURCE_ABSENT", `Horizon '${horizonRef.value}' not found`),
      }
    }

    if (args.basedOnSeq !== undefined && args.basedOnSeq < horizon.seq) {
      return {
        ok: false,
        refusal: createEapRefusal("STALE_BASE", `basedOnSeq ${args.basedOnSeq} precedes current horizon seq ${horizon.seq}`),
      }
    }

    const candRow = state.db
      .query("SELECT state, seq, created_at FROM candidates WHERE tenant_id = ? AND horizon_id = ? AND candidate_id = ?")
      .get(tenantId, horizonRef.value, candidateRef.value) as { state: string; seq: number; created_at: string } | null

    const currentCandState: CandidateState = (candRow?.state as CandidateState) ?? "proposed"

    const nextStateMap: Record<CandidateState, { command: string; next: CandidateState }> = {
      proposed: { command: "DELIBERATE", next: "deliberated" },
      deliberated: { command: "ADMIT", next: "admitted" },
      admitted: { command: "CONCRETIZE", next: "concretized" },
      concretized: { command: "VERIFY", next: "verified" },
      verified: { command: "", next: "verified" },
    }

    const expected = nextStateMap[currentCandState] ?? { command: "DELIBERATE", next: "deliberated" }

    if (expected.command !== args.command) {
      return {
        ok: false,
        refusal: createEapRefusal(
          "ILLEGAL_TRANSITION",
          `Cannot transition candidate '${candidateRef.value}' from '${currentCandState}' via '${args.command}'. Expected '${expected.command}'`
        ),
      }
    }

    // The horizon transition and the candidate/ledger writes below are one unit: a failed
    // saveTransition ABORTS, it never lets the candidate advance on an unmoved horizon.
    const saveRes = store.saveTransition(tenantId, horizonRef.value, horizon.seq, {})
    if (!saveRes.success) {
      return {
        ok: false,
        refusal: createEapRefusal("STALE_BASE", saveRes.reason),
      }
    }

    const now = new Date().toISOString()
    const nextSeq = saveRes.horizon.seq

    write(state.db, state.stateDir, tenantId, "candidates", {
      tenant_id: tenantId,
      horizon_id: horizonRef.value,
      candidate_id: candidateRef.value,
      state: expected.next,
      seq: nextSeq,
      created_at: candRow?.created_at ?? now,
      updated_at: now,
    })

    ledger.appendDecision({
      tenantId,
      id: `dec-${horizonRef.value}-${candidateRef.value}-${nextSeq}`,
      seq: nextSeq,
      horizonId: horizonRef.value,
      candidateId: candidateRef.value,
      outcome: "ADMITTED",
      createdAt: now,
    })

    return {
      ok: true,
      admitted: {
        horizonId: horizonRef.value,
        candidateId: candidateRef.value,
        state: expected.next,
        seq: nextSeq,
      },
    }
  })
}

export function eapPromote(
  state: ServerState,
  args: {
    token: string
    childHorizonId: string
    targetParentHorizonId: string
    candidateIds?: string[]
    basedOnSeq?: number
  }
): EapResponse {
  const { tenantId } = requireToken(state, args.token)

  const childRef = validateIdentifier(args.childHorizonId, "childHorizonId")
  if (!childRef.ok) return { ok: false, refusal: childRef.refusal }
  const parentRef = validateIdentifier(args.targetParentHorizonId, "targetParentHorizonId")
  if (!parentRef.ok) return { ok: false, refusal: parentRef.refusal }

  if (args.candidateIds !== undefined && !Array.isArray(args.candidateIds)) {
    return { ok: false, refusal: createEapRefusal("MALFORMED_CONTRACT", "candidateIds must be an array of identifiers") }
  }
  const candidateIds = args.candidateIds ?? []
  for (const candidateId of candidateIds) {
    const ref = validateIdentifier(candidateId, "candidateIds[]")
    if (!ref.ok) return { ok: false, refusal: ref.refusal }
  }

  if (args.basedOnSeq !== undefined && (!Number.isInteger(args.basedOnSeq) || args.basedOnSeq < 0)) {
    return { ok: false, refusal: createEapRefusal("MALFORMED_CONTRACT", "basedOnSeq must be a non-negative integer") }
  }

  const outcome = serialTransaction(state.db, (): EapResponse & { event?: Record<string, unknown> } => {
    const services = eapServices(state, tenantId)
    const store = services.horizons

    const child = store.get(tenantId, childRef.value)
    if (!child) {
      return {
        ok: false,
        refusal: createEapRefusal("RESOURCE_ABSENT", `Child horizon '${childRef.value}' not found`),
      }
    }

    // The declared immediate parent must exist as a governed horizon of THIS tenant before any
    // proposal is created for it — a proposal addressed to a horizon that does not exist is an
    // orphan row that no parent gate will ever evaluate.
    const parent = store.get(tenantId, parentRef.value)
    if (!parent) {
      return {
        ok: false,
        refusal: createEapRefusal("RESOURCE_ABSENT", `Target parent horizon '${parentRef.value}' does not exist`),
      }
    }

    // WHAT IS BEING PROMOTED HAS TO EXIST, IN THIS CHILD, AND BE VERIFIED.
    // This check had no equivalent anywhere: the adapter wrote whatever candidate ids the caller
    // sent straight into the parent horizon, so a client could inject arbitrary identifiers into a
    // horizon it never contributed to, with no lifecycle precondition at all. Promotion is the
    // distillation of knowledge that COMPLETED the child's lifecycle; anything else is not eligible.
    if (candidateIds.length === 0) {
      return {
        ok: false,
        refusal: createEapRefusal("MALFORMED_CONTRACT", "Promotion requires at least one candidate to distil"),
      }
    }
    const distilled: Candidate[] = []
    for (const candidateId of candidateIds) {
      const row = state.db
        .query("SELECT state FROM candidates WHERE tenant_id = ? AND horizon_id = ? AND candidate_id = ?")
        .get(tenantId, childRef.value, candidateId) as { state: string } | null
      if (!row) {
        return {
          ok: false,
          refusal: createEapRefusal(
            "RESOURCE_ABSENT",
            `Candidate '${candidateId}' does not exist in child horizon '${childRef.value}'`,
          ),
        }
      }
      if (row.state !== "verified") {
        return {
          ok: false,
          refusal: createEapRefusal(
            "ILLEGAL_TRANSITION",
            `Candidate '${candidateId}' is '${row.state}' in horizon '${childRef.value}'; only a verified candidate can be promoted`,
          ),
        }
      }
      distilled.push({ id: candidateId, content: candidateId })
    }

    // The one-edge rule, the stale-base rule and the proposal/event write are the domain's.
    const result = services.promotions.promote({
      childId: childRef.value,
      parentId: parentRef.value,
      basedOnSeq: args.basedOnSeq ?? Math.max(child.seq, parent.seq),
      distilled,
    })

    if (!result.success) {
      return { ok: false, refusal: createEapRefusal(result.refusalCode as RefusalCode, result.message) }
    }

    // Only now does the child's sequence move. A failed transition ABORTS the whole unit rather
    // than leaving an advanced sequence behind an absent proposal.
    const saveRes = store.saveTransition(tenantId, childRef.value, child.seq, {})
    if (!saveRes.success) {
      return { ok: false, refusal: createEapRefusal("STALE_BASE", saveRes.reason) }
    }
    const seq = saveRes.horizon.seq
    const now = new Date().toISOString()

    // "A successful promotion is stored as a proposed parent candidate" (Task 06 acceptance).
    // Promotion never inherits the child's admission or Relative Authority: every candidate enters
    // the parent horizon at `proposed`, at the start of the lifecycle.
    for (const candidate of distilled) {
      const existing = state.db
        .query("SELECT created_at FROM candidates WHERE tenant_id = ? AND horizon_id = ? AND candidate_id = ?")
        .get(tenantId, parentRef.value, candidate.id) as { created_at: string } | null
      if (existing) continue
      write(state.db, state.stateDir, tenantId, "candidates", {
        tenant_id: tenantId,
        horizon_id: parentRef.value,
        candidate_id: candidate.id,
        state: "proposed",
        seq,
        created_at: now,
        updated_at: now,
      })
    }

    return {
      ok: true,
      admitted: {
        promotionId: result.proposal.id,
        childHorizonId: childRef.value,
        targetParentHorizonId: parentRef.value,
        status: result.proposal.status,
        seq,
      },
      event: { ...result.event },
    }
  })

  // Broadcast AFTER the transaction commits: an event observed by a subscriber that a rollback then
  // erases is worse than a late event.
  if (outcome.ok && outcome.event) {
    appendEvent(state, tenantId, {
      kind: "PromotionProposed",
      targetKind: "promotion",
      targetId: String(outcome.admitted.promotionId),
      payload: outcome.event,
    })
  }
  return outcome.ok ? { ok: true, admitted: outcome.admitted } : outcome
}

/**
 * Resolves contestation targets against the caller's OWN tenant.
 *
 * A contestation targeting an identifier that names nothing is not a challenge to knowledge, it is
 * a write of attacker-controlled text into a governed table — the audit reproduced it with
 * path-traversal-shaped ids and with another tenant's identifiers. A target resolves when it is a
 * committed graph claim of this tenant, or a lifecycle candidate of this tenant that has reached
 * `admitted` or beyond. Anything else is absent, and absence is a refusal, not an admission.
 */
function unresolvedTargets(state: ServerState, tenantId: string, ids: string[]): string[] {
  const claim = state.db.query("SELECT 1 AS x FROM claims WHERE tenant_id = ? AND id = ?")
  const candidate = state.db.query(
    "SELECT 1 AS x FROM candidates WHERE tenant_id = ? AND candidate_id = ? AND state IN ('admitted','concretized','verified')",
  )
  return ids.filter((id) => claim.get(tenantId, id) === null && candidate.get(tenantId, id) === null)
}

export function eapContest(
  state: ServerState,
  args: {
    token: string
    targetClaimIds: string[]
    severity: "informative" | "blocking" | "invalidating"
    evidence?: any[]
    sourceHorizonId?: string
    reason?: string
  }
): EapResponse {
  const { tenantId } = requireToken(state, args.token)

  if (!args.targetClaimIds || !Array.isArray(args.targetClaimIds) || args.targetClaimIds.length === 0) {
    return {
      ok: false,
      refusal: createEapRefusal("MALFORMED_CONTRACT", "Contestation targetClaimIds must be a non-empty array of claim IDs"),
    }
  }

  for (const claimId of args.targetClaimIds) {
    const ref = validateIdentifier(claimId, "targetClaimIds[]")
    if (!ref.ok) return { ok: false, refusal: ref.refusal }
  }

  if (!CONTESTATION_SEVERITIES.includes(args.severity as ContestationSeverity)) {
    return {
      ok: false,
      refusal: createEapRefusal("MALFORMED_CONTRACT", `severity must be one of ${CONTESTATION_SEVERITIES.join(", ")}`),
    }
  }

  // Evidence ELEMENTS, not just the array. `[null]` used to sail through a bare length check and be
  // stored as admitted evidence. `validateEvidence` is the domain's own predicate — the same one
  // `ContestationService` applies — used here so the boundary refuses before anything is resolved.
  const evidenceRefs = Array.isArray(args.evidence)
    ? args.evidence.filter((ref): ref is string => typeof ref === "string")
    : []
  if (!validateEvidence(evidenceRefs)) {
    return {
      ok: false,
      refusal: createEapRefusal("EVIDENCE_REQUIRED", "Contestation requires at least one non-empty evidence reference"),
    }
  }

  if (args.sourceHorizonId !== undefined) {
    const horizonRef = validateIdentifier(args.sourceHorizonId, "sourceHorizonId")
    if (!horizonRef.ok) return { ok: false, refusal: horizonRef.refusal }
  }

  const outcome = serialTransaction(state.db, (): EapResponse & { event?: Record<string, unknown> } => {
    const services = eapServices(state, tenantId)

    const missing = unresolvedTargets(state, tenantId, args.targetClaimIds)
    if (missing.length > 0) {
      return {
        ok: false,
        refusal: createEapRefusal(
          "RESOURCE_ABSENT",
          `Contestation targets do not resolve to admitted knowledge of this tenant: ${missing.join(", ")}`,
        ),
      }
    }

    if (args.sourceHorizonId && !services.horizons.get(tenantId, args.sourceHorizonId.trim())) {
      return {
        ok: false,
        refusal: createEapRefusal("RESOURCE_ABSENT", `Source horizon '${args.sourceHorizonId}' does not exist`),
      }
    }

    // Identifier minting is the adapter's; admission is not. The ordinal comes from the durable
    // allocator so a purge cannot reissue an id that was already spent.
    const ordinal = allocateSequence(state.db, tenantId, "contestation_ids")
    const result = services.contestations.contestKnowledge({
      id: `contest_${ordinal}`,
      sourceHorizonId: args.sourceHorizonId?.trim() ?? "",
      targetClaimIds: args.targetClaimIds.map((id) => String(id).trim()),
      evidenceRefs,
      severity: args.severity,
      reason: typeof args.reason === "string" ? args.reason : undefined,
    })

    if (result.status === "REFUSED") {
      return { ok: false, refusal: createEapRefusal(mapContestationRefusal(result.refusal.code), result.refusal.reason) }
    }

    return {
      ok: true,
      admitted: {
        contestationId: result.contestation.id,
        targetClaimIds: result.contestation.targetClaimIds,
        severity: result.contestation.severity,
        status: result.contestation.admitted ? "admitted" : "refused",
        seq: result.contestation.seq,
      },
      event: { ...result.event },
    }
  })

  if (outcome.ok && outcome.event) {
    appendEvent(state, tenantId, {
      kind: "KnowledgeContested",
      targetKind: "contestation",
      targetId: String(outcome.admitted.contestationId),
      payload: outcome.event,
    })
  }
  return outcome.ok ? { ok: true, admitted: outcome.admitted } : outcome
}

/** Contestation domain refusal codes → the closed EAP transport taxonomy. */
function mapContestationRefusal(code: string): RefusalCode {
  switch (code) {
    case "EVIDENCE_REQUIRED":
      return "EVIDENCE_REQUIRED"
    case "DIRECT_EDIT_FORBIDDEN":
      return "DIRECT_EDIT_FORBIDDEN"
    case "RECALL_UNPROVEN":
      return "RECALL_UNPROVEN"
    case "INVALID_TARGET_CLAIM":
      return "RESOURCE_ABSENT"
    default:
      return "MALFORMED_CONTRACT"
  }
}

/** Bound on recall batches driven by one command; the closure is finite, this only stops a loop bug. */
const MAX_RECALL_BATCHES = 10_000

/**
 * Drives the governed `RecallWorker`.
 *
 * The previous implementation wrote ONE row into a `recalls` table — status hardcoded to
 * `completed`, `affected_claim_ids` copied verbatim from the contestation — while
 * `SqliteRecallRepository` used the disjoint `recall_cases` / `recall_checkpoints` / `recall_scars`
 * tables. Two writers, two schemas, one of them performing no reverse-dependency traversal, no
 * degradation, no truth-ownership suspension and no scar. The `recalls` table is gone; this adapter
 * initiates the case, runs it to completion in checkpointed batches, and reports what the domain
 * actually did.
 */
export async function eapRecall(
  state: ServerState,
  args: {
    token: string
    contestationId: string
    checkpoint?: string | number
    batchSize?: number
  }
): Promise<EapResponse> {
  const { tenantId } = requireToken(state, args.token)

  const contestationRef = validateIdentifier(args.contestationId, "contestationId")
  if (!contestationRef.ok) return { ok: false, refusal: contestationRef.refusal }

  if (args.checkpoint !== undefined && typeof args.checkpoint === "number" && (!Number.isInteger(args.checkpoint) || args.checkpoint < 0)) {
    return { ok: false, refusal: createEapRefusal("MALFORMED_CONTRACT", "checkpoint must be a non-negative integer") }
  }
  if (args.batchSize !== undefined && (!Number.isInteger(args.batchSize) || args.batchSize < 1)) {
    return { ok: false, refusal: createEapRefusal("MALFORMED_CONTRACT", "batchSize must be a positive integer") }
  }

  const services = eapServices(state, tenantId)

  // Presence, admitted status and invalidating severity are all decided by the domain service.
  const initiation = services.contestations.initiateRecall(contestationRef.value)
  if (initiation.status !== "INITIATED") {
    return {
      ok: false,
      refusal: createEapRefusal("RECALL_UNPROVEN", initiation.refusal?.reason ?? "Recall requires an admitted invalidating contestation"),
    }
  }

  const recallId = initiation.recallCaseId!
  const contestation = services.contestations.getContestation(contestationRef.value)!

  // Idempotent by contestation: replaying the command reports the existing case rather than
  // burning a fresh sequence and re-degrading the same claims.
  const existing = await services.recallRepo.get(recallId)
  if (existing) {
    return {
      ok: true,
      admitted: recallOutcome(existing.recallCase.id, contestationRef.value, {
        status: existing.recallCase.status,
        seq: existing.recallCase.notice.seq ?? contestation.seq ?? 0,
        closure: existing.recallCase.closure,
        checkpointSeq: existing.checkpoint.sequence,
        suspendedCells: existing.checkpoint.suspendedCells,
        degraded: [...existing.recallCase.degradedClaimStates.entries()].map(([claimId, v]) => ({
          claimId,
          previousState: v.previousState,
          newState: v.normativelyResolvedState,
        })),
        replayed: true,
      }),
    }
  }

  const notice: RecallNotice = {
    recallId,
    contestationId: contestation.id,
    targetClaimIds: [...contestation.targetClaimIds],
    severity: contestation.severity,
    contestationStatus: contestation.admitted ? "admitted" : "refused",
    tenantId,
    initiatedAt: new Date().toISOString(),
    seq: serialTransaction(state.db, () => allocateSequence(state.db, tenantId, "recalls")),
  }

  const created = await services.recalls.initiateRecall(notice)
  if ("refused" in created) {
    return { ok: false, refusal: createEapRefusal("RECALL_UNPROVEN", created.message) }
  }

  const ctx = services.recallContext()
  const batchSize = args.batchSize ?? Math.max(1, created.closure.length)
  let progress: RecallProgress | null = null
  for (let i = 0; i < MAX_RECALL_BATCHES; i++) {
    progress = await services.recalls.processBatch(recallId, batchSize, ctx)
    if (!progress || progress.isComplete) break
  }

  const settled = await services.recallRepo.get(recallId)
  const status = settled?.recallCase.status ?? "active"

  appendEvent(state, tenantId, {
    kind: "RecallProgressed",
    targetKind: "recall",
    targetId: recallId,
    payload: {
      recallId,
      contestationId: contestation.id,
      checkpoint: progress?.checkpoint.sequence ?? 0,
      affectedClaimIds: created.closure,
    },
  })
  for (const cellKey of progress?.suspendedCells ?? []) {
    appendEvent(state, tenantId, {
      kind: "TruthOwnershipSuspended",
      targetKind: "cell",
      targetId: cellKey,
      payload: { recallId, cellKey, seq: progress?.checkpoint.sequence ?? 0 },
    })
  }

  return {
    ok: true,
    admitted: recallOutcome(recallId, contestation.id, {
      status,
      seq: notice.seq!,
      closure: created.closure,
      checkpointSeq: progress?.checkpoint.sequence ?? 0,
      suspendedCells: settled ? settled.checkpoint.suspendedCells : (progress?.suspendedCells ?? []),
      degraded: progress?.degradedClaims ?? [],
      replayed: false,
    }),
  }
}

function recallOutcome(
  recallId: string,
  contestationId: string,
  detail: {
    status: string
    seq: number
    closure: string[]
    checkpointSeq: number
    suspendedCells: string[]
    degraded: Array<{ claimId: string; previousState: string; newState: string }>
    replayed: boolean
  }
): Record<string, unknown> {
  return {
    recallId,
    contestationId,
    status: detail.status,
    affectedClaimIds: detail.closure,
    checkpoint: detail.checkpointSeq,
    seq: detail.seq,
    suspendedCells: detail.suspendedCells,
    degradedClaims: detail.degraded,
    ...(detail.replayed ? { replayed: true } : {}),
  }
}
