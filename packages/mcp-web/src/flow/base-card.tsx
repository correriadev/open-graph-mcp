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
import { memo } from "react"
import { useUi } from "../store"
import type { CardData } from "./to-flow"

function BaseCardInner({ data, selected }: NodeProps<Node<CardData>>) {
  const n = data.node
  const drift = useUi((s) => s.drift[n.id])
  const picking = useUi((s) => s.refPicking)
  // lock/ghost são estado da CELL, não do nó — desenhados pelo CellOverlays
  // (norte visual, correção UI-2: borda âmbar na cell inteira, nunca em nó solto)
  return (
    <div className={`og-card${selected ? " sel" : ""}${n.overclaim ? " over" : ""}${picking ? " pickable" : ""}`}>
      <Handle type="target" position={Position.Top} className="og-handle" />
      <div className="og-card-top">
        <span className="og-chip">{n.domain ?? "(unassigned)"}</span>
        <span className="og-level mono">{n.level}</span>
      </div>
      <div className="og-card-title" title={n.id}>{n.id}</div>
      <div className="og-card-body">{n.responsibility || n.anchor || "—"}</div>
      <div className="og-card-status muted">
        ● {n.claims.length} claim{n.claims.length === 1 ? "" : "s"}
        {drift && <span className="og-drift" title={`drift: ${drift}`}> ⚠ {drift}</span>}
      </div>
      <div className="og-dot" aria-hidden />
      <Handle type="source" position={Position.Bottom} className="og-handle" />
    </div>
  )
}

export const BaseCard = memo(BaseCardInner)
