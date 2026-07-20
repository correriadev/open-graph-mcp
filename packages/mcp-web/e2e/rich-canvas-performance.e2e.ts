import { expect, test } from "@playwright/test"
import { startHarness, type Harness } from "./fixture"

let harness: Harness
test.beforeAll(async () => { harness = await startHarness({ sessionNodes: 200 }) })
test.afterAll(async () => { await harness.stop() })

test("session-regime rich canvas pan median remains above 50 FPS", async ({ browser }) => {
  const session = await harness.openSession(browser, "perf")
  const page = session.page
  expect((await harness.readResource("graph://snapshot")).graph.nodes.length).toBe(202)
  await expect(page.locator(".og-card").first()).toBeVisible()
  const samples = await page.evaluate(async () => {
    const results: { fps: number; slowFrames: number }[] = []
    for (let run = 0; run < 3; run++) {
      let frames = 0
      let slowFrames = 0
      const started = performance.now()
      let previous = started
      await new Promise<void>((resolve) => {
        const frame = () => {
          const now = performance.now()
          if (now - previous > 20) slowFrames++
          previous = now
          frames++
          const elapsed = now - started
          ;(window as any).__og_e2e.setViewport({ x: -((elapsed / 2_000) * 900), y: -120 * Math.sin(elapsed / 250), zoom: 0.55 })
          if (elapsed >= 2_000) resolve()
          else requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      })
      results.push({ fps: frames / ((performance.now() - started) / 1_000), slowFrames })
    }
    return results
  })
  samples.sort((a, b) => a.fps - b.fps)
  console.log(`UI-4 rich pan samples=${samples.map((sample) => `${sample.fps.toFixed(1)}fps/${sample.slowFrames}slow`).join(",")} median=${samples[1]!.fps.toFixed(1)}`)
  expect(samples[1]!.fps).toBeGreaterThanOrEqual(50)
  await session.context.close()
})
