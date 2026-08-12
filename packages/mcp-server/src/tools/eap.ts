/**
 * eap.ts — Epistemic Admission Protocol (EAP) MCP Tool Adapters.
 *
 * Closed refusal taxonomy compliant, per-candidate SQLite persistent state.
 *
 * Retry#5 / REWORK-LOG defect 3 (concurrency and sequence races). Every adapter below used to open
 * a DEFERRED transaction and compute its sequence with `SELECT COALESCE(MAX(seq),0) + 1`. That is a
 * read-decide-write over an unlocked snapshot: two concurrent calls read the same maximum and emit
 * the same sequence, and a purge of the highest row silently reissues a sequence already spent.
 * All five adapters now run inside `serialTransaction` (BEGIN IMMEDIATE) and take their sequence
 * from the durable atomic allocator, so allocation and the write that consumes it commit as one
 * indivisible unit — or not at all.
 */
import { requireToken } from "./session"
import type { ServerState } from "../state"
import { HorizonStore, AdmissionLedgerStore } from "../eap/horizon-store"
import { allocateSequence, serialTransaction, write } from "../db"
import { REFUSAL_OBLIGATIONS, type RefusalCode } from "@open-graph-mcp/graph-core/eap/refusals"

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

  return serialTransaction(state.db, () => {
    const store = new HorizonStore(state.db, state.stateDir)

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

    if (child.parentId !== parentRef.value) {
      return {
        ok: false,
        refusal: createEapRefusal("HORIZON_SKIP", `Target horizon '${parentRef.value}' is not the immediate parent of '${childRef.value}'`),
      }
    }

    if (args.basedOnSeq !== undefined && args.basedOnSeq < child.seq) {
      return {
        ok: false,
        refusal: createEapRefusal("STALE_BASE", `basedOnSeq ${args.basedOnSeq} precedes child horizon seq ${child.seq}`),
      }
    }

    const saveRes = store.saveTransition(tenantId, childRef.value, child.seq, {})
    if (!saveRes.success) {
      // Abort rather than advance: previously the sequence was forced forward regardless.
      return {
        ok: false,
        refusal: createEapRefusal("STALE_BASE", saveRes.reason),
      }
    }

    const seq = saveRes.horizon.seq
    const promotionOrdinal = allocateSequence(state.db, tenantId, "promotions")
    const promotionId = `prom_${childRef.value}_to_${parentRef.value}_${promotionOrdinal}`
    const now = new Date().toISOString()

    write(state.db, state.stateDir, tenantId, "proposals", {
      tenant_id: tenantId,
      id: promotionId,
      parent_id: parentRef.value,
      child_id: childRef.value,
      candidates: JSON.stringify(candidateIds),
      status: "proposed",
      based_on_seq: child.seq,
      created_at: now,
    })

    // "A successful promotion is stored as a proposed parent candidate" (Task 06 acceptance).
    // The proposal row alone is a promotion record; the parent's admission gate reads candidates.
    // Promotion never inherits the child's admission or Relative Authority: every candidate enters
    // the parent horizon at `proposed`, at the start of the lifecycle.
    for (const candidateId of candidateIds) {
      const existing = state.db
        .query("SELECT created_at FROM candidates WHERE tenant_id = ? AND horizon_id = ? AND candidate_id = ?")
        .get(tenantId, parentRef.value, candidateId) as { created_at: string } | null
      if (existing) continue
      write(state.db, state.stateDir, tenantId, "candidates", {
        tenant_id: tenantId,
        horizon_id: parentRef.value,
        candidate_id: candidateId,
        state: "proposed",
        seq,
        created_at: now,
        updated_at: now,
      })
    }

    return {
      ok: true,
      admitted: {
        promotionId,
        childHorizonId: childRef.value,
        targetParentHorizonId: parentRef.value,
        status: "proposed",
        seq,
      },
    }
  })
}

export function eapContest(
  state: ServerState,
  args: {
    token: string
    targetClaimIds: string[]
    severity: "informative" | "blocking" | "invalidating"
    evidence?: any[]
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

  if (!args.evidence || !Array.isArray(args.evidence) || args.evidence.length === 0) {
    return {
      ok: false,
      refusal: createEapRefusal("EVIDENCE_REQUIRED", "Contestation requires at least one non-empty evidence reference"),
    }
  }

  return serialTransaction(state.db, () => {
    const seq = allocateSequence(state.db, tenantId, "contestations")
    const contestationId = `contest_${seq}`
    const now = new Date().toISOString()

    write(state.db, state.stateDir, tenantId, "contestations", {
      tenant_id: tenantId,
      id: contestationId,
      seq,
      target_claim_ids: JSON.stringify(args.targetClaimIds),
      severity: args.severity,
      evidence: JSON.stringify(args.evidence),
      status: "admitted",
      created_at: now,
      source_horizon_id: null,
      reason: null,
    })

    return {
      ok: true,
      admitted: {
        contestationId,
        targetClaimIds: args.targetClaimIds,
        severity: args.severity,
        status: "admitted",
        seq,
      },
    }
  })
}

export function eapRecall(
  state: ServerState,
  args: {
    token: string
    contestationId: string
    checkpoint?: string | number
  }
): EapResponse {
  const { tenantId } = requireToken(state, args.token)

  const contestationRef = validateIdentifier(args.contestationId, "contestationId")
  if (!contestationRef.ok) return { ok: false, refusal: contestationRef.refusal }

  if (args.checkpoint !== undefined && typeof args.checkpoint === "number" && (!Number.isInteger(args.checkpoint) || args.checkpoint < 0)) {
    return { ok: false, refusal: createEapRefusal("MALFORMED_CONTRACT", "checkpoint must be a non-negative integer") }
  }

  return serialTransaction(state.db, () => {
    const row = state.db
      .query("SELECT id, seq, target_claim_ids, severity, status FROM contestations WHERE tenant_id = ? AND id = ?")
      .get(tenantId, contestationRef.value) as
      | { id: string; seq: number; target_claim_ids: string; severity: string; status: string }
      | null

    // Recall may begin ONLY from a contestation that is present, admitted, and invalidating. Each
    // of the three is checked explicitly; `status` in particular is what separates an admitted
    // challenge from one the gate refused.
    if (!row) {
      return {
        ok: false,
        refusal: createEapRefusal("RECALL_UNPROVEN", `Contestation '${contestationRef.value}' does not exist`),
      }
    }
    if (row.status !== "admitted") {
      return {
        ok: false,
        refusal: createEapRefusal(
          "RECALL_UNPROVEN",
          `Contestation '${contestationRef.value}' has status '${row.status}'; only an admitted contestation can initiate recall`
        ),
      }
    }
    if (row.severity !== "invalidating") {
      return {
        ok: false,
        refusal: createEapRefusal(
          "RECALL_UNPROVEN",
          `Contestation '${contestationRef.value}' has severity '${row.severity}'; recall requires 'invalidating'`
        ),
      }
    }

    const recallId = `recall_${contestationRef.value}`
    const existing = state.db
      .query("SELECT id, seq, status, affected_claim_ids, checkpoint FROM recalls WHERE tenant_id = ? AND id = ?")
      .get(tenantId, recallId) as
      | { id: string; seq: number; status: string; affected_claim_ids: string; checkpoint: number }
      | null

    // Recall is idempotent by contestation: replaying the command returns the existing case rather
    // than burning a fresh sequence and re-degrading the same claims.
    if (existing) {
      return {
        ok: true,
        admitted: {
          recallId: existing.id,
          contestationId: contestationRef.value,
          status: existing.status,
          affectedClaimIds: JSON.parse(existing.affected_claim_ids),
          checkpoint: existing.checkpoint,
          seq: existing.seq,
          replayed: true,
        },
      }
    }

    const seq = allocateSequence(state.db, tenantId, "recalls")
    const targetClaimIds = JSON.parse(row.target_claim_ids)
    const now = new Date().toISOString()
    const checkpointNum = typeof args.checkpoint === "number" ? args.checkpoint : 1

    write(state.db, state.stateDir, tenantId, "recalls", {
      tenant_id: tenantId,
      id: recallId,
      seq,
      contestation_id: contestationRef.value,
      status: "completed",
      affected_claim_ids: JSON.stringify(targetClaimIds),
      checkpoint: checkpointNum,
      created_at: now,
    })

    return {
      ok: true,
      admitted: {
        recallId,
        contestationId: contestationRef.value,
        status: "completed",
        affectedClaimIds: targetClaimIds,
        checkpoint: checkpointNum,
        seq,
      },
    }
  })
}
