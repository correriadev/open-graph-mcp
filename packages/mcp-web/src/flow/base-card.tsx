/**
 * BaseCard — nó único memoizado (padrão Dify _base/node.tsx): todos os tipos
 * futuros (claim rico, âncora, ghost) especializam ISTO, não criam irmãos.
 * LOD sem re-render React: app.tsx marca data-lod no wrapper e o CSS decide o
 * que aparece (card/chip/dot) — zoom nunca dispara reconciliação de N nós.
 * Estado vivo (lock/ghost/drift) entra por seletor zustand PRÓPRIO por card:
 * um evento SSE re-renderiza só os cards da cell afetada, nunca os N nós
 * (mitigação do risco 1 do 01-scope — broadcast storm não vira jank).
 */
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react"
import { lazy, memo, Suspense } from "react"
import type { CSSProperties } from "react"
import { useUi } from "../store"
import type { CardData } from "./to-flow"
import { domainColor, markdownSource, resolveVisualState } from "./rich-node"
const SafeMarkdown = lazy(() => import("./safe-markdown").then((module) => ({ default: module.SafeMarkdown })))

function BaseCardInner({ data }: NodeProps<Node<CardData>>) {
  const n = data.node
  const drift = useUi((s) => s.drift[n.id])
  const picking = useUi((s) => s.refPicking)
  const selectedId = useUi((s) => s.selectedId)
  const lock = useUi((s) => s.locks[data.cell])
  const ghost = useUi((s) => s.ghostCells[data.cell])
  const authority = useUi((s) => s.graph?.authority?.[data.cell])
  const avatarNames = useUi((s) => s.roster.filter((user) => user.focusCell === data.cell).map((user) => user.name).join("|"))
  const avatars = avatarNames ? avatarNames.split("|") : []
  const visual = resolveVisualState({ authority, drift, locked: !!lock, ghost: !!ghost })
  const pinned = selectedId === n.id
  return (
    <div
      className={`og-card state-${visual.state}${pinned ? " sel" : ""}${n.overclaim ? " over" : ""}${picking ? " pickable" : ""}`}
      data-id={n.id}
      data-pinned={pinned ? "true" : "false"}
      aria-label={`${n.id}, ${visual.markers.join(", ")}`}
      style={{ "--domain-color": domainColor(n.domain) } as CSSProperties}
    >
      <Handle type="target" position={Position.Top} className="og-handle" />
      <div className="og-card-top">
        <span className="og-chip">{n.domain ?? "(unassigned)"}</span>
        <span className="og-level mono">{n.level}</span>
      </div>
      <div className="og-card-title" title={n.id}>{n.id}</div>
      <div className="og-card-body og-markdown"><Suspense fallback={<span>carregando…</span>}><SafeMarkdown>{markdownSource(n)}</SafeMarkdown></Suspense></div>
      <div className="og-card-status">
        <span className="og-node-status" data-state={visual.state}>{visual.markers.join(" · ")}</span>
        <span> · {n.claims.length} claim{n.claims.length === 1 ? "" : "s"}</span>
        {n.confidence !== null && <span> · {n.confidence.toFixed(2)}</span>}
        {avatars.length > 0 && <span className="og-card-avatars" aria-label={`${avatars.length} participantes`}>{avatars.slice(0, 3).map((name) => name.slice(0, 1).toUpperCase()).join(" ")}</span>}
      </div>
      <div className="og-dot" data-domain={n.domain ?? "unassigned"} aria-label={`${n.id}, ${visual.state}`} />
      <Handle type="source" position={Position.Bottom} className="og-handle" />
    </div>
  )
}

export const BaseCard = memo(BaseCardInner)
