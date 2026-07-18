/**
 * spike-rf — protótipo DESCARTÁVEL do gate de escala UI-0 (Parte A).
 * Mede FPS de pan/zoom do @xyflow/react com grafos sintéticos.
 * Query params: ?n=<nós>&g=<grupos>&culling=on|off&cards=on|off
 * `window.__spike.run()` anima a câmera e devolve {fps, frames, ms}.
 * Fora do build de produção (vite só empacota o index.html raiz).
 */
import { Background, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react"
import type { Edge, Node, NodeProps } from "@xyflow/react"
import React, { useMemo } from "react"
import { createRoot } from "react-dom/client"
import "@xyflow/react/dist/style.css"

const q = new URLSearchParams(location.search)
const N = Number(q.get("n") ?? 1000)
const G = Number(q.get("g") ?? 6)
const CULLING = (q.get("culling") ?? "on") === "on"
const CARDS = (q.get("cards") ?? "on") === "on"

// ---- grafo sintético: G grupos, N nós distribuídos, edges encadeadas + aleatórias ----
const GROUP_W = 900
const GROUP_GAP = 140
const perGroup = Math.ceil(N / G)
const cols = Math.ceil(Math.sqrt(perGroup))
const CELL = 190

const nodes: Node[] = []
const edges: Edge[] = []

for (let gi = 0; gi < G; gi++) {
  const rows = Math.ceil(perGroup / cols)
  const gx = (gi % 3) * (GROUP_W + GROUP_GAP)
  const gy = Math.floor(gi / 3) * (rows * CELL + 220)
  nodes.push({
    id: `group-${gi}`,
    type: "cellGroup",
    position: { x: gx, y: gy },
    data: { label: `dominio-${gi}:P${(gi % 5) + 1}` },
    style: { width: cols * CELL + 40, height: rows * CELL + 70, zIndex: -1 },
  })
  for (let i = 0; i < perGroup && gi * perGroup + i < N; i++) {
    const id = `n-${gi}-${i}`
    nodes.push({
      id,
      type: "card",
      parentId: `group-${gi}`,
      extent: "parent",
      position: { x: 20 + (i % cols) * CELL, y: 50 + Math.floor(i / cols) * CELL },
      data: { title: `claim ${gi}.${i}`, domain: `dominio-${gi}`, body: "Um claim sintético com duas linhas de resumo pra dar altura de card real." },
    })
    if (i > 0) edges.push({ id: `e-${gi}-${i}`, source: `n-${gi}-${i - 1}`, target: id })
    if (i % 7 === 3 && gi > 0)
      edges.push({ id: `x-${gi}-${i}`, source: `n-${gi - 1}-${i % perGroup}`, target: id })
  }
}

// ---- nós custom: card rico (aprox. do BaseCard futuro) e container de cell ----
function Card({ data }: NodeProps) {
  const d = data as { title: string; domain: string; body: string }
  return (
    <div style={{ width: 170, background: "#121218", border: "1px solid #26262e", borderRadius: 8, padding: 8, color: "#e6e6eb", fontSize: 11, fontFamily: "system-ui" }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ background: "#8b5cf622", color: "#a78bfa", borderRadius: 4, padding: "1px 5px", fontSize: 9 }}>{d.domain}</span>
      </div>
      <div style={{ fontWeight: 600, margin: "4px 0" }}>{d.title}</div>
      {CARDS && <div style={{ color: "#8a8f98", fontSize: 10 }}>{d.body}</div>}
      <div style={{ marginTop: 4, color: "#10b981", fontSize: 9 }}>● publicado</div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}

function CellGroup({ data }: NodeProps) {
  const d = data as { label: string }
  return (
    <div style={{ width: "100%", height: "100%", border: "1px solid #26262e", borderRadius: 12, background: "#0e0e14aa" }}>
      <div style={{ padding: "8px 12px", color: "#8a8f98", fontSize: 12, fontFamily: "ui-monospace" }}>{d.label}</div>
    </div>
  )
}

const nodeTypes = { card: React.memo(Card), cellGroup: React.memo(CellGroup) }

// ---- medição: anima viewport com rAF e conta frames ----
function Bench() {
  const rf = useReactFlow()
  useMemo(() => {
    ;(window as any).__spike = {
      config: { N, G, CULLING, CARDS },
      ready: false,
      async run(durationMs = 5000): Promise<{ fps: number; frames: number; ms: number }> {
        await rf.fitView()
        const t0 = performance.now()
        let frames = 0
        return new Promise((resolve) => {
          const tick = () => {
            const t = performance.now() - t0
            frames++
            // trajeto: pan lateral + zoom in/out contínuos (pior caso de culling: mount/unmount no pan)
            const phase = t / durationMs
            const zoom = 0.4 + 0.5 * Math.abs(Math.sin(phase * Math.PI * 3))
            rf.setViewport({ x: -phase * 2200, y: -300 * Math.sin(phase * Math.PI * 2), zoom })
            if (t < durationMs) requestAnimationFrame(tick)
            else resolve({ fps: Math.round((frames / t) * 1000), frames, ms: Math.round(t) })
          }
          requestAnimationFrame(tick)
        })
      },
    }
    setTimeout(() => (((window as any).__spike.ready = true), undefined), 500)
  }, [rf])
  return null
}

function App() {
  document.getElementById("hud")!.textContent = `spike-rf n=${N} g=${G} culling=${CULLING} cards=${CARDS}`
  return (
    <ReactFlow
      defaultNodes={nodes}
      defaultEdges={edges}
      nodeTypes={nodeTypes}
      onlyRenderVisibleElements={CULLING}
      minZoom={0.05}
      fitView
    >
      <Background gap={14} size={2} color="#1a1a22" />
      <Bench />
    </ReactFlow>
  )
}

createRoot(document.getElementById("root")!).render(
  <ReactFlowProvider>
    <App />
  </ReactFlowProvider>,
)
