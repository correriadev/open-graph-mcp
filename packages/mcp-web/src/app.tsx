/**
 * App shell UI-0: topbar (conexão + identidade), canvas React Flow read-only,
 * painel lateral do nó selecionado. LOD sem re-render: onViewportChange grava
 * data-lod no wrapper e o CSS (app.css) decide card/chip/dot — contrato descrito
 * em base-card.tsx. Ids #conn/#name/#who/#panel são API do e2e (fixture.ts).
 */
import { ReactFlow, type Viewport } from "@xyflow/react"
import { useMemo, useRef } from "react"
import { lodForZoom } from "@open-graph-mcp/graph-core/layout"
import { BaseCard } from "./flow/base-card"
import { toFlow } from "./flow/to-flow"
import { connectOg } from "./og"
import { useUi } from "./store"

const nodeTypes = { card: BaseCard }

function Topbar() {
  const conn = useUi((s) => s.conn)
  const name = useUi((s) => s.name)
  return (
    <div id="topbar">
      <span className="title">open-graph</span>
      <span id="conn" className={conn}>{conn === "on" ? "● conectado" : "○ offline"}</span>
      {name && <span id="who">{name}</span>}
      <input
        id="name"
        placeholder="seu nome"
        defaultValue={localStorage.getItem("og.name") ?? ""}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim()
          if (v && v !== name) connectOg(v)
        }}
      />
    </div>
  )
}

function NodePanel() {
  const graph = useUi((s) => s.graph)
  const selectedId = useUi((s) => s.selectedId)
  const select = useUi((s) => s.select)
  const node = useMemo(
    () => (graph && selectedId ? graph.nodes.find((n) => n.id === selectedId) : undefined),
    [graph, selectedId],
  )
  if (!node) return null
  const cell = `${node.domain ?? "(unassigned)"}:${node.level}`
  const authority = graph!.authority?.[cell] ?? "source"
  return (
    <div id="panel">
      <button className="close" onClick={() => select(null)} aria-label="fechar">×</button>
      <h3>{node.id}</h3>
      <dl>
        <dt>cell</dt>
        <dd className="mono">{cell}</dd>
        <dt>authority</dt>
        <dd className={`auth-${authority}`}>{authority}</dd>
        <dt>responsibility</dt>
        <dd>{node.responsibility || "—"}</dd>
        <dt>anchor</dt>
        <dd className="mono">{node.anchor || "—"}</dd>
        <dt>claims</dt>
        <dd>
          {node.claims.length}
          {node.confidence !== null && ` · confiança ${node.confidence.toFixed(2)}`}
          {node.overclaim && " · OVERCLAIM"}
        </dd>
      </dl>
    </div>
  )
}

export function App() {
  const graph = useUi((s) => s.graph)
  const select = useUi((s) => s.select)
  const wrapRef = useRef<HTMLDivElement>(null)
  const flow = useMemo(() => (graph ? toFlow(graph) : { nodes: [], edges: [] }), [graph])

  return (
    <>
      <Topbar />
      <div className="canvas-wrap" ref={wrapRef} data-lod="node">
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          onlyRenderVisibleElements
          fitView
          // minZoom default do RF (0.5) > LOD_TOWER_MAX_ZOOM (0.35): sem isto o LOD "tower" é inatingível
          minZoom={0.1}
          nodesDraggable={false}
          nodesConnectable={false}
          onViewportChange={(vp: Viewport) => {
            if (wrapRef.current) wrapRef.current.dataset.lod = lodForZoom(vp.zoom)
          }}
          onNodeClick={(_, n) => select(n.id)}
          onPaneClick={() => select(null)}
        />
      </div>
      <NodePanel />
    </>
  )
}
