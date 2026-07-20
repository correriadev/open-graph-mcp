import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const manifest = JSON.parse(readFileSync(path.join(root, "e2e/parity-manifest.json"), "utf8"))
const expected = [...Array.from({ length: 18 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`), ...Array.from({ length: 6 }, (_, i) => `G${String(i + 1).padStart(2, "0")}`)]

export function parityRunPasses(summary: { total: number; failed: number; skipped: number }): boolean {
  return summary.total > 0 && summary.failed === 0 && summary.skipped === 0
}

describe("parity manifest", () => {
  test("accounts for every capability exactly once", () => {
    const ids = manifest.capabilities.map((item: any) => item.id)
    expect([...ids].sort()).toEqual([...expected].sort())
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("requires existing evidence for proven items and signed metadata for waivers", () => {
    for (const item of manifest.capabilities) {
      expect(["pending", "proven", "waived"]).toContain(item.status)
      if (item.status === "proven") {
        expect(item.evidence.length).toBeGreaterThan(0)
        for (const spec of item.evidence) expect(existsSync(path.join(root, "e2e", spec)), `${item.id}: ${spec}`).toBe(true)
      }
      if (item.status === "waived") {
        expect(item.signer).toBeTruthy()
        expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    }
  })

  test("rejects empty, failed, or skipped runs", () => {
    expect(parityRunPasses({ total: 0, failed: 0, skipped: 0 })).toBe(false)
    expect(parityRunPasses({ total: 1, failed: 1, skipped: 0 })).toBe(false)
    expect(parityRunPasses({ total: 1, failed: 0, skipped: 1 })).toBe(false)
    expect(parityRunPasses({ total: 1, failed: 0, skipped: 0 })).toBe(true)
  })
})
