/**
 * cell-drift-grade.test.ts — F2 (docs/roadmap-server-beta/01-evidencias-fluxo-completo.md §F2).
 *
 * Before the fix, `driftGradeOf` (resources.ts) read `n.stale`, a field nobody ever wrote — so
 * `graph://cell` and `graph://domain` reported `driftGrade: "fresh"` and every node's `stale: "fresh"`
 * forever, even for a cell the server had JUST suspended via `authority.demoted` because a node's
 * anchor rotted underneath it. The fix reads the real, live index instead: `state.driftStale`
 * (`Map<tenant, Set<nodeId>>`), populated by `watch-bridge.ts::tick`.
 *
 * This test drives the real pipeline (bootstrap → break an anchor on disk → `tick()`, same pattern as
 * `watch-tenant-attribution.test.ts` and `subscribe-demote.test.ts`) and asserts the resource surfaces
 * reflect it — per NODE, not per cell: a cell with one stale node and one untouched node must report
 * the untouched node as still "fresh" in the same response.
 *
 * Fixture: `multi-domain` (see `rebuild-from-disk-fixture.test.ts`) — `src/ui/panel.ts` and
 * `src/ui/button.ts` are both plain P4 files in the `ui` domain (no special level marker), so they land
 * in the SAME cell (`ui:4`). Breaking panel.ts's anchor while leaving button.ts untouched is exactly the
 * per-node scenario this fix needs to prove.
 */
import { expect, test } from "bun:test"
import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import path from "node:path"
import { startServer } from "../src/index"
import { tick } from "../src/watch-bridge"
import { callTool, readResource, register, tempRepo } from "./helpers"

const MULTI_DOMAIN_DOMAINS = [
  { pattern: "src/ui/*", domain: "ui" },
  { pattern: "src/api/*", domain: "api" },
  { pattern: "src/core/*", domain: "core" },
  { pattern: "docs/*", domain: "docs" },
] as const

test("graph://cell and graph://domain report real per-node drift from state.driftStale after a tick, not the never-written n.stale field", async () => {
  const { root, cleanup } = tempRepo("multi-domain")
  const s = startServer({ repoPath: root, watch: false, domains: MULTI_DOMAIN_DOMAINS })
  try {
    const alice = await register(s.url, "alice")
    await callTool(s.url, "graph.bootstrap", { token: alice.token, repoPath: root })

    const graph = s.state.graphs.get("default")!.graph!
    const panelNode = graph.nodes.find((n) => n.file.replace(/\\/g, "/").endsWith("src/ui/panel.ts"))!
    const buttonNode = graph.nodes.find((n) => n.file.replace(/\\/g, "/").endsWith("src/ui/button.ts"))!
    const cellKey = `${panelNode.domain}:${String(panelNode.level).replace(/^P/, "")}`
    expect(cellKey).toBe(`${buttonNode.domain}:${String(buttonNode.level).replace(/^P/, "")}`) // same cell, control

    // Before any drift: cell is fresh, both nodes fresh.
    const before = await readResource(s.url, `graph://cell/${cellKey}`, alice.token)
    expect(before.driftGrade).toBe("fresh")
    for (const n of before.nodes) expect(n.stale).toBe("fresh")

    // Break panel.ts's anchor on disk (structural drift) — button.ts is untouched.
    void readFileSync(path.join(root, "src", "ui", "panel.ts"), "utf8")
    writeFileSync(path.join(root, "src", "ui", "panel.ts"), "export const renamedPanelTitle = \"panel\"\n")

    const events = await tick(s.state, "default")
    expect(events.some((e) => e.kind === "node" && e.id === panelNode.id && e.type === "stale")).toBe(true)
    expect(s.state.driftStale.get("default")?.has(panelNode.id)).toBe(true)
    expect(s.state.driftStale.get("default")?.has(buttonNode.id)).toBe(false)

    // graph://cell: grade flips to "stale" for the cell, but ONLY panel's node is marked stale —
    // button's node, in the same response, stays fresh. Drift grade is per-node, not per-cell.
    const cell = await readResource(s.url, `graph://cell/${cellKey}`, alice.token)
    expect(cell.driftGrade).toBe("stale")
    const panelInCell = cell.nodes.find((n: { id: string }) => n.id === panelNode.id)
    const buttonInCell = cell.nodes.find((n: { id: string }) => n.id === buttonNode.id)
    expect(panelInCell.stale).toBe("stale")
    expect(buttonInCell.stale).toBe("fresh")

    // graph://domain/{ui}: same reality, reached through the domain resource.
    const domainView = await readResource(s.url, "graph://domain/ui", alice.token)
    const domainCell = domainView.cells.find((c: { cell: string }) => c.cell === cellKey)
    expect(domainCell.driftGrade).toBe("stale")
    const panelInDomain = domainCell.nodes.find((n: { id: string }) => n.id === panelNode.id)
    const buttonInDomain = domainCell.nodes.find((n: { id: string }) => n.id === buttonNode.id)
    expect(panelInDomain.stale).toBe("stale")
    expect(buttonInDomain.stale).toBe("fresh")
  } finally {
    s.stop()
    cleanup()
  }
})

/**
 * Entrega 1 (drift cause survives per node): before this fix, `state.driftStale` was a
 * `Map<tenant, Set<nodeId>>` — presence-only, cause discarded. `driftGradeOf` (resources.ts) could
 * therefore never produce "gone", even for a node whose FILE was actually deleted from disk; every
 * drifted node reported "stale" regardless of cause. Now `state.driftStale` is
 * `Map<tenant, Map<nodeId, "gone" | "structural">>`, so the cause `tick()` computes travels all the
 * way to the resource. This proves: a deleted file reports "gone"; an anchor-only break reports
 * "stale"; the two together in one cell make the cell "gone" (worst-of); and an untouched node
 * elsewhere in the SAME graph.bootstrap stays "fresh" in the same overall picture.
 */
test("graph://cell and graph://domain report 'gone' for a deleted file, distinct from 'stale' for a broken anchor, and 'gone' wins when both land in the same cell", async () => {
  const { root, cleanup } = tempRepo("multi-domain")
  const s = startServer({ repoPath: root, watch: false, domains: MULTI_DOMAIN_DOMAINS })
  try {
    const alice = await register(s.url, "alice")
    await callTool(s.url, "graph.bootstrap", { token: alice.token, repoPath: root })

    const graph = s.state.graphs.get("default")!.graph!
    const panelNode = graph.nodes.find((n) => n.file.replace(/\\/g, "/").endsWith("src/ui/panel.ts"))!
    const buttonNode = graph.nodes.find((n) => n.file.replace(/\\/g, "/").endsWith("src/ui/button.ts"))!
    const routerNode = graph.nodes.find((n) => n.file.replace(/\\/g, "/").endsWith("src/api/router.ts"))!
    const cellKey = `${panelNode.domain}:${String(panelNode.level).replace(/^P/, "")}`

    // panel.ts is deleted outright (file gone); button.ts (same cell) keeps existing but its anchor
    // rots; router.ts (different domain/cell) is left completely untouched — the control for "fresh".
    unlinkSync(path.join(root, "src", "ui", "panel.ts"))
    writeFileSync(path.join(root, "src", "ui", "button.ts"), "export const renamedButtonLabel = \"button\"\n")

    const events = await tick(s.state, "default")
    expect(events.some((e) => e.kind === "node" && e.id === panelNode.id && e.type === "stale" && e.cause === "gone")).toBe(true)
    expect(events.some((e) => e.kind === "node" && e.id === buttonNode.id && e.type === "stale" && e.cause === "structural")).toBe(true)
    expect(s.state.driftStale.get("default")?.get(panelNode.id)).toBe("gone")
    expect(s.state.driftStale.get("default")?.get(buttonNode.id)).toBe("structural")

    // Cell grade is the WORST of its nodes' causes: "gone" beats "structural".
    const cell = await readResource(s.url, `graph://cell/${cellKey}`, alice.token)
    expect(cell.driftGrade).toBe("gone")
    // Per-node `stale` keeps its existing coarse contract (unchanged shape): both are "stale", the
    // cause distinction only surfaces at the cell's `driftGrade`.
    const panelInCell = cell.nodes.find((n: { id: string }) => n.id === panelNode.id)
    const buttonInCell = cell.nodes.find((n: { id: string }) => n.id === buttonNode.id)
    expect(panelInCell.stale).toBe("stale")
    expect(buttonInCell.stale).toBe("stale")

    // graph://domain/{ui}: same reality through the domain resource.
    const domainView = await readResource(s.url, "graph://domain/ui", alice.token)
    const domainCell = domainView.cells.find((c: { cell: string }) => c.cell === cellKey)
    expect(domainCell.driftGrade).toBe("gone")

    // An untouched node in a different cell/domain reports "fresh" in the same overall picture.
    const apiCellKey = `${routerNode.domain}:${String(routerNode.level).replace(/^P/, "")}`
    const apiCell = await readResource(s.url, `graph://cell/${apiCellKey}`, alice.token)
    expect(apiCell.driftGrade).toBe("fresh")
    expect(apiCell.nodes.find((n: { id: string }) => n.id === routerNode.id).stale).toBe("fresh")
  } finally {
    s.stop()
    cleanup()
  }
})
