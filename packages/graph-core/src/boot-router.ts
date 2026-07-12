/**
 * boot-router.ts — the orchestrator boot gate's pure decision layer (spec:
 * 2026-07-01-orchestrator-boot-gate-design.md). The graph is the precondition for the
 * orchestrator: on launch, resolve the repo root, check `.graph/graph.json`, and decide which
 * agent the session boots into. No graph → a bootstrap must build one first; a ready graph →
 * the orchestrator ("GOD"); a corrupt/merge-mangled graph must NOT boot the orchestrator over
 * garbage — it routes to bootstrap with a loud banner (the roadmap's one hardening beyond the
 * spec, using boot-gate.ts's schema+checksum validation instead of a bare existence check).
 *
 * Pure and deterministic: the routing decision and the footer state are functions of the graph
 * file's bytes (and, for staleness only, mtimes). The launcher/TUI consume these — this module
 * itself performs no agent switch and renders nothing.
 */
import { bootReadiness, type BootVerdict } from "./boot-gate"

export type BootAgent = "graph-bootstrap" | "graph-orchestrator"

export type BootRoute = {
  agent: BootAgent
  verdict: BootVerdict
  banner?: string
}

/**
 * Decides the boot agent from the graph's readiness verdict:
 *  - "ready"    → graph-orchestrator (the graph exists and validates; converse + write intent).
 *  - "no-graph" → graph-bootstrap, with a banner telling the user a graph must be built first.
 *  - "corrupt"  → graph-bootstrap, with a LOUD banner naming the corruption reasons — never boot
 *                 the orchestrator over a schema-invalid or merge-mangled graph.
 * An explicit user `--agent` overrides this upstream (the launcher honors it); this only decides
 * the default when none was given.
 */
export function bootRoute(root: string, readFile?: (p: string) => string): BootRoute {
  const { verdict, reasons } = bootReadiness(root, readFile)
  switch (verdict) {
    case "ready":
      return { agent: "graph-orchestrator", verdict }
    case "no-graph":
      return {
        agent: "graph-bootstrap",
        verdict,
        banner: `⚠ No graph for ${root}. The orchestrator must bootstrap before any work.`,
      }
    case "corrupt":
      return {
        agent: "graph-bootstrap",
        verdict,
        banner: `⚠ Graph at ${root} is corrupt and cannot boot the orchestrator — rebuild it. Reasons: ${reasons.join("; ")}`,
      }
  }
}

// ── footer state ────────────────────────────────────────────────────────────────────────────

export type FooterState = "no-graph" | "stale" | "ready"
export type FooterSegment = { state: FooterState; label: string }

/**
 * Footer statusline segment state (spec's own test target): pure function of whether the graph
 * exists, its mtime vs the newest tracked source file, and its node count. Staleness is
 * DISPLAY-ONLY and never blocks (the boot gate is missing-only + corrupt-routing; drift is shown,
 * not gated). `graphMtime`/`newestSrcMtime` are epoch millis; pass `graphMtime: null` when absent.
 */
export function footerGraphState(
  graphMtime: number | null,
  newestSrcMtime: number,
  nodeCount: number,
): FooterSegment {
  if (graphMtime === null) return { state: "no-graph", label: "no-graph" }
  if (newestSrcMtime > graphMtime) return { state: "stale", label: "stale" }
  return { state: "ready", label: `ready · ${nodeCount} nodes` }
}
