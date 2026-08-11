/**
 * graphci.ts — Horizon 4 CI gateway: makes graph invariants un-bypassable at the merge
 * boundary. Three deterministic, headless gates sharing the exact modules the local tools
 * use (build.ts's Graph, authority.ts's cellKey/getAuthority/setAuthority) — CI verdict ≡
 * local verdict by construction, no separate reimplementation to drift out of sync.
 *
 * Pure functions of (diff text, graph, trailers): no Date/random/network. The diff is a
 * STRING here (INV-1) — this module never shells out; a caller wanting to run this against
 * a live PR is responsible for producing the diff text with execFile + array args upstream.
 *
 * - anchoredDiffGate: every hunk must land inside some node's tree-sitter range, or the file
 *   is explicitly (unassigned)-tolerated. This — not the boot gate — is what makes "edit with
 *   vim, skip the graph" non-viable: you can edit outside the graph, you cannot land it.
 * - authorityGate: a diff touching a β ("graph") cell must carry changeset provenance or an
 *   explicit break-glass escape. Break-glass is legal, loud, and debt-tracked: it demotes the
 *   touched β cell(s) to "suspended" in the returned graph (the merge-commit demotion) instead
 *   of silently letting code drift out from under an authoritative graph.
 * - parseBreakGlassTrailer: last-paragraph git-trailer scan for `Graph-Break-Glass: true`.
 */
import type { Graph, GraphNode } from "./build"
import type { Level } from "./classify"
import { cellKey, getAuthority, setAuthority } from "./authority"

/**
 * GraphNode.level is "P1".."P5" (classify.ts); authority.ts's cellKey (and the graph.authority
 * map it writes) uses the bare numeric level ("domain:5") — see watch.ts's cellIdToAuthorityKey,
 * which performs this exact P-prefix strip when bridging cell-dag ids to authority keys.
 */
function levelNumber(level: Level): number {
  return Number(level.slice(1))
}

// ── unified diff parsing (pure string parsing, no shell) ───────────────────────────────────

export type DiffHunk = { startLine: number; lineCount: number }
export type DiffFile = { file: string; hunks: DiffHunk[] }

const PLUS_HEADER = /^\+\+\+ (?:b\/)?(.+)$/
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/** Extracts per-file NEW-side changed line ranges from a unified diff string. Pure, no fs/shell. */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  for (const raw of diff.split("\n")) {
    const plus = PLUS_HEADER.exec(raw)
    if (plus) {
      if (plus[1] === "/dev/null") {
        current = null
        continue
      }
      current = { file: plus[1], hunks: [] }
      files.push(current)
      continue
    }
    const hunk = HUNK_HEADER.exec(raw)
    if (hunk && current) {
      const startLine = Number(hunk[1])
      const lineCount = hunk[2] !== undefined ? Number(hunk[2]) : 1
      current.hunks.push({ startLine, lineCount })
    }
  }
  return files
}

// ── anchored-diff gate ──────────────────────────────────────────────────────────────────────

export type Violation = { file: string; lines: string; reason: string }
export type AnchoredDiffOpts = { tolerated?: string[] }

/** node.range format is "L<start>-<end>" (1-based, inclusive) — see tool/graph-meta.txt. */
function parseNodeRange(range: string | undefined): { start: number; end: number } | null {
  if (!range) return null
  const m = /^L(\d+)-(\d+)$/.exec(range)
  if (!m) return null
  return { start: Number(m[1]), end: Number(m[2]) }
}

/**
 * Every changed hunk must fall within some node's tree-sitter range for that file, OR the
 * file is explicitly (unassigned)-tolerated (opts.tolerated). A hunk touching lines outside
 * every node range in a governed file is an "unanchored hunk" violation.
 */
export function anchoredDiffGate(
  diff: string,
  graph: Graph,
  opts: AnchoredDiffOpts = {},
): { ok: boolean; violations: Violation[] } {
  const tolerated = new Set(opts.tolerated ?? [])
  const violations: Violation[] = []
  for (const f of parseUnifiedDiff(diff)) {
    if (tolerated.has(f.file)) continue
    const ranges = graph.nodes
      .filter((n) => n.file === f.file)
      .map((n) => parseNodeRange(n.range))
      .filter((r): r is { start: number; end: number } => r !== null)
    for (const hunk of f.hunks) {
      const count = hunk.lineCount > 0 ? hunk.lineCount : 1
      const hunkEnd = hunk.startLine + count - 1
      const anchored = ranges.some((r) => hunk.startLine >= r.start && hunkEnd <= r.end)
      if (!anchored) {
        violations.push({ file: f.file, lines: `${hunk.startLine}-${hunkEnd}`, reason: "unanchored hunk" })
      }
    }
  }
  return { ok: violations.length === 0, violations }
}

// ── authority gate ──────────────────────────────────────────────────────────────────────────

/**
 * `changeset` is the provenance for a β-cell edit: its `id` plus the cells it actually covers
 * (the caller passes `blastRadius(deltas, lockedCells).cells` — mcp-server's gates.ts; the old
 * file-based changeset-store.ts this used to name was deleted, see
 * docs/CHANGELOG.md). Provenance is NOT trusted on
 * id presence alone — every touched β cell must appear in `changeset.cells`, else the edit is
 * unbacked and rejected (an unrelated changeset id cannot launder an edit to a cell it never
 * touched). `breakGlass` is the explicit escape (demotes touched β cells to suspended).
 */
export type AuthorityOpts = { changeset?: { id: string; cells: readonly string[] }; breakGlass?: boolean }
export type AuthorityViolation = { file: string; cell: string; reason: string }

/**
 * Diffs touching files whose cell is β ("graph") must carry a changesetId (provenance) or
 * breakGlass. With breakGlass and no changesetId, each touched β cell is auto-demoted to
 * "suspended" IN THE RETURNED GRAPH — the legal, loud merge-commit escape, not a violation.
 * Without either, every touched β cell/file pair is a violation.
 */
export function authorityGate(
  diff: string,
  graph: Graph,
  opts: AuthorityOpts = {},
): { ok: boolean; graph: Graph; violations: AuthorityViolation[] } {
  const files = parseUnifiedDiff(diff)
  const touched = new Map<string, Set<string>>() // cellKey -> files touching it
  for (const f of files) {
    const nodes: readonly GraphNode[] = graph.nodes.filter((n) => n.file === f.file)
    for (const n of nodes) {
      const key = cellKey(n.domain ?? "(unassigned)", levelNumber(n.level))
      if (getAuthority(graph, key) !== "graph") continue
      const set = touched.get(key) ?? new Set<string>()
      set.add(f.file)
      touched.set(key, set)
    }
  }

  const violations: AuthorityViolation[] = []
  let g = graph
  if (touched.size > 0) {
    if (opts.changeset) {
      // provenance present — but it must actually COVER each touched β cell, not just exist.
      const covered = new Set(opts.changeset.cells)
      for (const [key, filesSet] of touched) {
        if (covered.has(key)) continue
        for (const file of [...filesSet].sort()) {
          violations.push({
            file,
            cell: key,
            reason: `beta-cell edit not covered by changeset ${opts.changeset.id} (cell ${key} not in its blast radius)`,
          })
        }
      }
    } else if (opts.breakGlass) {
      for (const key of touched.keys()) {
        g = setAuthority(g, key, "suspended")
      }
    } else {
      for (const [key, filesSet] of touched) {
        for (const file of [...filesSet].sort()) {
          violations.push({
            file,
            cell: key,
            reason: "beta-cell edit without changeset provenance or break-glass trailer",
          })
        }
      }
    }
  }
  return { ok: violations.length === 0, graph: g, violations }
}

// ── break-glass trailer parsing ──────────────────────────────────────────────────────────────

const TRAILER_LINE = /^([A-Za-z0-9-]+):\s*(.*)$/

/** Detects a `Graph-Break-Glass: true` git trailer in the LAST paragraph, case-insensitive key. */
export function parseBreakGlassTrailer(commitMessage: string): boolean {
  const paragraphs = commitMessage.trim().split(/\n\s*\n/)
  const last = paragraphs[paragraphs.length - 1] ?? ""
  for (const line of last.split("\n")) {
    const m = TRAILER_LINE.exec(line.trim())
    if (m && m[1].toLowerCase() === "graph-break-glass") {
      return m[2].trim().toLowerCase() === "true"
    }
  }
  return false
}
