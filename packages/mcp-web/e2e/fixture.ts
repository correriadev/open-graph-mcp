// ---------------------------------------------------------------------------
// Shared e2e harness (QA-2 DoD): a real mcp-server (deterministic knobs, same
// factory the mcp-server integration tests use) + a real `vite preview`
// serving mcp-web's actual build (QD4 — not the dev server) + one isolated
// BrowserContext per simulated user (separate localStorage, so each gets its
// own session.register identity; token-store.ts is localStorage-backed).
//
// The server runs as a spawned Bun subprocess (server-runner.ts), not an
// in-process import: startServer() pulls in Bun-only APIs (bun:sqlite,
// Bun.serve) that Playwright's Node test workers cannot import directly.
// This is also exactly the shape reconnect.e2e.ts needs anyway — killing and
// restarting a real OS process, same stateDir, spec §10.9 web.
// ---------------------------------------------------------------------------
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Browser, BrowserContext, Page } from "@playwright/test"
import { build, preview, type PreviewServer } from "vite"
import type { StartOptions } from "@open-graph-mcp/mcp-server/index"

// Playwright's test runner executes on Node (not Bun), so `import.meta.dir` (Bun-only) isn't available.
const MCP_WEB_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..")
const VITE_CONFIG = path.join(MCP_WEB_ROOT, "vite.config.ts")
const RUNNER_SCRIPT = path.join(MCP_WEB_ROOT, "e2e", "server-runner.ts")

let buildOnce: Promise<void> | null = null
/** `vite build` once per test run (all harnesses share the same dist/); QD4. */
function ensureBuilt(): Promise<void> {
  if (!buildOnce) {
    buildOnce = build({ root: MCP_WEB_ROOT, configFile: VITE_CONFIG, logLevel: "warn" }).then(() => undefined)
  }
  return buildOnce
}

/** Two-domain fixture repo (auth/billing) so tests have real cells to focus/lock, not just "(unassigned)". */
function tempFixtureRepo(sessionNodes = 0): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "og-e2e-"))
  mkdirSync(path.join(root, "src", "auth"), { recursive: true })
  mkdirSync(path.join(root, "src", "billing"), { recursive: true })
  writeFileSync(path.join(root, "src", "auth", "login.ts"), "export function login() {}\n")
  // RETRY #1: asset only present so classify.ts maps it to P5 (.svg ext -> P5_EXTS) and the auth
  // domain gains a `auth:P5` node — gives SidebarTree a navigable level-5 cell so cross-cell chip
  // navigation can have a root claim (refs=[]) at the floor of one domain referenced from a mid-cell.
  writeFileSync(path.join(root, "src", "auth", "icon.svg"), "<svg/>\n")
  writeFileSync(path.join(root, "src", "billing", "charge.ts"), "export function charge() {}\n")
  for (let index = 0; index < sessionNodes; index++) {
    const domain = index % 2 ? "auth" : "billing"
    writeFileSync(path.join(root, "src", domain, `session-${index}.ts`), `/** # Session node ${index}\n * - rich content\n */\nexport function sessionNode${index}() { return ${index} }\n`)
  }
  mkdirSync(path.join(root, ".graph"), { recursive: true })
  writeFileSync(
    path.join(root, ".graph", "domains.json"),
    JSON.stringify([
      { pattern: "src/auth/*", domain: "auth" },
      { pattern: "src/billing/*", domain: "billing" },
    ]),
  )
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

async function rpc(base: string, method: string, params?: unknown): Promise<any> {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const body: any = await res.json()
  if (body.error) throw new Error(body.error.message)
  if (body.result?.isError === true) throw new Error(body.result.content?.[0]?.text ?? "tool error")
  return body.result
}
const callTool = (base: string, name: string, args?: unknown) =>
  rpc(base, "tools/call", { name, arguments: args ?? {} }).then((r) => r.structuredContent)
const readResource = (base: string, uri: string) =>
  rpc(base, "resources/read", { uri }).then((r) => JSON.parse(r.contents[0].text))

type ServerProc = { child: ChildProcessWithoutNullStreams; mcpUrl: string; controlUrl: string }

/** Spawns server-runner.ts, waits for its `READY <mcpUrl> <controlUrl>` stdout line. */
function spawnServer(opts: StartOptions): Promise<ServerProc> {
  const child = spawn("bun", [RUNNER_SCRIPT, JSON.stringify(opts)], { stdio: ["ignore", "pipe", "pipe"] })
  let stderr = ""
  child.stderr.on("data", (d) => (stderr += String(d)))
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: child.stdout })
    const onExit = (code: number | null) => reject(new Error(`server-runner exited (${code}) before READY:\n${stderr}`))
    child.once("exit", onExit)
    rl.on("line", (line) => {
      const m = line.match(/^READY (\S+) (\S+)$/)
      if (!m) return
      child.off("exit", onExit)
      resolve({ child, mcpUrl: m[1]!, controlUrl: m[2]! })
    })
  })
}

function stopServer(proc: ServerProc): Promise<void> {
  return new Promise((resolve) => {
    proc.child.once("exit", () => resolve())
    proc.child.kill("SIGTERM")
  })
}

export type Harness = {
  serverUrl: string
  previewUrl: string
  repoRoot: string
  /** First real "domain:level" cell from the bootstrapped skeleton graph — for focus/lock tests. */
  firstCell: string
  callTool: (name: string, args?: unknown) => Promise<any>
  readResource: (uri: string) => Promise<any>
  /** Deterministic hooks (mirrors RunningServer's) across the subprocess boundary — QD5. */
  control: (action: "tick" | "sweep" | "flush" | "sweepPresenceNow" | "tickTypingNow") => Promise<void>
  pageUrl: () => string
  /** Fresh BrowserContext + Page = a new simulated user; fills #name and waits for connect. */
  openSession: (browser: Browser, name: string) => Promise<{ page: Page; context: BrowserContext }>
  /** Same as openSession but reuses a given context — a second TAB of the same simulated user (shared
   * localStorage/identity, independent sessionStorage), for per-tab settings-persistence tests. */
  openSessionInContext: (context: BrowserContext, name: string) => Promise<{ page: Page }>
  /** Kills the server process and respawns it on the SAME port + stateDir (spec §10.9 web). */
  restartServer: () => Promise<void>
  stop: () => Promise<void>
}

/**
 * Deterministic knobs mirroring the mcp-server integration tests (QD5 — never sleep on prod timers).
 * presenceTtlMs/presenceSweepIntervalMs are deliberately left at server defaults (60s): @open-graph-mcp/
 * client's beat timer is a hardcoded 15s interval, not configurable from here — a short presenceTtlMs
 * (as mcp-server's own unit tests use, where the test calls sweepPresenceNow() itself instead of relying
 * on a real client beat) sweeps every real browser session as heartbeat-expired before it beats even
 * once. A spec that needs TTL-expiry behavior should pass its own short presenceTtlMs to startHarness()
 * and drive the sweep explicitly via control("sweepPresenceNow"), not shrink this shared default.
 */
const DEFAULT_KNOBS: StartOptions = {
  watch: false,
  focusDebounceMs: 10,
}

export async function startHarness(opts: StartOptions & { sessionNodes?: number } = {}): Promise<Harness> {
  await ensureBuilt()
  const { sessionNodes = 0, ...serverOptions } = opts
  const { root, cleanup: cleanupRepo } = tempFixtureRepo(sessionNodes)
  const stateDir = mkdtempSync(path.join(tmpdir(), "og-e2e-state-"))
  const startOpts: StartOptions = { repoPath: root, stateDir, autoBootstrap: true, ...DEFAULT_KNOBS, ...serverOptions }

  let proc = await spawnServer(startOpts)
  const port = new URL(proc.mcpUrl).port

  const snap = await readResource(proc.mcpUrl, "graph://snapshot")
  const firstNode = snap.graph.nodes[0]
  const firstCell = `${firstNode.domain ?? "unassigned"}:${firstNode.level}`

  const prev: PreviewServer = await preview({
    root: MCP_WEB_ROOT,
    configFile: VITE_CONFIG,
    preview: { port: 0, strictPort: false },
    logLevel: "warn",
  })
  const previewUrl = prev.resolvedUrls!.local[0]!.replace(/\/$/, "")

  async function openSessionInContext(context: BrowserContext, name: string): Promise<{ page: Page }> {
    const page = await context.newPage()
    await page.goto(`${previewUrl}/?server=${encodeURIComponent(proc.mcpUrl)}`)
    await page.fill("#name", name)
    await page.locator("#name").press("Tab") // blur → change event → connectOg()
    await page.waitForFunction((n) => document.getElementById("who")?.textContent === n, name)
    await page.waitForSelector("#conn.on")
    return { page }
  }

  return {
    get serverUrl() {
      return proc.mcpUrl
    },
    previewUrl,
    repoRoot: root,
    firstCell,
    callTool: (name, args) => callTool(proc.mcpUrl, name, args),
    readResource: (uri) => readResource(proc.mcpUrl, uri),
    async control(action) {
      const res = await fetch(`${proc.controlUrl}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error(`control ${action} → HTTP ${res.status}`)
    },
    pageUrl: () => `${previewUrl}/?server=${encodeURIComponent(proc.mcpUrl)}`,
    async openSession(browser, name) {
      const context = await browser.newContext()
      const { page } = await openSessionInContext(context, name)
      return { page, context }
    },
    openSessionInContext,
    async restartServer() {
      await stopServer(proc)
      proc = await spawnServer({ ...startOpts, port: Number(port) })
    },
    async stop() {
      await prev.close()
      await stopServer(proc)
      cleanupRepo()
      rmSync(stateDir, { recursive: true, force: true })
    },
  }
}
