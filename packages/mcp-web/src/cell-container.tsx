import { ViewportPortal } from "@xyflow/react"
import { useEffect, useMemo, useState } from "react"
import { useUi } from "./store"
import type { CellRect } from "./flow/to-flow"
import { aggregateCell, resolveHolderName } from "./flow/rich-node"

function countdown(expiresAt?: string, now = Date.now()): string {
  if (!expiresAt) return ""
  return `${Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000))}s`
}

export function CellContainers({ cells }: { cells: Record<string, CellRect> }) {
  const graph = useUi((state) => state.graph)
  const locks = useUi((state) => state.locks)
  const roster = useUi((state) => state.roster)
  const ghosts = useUi((state) => state.ghostDeltasByCell)
  const refPicking = useUi((state) => state.refPicking)
  const pickRef = useUi((state) => state.pickRef)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  const counts = useMemo(() => {
    const result: Record<string, { nodes: number; claims: Set<string> }> = {}
    for (const node of graph?.nodes ?? []) {
      const cell = `${node.domain ?? "(unassigned)"}:${node.level}`
      const entry = result[cell] ??= { nodes: 0, claims: new Set() }
      entry.nodes++
      for (const claim of node.claims) entry.claims.add(claim)
    }
    return result
  }, [graph])
  const containers = <ViewportPortal>{Object.entries(cells).map(([cell, rect]) => {
    const lock = locks[cell]
    const users = aggregateCell({ claims: [], users: roster.filter((user) => user.focusCell === cell) }).users
    const stats = counts[cell] ?? { nodes: 0, claims: new Set<string>() }
    return <div
      key={cell}
      className={`og-cell-container${lock ? " review" : ""}${ghosts[cell]?.length ? " ghosted" : ""}`}
      data-cell={cell}
      style={{ transform: `translate(${rect.x - 12}px, ${rect.y - 12}px)`, width: rect.w + 24, height: rect.h + 24 }}
    >
      {/* F1: sem gatilho de "abrir turno" — o header vira leitura pura (nós/claims/quem edita).
          A transição pra edição acontece no NÓ (NodePanel), não na célula inteira. */}
      <div className="og-cell-header" data-cell={cell}>
        <strong>{cell}</strong><span>{stats.nodes} nós · {stats.claims.size} claims</span>
        {lock && <span className="og-lock-badge" aria-label={`em edição por ${resolveHolderName(lock.holder, roster)}`}>em edição por {resolveHolderName(lock.holder, roster)} · {countdown(lock.expiresAt, now)}</span>}
        <span className="og-cell-avatars" aria-label={`${users.length} participantes`}>
          {users.slice(0, 3).map((user) => <span key={user.userId} title={user.name}>{user.name.slice(0, 1).toUpperCase()}</span>)}
          {users.length > 3 && <span>+{users.length - 3}</span>}
        </span>
      </div>
      {(ghosts[cell] ?? []).length > 0 && <div className="og-ghosts">{ghosts[cell].map((ghost, index) => <div
        key={index}
        className={`og-ghost-card${refPicking && ghost.id ? " pickable" : ""}`}
        data-claim={ghost.id ?? ""}
        onClick={() => refPicking && ghost.id && pickRef(ghost.id)}
      >Rascunho · {ghost.summary}</div>)}</div>}
    </div>
  })}</ViewportPortal>
  const emptyLockedCells = Object.keys(locks).filter((cell) => !cells[cell])
  return <>
    {containers}
    {emptyLockedCells.length > 0 && <aside id="empty-cell-locks" aria-label="Em edição em cells sem nós">{emptyLockedCells.map((cell) => <div key={cell} data-cell={cell}>{cell} em edição por {resolveHolderName(locks[cell]!.holder, roster)}</div>)}</aside>}
  </>
}

export { countdown as cellLockCountdown }
