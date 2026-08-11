import { expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { startServer } from "../src/index"
import { tempRepo } from "./helpers"

/**
 * sdk-client-compliance.test.ts — INT-0 matrix row: the official `@modelcontextprotocol/sdk` `Client`
 * + `StreamableHTTPClientTransport` (NOT our own hand-rolled JSON-RPC client in helpers.ts) driving the
 * real `/mcp` endpoint end-to-end over HTTP. This is the regression test that proves the SDK — the same
 * code real MCP clients embed — completes the handshake and every operation tracked in
 * docs/CHANGELOG.md without choking on some encoding/framing detail a raw
 * curl request wouldn't catch (e.g. the SDK's transport opens a GET SSE stream after connect() and
 * specifically expects — and gets — a 405 back, per Streamable HTTP spec §2.3, without erroring).
 */

test("SDK Client + StreamableHTTPClientTransport: initialize, tools/list, tools/call ok, tools/call error (isError), resources/read", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ watch: false })
  const client = new Client({ name: "int-0-compliance-check", version: "1.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`))
  try {
    // initialize — client.connect() performs the full handshake (initialize + notifications/initialized)
    // internally; there is no separate public client.initialize() to call.
    await client.connect(transport)
    expect(client.getServerVersion()).toMatchObject({ name: "open-graph-mcp" })
    expect(client.getServerCapabilities()).toMatchObject({ tools: {}, resources: {} })

    // tools/list
    const tools = await client.listTools()
    const names = tools.tools.map((t) => t.name)
    expect(names).toContain("session.register")
    expect(names).toContain("graph.query")

    // tools/call — success path
    const reg = await client.callTool({ name: "session.register", arguments: { name: "sdk-e2e-user" } })
    expect(reg.isError).toBeUndefined()
    expect((reg.structuredContent as any)?.token).toBeString()

    // tools/call — execution error surfaces as result.isError:true, NOT a thrown JSON-RPC error.
    // graph.query throws "not bootstrapped" when the tenant has no graph yet.
    const badQuery = await client.callTool({ name: "graph.query", arguments: { terms: ["x"] } })
    expect(badQuery.isError).toBe(true)
    expect((badQuery.content as any)?.[0]?.text).toContain("not bootstrapped")

    // bootstrap so resources/read has something real to return — needs the token from the
    // session.register above: graph.bootstrap publishes into the CALLER's tenant.
    const sdkToken = (reg.structuredContent as any).token as string
    const boot = await client.callTool({ name: "graph.bootstrap", arguments: { token: sdkToken, repoPath: root } })
    expect(boot.isError).toBeUndefined()
    const graphId = (boot.structuredContent as any)?.graphId
    expect(graphId).toBeString()

    // resources/read
    const snap = await client.readResource({ uri: "graph://snapshot" })
    const parsed = JSON.parse(snap.contents[0].text as string)
    expect(parsed.graphId).toBe(graphId)
  } finally {
    await client.close().catch(() => {})
    s.stop()
    cleanup()
  }
})
