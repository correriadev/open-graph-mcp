import type { GraphNode } from "@open-graph-mcp/graph-core/build"
import * as api from "./api"
import { Renderer } from "./render"
import { EventStream, type Envelope } from "./subscribe"

const DRIFT_KINDS = new Set(["drift.node", "drift.cell"])

document.body.innerHTML = `
<div id="topbar">
  <span id="title">open-graph</span>
  <span id="conn" class="off">● disconnected</span>
  <span id="seq">seq 0</span>
  <span id="drift" hidden></span>
  <button id="rebuild">Re-bootstrap</button>
</div>
<canvas id="cv"></canvas>
<aside id="events"><h3>events</h3><ul id="evlist"></ul></aside>
<section id="panel" hidden></section>`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $("cv") as HTMLCanvasElement

const renderer = new Renderer(canvas, {
  onNodePick: (n, cell, authority, drift) => showPanel(n, cell, authority, drift),
})

// ---- drift badge: cells demoted in the last 24h ----------------------------
const demotions = new Map<string, number>() // cell → ts
function refreshDriftBadge() {
  const cutoff = Date.now() - 24 * 3600_000
  const n = [...demotions.values()].filter((ts) => ts >= cutoff).length
  const el = $("drift")
  el.hidden = n === 0
  el.textContent = `${n} drifts unresolved`
}

// ---- side panel ------------------------------------------------------------
function showPanel(n: GraphNode, cell: string, authority: string, drift: string | null) {
  const p = $("panel")
  p.hidden = false
  p.innerHTML = `
    <button id="close">×</button>
    <h3>${esc(n.id)}</h3>
    <dl>
      <dt>responsibility</dt><dd>${esc(n.responsibility || "—")}</dd>
      <dt>anchor</dt><dd>${esc(n.anchor || "—")}</dd>
      <dt>cell</dt><dd>${esc(cell)}</dd>
      <dt>authority</dt><dd>${esc(authority)}</dd>
      <dt>drift grade</dt><dd>${esc(drift ?? "—")}</dd>
    </dl>`
  $("close").onclick = () => (p.hidden = true)
}

// ---- live events sidebar (last 20) -----------------------------------------
function pushEvent(env: Envelope) {
  const ul = $("evlist")
  const li = document.createElement("li")
  const t = new Date(env.ts || Date.now()).toLocaleTimeString()
  li.textContent = `${t} · ${env.kind} · ${env.target ?? ""}`
  li.title = "focus"
  li.onclick = () => renderer.focusTarget(env.target)
  ul.prepend(li)
  while (ul.children.length > 20) ul.lastChild!.remove()
}

function applyEvent(env: Envelope) {
  pushEvent(env)
  $("seq").textContent = `seq ${env.seq}`
  if (DRIFT_KINDS.has(env.kind) && env.target) renderer.markDrift(env.target, env.payload?.grade ?? "drift")
  if (env.kind === "authority.demoted" && env.target) {
    demotions.set(env.target, env.ts || Date.now())
    refreshDriftBadge()
  }
  if (env.kind === "authority.reconciled" && env.target) {
    demotions.delete(env.target)
    refreshDriftBadge()
  }
  if (env.kind === "graph.rebuilt" || env.kind === "graph.bootstrapped") loadSnapshot()
}

// ---- snapshot / bootstrap --------------------------------------------------
async function loadSnapshot() {
  try {
    renderer.setGraph(await api.readSnapshot())
  } catch (e) {
    console.error("snapshot failed", e)
  }
}

$("rebuild").onclick = () => api.rebuild().catch((e) => console.error("rebuild failed", e))

const setConn = (up: boolean) => {
  const el = $("conn")
  el.className = up ? "on" : "off"
  el.textContent = up ? "● connected" : "● disconnected"
}

const stream = new EventStream({
  onEvent: applyEvent,
  onReset: loadSnapshot,
  onOpen: () => setConn(true),
  onClose: () => setConn(false),
})

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)

loadSnapshot()
stream.start()
