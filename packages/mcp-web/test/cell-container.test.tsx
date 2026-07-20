import { expect, test } from "bun:test"
import { cellLockCountdown } from "../src/cell-container"

test("cell lock countdown is deterministic and never negative", () => {
  expect(cellLockCountdown(new Date(15_000).toISOString(), 10_000)).toBe("5s")
  expect(cellLockCountdown(new Date(5_000).toISOString(), 10_000)).toBe("0s")
})
