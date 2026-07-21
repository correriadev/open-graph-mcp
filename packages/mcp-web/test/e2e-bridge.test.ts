import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { installE2EBridge, type E2EBridgeDependencies, type E2EBridgeTarget } from "../src/e2e-bridge"

const calls: string[] = []
const dependencies: E2EBridgeDependencies = {
  setFocus: () => calls.push("focus"),
  pushToast: () => calls.push("toast"),
  pollWho: () => { calls.push("poll") },
  getViewport: () => ({ x: 1, y: 2, zoom: 3 }),
  setViewport: () => { calls.push("viewport") },
  focusNode: () => calls.push("node"),
  setNodeResponsibility: () => calls.push("responsibility"),
  setNodeDrift: () => calls.push("drift"),
  setCellAuthority: () => calls.push("authority"),
}

test("installer publishes the stable contract and owner cleanup removes it", () => {
  const target: E2EBridgeTarget = {}
  const cleanup = installE2EBridge(target, dependencies)
  expect(Object.keys(target.__og_e2e!).sort()).toEqual([
    "focusNode", "getViewport", "pollWho", "pushToast", "setCellAuthority", "setFocus",
    "setNodeDrift", "setNodeResponsibility", "setViewport", "zoomTo",
  ])
  expect(target.__og_e2e!.getViewport()).toEqual({ x: 1, y: 2, zoom: 3 })
  target.__og_e2e!.zoomTo(4)
  expect(calls).toContain("viewport")
  cleanup()
  expect(target.__og_e2e).toBeUndefined()
})

test("stale cleanup preserves the replacement bridge", () => {
  const target: E2EBridgeTarget = {}
  const cleanupA = installE2EBridge(target, dependencies)
  const bridgeA = target.__og_e2e
  const cleanupB = installE2EBridge(target, dependencies)
  const bridgeB = target.__og_e2e
  expect(bridgeB).not.toBe(bridgeA)
  cleanupA()
  expect(target.__og_e2e).toBe(bridgeB)
  cleanupB()
  expect(target.__og_e2e).toBeUndefined()
})

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const output = mkdtempSync(path.join(tmpdir(), "og-standard-build-"))
afterAll(() => rmSync(output, { recursive: true, force: true }))

test("standard production JavaScript artifact excludes the bridge marker and mutation commands", async () => {
  const build = Bun.spawn(["bunx", "vite", "build", "--mode", "production", "--outDir", output], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(await build.exited).toBe(0)
  const assets = path.join(output, "assets")
  const javascript = readdirSync(assets)
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(path.join(assets, name), "utf8"))
    .join("\n")
  expect(javascript).not.toContain("__og_e2e")
  expect(javascript).not.toContain("setNodeResponsibility")
  expect(javascript).not.toContain("setCellAuthority")
}, 60_000)
