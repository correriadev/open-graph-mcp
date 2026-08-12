/**
 * persistent-delta.ts — Persistent Delta Envelope and Admission Service (Task 07, Feature F001).
 *
 * Retry#5 / REWORK-LOG, two findings closed here:
 *
 *  TRANSACTIONAL RECOVERY — the old flow opened a changeset and inserted `cs_deltas` in one SQLite
 *  transaction, then called `changesetCommit` in a SECOND one. If the commit failed (or threw), the
 *  first transaction had already committed: the tenant was left with orphaned `cs_deltas` rows and
 *  cell locks nobody could release, and the compensating `changesetAbort` was itself a third
 *  transaction that could fail on its own. Admission is now ONE `durableTransaction`: open, stage,
 *  and commit succeed together or the whole unit — SQLite rows and JSONL mirror alike — rolls back.
 *
 *  PER-CANDIDATE SNAPSHOT COST — the incremental gate rebuilt its roundtrip projection of the FULL
 *  tenant claim set on every candidate, so a 100-candidate delta against a 100k-claim tenant did
 *  10 million claim projections and blocked the event loop for the duration. The projection is now
 *  built ONCE per batch and handed to the gate.
 */
import type { ServerState } from "../state"
import type { Delta } from "../gates"
import { requireToken } from "../tools/session"
import { claimOrOpenCs, changesetCommit } from "../tools/changeset"
import { incrementalGate, cellOfClaim, buildRoundtripIndex } from "../gates"
import { readClaims, makeReadFile } from "../store"
import { appendEvent } from "../state"
import { durableTransaction } from "../db"

export type RollbackSemantics = "all_or_nothing" | "rollback_on_required_failure"

export interface Candidate {
  id?: string
  required?: boolean
  delta: Delta
}

export interface PersistentDelta {
  id: string
  candidates: Candidate[]
  rollback?: RollbackSemantics
  intent?: string
}

export type PersistentDeltaAdmissionResult =
  | {
      ok: true
      deltaId: string
      admittedClaimIds: string[]
      seq: number
      csId: string
      __tenant?: string
    }
  | {
      ok: false
      deltaId: string
      reasons: string[]
      refusedCandidateIds?: string[]
      __tenant?: string
    }

export function disassemblePersistentDelta(envelope: PersistentDelta): Candidate[] {
  if (!envelope || !envelope.id || !Array.isArray(envelope.candidates)) {
    throw new Error("Invalid PersistentDelta envelope: missing id or candidates array")
  }
  return envelope.candidates.map((c) => ({
    id: c.id,
    required: c.required !== false,
    delta: c.delta,
  }))
}

/** Sentinel thrown to unwind the single admission transaction with a typed refusal payload. */
class AdmissionRollback extends Error {
  constructor(readonly result: PersistentDeltaAdmissionResult) {
    super("persistent delta admission rolled back")
  }
}

export function admitPersistentDelta(
  state: ServerState,
  args: { token: string; delta: PersistentDelta }
): PersistentDeltaAdmissionResult {
  const { userId, tenantId: tenant, name } = requireToken(state, args.token)
  const envelope = args.delta

  if (!envelope || !envelope.id || !Array.isArray(envelope.candidates) || envelope.candidates.length === 0) {
    return {
      ok: false,
      deltaId: envelope?.id ?? "",
      reasons: ["Invalid PersistentDelta envelope: must contain non-empty candidates array"],
      __tenant: tenant,
    }
  }

  const candidates = disassemblePersistentDelta(envelope)
  const intent = envelope.intent || `Admit Persistent Delta ${envelope.id}`

  const cells: string[] = []
  for (const cand of candidates) {
    const d = cand.delta
    if (d.kind === "authority.flip") {
      if (typeof d.payload?.cell === "string") cells.push(d.payload.cell)
    } else if (d.kind === "claim.add") {
      cells.push(cellOfClaim(d.payload ?? {}))
    }
  }

  if (cells.length === 0) {
    return {
      ok: false,
      deltaId: envelope.id,
      reasons: ["Cannot derive target cells for PersistentDelta candidates"],
      __tenant: tenant,
    }
  }

  // The hot caches (`graphs`, `claimsCache`) are mutated by the nested commit path but are NOT part
  // of the SQLite transaction, so a rollback must restore them explicitly or the process keeps
  // serving claims that no longer exist on disk.
  const graphsBefore = structuredClone(state.graphs)
  const claimsCacheBefore = structuredClone(state.claimsCache)

  try {
    return durableTransaction(state.db, (): PersistentDeltaAdmissionResult => {
      const admittedClaimIds: string[] = []
      const refusedCandidateIds: string[] = []
      const reasons: string[] = []

      // ONE snapshot read and ONE roundtrip projection for the whole batch. Both were previously
      // recomputed per candidate.
      const existingClaims = readClaims(state, tenant)
      const roundtripIndex = buildRoundtripIndex(existingClaims)
      const readFile = makeReadFile(state)

      for (const cand of candidates) {
        const isRequired = cand.required !== false
        const candCell =
          cand.delta.kind === "authority.flip" ? cand.delta.payload?.cell : cellOfClaim(cand.delta.payload ?? {})

        const gateRes = incrementalGate(cand.delta, {
          lockedCells: [candCell],
          existingClaims,
          existingRoundtrip: roundtripIndex,
          readFile,
        })

        if (gateRes.reasons.length > 0) {
          if (cand.id) refusedCandidateIds.push(cand.id)
          reasons.push(...gateRes.reasons.map((r) => `Candidate ${cand.id || "unnamed"}: ${r}`))
          if (isRequired || envelope.rollback === "all_or_nothing") {
            throw new AdmissionRollback({
              ok: false,
              deltaId: envelope.id,
              reasons,
              refusedCandidateIds,
              __tenant: tenant,
            })
          }
        } else if (cand.delta.kind === "claim.add" && cand.delta.payload?.id) {
          admittedClaimIds.push(cand.delta.payload.id)
        }
      }

      const opened = claimOrOpenCs(state, tenant, userId, name, cells, intent, [])
      if (!opened.ok) {
        throw new AdmissionRollback({
          ok: false,
          deltaId: envelope.id,
          reasons: [`Lock contention: ${opened.hint}`],
          refusedCandidateIds: candidates.map((c) => c.id).filter(Boolean) as string[],
          __tenant: tenant,
        })
      }
      const csId = opened.csId

      let seq = (
        state.db
          .query("SELECT COALESCE(MAX(seq),0) AS m FROM cs_deltas WHERE tenant_id = ? AND cs_id = ?")
          .get(tenant, csId) as { m: number }
      ).m
      const nowTs = new Date().toISOString()
      const insertDelta = state.db.query(
        "INSERT INTO cs_deltas (tenant_id, cs_id, seq, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      for (const cand of candidates) {
        seq++
        insertDelta.run(tenant, csId, seq, cand.delta.kind, JSON.stringify(cand.delta.payload), nowTs)
      }

      // Same transaction: `changesetCommit` nests into this durable unit (durableTransaction is
      // re-entrant), so a refused or throwing commit unwinds the staged deltas and the cell locks
      // acquired above instead of stranding them.
      const commitRes = changesetCommit(state, { token: args.token, csId, intent })
      if (!commitRes.ok) {
        throw new AdmissionRollback({
          ok: false,
          deltaId: envelope.id,
          reasons: commitRes.reasons,
          refusedCandidateIds: candidates.map((c) => c.id).filter(Boolean) as string[],
          __tenant: tenant,
        })
      }

      appendEvent(state, tenant, {
        kind: "PersistentDeltaAdmitted",
        targetKind: "persistent_delta",
        targetId: envelope.id,
        byUser: userId,
        payload: {
          deltaId: envelope.id,
          admittedClaimIds,
          seq: commitRes.admitSeq,
        },
      })

      return {
        ok: true,
        deltaId: envelope.id,
        admittedClaimIds,
        seq: commitRes.admitSeq!,
        csId,
        __tenant: tenant,
      }
    })
  } catch (err) {
    state.graphs = graphsBefore
    state.claimsCache = claimsCacheBefore
    if (err instanceof AdmissionRollback) return err.result
    return {
      ok: false,
      deltaId: envelope.id,
      reasons: [(err as Error).message],
      refusedCandidateIds: candidates.map((c) => c.id).filter(Boolean) as string[],
      __tenant: tenant,
    }
  }
}
