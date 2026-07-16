import type { Graph, GraphNode } from "@open-graph-mcp/graph-core/build"
import { seedLayout, lodForZoom, xForNode, yForLevel, type Point } from "@open-graph-mcp/graph-core/layout"
import { Quadtree } from "@open-graph-mcp/graph-core/quadtree"
import { initials, type PresenceEntry } from "@open-graph-mcp/client"
import { colorForCsId, type Lock, type OpenChangeset } from "./ghosts"

const BAND = 400 // domain column width in world units (mirrors layout.DOMAIN_BAND_WIDTH)
const NODE_R = 3 // node dot radius, screen px

type Cam = { x: number; y: number; zoom: number }
type Tower = { domain: string | null; idx: number; nodes: GraphNode[]; claims: number; beta: number; y0: number; y1: number }
type AvatarHit = { x: number; y: number; r: number; entry: PresenceEntry; locked: boolean }

export type PickHandlers = {
  onNodePick: (node: GraphNode, cell: string, authority: string, drift: string | null) => void
  /** Hover over a presence avatar badge (spec §7.2) — null when the pointer leaves it. Screen coords for tooltip placement. */
  onAvatarHover?: (entry: PresenceEntry | null, locked: boolean, sx: number, sy: number) => void
}

function cellKey(n: GraphNode): string {
  return `${n.domain ?? "unassigned"}:${n.level}`
}

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private cam: Cam = { x: 0, y: 0, zoom: 1 }
  private dirty = true
  private graph: Graph | null = null
  private pos: Map<string, Point> = new Map()
  private byId: Map<string, GraphNode> = new Map()
  private towers: Tower[] = []
  private qt: Quadtree | null = null
  private hoverDomain: string | null | undefined = undefined
  private hoverNode: string | null = null
  private drift = new Map<string, string>() // nodeId → grade
  private drag: { x: number; y: number } | null = null
  private sortedDomains: string[] = []
  private ghosts: OpenChangeset[] = []
  private locks: Lock[] = []
  private presence: PresenceEntry[] = []
  private avatarHits: AvatarHit[] = []
  private hoverAvatar: PresenceEntry | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly h: PickHandlers,
  ) {
    this.ctx = canvas.getContext("2d")!
    this.bindPointer()
    this.resize()
    addEventListener("resize", () => this.resize())
    requestAnimationFrame(() => this.loop())
  }

  setGraph(graph: Graph) {
    this.graph = graph
    this.pos = seedLayout(graph)
    this.byId = new Map(graph.nodes.map((n) => [n.id, n]))
    this.sortedDomains = [...new Set(graph.nodes.map((n) => n.domain).filter((d): d is string => d !== null))].sort()
    this.qt = Quadtree.fromPoints(graph.nodes.map((n) => ({ id: n.id, ...this.pos.get(n.id)! })))
    this.towers = this.buildTowers(graph)
    this.fitCamera()
    this.dirty = true
  }

  /** Open changesets → ghost overlay; live locks → cell badges (spec §7.1, §7.2). */
  setGhosts(changesets: Iterable<OpenChangeset>, locks: Iterable<Lock>) {
    this.ghosts = [...changesets]
    this.locks = [...locks]
    this.dirty = true
  }

  /** Presence roster → avatar overlay near focused cells (spec §7.2). */
  setPresence(entries: PresenceEntry[]) {
    this.presence = entries
    this.dirty = true
  }

  markDrift(nodeId: string, grade: string) {
    this.drift.set(nodeId, grade)
    this.dirty = true
  }

  /** Center the camera on a node id, cell key "domain:level", or bare domain. */
  focusTarget(target: string) {
    const p = this.pos.get(target)
    if (p) return this.centerOn(p, 1.0, this.byId.get(target)?.domain ?? null)
    const domain = target.includes(":") ? target.split(":")[0] : target
    const t = this.towers.find((tw) => (tw.domain ?? "unassigned") === domain)
    if (t) this.centerOn({ x: t.idx * BAND + BAND / 2, y: (t.y0 + t.y1) / 2 }, 0.8, t.domain)
  }

  private authorityOf(n: GraphNode): string {
    return this.graph?.authority?.[cellKey(n)] ?? "source"
  }

  private buildTowers(graph: Graph): Tower[] {
    const domains = [...new Set(graph.nodes.map((n) => n.domain).filter((d): d is string => d !== null))].sort()
    const order: (string | null)[] = [...domains, null]
    return order
      .map((domain, idx) => {
        const nodes = graph.nodes.filter((n) => n.domain === domain)
        if (!nodes.length) return null
        const ys = nodes.map((n) => this.pos.get(n.id)!.y)
        const graphCells = nodes.filter((n) => this.authorityOf(n) === "graph").length
        return {
          domain,
          idx,
          nodes,
          claims: nodes.reduce((s, n) => s + n.claims.length, 0),
          beta: graphCells / nodes.length,
          y0: Math.min(...ys) - 60,
          y1: Math.max(...ys) + 60,
        } as Tower
      })
      .filter((t): t is Tower => t !== null)
  }

  // ---- camera --------------------------------------------------------------

  private worldBounds() {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of this.pos.values()) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
    if (!isFinite(minX)) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
    return { minX, maxX, minY, maxY }
  }

  private fitCamera() {
    const b = this.worldBounds()
    const w = b.maxX - b.minX || 1, hgt = b.maxY - b.minY || 1
    const zoom = Math.min(this.canvas.clientWidth / w, this.canvas.clientHeight / hgt) * 0.85
    this.cam = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, zoom: Math.min(zoom, 0.3) }
  }

  private centerOn(p: Point, zoom: number, domain: string | null | undefined) {
    this.cam = { x: p.x, y: p.y, zoom }
    this.hoverDomain = domain
    this.dirty = true
  }

  private toScreen(wx: number, wy: number): [number, number] {
    return [
      (wx - this.cam.x) * this.cam.zoom + this.canvas.clientWidth / 2,
      (wy - this.cam.y) * this.cam.zoom + this.canvas.clientHeight / 2,
    ]
  }

  private toWorld(sx: number, sy: number): Point {
    return {
      x: (sx - this.canvas.clientWidth / 2) / this.cam.zoom + this.cam.x,
      y: (sy - this.canvas.clientHeight / 2) / this.cam.zoom + this.cam.y,
    }
  }

  // ---- pointer -------------------------------------------------------------

  private bindPointer() {
    const c = this.canvas
    c.addEventListener("mousedown", (e) => (this.drag = { x: e.clientX, y: e.clientY }))
    addEventListener("mouseup", () => (this.drag = null))
    c.addEventListener("mousemove", (e) => {
      const r = c.getBoundingClientRect()
      if (this.drag) {
        this.cam.x -= (e.clientX - this.drag.x) / this.cam.zoom
        this.cam.y -= (e.clientY - this.drag.y) / this.cam.zoom
        this.drag = { x: e.clientX, y: e.clientY }
        this.dirty = true
        return
      }
      this.onHover(e.clientX - r.left, e.clientY - r.top)
    })
    c.addEventListener("wheel", (e) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      this.cam.zoom = Math.max(0.02, Math.min(this.cam.zoom * factor, 6))
      this.dirty = true
    }, { passive: false })
    c.addEventListener("click", (e) => {
      const r = c.getBoundingClientRect()
      this.onClick(e.clientX - r.left, e.clientY - r.top)
    })
  }

  private nodeAt(sx: number, sy: number): GraphNode | null {
    if (!this.qt) return null
    const w = this.toWorld(sx, sy)
    const pad = (NODE_R + 4) / this.cam.zoom
    const ids = this.qt.queryRange({ minX: w.x - pad, maxX: w.x + pad, minY: w.y - pad, maxY: w.y + pad })
    let best: GraphNode | null = null
    let bestD = Infinity
    for (const id of ids) {
      const p = this.pos.get(id)!
      const d = (p.x - w.x) ** 2 + (p.y - w.y) ** 2
      if (d < bestD) { bestD = d; best = this.byId.get(id) ?? null }
    }
    return best
  }

  private towerAt(sx: number, sy: number): Tower | null {
    const w = this.toWorld(sx, sy)
    for (const t of this.towers) {
      const x0 = t.idx * BAND
      if (w.x >= x0 && w.x <= x0 + BAND && w.y >= t.y0 && w.y <= t.y1) return t
    }
    return null
  }

  private onHover(sx: number, sy: number) {
    const avatar = this.avatarAt(sx, sy)
    if (avatar || this.hoverAvatar) {
      this.hoverAvatar = avatar?.entry ?? null
      this.h.onAvatarHover?.(avatar?.entry ?? null, avatar?.locked ?? false, sx, sy)
    }
    const showNodes = lodForZoom(this.cam.zoom) !== "tower" || this.hoverDomain !== undefined
    const node = showNodes ? this.nodeAt(sx, sy) : null
    const hn = node?.id ?? null
    if (hn !== this.hoverNode) { this.hoverNode = hn; this.dirty = true }
    if (!node) {
      const t = this.towerAt(sx, sy)
      const hd = t ? t.domain : undefined
      if (hd !== this.hoverDomain) { this.hoverDomain = hd; this.dirty = true }
    }
    this.canvas.style.cursor = node || avatar ? "pointer" : "default"
  }

  private onClick(sx: number, sy: number) {
    const node = this.nodeAt(sx, sy)
    if (!node) return
    this.h.onNodePick(node, cellKey(node), this.authorityOf(node), this.drift.get(node.id) ?? null)
  }

  // ---- draw ----------------------------------------------------------------

  private loop() {
    if (this.dirty) { this.draw(); this.dirty = false }
    requestAnimationFrame(() => this.loop())
  }

  private resize() {
    const dpr = devicePixelRatio || 1
    this.canvas.width = this.canvas.clientWidth * dpr
    this.canvas.height = this.canvas.clientHeight * dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.dirty = true
  }

  private draw() {
    const ctx = this.ctx
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = "#0d0f14"
    ctx.fillRect(0, 0, W, H)
    if (!this.graph) return

    const maxClaims = Math.max(1, ...this.towers.map((t) => t.claims))
    const lod = lodForZoom(this.cam.zoom)

    for (const t of this.towers) {
      const [x0, y0] = this.toScreen(t.idx * BAND, t.y0)
      const [x1, y1] = this.toScreen(t.idx * BAND + BAND, t.y1)
      const heat = t.claims / maxClaims
      const hue = 210 - t.beta * 180 // blue (source) → red (β)
      ctx.fillStyle = `hsla(${hue}, 70%, 45%, ${0.25 + heat * 0.55})`
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
      ctx.strokeStyle = t.domain === this.hoverDomain ? "#e8e8ea" : "rgba(255,255,255,0.12)"
      ctx.lineWidth = t.domain === this.hoverDomain ? 2 : 1
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
      if (x1 - x0 > 30) {
        ctx.fillStyle = "rgba(230,230,235,0.85)"
        ctx.font = "12px ui-monospace, monospace"
        ctx.fillText(`${t.domain ?? "unassigned"} · ${t.nodes.length}n · ${(t.beta * 100) | 0}%β`, x0 + 4, y0 - 4)
      }
    }

    const showNodes = lod !== "tower"
    for (const t of this.towers) {
      if (!showNodes && t.domain !== this.hoverDomain) continue
      this.drawNodes(t)
    }

    this.drawGhosts()
    this.drawLocks()
    this.drawAvatars()
  }

  /** Cell "domain:level" → world center of that floor in its domain tower (null if no such tower). */
  private cellCenter(cell: string): { x: number; y: number; domain: string; level: string } | null {
    const i = cell.indexOf(":")
    if (i < 0) return null
    const domain = cell.slice(0, i)
    const level = cell.slice(i + 1)
    const t = this.towers.find((tw) => (tw.domain ?? "unassigned") === domain)
    if (!t) return null
    return { x: t.idx * BAND + BAND / 2, y: yForLevel(level), domain, level }
  }

  // ---- ghost overlay (spec §7.1): unadmitted deltas, never drawn as solid ---
  private drawGhosts() {
    const ctx = this.ctx
    for (const cs of this.ghosts) {
      const color = colorForCsId(cs.csId)
      const domains = this.sortedDomains
      cs.deltas.forEach((d, i) => {
        const cell = d.domain != null && d.level ? `${d.domain}:${d.level}` : cs.cells[0]
        const c = cell ? this.cellCenter(cell) : null
        if (!c) return
        // spread multiple deltas within the floor by hashing csId+idx (mirrors layout.xForNode)
        const wx = xForNode(`${cs.csId}#${i}`, c.domain, domains)
        const [sx, sy] = this.toScreen(wx, c.y)
        ctx.save()
        ctx.globalAlpha = 0.4
        ctx.setLineDash([3, 2])
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(sx + 4, sy + 4, NODE_R + 1, 0, Math.PI * 2) // +4px offset: "visibly not yet real"
        ctx.stroke()
        ctx.restore()
      })
    }
  }

  // ---- lock badges (spec §7.2) ----------------------------------------------
  private drawLocks() {
    const ctx = this.ctx
    ctx.font = "11px ui-monospace, monospace"
    for (const lock of this.locks) {
      const c = this.cellCenter(lock.cell)
      if (!c) continue
      const [sx, sy] = this.toScreen(c.x, c.y - 70)
      const label = `🔒 ${lock.csId.slice(0, 6)} @ ${lock.holder}`
      const w = ctx.measureText(label).width + 10
      ctx.fillStyle = "rgba(20,23,31,0.9)"
      ctx.fillRect(sx - w / 2, sy - 8, w, 16)
      ctx.strokeStyle = colorForCsId(lock.csId)
      ctx.lineWidth = 1
      ctx.strokeRect(sx - w / 2, sy - 8, w, 16)
      ctx.fillStyle = "#e6e6eb"
      ctx.fillText(label, sx - w / 2 + 5, sy + 3)
      if (c.domain === this.hoverDomain && lock.expiresAt) {
        const mins = Math.max(0, Math.round((lock.expiresAt - Date.now()) / 60000))
        ctx.fillStyle = "#8a8f98"
        ctx.fillText(`expires in ${mins}m`, sx - w / 2 + 5, sy + 18)
      }
    }
  }

  /**
   * Avatar overlay (spec §7.2): a cell LOCKED by user X gets a solid mini-circle badge; a cell someone
   * merely FOCUSES (no lock) gets a smaller, semi-transparent one. Hover is resolved in onHover() below
   * against `avatarHits`, rebuilt here every draw.
   */
  private drawAvatars() {
    const ctx = this.ctx
    this.avatarHits = []
    for (const u of this.presence) {
      if (!u.focusCell) continue
      const c = this.cellCenter(u.focusCell)
      if (!c) continue
      // lock.holder is a userId (server tools/changeset.ts), not a display name
      const locked = this.locks.some((l) => l.cell === u.focusCell && l.holder === u.userId)
      const [sx, sy] = this.toScreen(c.x, c.y)
      const r = locked ? 9 : 6
      const ax = sx + (locked ? -18 : 18)
      const ay = sy - 40
      ctx.save()
      ctx.globalAlpha = locked ? 0.95 : 0.5
      ctx.beginPath()
      ctx.arc(ax, ay, r, 0, Math.PI * 2)
      ctx.fillStyle = locked ? "#2f8f4e" : "#4a90d9"
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = "#0d0f14"
      ctx.stroke()
      ctx.fillStyle = "#fff"
      ctx.font = `${locked ? 10 : 8}px ui-monospace, monospace`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(initials(u.name), ax, ay + 1)
      ctx.restore()
      this.avatarHits.push({ x: ax, y: ay, r, entry: u, locked })
    }
  }

  private avatarAt(sx: number, sy: number): AvatarHit | null {
    for (const a of this.avatarHits) {
      if ((a.x - sx) ** 2 + (a.y - sy) ** 2 <= a.r * a.r) return a
    }
    return null
  }

  private drawNodes(t: Tower) {
    const ctx = this.ctx
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight
    const tl = this.toWorld(0, 0), br = this.toWorld(W, H)
    const ids = this.qt!.queryRange({ minX: tl.x, maxX: br.x, minY: tl.y, maxY: br.y })
    for (const id of ids) {
      const n = this.byId.get(id)
      if (!n || n.domain !== t.domain) continue
      const p = this.pos.get(id)!
      const [sx, sy] = this.toScreen(p.x, p.y)
      ctx.beginPath()
      ctx.arc(sx, sy, id === this.hoverNode ? NODE_R + 2 : NODE_R, 0, Math.PI * 2)
      ctx.fillStyle = this.nodeColor(n)
      ctx.fill()
    }
  }

  private nodeColor(n: GraphNode): string {
    if (this.drift.has(n.id)) return "#ff4d4f"
    const a = this.authorityOf(n)
    if (a === "suspended") return "#8a8f98"
    if (a === "graph") return "#ffa940"
    return "#4a90d9"
  }
}
