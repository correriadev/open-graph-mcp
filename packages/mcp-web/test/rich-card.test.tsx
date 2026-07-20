import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { SafeMarkdown } from "../src/flow/safe-markdown"

test("safe markdown renders structure without raw script injection", () => {
  const html = renderToStaticMarkup(<SafeMarkdown>{"# ADR\n\n- item\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>"}</SafeMarkdown>)
  expect(html).toContain("<h1>ADR</h1>")
  expect(html).toContain("<li>item</li>")
  expect(html).toContain("<table>")
  expect(html).not.toContain("<script")
})
