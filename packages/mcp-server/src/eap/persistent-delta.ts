/**
 * persistent-delta.ts — Persistent Delta Envelope and Admission Service.
 * Implements Task 07 of Feature F001 (Domain: cognitive_line).
 */
import type { ServerState } from "../state"
import type { Delta } from "../gates"
import { requireToken } from "../tools/session"
import { claimOrOpenCs, changesetCommit, changesetAbort } from "../tools/changeset"
import { incrementalGate, cellOfClaim } from "../gates"
import { readClaims, makeReadFile } from "../store"
import { appendEvent } from "../state"

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

  const admittedClaimIds: string[] = []
  const refusedCandidateIds: string[] = []
  const existingClaims = readClaims(state, tenant)
  const readFile = makeReadFile(state)

  for (const cand of candidates) {
    const isRequired = cand.required !== false
    const candCell = cand.delta.kind === "authority.flip" ? cand.delta.payload?.cell : cellOfClaim(cand.delta.payload ?? {})

    const gateRes = incrementalGate(cand.delta, {
      lockedCells: [candCell],
      existingClaims,
      readFile,
    })

    if (gateRes.reasons.length > 0) {
      if (cand.id) refusedCandidateIds.push(cand.id)
      reasons.push(...gateRes.reasons.map((r) => `Candidate ${cand.id || "unnamed"}: ${r}`))
      if (isRequired || envelope.rollback === "all_or_nothing") {
        return {
          ok: false,
          deltaId: envelope.id,
          reasons,
          refusedCandidateIds,
          __tenant: tenant,
        }
      }
    } else if (cand.delta.kind === "claim.add" && cand.delta.payload?.id) {
      admittedClaimIds.push(cand.delta.payload.id)
    }
  }

  let csId: string
  try {
    const openRes = state.db.transaction(() => {
      const opened = claimOrOpenCs(state, tenant, userId, name, cells, intent, [])
      if (!opened.ok) {
        throw new Error(`Lock contention: ${opened.hint}`)
      }
      csId = opened.csId

      let seq = (state.db.query("SELECT COALESCE(MAX(seq),0) AS m FROM cs_deltas WHERE tenant_id = ? AND cs_id = ?").get(tenant, csId) as { m: number }).m
      const nowTs = new Date().toISOString()

      for (const cand of candidates) {
        seq++
        state.db.query(
          "INSERT INTO cs_deltas (tenant_id, cs_id, seq, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(tenant, csId, seq, cand.delta.kind, JSON.stringify(cand.delta.payload), nowTs)
      }

      return { ok: true, csId }
    })()

    csId = openRes.csId
  } catch (err) {
    return {
      ok: false,
      deltaId: envelope.id,
      reasons: [(err as Error).message],
      __tenant: tenant,
    }
  }

  let commitRes: any
  try {
    commitRes = changesetCommit(state, { token: args.token, csId, intent })
  } catch (err) {
    changesetAbort(state, { token: args.token, csId })
    return {
      ok: false,
      deltaId: envelope.id,
      reasons: [(err as Error).message],
      refusedCandidateIds: candidates.map((c) => c.id).filter(Boolean) as string[],
      __tenant: tenant,
    }
  }

  if (!commitRes.ok) {
    changesetAbort(state, { token: args.token, csId })
    return {
      ok: false,
      deltaId: envelope.id,
      reasons: commitRes.reasons,
      refusedCandidateIds: candidates.map((c) => c.id).filter(Boolean) as string[],
      __tenant: tenant,
    }
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
    seq: commitRes.admitSeq,
    csId,
    __tenant: tenant,
  }
}
