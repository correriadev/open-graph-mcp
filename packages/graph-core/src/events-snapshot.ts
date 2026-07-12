/**
 * events-snapshot.ts — bound the watch replay cost. `events.jsonl` is append-only and unbounded;
 * every watch cycle folds the ENTIRE history to recover the last-known status per id, so replay
 * grows without limit (blind spot 3). This adds the snapshot+truncate protocol: fold the current
 * events into `events.snapshot.json` (the folded lastKnown state per kind), then truncate
 * `events.jsonl`. Replay becomes snapshot + tail, not full history.
 *
 * The fold is a pure function of the event order and produces exactly what `lastKnown` produces,
 * so a watch reading (snapshot + tail) sees the same prior state it would have from the full log —
 * the protocol is transparent: with no snapshot present, `loadFolded` folds the whole log, i.e.
 * identical to today's behavior.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import type { Status, WatchEvent } from "./watch" // type-only: no runtime import cycle with watch.ts

/** Folded last-known status per event kind, as plain records (snapshot on disk). */
export type FoldedState = { node: Record<string, Status>; claim: Record<string, Status> }

function eventsFile(root: string): string {
  return path.join(root, ".graph", "events.jsonl")
}
function snapshotFile(root: string): string {
  return path.join(root, ".graph", "events.snapshot.json")
}

const mapToRec = (m: Map<string, Status>): Record<string, Status> => Object.fromEntries(m)
const recToMap = (r: Record<string, Status> | undefined): Map<string, Status> => new Map(Object.entries(r ?? {}))

/** Local event reader (self-contained; avoids a runtime cycle with watch.ts). */
function readEvents(root: string): WatchEvent[] {
  const file = eventsFile(root)
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as WatchEvent)
}

/** Fold events of one kind to last-known status (recovered → fresh). Mirrors watch.ts lastKnown. */
function foldKindEvents(events: readonly WatchEvent[], kind: "node" | "claim"): Map<string, Status> {
  const out = new Map<string, Status>()
  for (const e of events) {
    if (e.kind !== kind) continue
    if (e.type === "recovered") out.set(e.id, "fresh")
    else out.set(e.id, e.type as Status)
  }
  return out
}

/** Reads the folded snapshot, or an empty folded state when none exists. */
export function readSnapshot(root: string): FoldedState {
  const file = snapshotFile(root)
  if (!existsSync(file)) return { node: {}, claim: {} }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<FoldedState>
    return { node: parsed.node ?? {}, claim: parsed.claim ?? {} }
  } catch {
    return { node: {}, claim: {} }
  }
}

/**
 * Last-known status per kind = snapshot folded state with the current `events.jsonl` tail folded
 * on top (tail wins, since it is newer). Equivalent to `lastKnown` over the full pre-truncation
 * log. With no snapshot, this is exactly `lastKnown(readEvents)` filtered per kind.
 */
export function loadFolded(root: string): { node: Map<string, Status>; claim: Map<string, Status> } {
  const snap = readSnapshot(root)
  const tail = readEvents(root)
  const foldKind = (kind: "node" | "claim"): Map<string, Status> => {
    const base = recToMap(snap[kind])
    for (const [id, s] of foldKindEvents(tail, kind)) base.set(id, s)
    return base
  }
  return { node: foldKind("node"), claim: foldKind("claim") }
}

/**
 * Folds (snapshot + current tail) into a fresh snapshot and truncates `events.jsonl`. After this,
 * the log is empty and `loadFolded` returns the same maps it returned before — replay cost is now
 * O(new events since snapshot) instead of O(all history). Returns the folded state written.
 */
export function snapshotAndTruncate(root: string): FoldedState {
  const folded = loadFolded(root)
  const state: FoldedState = { node: mapToRec(folded.node), claim: mapToRec(folded.claim) }
  mkdirSync(path.join(root, ".graph"), { recursive: true })
  writeFileSync(snapshotFile(root), JSON.stringify(state, null, 2))
  writeFileSync(eventsFile(root), "") // truncate: folded state now lives in the snapshot
  return state
}

/** Re-export for callers that fold their own event slices. */
export type { WatchEvent }
