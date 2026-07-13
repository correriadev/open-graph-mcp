import type { Graph, GraphNode } from "@open-graph-mcp/graph-core/build"
import * as api from "./api"
import { GhostStore, type GhostDelta } from "./ghosts"
import { Renderer } from "./render"
import { EventStream, type Envelope } from "./subscribe"

const DRIFT_KINDS = new Set(["drift.node", "drift.cell"])
const CS_KINDS = new Set([
  "changeset.opened",
  "changeset.delta",
  "changeset.committed",
  "changeset.aborted",
  "lock.acquired",
  "lock.released",
])
const LEVELS = ["P1", "P2", "P3", "P4", "P5"]
const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)

document.body.innerHTML = `
<div id="topbar">
  <span id="title">open-graph</span>
  <span id="conn" class="off">● disconnected</span>
  <span id="seq">seq 0</span>
  <span id="drift" hidden></span>
  <input id="name" placeholder="your name" size="10" />
  <span id="who"></span>
  <button id="openturn">Open Turn</button>
  <a id="histlink" href="#/history">history</a>
  <button id="rebuild">Re-bootstrap</button>
</div>
<canvas id="cv"></canvas>
<aside id="events"><h3>events</h3><ul id="evlist"></ul></aside>
<section id="panel" hidden></section>
<section id="draft" hidden></section>
<section id="history" hidden></section>
<div id="modal" hidden></div>`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $("cv") as HTMLCanvasElement

const renderer = new Renderer(canvas, {
  onNodePick: (n, cell, authority, drift) => showPanel(n, cell, authority, drift),
})

const ghosts = new GhostStore()
let graph: Graph | null = null
let activeCsId: string | null = null // changeset this client is drafting

// ---- session / reconnect (spec §9) -----------------------------------------
const tenant = new URLSearchParams(location.search).get("tenant") || "default"

async function bootSession(): Promise<void> {
  const saved = localStorage.getItem("og.token")
  if (saved) {
    api.setToken(saved)
    $<HTMLInputElement>("name").value = localStorage.getItem("og.name") || ""
    $("who").textContent = localStorage.getItem("og.name") || ""
    await reattach()
    return
  }
  const name = ($<HTMLInputElement>("name").value || localStorage.getItem("og.name") || "").trim()
  if (!name) return // wait until the user types a name and blurs
  try {
    const s = await api.registerSession(name, tenant)
    api.setToken(s.token)
    localStorage.setItem("og.token", s.token)
    localStorage.setItem("og.name", name)
    $("who").textContent = name
    await reattach()
  } catch (e) {
    console.error("register failed", e)
  }
}

/** Re-attach any open changeset owned by this session (spec §9). */
async function reattach(): Promise<void> {
  try {
    const res = await api.listMine()
    const mine: any[] = res?.changesets ?? res ?? []
    for (const cs of mine) {
      ghosts.track({
        csId: cs.csId ?? cs.id,
        intent: cs.intent ?? "",
        cells: cs.cells ?? [],
        byUser: cs.byUser ?? localStorage.getItem("og.name") ?? "",
        openedAt: cs.openedAt ?? 0,
        expiresAt: cs.expiresAt ?? 0,
        deltaCount: 0,
        deltas: [],
      })
      refetchDeltas(cs.csId ?? cs.id)
    }
    if (mine[0]) {
      activeCsId = mine[0].csId ?? mine[0].id
      renderDraft()
    }
    renderer.setGhosts(ghosts.changesets.values(), ghosts.locks.values())
  } catch (e) {
    console.error("list_mine failed", e)
  }
}

$<HTMLInputElement>("name").onchange = async () => {
  if (localStorage.getItem("og.token")) return // already registered this session
  await bootSession()
  if (api.getToken()) stream.reset() // reopen SSE carrying the fresh token
}

// ---- drift badge (Phase 1) -------------------------------------------------
const demotions = new Map<string, number>()
function refreshDriftBadge() {
  const cutoff = Date.now() - 24 * 3600_000
  const n = [...demotions.values()].filter((ts) => ts >= cutoff).length
  const el = $("drift")
  el.hidden = n === 0
  el.textContent = `${n} drifts unresolved`
}

// ---- node side panel (Phase 1, + lock info) --------------------------------
function showPanel(n: GraphNode, cell: string, authority: string, drift: string | null) {
  const lock = ghosts.locks.get(cell)
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
      ${lock ? `<dt>🔒 locked by</dt><dd>${esc(lock.holder)} · ${esc(lock.csId)}<br>expires ${new Date(lock.expiresAt).toLocaleTimeString()}</dd>` : ""}
    </dl>`
  $("close").onclick = () => (p.hidden = true)
}

// ---- events sidebar --------------------------------------------------------
function pushEvent(env: Envelope) {
  const ul = $("evlist")
  const li = document.createElement("li")
  const t = new Date(env.ts || Date.now()).toLocaleTimeString()
  li.textContent = `${t} · ${env.kind} · ${env.target ?? ""}`
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

  if (CS_KINDS.has(env.kind) || env.kind === "authority.flipped") {
    const r = ghosts.apply(env)
    if (r.refetch) refetchDeltas(r.refetch)
    if (r.committed) loadSnapshot()
    if (env.kind === "changeset.committed" || env.kind === "changeset.aborted") {
      if (env.payload?.csId === activeCsId) {
        activeCsId = null
        renderDraft()
      }
    }
    renderer.setGhosts(ghosts.changesets.values(), ghosts.locks.values())
  }
}

// ---- ghost deltas: debounced refetch of graph://changeset/{id} (spec §7.1) -
const refetchTimers = new Map<string, ReturnType<typeof setTimeout>>()
function refetchDeltas(csId: string) {
  clearTimeout(refetchTimers.get(csId))
  refetchTimers.set(
    csId,
    setTimeout(async () => {
      try {
        const res = await api.readChangeset(csId)
        const raw: any[] = res?.deltas ?? res?.changeset?.deltas ?? []
        ghosts.setDeltas(csId, raw.map(toGhostDelta))
        renderer.setGhosts(ghosts.changesets.values(), ghosts.locks.values())
        if (csId === activeCsId) renderDraft()
      } catch (e) {
        console.error("changeset refetch failed", e)
      }
    }, 150),
  )
}

function toGhostDelta(d: any): GhostDelta {
  const pl = d.payload ?? {}
  const summary = pl.subject ?? pl.cell ?? d.kind
  return { kind: d.kind, subject: pl.subject, domain: pl.domain ?? null, level: pl.level, summary, at: d.createdAt ?? d.at }
}

// ---- snapshot --------------------------------------------------------------
async function loadSnapshot() {
  try {
    graph = await api.readSnapshot()
    renderer.setGraph(graph)
    await loadOpenChangesets()
  } catch (e) {
    console.error("snapshot failed", e)
  }
}

async function loadOpenChangesets() {
  try {
    const res = await api.readOpenChangesets()
    const list: any[] = res?.changesets ?? res ?? []
    for (const cs of list) {
      ghosts.track({
        csId: cs.csId ?? cs.id,
        intent: cs.intent ?? "",
        cells: cs.cells ?? [],
        byUser: cs.byUser ?? "?",
        openedAt: cs.openedAt ?? 0,
        expiresAt: cs.expiresAt ?? 0,
        deltaCount: 0,
        deltas: [],
      })
      refetchDeltas(cs.csId ?? cs.id)
    }
    renderer.setGhosts(ghosts.changesets.values(), ghosts.locks.values())
  } catch (e) {
    console.error("open changesets failed", e)
  }
}

// ---- Open Turn modal (spec §7.3) -------------------------------------------
$("openturn").onclick = () => openTurnModal()

function openTurnModal() {
  const domains = graph ? [...new Set(graph.nodes.map((n) => n.domain).filter((d): d is string => !!d))].sort() : []
  const m = $("modal")
  m.hidden = false
  const cellRow = (i: number) => `
    <div class="cellrow" data-i="${i}">
      <select class="cd">${domains.map((d) => `<option>${esc(d)}</option>`).join("")}</select>
      <select class="cl">${LEVELS.map((l) => `<option>${l}</option>`).join("")}</select>
      <button class="rmcell" type="button">−</button>
    </div>`
  m.innerHTML = `
    <div class="dialog">
      <h3>Open Turn</h3>
      <label>Intent</label>
      <input id="intent" placeholder="e.g. add CPF validation" />
      <label>Cells</label>
      <div id="cells">${cellRow(0)}</div>
      <button id="addcell" type="button">+ cell</button>
      <div id="turnerr" class="err"></div>
      <div class="row"><button id="doopen">Open</button><button id="cancel" type="button">Cancel</button></div>
    </div>`
  const cells = $("cells")
  let idx = 1
  $("addcell").onclick = () => cells.insertAdjacentHTML("beforeend", cellRow(idx++))
  cells.onclick = (e) => {
    const b = e.target as HTMLElement
    if (b.classList.contains("rmcell") && cells.children.length > 1) b.closest(".cellrow")!.remove()
  }
  $("cancel").onclick = () => (m.hidden = true)
  $("doopen").onclick = async () => {
    const intent = $<HTMLInputElement>("intent").value.trim()
    const picked = [...cells.querySelectorAll<HTMLDivElement>(".cellrow")].map((r) => {
      const d = r.querySelector<HTMLSelectElement>(".cd")!.value
      const l = r.querySelector<HTMLSelectElement>(".cl")!.value
      return `${d}:${l}`
    })
    const errEl = $("turnerr")
    if (!intent || !picked.length) {
      errEl.textContent = "intent and at least one cell required"
      return
    }
    try {
      const res = await api.openChangeset(picked, intent)
      if (res?.ok === false) {
        errEl.textContent =
          res.reason === "cell_locked"
            ? `cell ${res.cell} locked by ${res.holder} (cs ${res.csId}, expires ${new Date(res.expiresAt).toLocaleTimeString()})`
            : `refused: ${res.reason ?? JSON.stringify(res.reasons ?? res)}`
        return
      }
      const csId = res.csId ?? res.id
      ghosts.track({
        csId,
        intent,
        cells: picked,
        byUser: localStorage.getItem("og.name") ?? "",
        openedAt: Date.now(),
        expiresAt: res.expiresAt ?? 0,
        deltaCount: 0,
        deltas: [],
      })
      activeCsId = csId
      m.hidden = true
      renderer.setGhosts(ghosts.changesets.values(), ghosts.locks.values())
      renderDraft()
    } catch (e) {
      errEl.textContent = String(e)
    }
  }
}

// ---- drafting side panel (spec §7.4) ---------------------------------------
function renderDraft() {
  const el = $("draft")
  if (!activeCsId) {
    el.hidden = true
    return
  }
  const cs = ghosts.changesets.get(activeCsId)
  el.hidden = false
  el.innerHTML = `
    <button id="dclose">×</button>
    <h3>drafting ${esc(activeCsId)}</h3>
    <div class="intent">${esc(cs?.intent ?? "")}</div>
    <div class="acts">
      <button id="commit">Commit</button>
      <button id="abort">Abort</button>
      <button id="extend">Extend TTL</button>
    </div>
    <div id="dreasons" class="err"></div>
    <h4>deltas (${cs?.deltas.length ?? 0})</h4>
    <ul id="dlist">${(cs?.deltas ?? [])
      .map((d) => `<li>${esc(d.kind)} · ${esc(d.summary)}${d.at ? ` · ${new Date(d.at).toLocaleTimeString()}` : ""}</li>`)
      .join("")}</ul>
    <h4>add claim.add delta</h4>
    <input id="f_subject" placeholder="subject" />
    <input id="f_domain" placeholder="domain" />
    <input id="f_level" placeholder="level (P1..P5)" />
    <input id="f_refs" placeholder="refs (comma-separated)" />
    <input id="f_anchor" placeholder="anchor excerpt" />
    <details><summary>raw JSON payload</summary><textarea id="f_json" rows="4" placeholder='{"subject":...}'></textarea></details>
    <button id="addclaim">Add delta</button>`

  $("dclose").onclick = () => {
    activeCsId = null
    renderDraft()
  }
  $("commit").onclick = () => runCs(() => api.commitChangeset(activeCsId!), "commit")
  $("abort").onclick = () => runCs(() => api.abortChangeset(activeCsId!), "abort")
  $("extend").onclick = () => runCs(() => api.extendChangeset(activeCsId!), "extend")
  $("addclaim").onclick = addClaimDelta
}

async function runCs(fn: () => Promise<any>, label: string) {
  const errEl = $("dreasons")
  errEl.textContent = ""
  try {
    const res = await fn()
    if (res?.ok === false) {
      errEl.textContent = `${label} refused: ${(res.reasons ?? [res.reason]).join(", ")}`
      return
    }
    if (label === "commit" || label === "abort") {
      activeCsId = null
      renderDraft()
    }
  } catch (e) {
    errEl.textContent = String(e)
  }
}

async function addClaimDelta() {
  const errEl = $("dreasons")
  errEl.textContent = ""
  const rawJson = $<HTMLTextAreaElement>("f_json").value.trim()
  let payload: any
  if (rawJson) {
    try {
      payload = JSON.parse(rawJson)
    } catch {
      errEl.textContent = "raw JSON is not valid"
      return
    }
  } else {
    const refs = $<HTMLInputElement>("f_refs").value.split(",").map((s) => s.trim()).filter(Boolean)
    payload = {
      subject: $<HTMLInputElement>("f_subject").value.trim(),
      domain: $<HTMLInputElement>("f_domain").value.trim(),
      level: $<HTMLInputElement>("f_level").value.trim(),
      refs,
      anchor: $<HTMLInputElement>("f_anchor").value.trim(),
    }
  }
  try {
    const res = await api.claimDelta(activeCsId!, { kind: "claim.add", payload })
    if (res?.ok === false) {
      errEl.textContent = `refused: ${(res.reasons ?? []).join(", ")}`
      return
    }
    refetchDeltas(activeCsId!) // SSE delta will also fire; refetch now for snappy feedback
  } catch (e) {
    errEl.textContent = String(e)
  }
}

// ---- /history route (spec §8.2) --------------------------------------------
type HistEvent = { seq: number; ts: number; kind: string; target?: string; byUser?: string; payload?: any }
let histEvents: HistEvent[] = []

async function showHistory() {
  const el = $("history")
  el.hidden = false
  el.innerHTML = `
    <div class="hhead">
      <h3>history</h3>
      <input id="h_user" placeholder="byUser" />
      <input id="h_cell" placeholder="cell/target" />
      <input id="h_kind" placeholder="kind" />
      <a href="#/">← back</a>
    </div>
    <ul id="hlist"></ul>`
  try {
    const res = await api.readHistory(0)
    histEvents = res?.events ?? res ?? []
  } catch (e) {
    histEvents = []
    console.error("history failed", e)
  }
  for (const inp of ["h_user", "h_cell", "h_kind"]) $<HTMLInputElement>(inp).oninput = renderHistList
  renderHistList()
}

function renderHistList() {
  const u = $<HTMLInputElement>("h_user").value.toLowerCase()
  const c = $<HTMLInputElement>("h_cell").value.toLowerCase()
  const k = $<HTMLInputElement>("h_kind").value.toLowerCase()
  const rows = histEvents.filter(
    (e) =>
      (!u || (e.byUser ?? "").toLowerCase().includes(u)) &&
      (!c || (e.target ?? "").toLowerCase().includes(c)) &&
      (!k || e.kind.toLowerCase().includes(k)),
  )
  const ul = $("hlist")
  ul.innerHTML = rows
    .map(
      (e, i) =>
        `<li data-i="${i}">${e.seq} · ${new Date(e.ts).toLocaleTimeString()} · ${esc(e.kind)} · ${esc(e.target ?? "")} · ${esc(e.byUser ?? "")}</li>`,
    )
    .join("")
  ul.onclick = (ev) => {
    const li = (ev.target as HTMLElement).closest("li")
    if (!li) return
    const e = rows[+li.dataset.i!]
    const p = $("panel")
    p.hidden = false
    p.innerHTML = `<button id="close">×</button><h3>${esc(e.kind)} · seq ${e.seq}</h3><pre>${esc(JSON.stringify(e.payload ?? e, null, 2))}</pre>`
    $("close").onclick = () => (p.hidden = true)
  }
}

function route() {
  const hist = location.hash === "#/history"
  $("history").hidden = !hist
  canvas.style.visibility = hist ? "hidden" : "visible"
  $("events").hidden = hist
  if (hist) showHistory()
}
addEventListener("hashchange", route)

// ---- boot ------------------------------------------------------------------
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

;(async () => {
  await bootSession()
  await loadSnapshot()
  route()
  stream.start()
})()
