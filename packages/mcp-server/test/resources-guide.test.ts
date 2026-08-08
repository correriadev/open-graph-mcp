/**
 * resources-guide.test.ts — Entrega 2. `claude mcp add --transport http` gives a fresh agent the
 * tools and nothing else (no skill/hook/plugin), so `graph://guide` is the one place the workflow
 * can live where such an agent can read it on its own. Asserts it's discoverable via
 * `resources/list` and readable via `resources/read` with non-empty, on-topic content.
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { RESOURCE_LIST, resolveResource } from "../src/resources"
import { rpc, readResource, register } from "./helpers"

test("graph://guide is listed in RESOURCE_LIST", () => {
  const entry = RESOURCE_LIST.find((r) => r.uri === "graph://guide")
  expect(entry).toBeDefined()
  expect(entry!.description.length).toBeGreaterThan(0)
})

test("resources/list exposes graph://guide over the wire", async () => {
  const s = startServer()
  try {
    const { resources } = await rpc(s.url, "resources/list")
    expect(resources.some((r: { uri: string }) => r.uri === "graph://guide")).toBe(true)
  } finally {
    s.stop()
  }
})

test("graph://guide reads back non-empty text covering the core workflow", () => {
  const s = startServer()
  try {
    const env = resolveResource(s.state, "graph://guide", "default") as { text: string }
    expect(typeof env.text).toBe("string")
    expect(env.text.length).toBeGreaterThan(0)
    // Core workflow beats this guide must actually mention (register first, query-before-write,
    // the changeset/claim mechanics, lock contention, and the stateless notification poll).
    expect(env.text).toContain("session.register")
    expect(env.text).toContain("graph.query")
    expect(env.text).toContain("graph.impact")
    expect(env.text).toContain("changeset.open")
    expect(env.text).toContain("changeset.claim")
    expect(env.text).toContain("changeset.commit")
    expect(env.text).toContain("cell_locked")
    expect(env.text).toContain("system.pending")
  } finally {
    s.stop()
  }
})

test("graph://guide is readable end-to-end through resources/read with a registered token", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const env = await readResource(s.url, "graph://guide", alice.token)
    expect(env.text.length).toBeGreaterThan(0)
  } finally {
    s.stop()
  }
})
