// ---------------------------------------------------------------------------
// Pure presence state (unit-tested). Folds the ephemeral `user.*` events
// (spec §6/§7.1) plus periodic `presence.who` polls into the per-user roster
// consumers render presence UI from. A small mutable store with `apply(env)`
// folding one envelope at a time, kept deliberately dumb — no network, no DOM.
// ---------------------------------------------------------------------------

export type TypingState = "typing" | "idle" | "quiet"

export type PresenceEntry = {
  userId: string
  name: string
  agentKind: string
  focusCell: string | null
  openCount: number
  lastSeen: number
  typingState: TypingState
}

export type DotColor = "green" | "yellow" | "gray"

/** Dot color from last-seen age (spec §7.1): <30s green, 30-60s yellow, >60s gray. */
export function dotColor(lastSeen: number, now = Date.now()): DotColor {
  const age = now - lastSeen
  if (age < 30_000) return "green"
  if (age < 60_000) return "yellow"
  return "gray"
}

/** Up to two initials for an avatar badge (spec §7.2): "Alice Smith" → "AS", "Bob" → "BO", "" → "?". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export type WhoUser = { id: string; name: string; agentKind: string; focusCell: string | null; openCount: number; lastSeen?: number }

export class PresenceStore {
  readonly users = new Map<string, PresenceEntry>()

  /**
   * Fold one ephemeral `user.*` envelope. Unknown kinds are ignored.
   *
   * `lastSeen` (Task 4 review): `user.joined`/`user.focused` now carry the SERVER's ms timestamp in
   * their payload (presence.ts) — prefer that over the local `now` so the dotColor thresholds (30s/60s,
   * below) measure staleness from the server's clock. `user.typing_state` doesn't carry one (it's a
   * pure state transition, not a liveness signal); `now` remains the fallback there and whenever a
   * payload happens to omit it.
   */
  apply(env: { kind: string; payload: any }, now = Date.now()): void {
    const p = env.payload ?? {}
    switch (env.kind) {
      case "user.joined":
        this.upsert(p.userId, { name: p.name ?? p.userId, agentKind: p.agentKind ?? "web", lastSeen: p.lastSeen }, now)
        break
      case "user.focused":
        this.upsert(p.userId, { focusCell: p.cell ?? null, lastSeen: p.lastSeen }, now)
        break
      case "user.left":
        this.users.delete(p.userId)
        break
      case "user.typing_state":
        this.upsert(p.userId, { typingState: p.state ?? "quiet", focusCell: p.cell ?? undefined }, now)
        break
      default:
        break
    }
  }

  private upsert(userId: string, patch: Partial<PresenceEntry>, now: number): void {
    if (!userId) return
    const cur = this.users.get(userId)
    const base: PresenceEntry = cur ?? {
      userId,
      name: userId,
      agentKind: "web",
      focusCell: null,
      openCount: 0,
      lastSeen: now,
      typingState: "quiet",
    }
    this.users.set(userId, { ...base, ...patch, userId, lastSeen: patch.lastSeen ?? now })
  }

  /**
   * Merge a `presence.who` poll snapshot: authoritative for membership + openCount (someone we never
   * saw a `user.joined` for — e.g. we connected mid-session — still shows up). Users missing from the
   * snapshot are dropped (they left without us catching the broadcast). typingState survives the merge
   * since `who` doesn't report it.
   */
  mergeWho(list: WhoUser[], now = Date.now()): void {
    const seen = new Set(list.map((u) => u.id))
    for (const id of [...this.users.keys()]) if (!seen.has(id)) this.users.delete(id)
    for (const u of list) {
      const cur = this.users.get(u.id)
      this.users.set(u.id, {
        userId: u.id,
        name: u.name,
        agentKind: u.agentKind,
        focusCell: u.focusCell,
        openCount: u.openCount,
        lastSeen: u.lastSeen ?? now, // server-provided (presence.who, Task 4 review) — now only as fallback
        typingState: cur?.typingState ?? "quiet",
      })
    }
  }

  /** Roster sorted by name, for stable rendering. */
  list(): PresenceEntry[] {
    return [...this.users.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
}
