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
import { StoredStateCorruptionError, type SqliteRecallRepository } from "../eap/eap-repositories"
import { findRecallClosureMembership, findRecallClosureMemberships } from "../eap/recall-closure"

export type EapRefusal = {
  code: RefusalCode
  obligation: string
  reason: string
}

export type EapResponse<T = any> =
  | { ok: true; admitted: T }
  | { ok: false; refusal: EapRefusal }

/**
 * `recalled` is a TERMINAL lifecycle state written by the recall projection, never by a client
 * command: a claim invalidated by an admitted invalidating contestation has no next transition.
 * Without it in this union the fallback below would treat a recalled candidate as `proposed` and
 * happily re-admit it (QA: invalidated knowledge kept climbing the lifecycle).
 */
export const CANDIDATE_STATES = ["proposed", "deliberated", "admitted", "concretized", "verified", "recalled"] as const
export type CandidateState = (typeof CANDIDATE_STATES)[number]

const CONTESTATION_SEVERITIES = ["informative", "blocking", "invalidating"] as const
type ContestationSeverity = (typeof CONTESTATION_SEVERITIES)[number]

/** Contract limit for opaque identifiers reaching a governed boundary (test scenario §3.3). */
const MAX_IDENTIFIER_LENGTH = 256

/**
 * Upper bound for a caller-supplied sequence (test scenario §3.3, "oversized or out-of-range
 * contract values" — enforced for strings via MAX_IDENTIFIER_LENGTH, and now for numbers too).
 *
 * `Number.isInteger(1e308)` is TRUE, so the only validation this gate used to have admitted a value
 * no sequence allocator can ever reach, and the optimistic-concurrency check that compared against
 * it was bypassed unconditionally and forever (validation audit, VALIDATION_BYPASS). Beyond
 * MAX_SAFE_INTEGER integer arithmetic is not exact either, so a sequence outside it is not a
 * sequence.
 */
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER

/**
 * A caller-supplied `basedOnSeq`: a non-negative safe integer, or a typed refusal.
 *
 * Callers state the sequence they observed. The gate is EQUALITY with the sequence the host
 * actually holds, not `<`: a request declaring a base BEHIND the horizon is stale (someone else
 * advanced it), and a request declaring a base AHEAD of it is based on a state this host never
 * produced. Both must rebase; neither is fresh.
 */
function validateBasedOnSeq(value: unknown): { ok: true } | { ok: false; refusal: EapRefusal } {
  if (value === undefined) return { ok: true }
  // `Number.isSafeInteger(-0)` is true and `-0 < 0` is false, so `-0` used to be admitted as a
  // sequence. No allocator produces it and no canonical JSON round trip preserves it.
  if (typeof value !== "number" || Object.is(value, -0) || !Number.isSafeInteger(value) || value < 0 || value > MAX_SEQUENCE) {
    return {
      ok: false,
      refusal: createEapRefusal(
        "MALFORMED_CONTRACT",
        `basedOnSeq must be a non-negative integer no greater than ${MAX_SEQUENCE}`,
      ),
    }
  }
  return { ok: true }
}

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

function eapProposeGoverned(
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

  const proposeBase = validateBasedOnSeq(args.basedOnSeq)
  if (!proposeBase.ok) return { ok: false, refusal: proposeBase.refusal }

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

    if (args.basedOnSeq !== undefined && args.basedOnSeq !== horizon.seq) {
      return {
        ok: false,
        refusal: createEapRefusal(
          "STALE_BASE",
          `basedOnSeq ${args.basedOnSeq} does not match current horizon seq ${horizon.seq}`,
        ),
      }
    }

    const candRow = state.db
      .query("SELECT state, seq, created_at FROM candidates WHERE tenant_id = ? AND horizon_id = ? AND candidate_id = ?")
      .get(tenantId, horizonRef.value, candidateRef.value) as { state: string; seq: number; created_at: string } | null

    // FAIL CLOSED ON AN UNRECOGNIZED STATE.
    // The fallback below used to be `nextStateMap[state] ?? { command: 'DELIBERATE', next:
    // 'deliberated' }`, so ANY value outside the union — a directly corrupted column, or a
    // `rebuildFromJsonl` replay of a mirror written by a future or foreign schema version — was
    // silently read as the START of the lifecycle and rewritten to `deliberated` (QA reproduced it
    // with 'weird-state'). A lifecycle gate does not get to guess.
    if (candRow !== null && !CANDIDATE_STATES.includes(candRow.state as CandidateState)) {
      return {
        ok: false,
        refusal: createEapRefusal(
          "ILLEGAL_TRANSITION",
          `Candidate '${candidateRef.value}' holds unrecognized lifecycle state '${candRow.state}'; no transition can be derived from a state outside the epistemic lifecycle`,
        ),
      }
    }
    const currentCandState: CandidateState = (candRow?.state as CandidateState) ?? "proposed"

    const nextStateMap: Record<CandidateState, { command: string; next: CandidateState }> = {
      proposed: { command: "DELIBERATE", next: "deliberated" },
      deliberated: { command: "ADMIT", next: "admitted" },
      admitted: { command: "CONCRETIZE", next: "concretized" },
      concretized: { command: "VERIFY", next: "verified" },
      verified: { command: "", next: "verified" },
      recalled: { command: "", next: "recalled" },
    }

    const expected = nextStateMap[currentCandState]

    if (currentCandState === "recalled") {
      return {
        ok: false,
        refusal: createEapRefusal(
          "ILLEGAL_TRANSITION",
          `Candidate '${candidateRef.value}' was recalled by an admitted invalidating contestation; recalled knowledge has no lifecycle successor`,
        ),
      }
    }

    if (expected.command !== args.command) {
      return {
        ok: false,
        refusal: createEapRefusal(
          "ILLEGAL_TRANSITION",
          `Cannot transition candidate '${candidateRef.value}' from '${currentCandState}' via '${args.command}'. Expected '${expected.command}'`
        ),
      }
    }

    // THE RECALL-CLOSURE GATE (see eap/recall-closure.ts).
    // A candidate the domain swept into a recall closure rests on a retracted premise. 003 defers
    // the destination STATUS of an indirect dependent, so nothing here assigns one — but completing
    // the lifecycle is rehabilitation, and rehabilitation travels the normal verification path with
    // new proof (ADR §Correção, PRD FR-C4), never a VERIFY on the strength of the old admission.
    if (args.command === "VERIFY") {
      const membership = findRecallClosureMembership(state.db, tenantId, candidateRef.value)
      if (membership) {
        return {
          ok: false,
          refusal: createEapRefusal(
            "REHAB_WITHOUT_PROOF",
            `Candidate '${candidateRef.value}' is inside the recall closure of case '${membership.recallId}' (contestation '${membership.contestationId}'); its final status is undecided, but it cannot complete its lifecycle without new proof`,
          ),
        }
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

/**
 * The id of an existing proposal distilling EXACTLY this candidate set out of this child into this
 * parent, or null. The comparison is on the candidate id SET, so reordering the same distillation
 * is still the same epistemic act.
 */
function findEquivalentProposal(
  state: ServerState,
  tenantId: string,
  childId: string,
  parentId: string,
  candidateIds: string[],
): string | null {
  const wanted = JSON.stringify([...new Set(candidateIds)].sort())
  const rows = state.db
    .query("SELECT id, candidates FROM proposals WHERE tenant_id = ? AND child_id = ? AND parent_id = ? ORDER BY created_at, id")
    .all(tenantId, childId, parentId) as { id: string; candidates: string }[]
  for (const row of rows) {
    let stored: unknown
    try {
      stored = JSON.parse(row.candidates ?? "[]")
    } catch {
      // A proposal whose candidate list is unreadable cannot be shown to be this same distillation.
      continue
    }
    if (!Array.isArray(stored)) continue
    const ids = stored
      .map((c) => (c && typeof c === "object" ? (c as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === "string")
    if (JSON.stringify([...new Set(ids)].sort()) === wanted) return row.id
  }
  return null
}

function eapPromoteGoverned(
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

  const promoteBase = validateBasedOnSeq(args.basedOnSeq)
  if (!promoteBase.ok) return { ok: false, refusal: promoteBase.refusal }

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
    // ONE closure-membership resolution FOR THE WHOLE BATCH. This used to run once per candidate,
    // inside this transaction, against an unindexed table (TL Tier 3 / QA RESOURCE_EXHAUSTION):
    // promoting 50 candidates re-read and re-parsed the tenant's entire recall history 50 times
    // while holding the write lock. Membership cannot change inside this unit of work, so it is
    // resolved once, before the loop, in a single indexed query.
    const closureMembership = findRecallClosureMemberships(state.db, tenantId, candidateIds)
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
      // Same gate as VERIFY: a candidate that was `verified` BEFORE a later recall pulled it into a
      // closure still reads `verified`, and 003 defers what it should read instead. What is not
      // deferred is that it must not be distilled into a parent horizon on that stale verification.
      const membership = closureMembership.get(candidateId)
      if (membership) {
        return {
          ok: false,
          refusal: createEapRefusal(
            "REHAB_WITHOUT_PROOF",
            `Candidate '${candidateId}' is inside the recall closure of case '${membership.recallId}' (contestation '${membership.contestationId}'); it cannot be distilled into a parent horizon without new proof`,
          ),
        }
      }
      distilled.push({ id: candidateId, content: candidateId })
    }

    // IDEMPOTENT BY DISTILLATION. Two identical promote calls are ONE epistemic act: the same
    // candidates, out of the same child, into the same parent. Replaying used to mint a second
    // proposal and burn a second child-horizon sequence, leaving the parent gate with two competing
    // proposals for one distillation (the duplicate parent candidate was already guarded below, so
    // no state corrupted — the defect is the duplicate proposal and the double sequence burn).
    const replayed = findEquivalentProposal(state, tenantId, childRef.value, parentRef.value, candidateIds)
    if (replayed) {
      return {
        ok: true,
        admitted: {
          promotionId: replayed,
          childHorizonId: childRef.value,
          targetParentHorizonId: parentRef.value,
          status: "proposed",
          seq: child.seq,
          replayed: true,
        },
      }
    }

    // Same equality gate as `cognitive.propose`: the domain refuses a base BEHIND the applicable
    // sequence, but a base AHEAD of it describes a state this host never produced and was admitted
    // as fresh. Both directions are a rebase.
    const applicableSeq = Math.max(child.seq, parent.seq)
    if (args.basedOnSeq !== undefined && args.basedOnSeq !== applicableSeq) {
      return {
        ok: false,
        refusal: createEapRefusal(
          "STALE_BASE",
          `basedOnSeq ${args.basedOnSeq} does not match current applicable seq ${applicableSeq}`,
        ),
      }
    }

    // The one-edge rule, the stale-base rule and the proposal/event write are the domain's.
    const result = services.promotions.promote({
      childId: childRef.value,
      parentId: parentRef.value,
      basedOnSeq: args.basedOnSeq ?? applicableSeq,
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

function eapContestGoverned(
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
  // EVERY element must be a reference. Filtering the non-strings out admitted `[{a:1},'ok-ev']` as
  // if one reference had been supplied and never told the caller part of its contract was dropped;
  // a contract is refused whole or admitted whole.
  const evidenceRefs: string[] = Array.isArray(args.evidence) ? (args.evidence as string[]) : []
  if (evidenceRefs.some((ref) => typeof ref !== "string")) {
    return {
      ok: false,
      refusal: createEapRefusal(
        "EVIDENCE_REQUIRED",
        "Every evidence element must be a non-empty reference string; the contract is refused rather than partially admitted",
      ),
    }
  }
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

/**
 * Bound on recall batches driven by one command; the closure is finite, so this only stops a loop
 * bug. Held in a mutable record rather than a bare `const` so the exhaustion PATH — which is
 * otherwise reachable only with a closure of 10k+ claims — is testable without a 10k-claim fixture.
 * Nothing in production writes it.
 */
export const RECALL_LIMITS = { maxBatches: 10_000 }

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
async function eapRecallGoverned(
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

  // VALIDATED AND DISCARDED IS WORSE THAN UNSUPPORTED.
  // `checkpoint` was range-checked here and then never read anywhere in the function: resumption is
  // driven entirely by the DURABLE checkpoint, so a client naming a resumption point silently got a
  // normal run and had every reason to believe it had resumed from the point it named. 003 lists
  // large-closure batching limits among the boundaries implementation must stop at rather than
  // decide, so the honest answer is a refusal, not a fabricated resumption semantics.
  if (args.checkpoint !== undefined) {
    return {
      ok: false,
      refusal: createEapRefusal(
        "MALFORMED_CONTRACT",
        "checkpoint is not a supported input: recall resumes from its own durable checkpoint, so a caller-named resumption point cannot be honoured. Omit it.",
      ),
    }
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

  // The execution context is a snapshot of the tenant's claim states, claim→cell map and cell
  // ownership. It is read BEFORE the transaction opens, once per command, and handed to every batch.
  const ctx = services.recallContext()

  // IDEMPOTENT BY CONTESTATION, RESUMABLE, ATOMICALLY.
  //
  // The read that establishes idempotency ("is there already a case for this contestation?"), the
  // writes that satisfy it (allocate the recall sequence, create the case and its checkpoint) AND
  // the batches that drive it commit as ONE serialized unit. Previously they were separated by
  // `await` boundaries, so two concurrent `cognitive.recall` calls inside one process both saw no
  // case, both burned a sequence and both drove the same closure — and once the drive itself was
  // reachable for an EXISTING case, two callers could step separately loaded copies of it.
  // Everything inside this callback is synchronous by construction, which is what makes the window
  // impossible rather than merely narrow.
  //
  // A case that already exists is RESUMED, not replayed, unless it is already `completed`:
  // `batchLimitReached` tells the operator to re-drive the case with a larger batchSize, and this is
  // the tool that has to honour it. A COMPLETED case still replays, byte-identically, because
  // idempotency by contestation is what makes a retry safe.
  const outcome = serialTransaction(
    state.db,
    ():
      | { kind: "refused"; message: string }
      | { kind: "absent" }
      | { kind: "replay"; record: RecallRecord }
      | { kind: "driven"; record: RecallRecord | null; created: boolean; batchLimitReached: boolean; progress: RecallProgress | null; broadcasts: Array<() => void> } => {
      let created = false
      if (!services.recallRepo.exists(recallId)) {
        const notice: RecallNotice = {
          recallId,
          contestationId: contestation.id,
          targetClaimIds: [...contestation.targetClaimIds],
          severity: contestation.severity,
          contestationStatus: contestation.admitted ? "admitted" : "refused",
          tenantId,
          initiatedAt: new Date().toISOString(),
          seq: allocateSequence(state.db, tenantId, "recalls"),
        }
        const opened = services.recalls.initiateRecallAtomic(notice)
        if ("refused" in opened) return { kind: "refused", message: opened.message }
        created = true
      }

      const loaded = services.recallRepo.getSync(recallId)
      if (!loaded) return { kind: "absent" }
      if (!created && loaded.recallCase.status === "completed") return { kind: "replay", record: loaded }

      const batchSize = args.batchSize ?? Math.max(1, loaded.recallCase.closure.length)
      const driven = services.recalls.driveSync(recallId, batchSize, ctx, RECALL_LIMITS.maxBatches)
      return {
        kind: "driven",
        record: services.recallRepo.getSync(recallId),
        created,
        batchLimitReached: driven.batchLimitReached,
        progress: driven.progress,
        broadcasts: driven.broadcasts,
      }
    },
  )

  if (outcome.kind === "refused") {
    return { ok: false, refusal: createEapRefusal("RECALL_UNPROVEN", outcome.message) }
  }
  if (outcome.kind === "absent") {
    return {
      ok: false,
      refusal: createEapRefusal("RESOURCE_ABSENT", `Recall case '${recallId}' exists but carries no durable checkpoint`),
    }
  }

  if (outcome.kind === "replay") {
    const existing = outcome.record
    return {
      ok: true,
      admitted: recallOutcome(existing.recallCase.id, contestationRef.value, {
        status: existing.recallCase.status,
        seq: existing.recallCase.notice.seq ?? contestation.seq ?? 0,
        closure: existing.recallCase.closure,
        checkpointSeq: existing.checkpoint.sequence,
        suspendedCells: existing.checkpoint.suspendedCells,
        degraded: degradationsOf(existing),
        replayed: true,
        remainingClaimIds: existing.checkpoint.remainingClaimIds,
        batchLimitReached: false,
      }),
    }
  }

  // The suspensions this drive projected are durable now that the transaction has returned; this is
  // the push to live sessions (state.ts `pushEnvelope`), never the write.
  for (const broadcast of outcome.broadcasts) broadcast()

  const settled = outcome.record
  const closure = settled?.recallCase.closure ?? []

  appendEvent(state, tenantId, {
    kind: "RecallProgressed",
    targetKind: "recall",
    targetId: recallId,
    payload: {
      recallId,
      contestationId: contestation.id,
      checkpoint: outcome.progress?.checkpoint.sequence ?? 0,
      affectedClaimIds: closure,
    },
  })
  // `TruthOwnershipSuspended` is NOT emitted here any more. It used to be emitted from the LAST
  // batch's `progress`, so with any batchSize smaller than the closure, cells suspended in earlier
  // batches were durably suspended and announced nowhere. The read-model projection now publishes
  // one event per cell at the moment it is projected (recall-projection.ts → services.ts).

  return {
    ok: true,
    admitted: recallOutcome(recallId, contestation.id, {
      status: settled?.recallCase.status ?? "active",
      seq: settled?.recallCase.notice.seq ?? contestation.seq ?? 0,
      closure,
      checkpointSeq: outcome.progress?.checkpoint.sequence ?? 0,
      suspendedCells: settled ? settled.checkpoint.suspendedCells : (outcome.progress?.suspendedCells ?? []),
      // THE WHOLE CASE, NOT THE LAST BATCH. This used to report `progress.degradedClaims`, which is
      // the degradations of the FINAL batch only: a drive at batchSize 1 over a four-claim closure
      // reported one degraded claim, while replaying the very same case reported four. Both branches
      // now read the same durable field, so they cannot disagree about the same case.
      degraded: settled ? degradationsOf(settled) : [],
      replayed: false,
      resumed: !outcome.created,
      remainingClaimIds: settled?.checkpoint.remainingClaimIds ?? [],
      batchLimitReached: outcome.batchLimitReached,
    }),
  }
}

type RecallRecord = NonNullable<ReturnType<SqliteRecallRepository["getSync"]>>

/** The case's cumulative degradations, from the durable state both branches read. */
function degradationsOf(record: RecallRecord): Array<{ claimId: string; previousState: string; newState: string }> {
  return [...record.recallCase.degradedClaimStates.entries()].map(([claimId, v]) => ({
    claimId,
    previousState: v.previousState,
    newState: v.normativelyResolvedState,
  }))
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
    /** The case already existed and this command ADVANCED it, rather than opening it. */
    resumed?: boolean
    remainingClaimIds: string[]
    batchLimitReached: boolean
  }
): Record<string, unknown> {
  const complete = detail.status === "completed"
  return {
    recallId,
    contestationId,
    status: detail.status,
    // `status: 'active'` used to be the ONLY hint that a recall had not finished, and it rode on an
    // `ok: true` payload otherwise identical to a completed one. `complete` says it in one field,
    // and `remainingClaimIds` names exactly what the closure still owes.
    complete,
    remainingClaimIds: detail.remainingClaimIds,
    affectedClaimIds: detail.closure,
    checkpoint: detail.checkpointSeq,
    seq: detail.seq,
    suspendedCells: detail.suspendedCells,
    degradedClaims: detail.degraded,
    ...(detail.replayed ? { replayed: true } : {}),
    // Distinct from `replayed`: the case existed and was UNFINISHED, and this command drove it
    // further. It is the audit trail of the remedy `batchLimitReached` names.
    ...(detail.resumed ? { resumed: true } : {}),
    // Distinct, actionable: the drive loop stopped because it hit its own batch cap, not because
    // the closure was exhausted. The recall is durably checkpointed and unfinished; finishing it
    // requires an operator-driven run (a larger `batchSize` shortens it), not a retry of this call,
    // which is idempotent by contestation and will replay this same partial case.
    ...(detail.batchLimitReached
      ? {
          batchLimitReached: true,
          maxBatches: RECALL_LIMITS.maxBatches,
          obligation:
            "Recall is durably checkpointed but INCOMPLETE: the batch cap was reached before the closure was exhausted. Re-drive the case with a larger batchSize; do not treat these degradations as the final closure.",
        }
      : {}),
  }
}

/**
 * Durable state that cannot be READ is not a crash the client should receive as a stack trace.
 *
 * Every writer in `eap-repositories.ts` stringifies, but `rebuildFromJsonl` replays arbitrary
 * on-disk JSONL into the same JSON columns, so a truncated or hand-edited mirror used to throw a
 * raw `SyntaxError` out of the repository and through the tool boundary. It is now a typed
 * Refusal, with the same obligation as any other resource that fails to resolve.
 */
function storedStateRefusal(err: unknown): EapResponse | null {
  if (err instanceof StoredStateCorruptionError) {
    return { ok: false, refusal: createEapRefusal("RESOURCE_ABSENT", err.message) }
  }
  return null
}

/** `eapPropose` reads `recall_cases.closure` for the closure gate, so it too can meet a corrupt
 *  stored column, and a corrupt column on a gate must be a typed Refusal, never a stack trace. */
export function eapPropose(state: ServerState, args: Parameters<typeof eapProposeGoverned>[1]): EapResponse {
  try {
    return eapProposeGoverned(state, args)
  } catch (err) {
    const refusal = storedStateRefusal(err)
    if (refusal) return refusal
    throw err
  }
}

export function eapPromote(state: ServerState, args: Parameters<typeof eapPromoteGoverned>[1]): EapResponse {
  try {
    return eapPromoteGoverned(state, args)
  } catch (err) {
    const refusal = storedStateRefusal(err)
    if (refusal) return refusal
    throw err
  }
}

export function eapContest(state: ServerState, args: Parameters<typeof eapContestGoverned>[1]): EapResponse {
  try {
    return eapContestGoverned(state, args)
  } catch (err) {
    const refusal = storedStateRefusal(err)
    if (refusal) return refusal
    throw err
  }
}

export async function eapRecall(state: ServerState, args: Parameters<typeof eapRecallGoverned>[1]): Promise<EapResponse> {
  try {
    return await eapRecallGoverned(state, args)
  } catch (err) {
    const refusal = storedStateRefusal(err)
    if (refusal) return refusal
    throw err
  }
}
