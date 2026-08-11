/**
 * eap.ts — Epistemic Admission Protocol (EAP) MCP Tool Adapters.
 * Closed refusal taxonomy compliant & per-candidate SQLite persistent state.
 */
import { requireToken } from "./session"
import type { ServerState } from "../state"
import { HorizonStore, AdmissionLedgerStore } from "../eap/horizon-store"
import { durableTransaction, write } from "../db"
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

function createEapRefusal(code: RefusalCode, reason: string): EapRefusal {
  return {
    code,
    obligation: REFUSAL_OBLIGATIONS[code] ?? "follow_eap_protocol",
    reason,
  }
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

  if (!args.horizonId || typeof args.horizonId !== "string" || args.horizonId.trim().length === 0) {
    return {
      ok: false,
      refusal: createEapRefusal("MALFORMED_CONTRACT", "HorizonId must be a non-empty string"),
    }
  }

  const horizonId = args.horizonId.trim()

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

  return durableTransaction(state.db, () => {
    const store = new HorizonStore(state.db, state.stateDir)
    const ledger = new AdmissionLedgerStore(state.db, state.stateDir)

    const horizon = store.get(tenantId, args.horizonId)
    if (!horizon) {
      return {
        ok: false,
        refusal: createEapRefusal("RESOURCE_ABSENT", `Horizon '${args.horizonId}' not found`),
      }
    }

    if (args.basedOnSeq !== undefined && args.basedOnSeq < horizon.seq) {
      return {
        ok: false,
        refusal: createEapRefusal("STALE_BASE", `basedOnSeq ${args.basedOnSeq} precedes current horizon seq ${horizon.seq}`),
      }
    }

    const candRow = state.db
      .query("SELECT state, seq FROM candidates WHERE tenant_id = ? AND horizon_id = ? AND candidate_id = ?")
      .get(tenantId, args.horizonId, args.candidateId) as { state: string; seq: number } | null

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
          `Cannot transition candidate '${args.candidateId}' from '${currentCandState}' via '${args.command}'. Expected '${expected.command}'`
        ),
      }
    }

    const saveRes = store.saveTransition(tenantId, args.horizonId, horizon.seq, {})
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
      horizon_id: args.horizonId,
      candidate_id: args.candidateId,
      state: expected.next,
      seq: nextSeq,
      created_at: now,
      updated_at: now,
    })

    ledger.appendDecision({
      tenantId,
      id: `dec-${args.horizonId}-${args.candidateId}-${nextSeq}`,
      seq: nextSeq,
      horizonId: args.horizonId,
      candidateId: args.candidateId,
      outcome: "ADMITTED",
      createdAt: now,
    })

    return {
      ok: true,
      admitted: {
        horizonId: args.horizonId,
        candidateId: args.candidateId,
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

  return durableTransaction(state.db, () => {
    const store = new HorizonStore(state.db, state.stateDir)

    const child = store.get(tenantId, args.childHorizonId)
    if (!child) {
      return {
        ok: false,
        refusal: createEapRefusal("RESOURCE_ABSENT", `Child horizon '${args.childHorizonId}' not found`),
      }
    }

    const parent = store.get(tenantId, args.targetParentHorizonId)
    if (!parent) {
      return {
        ok: false,
        refusal: createEapRefusal("RESOURCE_ABSENT", `Target parent horizon '${args.targetParentHorizonId}' does not exist`),
      }
    }

    if (child.parentId !== args.targetParentHorizonId) {
      return {
        ok: false,
        refusal: createEapRefusal("HORIZON_SKIP", `Target horizon '${args.targetParentHorizonId}' is not the immediate parent of '${args.childHorizonId}'`),
      }
    }

    if (args.basedOnSeq !== undefined && args.basedOnSeq < child.seq) {
      return {
        ok: false,
        refusal: createEapRefusal("STALE_BASE", `basedOnSeq ${args.basedOnSeq} precedes child horizon seq ${child.seq}`),
      }
    }

    const saveRes = store.saveTransition(tenantId, args.childHorizonId, child.seq, {})
    if (!saveRes.success) {
      return {
        ok: false,
        refusal: createEapRefusal("STALE_BASE", saveRes.reason),
      }
    }

    const seq = saveRes.horizon.seq
    const promotionId = `prom_${args.childHorizonId}_to_${args.targetParentHorizonId}_${seq}`
    const now = new Date().toISOString()

    write(state.db, state.stateDir, tenantId, "proposals", {
      tenant_id: tenantId,
      id: promotionId,
      parent_id: args.targetParentHorizonId,
      child_id: args.childHorizonId,
      candidates: JSON.stringify(args.candidateIds ?? []),
      status: "proposed",
      based_on_seq: child.seq,
      created_at: now,
    })

    return {
      ok: true,
      admitted: {
        promotionId,
        childHorizonId: args.childHorizonId,
        targetParentHorizonId: args.targetParentHorizonId,
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

  if (!args.evidence || !Array.isArray(args.evidence) || args.evidence.length === 0) {
    return {
      ok: false,
      refusal: createEapRefusal("EVIDENCE_REQUIRED", "Contestation requires at least one non-empty evidence reference"),
    }
  }

  return durableTransaction(state.db, () => {
    const maxRow = state.db
      .query("SELECT COALESCE(MAX(seq), 0) AS m FROM contestations WHERE tenant_id = ?")
      .get(tenantId) as { m: number }
    const seq = maxRow.m + 1

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

  return durableTransaction(state.db, () => {
    const row = state.db
      .query("SELECT * FROM contestations WHERE tenant_id = ? AND id = ?")
      .get(tenantId, args.contestationId) as any

    if (!row || row.status !== "admitted" || row.severity !== "invalidating") {
      return {
        ok: false,
        refusal: createEapRefusal("RECALL_UNPROVEN", `Contestation '${args.contestationId}' is missing, not admitted, or not of severity 'invalidating'`),
      }
    }

    const maxRecallRow = state.db
      .query("SELECT COALESCE(MAX(seq), 0) AS m FROM recalls WHERE tenant_id = ?")
      .get(tenantId) as { m: number }
    const seq = maxRecallRow.m + 1

    const recallId = `recall_${args.contestationId}`
    const targetClaimIds = JSON.parse(row.target_claim_ids)
    const now = new Date().toISOString()
    const checkpointNum = typeof args.checkpoint === "number" ? args.checkpoint : 1

    write(state.db, state.stateDir, tenantId, "recalls", {
      tenant_id: tenantId,
      id: recallId,
      seq,
      contestation_id: args.contestationId,
      status: "completed",
      affected_claim_ids: JSON.stringify(targetClaimIds),
      checkpoint: checkpointNum,
      created_at: now,
    })

    return {
      ok: true,
      admitted: {
        recallId,
        contestationId: args.contestationId,
        status: "completed",
        affectedClaimIds: targetClaimIds,
        checkpoint: checkpointNum,
        seq,
      },
    }
  })
}
