/**
 * App shell UI-1: topbar (conexão + seq + identidade + settings), canvas React
 * Flow com badges vivos, roster de presença, avatares na cell focada
 * (ViewportPortal — DOM, não canvas), typing, toasts, feed de atividade.
 * LOD sem re-render: onViewportChange grava data-lod no wrapper (base-card.tsx).
 * Ids #conn/#name/#who/#panel/#pcount/#plist/#ptoggle/#typing/#toasts/#evlist/
 * #modal/#settingsBtn são API do e2e (fixture.ts + specs desta fase).
 */
import { MiniMap, ReactFlow, ReactFlowProvider, ViewportPortal, useReactFlow, type Viewport } from "@xyflow/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { dotColor, initials, type PresenceEntry } from "@open-graph-mcp/client"
import { lodForZoom } from "@open-graph-mcp/graph-core/layout"
import { BaseCard } from "./flow/base-card"
import { CARD_H, CARD_W, toFlow, type CellRect } from "./flow/to-flow"
import { connectOg, pollWho, pushToast, refreshFocus, setFocus, toastTarget } from "./og"
import { useUi } from "./store"
import { DraftPanel, MyTurns, TurnModal } from "./turn"
import { ClaimsBrowser } from "./claims-browser"
import { QueryBar } from "./query-bar"
import { HistoryView } from "./history-view"
import { SidebarTree } from "./sidebar-tree"
import { CellContainers } from "./cell-container"
import { StateLegend } from "./state-legend"
import { domainColor } from "./flow/rich-node"
import { installE2EBridge, type E2EBridgeTarget } from "./e2e-bridge"

const nodeTypes = { card: BaseCard }

function GraphMiniMap() {
  const reactFlow = useReactFlow()
  return <MiniMap
    pannable
    zoomable
    nodeColor={(node) => domainColor((node.data as { node?: { domain?: string | null } })?.node?.domain)}
    onClick={(_, position) => reactFlow.setCenter(position.x, position.y, { zoom: reactFlow.getZoom(), duration: 0 })}
  />
}

function Topbar({ onSettings, onOpenTurn }: { onSettings: () => void; onOpenTurn: () => void }) {
  const conn = useUi((s) => s.conn)
  const name = useUi((s) => s.name)
  const seq = useUi((s) => s.seq)
  const demotions = useUi((s) => s.demotions)
  const openQuery = useUi((s) => s.openQuery)
  const navigate = useUi((s) => s.navigate)
  const route = useUi((s) => s.route)
  return (
    <div id="topbar">
      <span className="title">open-graph</span>
      <span id="conn" className={conn}>{conn === "on" ? "● conectado" : "○ offline"}</span>
      <span id="seq" className="mono">seq {seq}</span>
      {demotions > 0 && <span id="drift-badge">{demotions} drifts</span>}
      <button id="queryBtn" title="Buscar (⌘K)" onClick={() => openQuery(true)}>⌘K</button>
      <a id="nav-history" href="#/history" data-active={route.startsWith("/history")} onClick={(e) => { e.preventDefault(); navigate("/history") }}>histórico</a>
      <a id="nav-canvas" href="/" data-active={!route.startsWith("/history")} onClick={(e) => { e.preventDefault(); navigate("/") }}>canvas</a>
      {name && <button id="openturn" onClick={onOpenTurn}>Abrir turno</button>}
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
      <button id="settingsBtn" title="Settings" onClick={onSettings}>⚙</button>
    </div>
  )
}

// ---- presença ---------------------------------------------------------------
function rosterLine(u: PresenceEntry): string {
  if (u.typingState === "typing") return "digitando…"
  return u.focusCell ? `focando ${u.focusCell}` : "idle"
}

function Roster() {
  const roster = useUi((s) => s.roster)
  const collapsedRef = useRef(false)
  const aside = useRef<HTMLElement>(null)
  return (
    <aside id="presence" ref={aside}>
      <div className="phead">
        <span id="pcount">Conectados ({roster.length})</span>
        <button
          id="ptoggle"
          title="expand/collapse"
          onClick={() => {
            collapsedRef.current = !collapsedRef.current
            aside.current?.classList.toggle("collapsed", collapsedRef.current)
          }}
        >▾</button>
      </div>
      <ul id="plist">
        {roster.map((u) => (
          <li key={u.userId}>
            <span className={`dot ${dotColor(u.lastSeen)}`} />
            <b>{u.name}</b> <span className="kind">({u.agentKind === "web" ? "web" : `🤖 ${u.agentKind}`})</span>
            <div className="sub">
              {rosterLine(u)}
              {u.openCount > 0 && ` · turno${u.openCount > 1 ? ` ×${u.openCount}` : ""}`}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function TypingIndicator() {
  const roster = useUi((s) => s.roster)
  const locks = useUi((s) => s.locks)
  const typist = roster.find((u) => u.typingState === "typing")
  if (!typist) return null
  const lock = typist.focusCell ? locks[typist.focusCell] : undefined
  const csId = lock && lock.holder === typist.userId ? lock.csId : null
  return (
    <div id="typing">
      {typist.name} está editando{csId ? ` ${csId}` : ""}
      <span className="dots"><span>.</span><span>.</span><span>.</span></span>
    </div>
  )
}

/** Avatares DOM na cell focada (ViewportPortal — coordenadas de mundo, junto com os nós). */
function AvatarsLayer({ cells }: { cells: Record<string, CellRect> }) {
  const roster = useUi((s) => s.roster)
  const locks = useUi((s) => s.locks)
  const byCell = new Map<string, PresenceEntry[]>()
  for (const u of roster) {
    if (!u.focusCell || !cells[u.focusCell]) continue
    if (!byCell.has(u.focusCell)) byCell.set(u.focusCell, [])
    byCell.get(u.focusCell)!.push(u)
  }
  return (
    <ViewportPortal>
      {[...byCell.entries()].flatMap(([cell, users]) => {
        const rect = cells[cell]!
        return users.map((u, i) => {
          const locked = locks[cell]?.holder === u.userId
          return (
            <div
              key={u.userId}
              className={`og-avatar${locked ? " solid" : ""}`}
              data-user={u.userId}
              style={{ transform: `translate(${rect.x + rect.w + 10}px, ${rect.y + i * 34}px)` }}
            >
              {initials(u.name)}
              <div className="avatar-tip">
                {u.name} · {u.agentKind}
                {locked ? " · turno aberto" : ""} · última atividade {new Date(u.lastSeen).toLocaleTimeString()}
              </div>
            </div>
          )
        })
      })}
    </ViewportPortal>
  )
}

// ---- toasts + feed ----------------------------------------------------------
function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const requestCenter = useUi((s) => s.requestCenter)
  return (
    <div id="toasts">
      {toasts.list.map((t) => (
        <div
          key={t.id}
          className="toast"
          data-id={t.id}
          title={new Date(t.ts).toLocaleTimeString()}
          onClick={() => {
            const target = toastTarget(t.id)
            if (target) requestCenter(target)
          }}
        >{t.text}</div>
      ))}
      {toasts.overflow > 0 && <div className="toast overflow">(+{toasts.overflow})</div>}
    </div>
  )
}

function Feed() {
  const events = useUi((s) => s.events)
  const requestCenter = useUi((s) => s.requestCenter)
  return (
    <aside id="events">
      <h3>Atividade recente</h3>
      <ul id="evlist" className="mono">
        {[...events].sort((a, b) => a.seq - b.seq).map((e) => (
          <li
            key={e.seq}
            data-seq={e.seq}
            data-kind={e.kind.split(".")[0]}
            onClick={() => e.target && requestCenter(e.target)}
          >
            {new Date(e.ts).toLocaleTimeString()} · {e.kind} · {e.target ?? ""}
          </li>
        ))}
      </ul>
    </aside>
  )
}

// ---- settings ---------------------------------------------------------------
function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useUi((s) => s.settings)
  const setSettings = useUi((s) => s.setSettings)
  if (!open) return null
  return (
    <div id="modal">
      <div className="dialog">
        <h3>Settings</h3>
        <label className="chk">
          <input
            type="checkbox"
            id="s_presence"
            checked={settings.showPresence}
            onChange={(e) => {
              setSettings({ ...settings, showPresence: e.target.checked })
              // re-envia a MESMA cell com o flag novo (server só muda invisibilidade com boolean explícito)
              refreshFocus()
            }}
          />
          Mostrar minha presença para outros
        </label>
        <label className="chk">
          <input
            type="checkbox"
            id="s_notify"
            checked={settings.notifyCommits}
            onChange={(e) => setSettings({ ...settings, notifyCommits: e.target.checked })}
          />
          Receber notificações de commit em cells que observo
        </label>
        <div className="row"><button id="sclose" onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  )
}

// ---- painel do nó -----------------------------------------------------------
function NodePanel() {
  const graph = useUi((s) => s.graph)
  const selectedId = useUi((s) => s.selectedId)
  const select = useUi((s) => s.select)
  const locks = useUi((s) => s.locks)
  const drift = useUi((s) => s.drift)
  const node = useMemo(
    () => (graph && selectedId ? graph.nodes.find((n) => n.id === selectedId) : undefined),
    [graph, selectedId],
  )
  if (!node) return null
  const cell = `${node.domain ?? "(unassigned)"}:${node.level}`
  const authority = graph!.authority?.[cell] ?? "source"
  const lock = locks[cell]
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
        <dt>drift</dt>
        <dd>{drift[node.id] ?? "—"}</dd>
        {lock && (
          <>
            <dt>🔒 locked by</dt>
            <dd>{lock.holder} · {lock.csId}<br />expira {new Date(lock.expiresAt).toLocaleTimeString()}</dd>
          </>
        )}
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

/** Centra a câmera na cell/nó pedido por toast/feed; e2e builds additionally expose test controls. */
function CameraDriver({ cells }: { cells: Record<string, CellRect> }) {
  const rf = useReactFlow()
  const centerCell = useUi((s) => s.centerCell)
  const graph = useUi((s) => s.graph)
  const requestCenter = useUi((s) => s.requestCenter)
  useEffect(() => {
    if (!centerCell) return
    const rect = cells[centerCell]
    if (rect) rf.setCenter(rect.x + rect.w / 2, rect.y + rect.h / 2, { zoom: 0.8, duration: 300 })
    else {
      const n = rf.getNodes().find((x) => x.id === centerCell)
      if (n) rf.setCenter(n.position.x, n.position.y, { zoom: 0.8, duration: 300 })
    }
    requestCenter(null)
  }, [centerCell, cells, graph, rf, requestCenter])
  useEffect(() => {
    if (!__OG_E2E__) return
    return installE2EBridge(window as Window & E2EBridgeTarget, {
      setFocus,
      pushToast,
      pollWho,
      getViewport: () => rf.getViewport(),
      setViewport: (viewport: Viewport) => rf.setViewport(viewport),
      focusNode: (id: string, zoom: number) => {
        const node = rf.getNode(id)
        if (node) rf.setCenter(node.position.x + CARD_W / 2, node.position.y + CARD_H / 2, { zoom, duration: 0 })
      },
      setNodeResponsibility: (id: string, responsibility: string) => useUi.setState((state) => ({
        graph: state.graph ? { ...state.graph, nodes: state.graph.nodes.map((node) => node.id === id ? { ...node, responsibility } : node) } : null,
      })),
      setNodeDrift: (id: string, grade: string) => useUi.setState((state) => ({ drift: { ...state.drift, [id]: grade } })),
      setCellAuthority: (cell: string, authority: "source" | "graph" | "suspended") => useUi.setState((state) => ({
        graph: state.graph ? { ...state.graph, authority: { ...state.graph.authority, [cell]: authority } } : null,
      })),
    })
  }, [rf])
  return null
}

function Shell() {
  const graph = useUi((s) => s.graph)
  const select = useUi((s) => s.select)
  const wrapRef = useRef<HTMLDivElement>(null)
  const flow = useMemo(() => (graph ? toFlow(graph) : { nodes: [], edges: [], cells: {} }), [graph])
  return (
    <>
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
            if (!wrapRef.current) return
            wrapRef.current.dataset.lod = lodForZoom(vp.zoom)
            // `--zoom` deixa o CSS CONTRA-ESCALAR o que precisa ter tamanho de TELA constante
            // (dot do overview, rótulo da célula). Sem isto eles vivem dentro do transform do
            // React Flow e encolhem junto: medido no harness-kit, o fitView sobre 186 nós cai
            // em zoom 0.1 e um dot de 14px virava 1.4 pixel — o canvas parecia vazio.
            wrapRef.current.style.setProperty("--zoom", String(vp.zoom))
          }}
          onInit={(rf) => {
            // fitView roda antes do primeiro onViewportChange: sem semear aqui, o primeiro
            // paint usa --zoom: 1 e pisca com os dots minúsculos.
            if (wrapRef.current) {
              const zoom = rf.getZoom()
              wrapRef.current.dataset.lod = lodForZoom(zoom)
              wrapRef.current.style.setProperty("--zoom", String(zoom))
            }
          }}
          onNodeClick={(_, n) => {
            const st = useUi.getState()
            if (st.refPicking) {
              st.pickRef(n.id) // modo ref-por-clique: nó vira ref, sem seleção/focus
              return
            }
            select(n.id)
            setFocus((n.data as { cell?: string }).cell ?? null) // clicar nó = focar a cell dele (spec §7)
          }}
          onPaneClick={() => select(null)}
        >
          <AvatarsLayer cells={flow.cells} />
          <CellContainers cells={flow.cells} />
          <CameraDriver cells={flow.cells} />
          <GraphMiniMap />
        </ReactFlow>
      </div>
      <NodePanel />
      <StateLegend />
    </>
  )
}

function RouteDriver(): JSX.Element {
  const route = useUi((s) => s.route)
  if (route.startsWith("/history")) return <HistoryView />
  return <></>
}

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [turnOpen, setTurnOpen] = useState(false)
  const [requestedCell, setRequestedCell] = useState<string | null>(null)
  const route = useUi((s) => s.route)
  const openTurnRequest = useUi((s) => s.openTurnRequest)
  useEffect(() => {
    const syncRoute = () => useUi.setState({ route: window.location.hash.replace(/^#/, "").split("?")[0] || "/" })
    syncRoute()
    window.addEventListener("hashchange", syncRoute)
    return () => window.removeEventListener("hashchange", syncRoute)
  }, [])
  useEffect(() => {
    if (openTurnRequest) {
      setRequestedCell(openTurnRequest)
      setTurnOpen(true)
      useUi.getState().requestOpenTurn(null) // consume
    }
  }, [openTurnRequest])
  return (
    <ReactFlowProvider>
      <Topbar onSettings={() => setSettingsOpen(true)} onOpenTurn={() => setTurnOpen(true)} />
      {route.startsWith("/history") ? (
        <RouteDriver />
      ) : (
        <Shell />
      )}
      {/*SidebarTree disabled for reconnect-revert investigation */}
      {!route.startsWith("/history") && <SidebarTree />}
      {!route.startsWith("/history") && <ClaimsBrowser />}
      <Roster />
      <Feed />
      <TypingIndicator />
      <Toasts />
      <DraftPanel />
      <MyTurns />
      <QueryBar />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <TurnModal open={turnOpen} initialCell={requestedCell} onClose={() => { setTurnOpen(false); setRequestedCell(null) }} />
    </ReactFlowProvider>
  )
}
