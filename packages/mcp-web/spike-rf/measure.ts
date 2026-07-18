/**
 * spike-rf/measure.ts — runner do gate de escala (UI-0 Parte A).
 * Sobe o vite dev, abre chromium (playwright) em cada configuração e
 * imprime a tabela markdown pro doc 00-scope. `bun spike-rf/measure.ts`.
 * Números são de chromium headless — comparativos, não absolutos.
 */
import { chromium } from "@playwright/test"
import { spawn } from "node:child_process"

const PORT = 5199
const CONFIGS = [
  { n: 200, g: 6, culling: "on" },
  { n: 500, g: 6, culling: "on" },
  { n: 1000, g: 6, culling: "on" },
  { n: 1000, g: 6, culling: "off" },
  { n: 5000, g: 6, culling: "on" },
  { n: 5000, g: 30, culling: "on" },
  { n: 5000, g: 6, culling: "off" },
]

const vite = spawn("bunx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: "pipe",
})
await new Promise<void>((ok, err) => {
  vite.stdout.on("data", (d: Buffer) => d.toString().includes("Local:") && ok())
  vite.on("exit", () => err(new Error("vite exited")))
  setTimeout(() => err(new Error("vite timeout")), 15_000)
})

const browser = await chromium.launch()
const rows: string[] = []
try {
  for (const c of CONFIGS) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
    await page.goto(`http://localhost:${PORT}/spike-rf/index.html?n=${c.n}&g=${c.g}&culling=${c.culling}`)
    await page.waitForFunction(() => (window as any).__spike?.ready, { timeout: 30_000 })
    const mount0 = await page.evaluate(() => performance.now())
    const res = await page.evaluate(() => (window as any).__spike.run(5000))
    rows.push(`| ${c.n} | ${c.g} | ${c.culling} | ${res.fps} | ${res.frames} |`)
    console.log(`n=${c.n} g=${c.g} culling=${c.culling} → ${res.fps} FPS (${res.frames} frames)`)
    void mount0
    await page.close()
  }
} finally {
  await browser.close()
  vite.kill()
}

console.log("\n| nós | grupos | culling | FPS pan/zoom | frames/5s |")
console.log("|---|---|---|---|---|")
for (const r of rows) console.log(r)
