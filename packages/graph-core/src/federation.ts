/**
 * federation.ts — authority crossing repo boundaries.
 *
 * A repo publishes a signed manifest of its PUBLIC surface (`exposed: true`
 * nodes only). A consuming repo vendors that manifest as a read-only
 * "foreign tower": it references foreign nodes in local claims, and pins the
 * vendored manifest's Merkle root in `.graph/federation.lock`. Verification
 * recomputes the root from the vendored (in-memory) manifest and compares it
 * to the pin — never a network call.
 *
 * INV-H4-1: no function here performs I/O beyond the local filesystem for
 * the lock file itself; `verifyForeignRefs` takes manifests as plain
 * arguments and never fetches.
 * INV-H4-2: foreign nodes are read-only data (`GraphManifest["exposed"]`
 * entries) — there is no mutation path exposed for them here.
 *
 * Determinism: no Date.now()/Math.random() anywhere in the pure functions.
 * `merkleRoot` is a sorted-leaf sha256 fold (see `merkleRootOf` below) —
 * leaves are sorted lexicographically before folding, so the result only
 * depends on the *set* of exposed entries, never on `graph.nodes` order.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import type { Graph, GraphNode } from "./build"

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

export type ExposedEntry = {
  id: string
  anchor: string
  tokenHash?: string
  responsibility: string
  level: string
}

export type GraphManifest = {
  repo: string
  version: string
  merkleRoot: string
  exposed: ExposedEntry[]
}

export type FederationLockDep = { repo: string; version: string; merkleRoot: string }

export type FederationLock = { deps: FederationLockDep[] }

/** GraphNode possibly carrying a structural tokenHash (see extract.ts / imports-manifest.ts). */
type MaybeHashedNode = GraphNode & { tokenHash?: string }

/**
 * Structural anchor identity for an exposed node: the node's own tokenHash
 * when present (precise, content-addressed on the symbol body), otherwise a
 * sha256 fallback over the anchor string. Always populated — never left
 * undefined — so downstream diffing/hashing has a stable identity to compare.
 */
function anchorIdentity(node: MaybeHashedNode): string {
  return node.tokenHash ?? sha256(node.anchor)
}

function leafOf(entry: ExposedEntry): string {
  return sha256(`${entry.id}|${entry.anchor}|${entry.tokenHash ?? ""}|${entry.responsibility}|${entry.level}`)
}

/**
 * Deterministic Merkle root over exposed entries: leaves are sorted
 * lexicographically (order-independence), then folded pairwise
 * (sha256(left+right), duplicating the last node when a level is odd-sized)
 * until a single root remains. Empty input has a fixed root (sha256("")).
 */
export function merkleRootOf(entries: readonly ExposedEntry[]): string {
  if (entries.length === 0) return sha256("")
  let level = entries.map(leafOf).sort()
  while (level.length > 1) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]
      const right = i + 1 < level.length ? level[i + 1] : level[i]
      next.push(sha256(left + right))
    }
    level = next
  }
  return level[0]
}

/**
 * Collects `exposed: true` nodes from the graph, sorted by id, and computes
 * the Merkle root over them. Same exposed surface -> same manifest,
 * regardless of `graph.nodes` input order.
 */
export function publishManifest(graph: Graph, opts: { version: string }): GraphManifest {
  const exposed: ExposedEntry[] = (graph.nodes as MaybeHashedNode[])
    .filter((n) => n.exposed)
    .map((n) => ({
      id: n.id,
      anchor: n.anchor,
      tokenHash: anchorIdentity(n),
      responsibility: n.responsibility,
      level: n.level,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  return {
    repo: graph.repo,
    version: opts.version,
    merkleRoot: merkleRootOf(exposed),
    exposed,
  }
}

function lockPath(root: string): string {
  return path.join(root, ".graph", "federation.lock")
}

/** Loads `.graph/federation.lock`. Missing file -> empty lock ({ deps: [] }). */
export function loadLock(root: string): FederationLock {
  const file = lockPath(root)
  if (!existsSync(file)) return { deps: [] }
  const raw = readFileSync(file, "utf8")
  const parsed = JSON.parse(raw)
  const deps = Array.isArray(parsed?.deps) ? parsed.deps : []
  return { deps }
}

/**
 * Writes `.graph/federation.lock` only — never touches graph.json or any
 * other file under `.graph/`.
 */
export function saveLock(root: string, lock: FederationLock): string {
  const dir = path.join(root, ".graph")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = lockPath(root)
  writeFileSync(file, JSON.stringify(lock, null, 2))
  return file
}

export type ForeignMismatch = { repo: string; reason: string }

/**
 * Verifies pinned foreign deps against already-vendored manifests supplied
 * in memory. NO network I/O — `manifests` must already be loaded/vendored
 * by the caller (INV-H4-1). For each pinned dep: find the matching manifest
 * by repo, recompute its Merkle root from `manifest.exposed`, and compare to
 * the pinned root. A missing manifest or a root mismatch is a named failure.
 */
export function verifyForeignRefs(
  lock: FederationLock,
  manifests: readonly GraphManifest[],
): { ok: boolean; mismatches: ForeignMismatch[] } {
  const byRepo = new Map(manifests.map((m) => [m.repo, m]))
  const mismatches: ForeignMismatch[] = []

  for (const dep of lock.deps) {
    const manifest = byRepo.get(dep.repo)
    if (!manifest) {
      mismatches.push({ repo: dep.repo, reason: "manifest-not-vendored" })
      continue
    }
    const recomputed = merkleRootOf(manifest.exposed)
    if (recomputed !== dep.merkleRoot) {
      mismatches.push({
        repo: dep.repo,
        reason: `merkle-root-mismatch: pinned=${dep.merkleRoot} recomputed=${recomputed}`,
      })
    }
  }

  return { ok: mismatches.length === 0, mismatches }
}

export type ManifestDiffClass = "same" | "patch" | "breaking"

/**
 * Intent-level semver classification between two manifests of the same repo:
 * - "same": identical exposed surface (same ids, anchors, tokenHash, responsibility, level).
 * - "breaking": any exposed node added/removed, or a shared node's responsibility changed.
 * - "patch": every shared node's responsibility is unchanged, but anchor/tokenHash
 *   (or level) drifted — code-only movement, not a contract change.
 */
export function classifyManifestDiff(oldM: GraphManifest, newM: GraphManifest): ManifestDiffClass {
  const oldById = new Map(oldM.exposed.map((e) => [e.id, e]))
  const newById = new Map(newM.exposed.map((e) => [e.id, e]))

  for (const id of oldById.keys()) if (!newById.has(id)) return "breaking"
  for (const id of newById.keys()) if (!oldById.has(id)) return "breaking"

  let changed = false
  for (const [id, oldEntry] of oldById) {
    const newEntry = newById.get(id)!
    if (oldEntry.responsibility !== newEntry.responsibility) return "breaking"
    if (
      oldEntry.anchor !== newEntry.anchor ||
      oldEntry.tokenHash !== newEntry.tokenHash ||
      oldEntry.level !== newEntry.level
    ) {
      changed = true
    }
  }

  return changed ? "patch" : "same"
}
