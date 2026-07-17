import type { Graph, GraphNode } from "@open-graph-mcp/graph-core/build"
import { connect, dotColor, PresenceStore, type Envelope, type OgHandle, type PresenceEntry, type ReauthEvent } from "@open-graph-mcp/client"
import * as api from "./api"
import { GhostStore, type GhostDelta } from "./ghosts"
import { Renderer } from "./render"
import { ToastQueue } from "./toasts"
import { localStorageTokenStore } from "./token-store"

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
const PRESENCE_KINDS = new Set(["user.joined", "user.focused", "user.left", "user.typing_state"])
const esc = (s: string) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  )

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
  <button id="settingsBtn" title="Settings">⚙</button>
  <button id="rebuild">Re-bootstrap</button>
</div>
<canvas id="cv"></canvas>
<aside id="presence">
  <div class="phead"><span id="pcount">Conectados (0)</span><button id="ptoggle" title="expand/collapse">▾</button></div>
  <ul id="plist"></ul>
</aside>
<aside id="events"><h3>events</h3><ul id="evlist"></ul></aside>
<section id="panel" hidden></section>
<section id="draft" hidden></section>
<section id="history" hidden></section>
<div id="typing" hidden></div>
<div id="toasts"></div>
<div id="avatarTip" hidden></div>
<div id="modal" hidden></div>`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $("cv") as HTMLCanvasElement

const renderer = new Renderer(canvas, {
  onNodePick: (n, cell, authority, drift) => showPanel(n, cell, authority, drift),
  onAvatarHover: (entry, locked, sx, sy) => showAvatarTip(entry, locked, sx, sy),
})

const ghosts = new GhostStore()
const presence = new PresenceStore()
const toasts = new ToastQueue()
let graph: Graph | null = null
let activeCsId: string | null = null // changeset this client is drafting

// ---- presence (spec §7) -----------------------------------------------------
type Settings = { showPresence: boolean; notifyCommits: boolean }
function loadSettings(): Settings {
  try {
    const raw = sessionStorage.getItem("og.settings")
    if (raw) return { showPresence: true, notifyCommits: true, ...JSON.parse(raw) }
  } catch {
    /* corrupt/inaccessible sessionStorage — fall back to defaults */
  }
  return { showPresence: true, notifyCommits: true }
}
const settings = loadSettings()
function saveSettings() {
  sessionStorage.setItem("og.settings", JSON.stringify(settings))
}

// og.presence.focus/beat (INT-2 T4, @open-graph-mcp/client) now own the SSE session id, the 15s beat
// timer, and re-declaring presence on every (re)connect (spec §9.1) — including the focus-BEFORE-beat
// ordering (stalker mode must be born silent, spec §9.4) and the QA-1 auto-re-register-on-dead-token
// recovery. `focusedCell` stays local — it's still needed for maybeToast()'s "did I lose priority on the
// cell I'm looking at" check and to re-send the same cell when the invisible-mode toggle changes.
let focusedCell: string | null = null

function setFocus(cell: string | null): void {
  focusedCell = cell
  // always explicit invisible: the server only updates invisibility when the flag is a boolean, so an
  // `undefined` here would leave a previously-invisible presence invisible after re-enabling
  og?.presence.focus(cell, { invisible: !settings.showPresence }).catch((e) => console.error("presence.focus failed", e))
}

async function pollWho(): Promise<void> {
  if (!api.getToken()) return
  try {
    const res = await api.presenceWho()
    presence.mergeWho(res.users ?? [])
    renderPresenceBar()
    renderer.setPresence(presence.list())
    renderTyping()
  } catch (e) {
    console.error("presence.who failed", e)
  }
}

// pollWho() is a SEPARATE polling loop the client lib doesn't cover yet (that's INT-2 T5's
// `connect({live:false})` job) — left as-is per the T4 task brief.
setInterval(pollWho, 10_000)

// keep dot colors fresh even without new presence traffic
setInterval(renderPresenceBar, 5_000)

function renderPresenceBar(): void {
  const list = presence.list()
  $("pcount").textContent = `Conectados (${list.length})`
  const ul = $("plist")
  if ($("presence").classList.contains("collapsed")) {
    ul.innerHTML = ""
    return
  }
  ul.innerHTML = list
    .map((u) => {
      const status =
        u.typingState === "typing" ? "digitando…" : u.focusCell ? `focando ${esc(u.focusCell)}` : "idle"
      const turno = u.openCount > 0 ? ` · turno ${u.openCount > 1 ? `×${u.openCount}` : ""}`.trimEnd() : ""
      return `<li><span class="dot ${dotColor(u.lastSeen)}"></span><b>${esc(u.name)}</b> <span class="kind">(${esc(u.agentKind)})</span><div class="sub">${status}${turno}</div></li>`
    })
    .join("")
}

$("ptoggle").onclick = () => {
  $("presence").classList.toggle("collapsed")
  renderPresenceBar()
}

function showAvatarTip(entry: PresenceEntry | null, locked: boolean, sx: number, sy: number): void {
  const tip = $("avatarTip")
  if (!entry) {
    tip.hidden = true
    return
  }
  tip.hidden = false
  const last = new Date(entry.lastSeen).toLocaleTimeString()
  tip.textContent = `${entry.name} · ${entry.agentKind}${locked ? " · turno aberto" : ""} · última atividade ${last}`
  tip.style.left = `${sx + 14}px`
  tip.style.top = `${sy + 34 + 14}px` // +34 = topbar height (canvas is offset below it)
}

function renderTyping(): void {
  const el = $("typing")
  const typist = presence.list().find((u) => u.typingState === "typing")
  if (!typist) {
    el.hidden = true
    return
  }
  // lock.holder is a userId (server tools/changeset.ts), matching PresenceEntry.userId
  const lock = typist.focusCell ? ghosts.locks.get(typist.focusCell) : undefined
  const csId = lock && lock.holder === typist.userId ? lock.csId : null
  el.hidden = false
  el.innerHTML = `${esc(typist.name)} está editando${csId ? ` ${esc(csId)}` : ""}<span class="dots"><span>.</span><span>.</span><span>.</span></span>`
}

// ---- toast notifications (spec §7.4) ---------------------------------------
function pushToast(key: string, text: string, target?: string): void {
  const t = toasts.push(key, text, { target })
  renderToasts()
  setTimeout(() => {
    toasts.remove(t.id)
    renderToasts()
  }, 8_000)
}

function renderToasts(): void {
  const { toasts: visible, overflow } = toasts.visible(5)
  const el = $("toasts")
  el.innerHTML =
    visible
      .map(
        (t) =>
          `<div class="toast" data-id="${esc(t.id)}" title="${esc(new Date(t.ts).toLocaleTimeString())}">${esc(t.text)}</div>`,
      )
      .join("") + (overflow > 0 ? `<div class="toast overflow">(+${overflow})</div>` : "")
  el.querySelectorAll<HTMLDivElement>(".toast[data-id]").forEach((div) => {
    div.onclick = () => {
      const t = toasts.all().find((x) => x.id === div.dataset.id)
      if (t?.target) renderer.focusTarget(t.target)
    }
  })
}

const myUserId = (): string => localStorage.getItem("og.userId") ?? ""
/** userId → display name, via the live presence roster (falls back to the id itself). */
const nameOf = (userId: string): string => presence.users.get(userId)?.name ?? userId

/** Toast triggers for events relevant to the current user (spec §7.4). */
function maybeToast(env: Envelope): void {
  const p = env.payload ?? {}
  if (env.kind === "changeset.aborted" && p.reason === "ttl_expired") {
    // affinity router already scopes this to cs observers + holder — anyone receiving it cares
    pushToast(p.csId, `${p.csId} abortado por TTL`, p.cells?.[0])
  } else if (env.kind === "lock.acquired" && focusedCell && p.cell === focusedCell && p.holder !== myUserId()) {
    // p.holder is a userId here (server changeset.open lock payload)
    pushToast(p.csId ?? p.cell, `${nameOf(p.holder)} abriu turno em [${p.cell}] — você perdeu prioridade`, p.cell)
  } else if (env.kind === "changeset.committed" && settings.notifyCommits) {
    // committed payload has no byUser — the ghost entry (removed only after this runs) knows the opener
    const opener = ghosts.changesets.get(p.csId)?.byUser
    if (opener && opener === myUserId()) return // don't toast our own commit
    const cell = p.cells?.[0]
    pushToast(p.csId, `${opener ? nameOf(opener) : "alguém"} commitou ${p.csId} em [${cell ?? "?"}]`, cell)
  }
}

// ---- settings modal (spec §7.5) --------------------------------------------
function openSettingsModal(): void {
  const m = $("modal")
  m.hidden = false
  m.innerHTML = `
    <div class="dialog">
      <h3>Settings</h3>
      <label class="chk"><input type="checkbox" id="s_presence" ${settings.showPresence ? "checked" : ""} /> Mostrar minha presença para outros</label>
      <label class="chk"><input type="checkbox" id="s_notify" ${settings.notifyCommits ? "checked" : ""} /> Receber notificações de commit em cells que observo</label>
      <div class="row"><button id="sclose">Fechar</button></div>
    </div>`
  $("sclose").onclick = () => (m.hidden = true)
  $<HTMLInputElement>("s_presence").onchange = (e) => {
    settings.showPresence = (e.target as HTMLInputElement).checked
    saveSettings()
    setFocus(focusedCell)
  }
  $<HTMLInputElement>("s_notify").onchange = (e) => {
    settings.notifyCommits = (e.target as HTMLInputElement).checked
    saveSettings()
  }
}
$("settingsBtn").onclick = () => openSettingsModal()

// ---- session / reconnect (spec §9) -----------------------------------------
// connect() (INT-2 T4, @open-graph-mcp/client) now owns: register-if-needed, the SSE connection +
// reconnect/backoff, re-declaring presence on every fresh session id, and — the QA-1 fix — auto
// re-registering (with this SAME localStorage-persisted name) when a live call comes back "invalid or
// expired token" (e.g. after a server restart wipes in-memory tokens), retrying once, and redeclaring
// presence against the fresh token/session. None of that requires a manual page refresh anymore.
let og: OgHandle | null = null
const tokenStore = localStorageTokenStore()
const tenant = new URLSearchParams(location.search).get("tenant") || undefined

/**
 * Recover any changesets this session still has open — fired by og's onReattach after every fresh SSE
 * session id (spec §9), not just at initial boot (an improvement over the pre-refactor code, which only
 * ever reattached once at boot and never after a reconnect). Also where `pollWho()` gets kicked
 * immediately (rather than waiting for its 10s interval): old `declarePresence()` ran focus → beat →
 * `pollWho()` on every `session.created`, and ephemeral `user.*` events are NOT replayed on a fresh SSE
 * connection (the tail-of-log query only reads durable rows) — without an immediate poll here, a user
 * already present-and-idle when we (re)connect would be invisible for up to ~10s.
 *
 * Doesn't overwrite `activeCsId` if the user already has a draft open in the UI — a reconnect (e.g. a
 * brief network blip) shouldn't yank the currently-open draft panel out from under them.
 */
function applyReattach(res: any): void {
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
  if (mine[0] && !activeCsId) {
    activeCsId = mine[0].csId ?? mine[0].id
    renderDraft()
  }
  renderer.setGhosts(ghosts.changesets.values(), ghosts.locks.values())
  pollWho()
}

/**
 * (Re)connects. Called at boot, and again whenever the user types+blurs a name (fresh identity — the
 * previous, possibly-anonymous connection is torn down and replaced). With no cached token and no name
 * yet, `store`/`name` are omitted entirely so `connect()` still opens a live but unauthenticated SSE
 * connection (mirrors the pre-refactor code's unconditional `stream.start()` — anonymous visitors still
 * see the canvas + live graph events before registering an identity).
 */
async function connectOg(): Promise<void> {
  const cached = tokenStore.get()
  const name = ($<HTMLInputElement>("name").value || localStorage.getItem("og.name") || "").trim()

  og?.close()
  try {
    og = await connect({
      server: api.serverBase(),
      agentKind: "web",
      tenant,
      ...(cached || name ? { store: tokenStore, name: name || undefined } : {}),
      onOpen: () => setConn(true),
      onClose: () => setConn(false),
      onReset: () => loadSnapshot(),
      onReattach: applyReattach,
      onReauth: (event: ReauthEvent) => {
        if (event.type === "reregistered") {
          // Keep api.ts's own module-level token in sync — every non-presence tool call in this file
          // (openChangeset, claimDelta, commitChangeset, ...) still goes through api.toolCall(), which
          // has its own token variable separate from og's internal one. This is a known seam from the
          // T4 refactor (SSE/presence moved into the lib, RPC+auth didn't) — a future pass should route
          // api.ts's calls through og.call() directly and drop api.ts's own token entirely.
          api.setToken(event.creds.token)
          localStorage.setItem("og.userId", event.creds.userId)
          // Can fire alongside the separate "Server reiniciou" toast below (applyEvent's server.restarted
          // handler) for the same restart — two toasts for one event is intentional, not a dup bug: this
          // one is the only user-visible proof the QA-1 auto-recovery actually ran.
          pushToast("reauth", "Sessão renovada automaticamente após reinício do servidor")
        } else {
          console.error("auto re-register failed", event.error)
        }
      },
    })
  } catch (e) {
    console.error("connect failed", e)
    og = null
    return
  }

  og.on("*", applyEvent)

  const creds = tokenStore.get()
  if (creds) {
    api.setToken(creds.token)
    if (name) localStorage.setItem("og.name", name)
    localStorage.setItem("og.userId", creds.userId)
    $<HTMLInputElement>("name").value = localStorage.getItem("og.name") || ""
    $("who").textContent = localStorage.getItem("og.name") || ""
  }
}

$<HTMLInputElement>("name").onchange = async () => {
  if (tokenStore.get()) return // already registered this session
  await connectOg()
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
  setFocus(cell) // clicking a node = focusing its cell (spec §7: client cell-focus concept)
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

  if (env.kind === "server.restarted") {
    // Presence lives in server memory only (spec §9.1) — flag it. Recovery itself (redeclaring presence,
    // and — QA-1 fix — auto re-registering if the cached token is now dead) happens automatically inside
    // og's own reconnect handling; nothing to trigger manually here anymore.
    pushToast("server", "Server reiniciou — sua presença foi resetada")
  }

  if (PRESENCE_KINDS.has(env.kind)) {
    presence.apply(env)
    renderPresenceBar()
    renderer.setPresence(presence.list())
    renderTyping()
  }

  maybeToast(env)

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
  $("presence").hidden = hist
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

// e2e hook (QA-2): avatars/nodes are canvas pixels with no other DOM query path, and driving focus via
// a synthetic canvas click would require re-deriving exact node screen coordinates — a fragile detail
// unrelated to what avatar-overlay.e2e.ts actually verifies (overlay rendering + tooltip content).
// `setFocus` here is the real production call (og.presence.focus), not a bypass; `avatarScreenPos` is
// query-only. No production behavior depends on this object.
;(window as any).__og_e2e = {
  setFocus,
  avatarScreenPos: (userId: string) => renderer.avatarScreenPos(userId),
  // Real commit/lock/abort bursts on the same csId within toasts.ts's coalescing window are
  // impractical to produce deterministically over a real network — coalescing itself is already
  // unit-tested (toasts.test.ts). This drives the same production pushToast the real handlers call, so
  // e2e can assert the DOM-rendering side (cap, overflow, coalesced text) without re-timing the network.
  pushToast,
  getCamera: () => renderer.getCamera(),
}

// SSE connection, reconnect/backoff, event dispatch (og.on wired in connectOg), and presence lifecycle
// are all owned by connect() now — see connectOg() above (spec §9 section).
;(async () => {
  await connectOg()
  await loadSnapshot()
  route()
})()
