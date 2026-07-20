/**
 * sidebar-tree.tsx — UI-3 (F002): árvore domínios→níveis (cells). claimCount por cell (das nodes[].claims[]),
 * lockBadge quando trincada; quick filters 'all'|'open-turn'|'locked'|'mine'. 'mine' reusa changeset.list_mine.
 * Click na cell → setSelectedCell (abre ClaimsBrowser). Puro de canvas (não desenha nós).
 *
 * API DOM p/ e2e: #sidebar-tree, .sidebar-cell, .lock-badge, [data-quickfilter="mine"|"locked"|"open-turn"|"all"].
 */
import { useMemo } from "react"
import { useUi, type QuickFilter } from "./store"

type Tree = Map<string, Map<string, { cell: string; claimCount: number; locked: boolean; holder?: string; expiresAt?: string }>>
type MineSet = Set<string>

const FILTERS: QuickFilter[] = ["all", "open-turn", "locked", "mine"]

/** Build domain→level tree. Returns tree + mine separately (RETRY #1 REWORK-LOG openPoint 12:
 *  `(out as any).__mine` smuggle was a hidden type-breachable side channel — future consumers
 *  iterate `entries()` and render the smuggled key as a domain. Now returned as a sibling value). */
function buildTree(): { tree: Tree; mine: MineSet } {
  const g = useUi.getState().graph
  const locks = useUi.getState().locks
  const mine: MineSet = new Set()
  const turns = useUi.getState().myTurns
  for (const t of turns) for (const c of t.cells) mine.add(c)
  const out: Tree = new Map()
  if (!g) return { tree: out, mine }
  // RETRY #1 (REWORK-LOG edgeCase D): track UNIQUE claimIds per cell. Multiple nodes in a cell
  // can list the same claim id (multi-file claim) — summing `n.claims.length` double-counts.
  const claimIdsByCell = new Map<string, Set<string>>()
  for (const n of g.nodes) {
    const dom = n.domain ?? "(unassigned)"
    const lvl = String(n.level)
    const cell = `${dom}:${lvl}`
    if (!claimIdsByCell.has(cell)) claimIdsByCell.set(cell, new Set())
    const ids = claimIdsByCell.get(cell)!
    for (const cid of n.claims ?? []) ids.add(cid)
    let domMap = out.get(dom)
    if (!domMap) { domMap = new Map(); out.set(dom, domMap) }
    if (!domMap.has(lvl)) {
      const lock = locks[cell]
      domMap.set(lvl, { cell, claimCount: 0, locked: !!lock && lock.holder !== "", holder: lock?.holder, expiresAt: lock?.expiresAt })
    }
  }
  // count after dedup, so a multi-file claim doesn't double its contribution
  for (const [cell, ids] of claimIdsByCell) {
    const cut = cell.lastIndexOf(":")
    const domOf = cell.slice(0, cut)
    const lvlOf = cell.slice(cut + 1)
    const entry = out.get(domOf)?.get(lvlOf)
    if (entry) entry.claimCount = ids.size
  }
  return { tree: out, mine }
}

function pass(cell: string, entry: { locked: boolean }, filter: QuickFilter, mine: Set<string>): boolean {
  if (filter === "all") return true
  if (filter === "locked" || filter === "open-turn") return entry.locked
  if (filter === "mine") return mine.has(cell)
  return true
}

export function SidebarTree(): JSX.Element {
  const graph = useUi((s) => s.graph)
  const locks = useUi((s) => s.locks)
  const myTurns = useUi((s) => s.myTurns)
  const filter = useUi((s) => s.sidebarFilter)
  const setFilter = useUi((s) => s.setSidebarFilter)
  const setSelectedCell = useUi((s) => s.setSelectedCell)
  const selectedCell = useUi((s) => s.selectedCell)

  const { tree, mine } = useMemo(() => buildTree(), [graph, locks, myTurns, filter])

  return (
    <aside id="sidebar-tree">
      <h3>Células</h3>
      <div className="quick-filters">
        {FILTERS.map((f) => (
          <button key={f} className="quick-filter" data-quickfilter={f} data-active={filter === f} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      <ul className="domain-list">
        {[...tree.entries()].filter(([dom]) => dom !== "__mine").map(([dom, lvlMap]) => (
          <li key={dom} className="domain" data-domain={dom}>
            <div className="domain-head">{dom}</div>
            <ul className="level-list">
              {[...lvlMap.entries()].map(([lvl, e]) => (
                <li key={lvl}>
                  <button
                    className={`sidebar-cell${selectedCell === e.cell ? " selected" : ""}`}
                    data-cell={e.cell}
                    onClick={() => setSelectedCell(e.cell)}
                  >
                    <span className="lvl">P{lvl.replace(/^P/, "")}</span>
                    <span className="count">{e.claimCount}</span>
                    {e.locked && <span className="lock-badge" data-holder={e.holder} title={`🔒 ${e.holder ?? ""}`}>🔒</span>}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </aside>
  )
}