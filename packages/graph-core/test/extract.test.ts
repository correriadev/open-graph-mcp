import { expect, test } from "bun:test"
import { excerptCheck } from "../src/extract"

// QA-4 DoD item 2: excerptCheck is the verbatim-anchor primitive gates.ts (incrementalGate's
// anchor check, finalGate via verify.ts) and claim-store.ts's validateClaims all call directly.

test("match: excerpt appears verbatim in the content", () => {
  expect(excerptCheck("line1\nexport function f() {}\nline3", "export function f() {}")).toBe(true)
})

test("no match: excerpt absent from the content", () => {
  expect(excerptCheck("totally unrelated content", "export function f() {}")).toBe(false)
})

test("CRLF in the content is normalized before matching an LF excerpt", () => {
  expect(excerptCheck("line1\r\nexport function f() {}\r\nline3", "export function f() {}")).toBe(true)
})

test("CRLF in the excerpt is normalized before matching LF content", () => {
  expect(excerptCheck("line1\nexport function f() {}\nline3", "line1\r\nexport function f() {}")).toBe(true)
})

test("empty excerpt is trivially found in any content (substring identity)", () => {
  expect(excerptCheck("anything", "")).toBe(true)
})

test("excerpt longer than the content never matches", () => {
  expect(excerptCheck("short", "this excerpt is way longer than the content")).toBe(false)
})
