/**
 * BaseCard — nó único memoizado (padrão Dify _base/node.tsx): todos os tipos
 * futuros (claim rico, âncora, ghost) especializam ISTO, não criam irmãos.
 * LOD sem re-render React: app.tsx marca data-lod no wrapper e o CSS decide o
 * que aparece (card/chip/dot) — zoom nunca dispara reconciliação de N nós.
 */
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react"
import { memo } from "react"
import type { CardData } from "./to-flow"

function authorityBadge(a: string | undefined): { label: string; cls: string } {
  if (a === "graph") return { label: "graph", cls: "ok" }
  if (a === "suspended") return { label: "suspenso", cls: "warn" }
  return { label: "source", cls: "muted" }
}

function BaseCardInner({ data, selected }: NodeProps<Node<CardData>>) {
  const n = data.node
  const badge = authorityBadge(undefined) // authority por cell chega via seleção (panel); card mostra o intrínseco
  return (
    <div className={`og-card${selected ? " sel" : ""}${n.overclaim ? " over" : ""}`}>
      <Handle type="target" position={Position.Top} className="og-handle" />
      <div className="og-card-top">
        <span className="og-chip">{n.domain ?? "(unassigned)"}</span>
        <span className="og-level mono">{n.level}</span>
      </div>
      <div className="og-card-title" title={n.id}>{n.id}</div>
      <div className="og-card-body">{n.responsibility || n.anchor || "—"}</div>
      <div className={`og-card-status ${badge.cls}`}>
        ● {n.claims.length} claim{n.claims.length === 1 ? "" : "s"}
      </div>
      <div className="og-dot" aria-hidden />
      <Handle type="source" position={Position.Bottom} className="og-handle" />
    </div>
  )
}

export const BaseCard = memo(BaseCardInner)
