import { stableHash } from "@open-graph-mcp/graph-core/layout"

// ---------------------------------------------------------------------------
// Pure ghost-layer state (unit-tested). Folds the changeset.* / lock.* SSE
// events (spec §6) into the set of open changesets + live locks the canvas
// draws as ghosts (spec §7.1) and lock badges (spec §7.2). Deltas themselves
// arrive out-of-band: changeset.delta only carries a count, so `apply` returns
// the csId to refetch (`graph://changeset/{id}`) and the caller feeds them
// back via `setDeltas`.
// ---------------------------------------------------------------------------

export type GhostDelta = {
  kind: string
  subject?: string
  domain?: string | null
  level?: string
  summary: string
  at?: number
}

export type OpenChangeset = {
  csId: string
  intent: string
  cells: string[]
  byUser: string
  openedAt: number
  expiresAt: number
  deltaCount: number
  deltas: GhostDelta[]
}

export type Lock = { cell: string; csId: string; holder: string; expiresAt: number }

/** Deterministic color for a changeset id — stable across reloads, distinct per csId (spec §7.1). */
export function colorForCsId(csId: string): string {
  return `hsl(${stableHash(csId) % 360}, 70%, 60%)`
}

export type ApplyResult = {
  /** csId whose deltas advanced — caller should refetch graph://changeset/{id} (debounced). */
  refetch?: string
  /** true when an admitted/aborted changeset means the base graph should reload. */
  committed?: boolean
}

export class GhostStore {
  readonly changesets = new Map<string, OpenChangeset>()
  readonly locks = new Map<string, Lock>() // cell → lock

  /** Fold one SSE envelope. Non-changeset/lock kinds are ignored (return {}). */
  apply(env: { kind: string; payload: any }): ApplyResult {
    const p = env.payload ?? {}
    switch (env.kind) {
      case "changeset.opened": {
        this.changesets.set(p.csId, {
          csId: p.csId,
          intent: p.intent ?? "",
          cells: p.cells ?? [],
          byUser: p.byUser ?? "?",
          openedAt: p.openedAt ?? 0,
          expiresAt: p.expiresAt ?? 0,
          deltaCount: 0,
          deltas: [],
        })
        return { refetch: p.csId }
      }
      case "changeset.delta": {
        const cs = this.changesets.get(p.csId)
        if (!cs) return {}
        cs.deltaCount += p.deltaCountSinceLast ?? 0
        return { refetch: p.csId }
      }
      case "changeset.committed":
      case "changeset.aborted": {
        this.changesets.delete(p.csId)
        for (const cell of p.cells ?? []) if (this.locks.get(cell)?.csId === p.csId) this.locks.delete(cell)
        return env.kind === "changeset.committed" ? { committed: true } : {}
      }
      case "lock.acquired":
        this.locks.set(p.cell, { cell: p.cell, csId: p.csId, holder: p.holder, expiresAt: p.expiresAt })
        return {}
      case "lock.released":
        if (this.locks.get(p.cell)?.csId === p.csId) this.locks.delete(p.cell)
        return {}
      default:
        return {}
    }
  }

  /** Feed refetched deltas back into an open changeset (from graph://changeset/{id}). */
  setDeltas(csId: string, deltas: GhostDelta[]): void {
    const cs = this.changesets.get(csId)
    if (cs) {
      cs.deltas = deltas
      cs.deltaCount = deltas.length
    }
  }

  /** Register a changeset the client itself opened / reattached (spec §7.3, §9). */
  track(cs: OpenChangeset): void {
    this.changesets.set(cs.csId, cs)
  }
}
