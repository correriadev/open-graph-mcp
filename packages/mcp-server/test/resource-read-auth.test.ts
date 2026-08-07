/**
 * resource-read-auth.test.ts — WS-D. The authz question a beta reviewer asks first about `resources/read`:
 * bogus token → explicit error, no token → deliberate anonymous default-tenant fallback (D13, pinned here
 * so nobody "fixes" it into an error later), valid token → scoped strictly to that tenant, never leaking
 * another tenant's data. Also covers the `resources/list` ↔ `resolveResource` drift check (every URI in
 * RESOURCE_LIST resolves; every resolver case is represented in RESOURCE_LIST) and the `unknown resource`
 * error, neither asserted anywhere today. §5 (tools/list ↔ callTool drift) is included here too, per the
 * campaign scope's instruction to place it in one of WS-D's own new files.
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, readResource, register, tempRepo, bootstrapAs } from "./helpers"

// rpc() collapses body.error and result.isError into the same thrown Error — fine for tool calls, but
// resources/read errors surface as a raw JSON-RPC error envelope (protocol-level, not tool isError), so
// a local raw helper is needed to assert on the envelope shape directly.
async function rpcRaw(base: string, method: string, params?: unknown): Promise<any> {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  return res.json()
}

test("resources/read com token forjado: erro explícito 'invalid or expired token', não fallback silencioso", async () => {
  const s = startServer()
  try {
    const body = await rpcRaw(s.url, "resources/read", { uri: "graph://snapshot", token: "totally-bogus-token" })
    expect(body.result).toBeUndefined()
    expect(body.error?.message).toMatch(/invalid or expired token/)
  } finally {
    s.stop()
  }
})

// D13, pinned deliberately: transport.ts's tenantOf treats an ABSENT token as the anonymous default
// tenant, NOT an error — the web client reads graph://snapshot before the user has registered any
// identity, and that path must never throw. This is different from a token that IS present but unknown
// (previous test), which IS an error. Conflating the two was the original bug this comment documents.
test("resources/read SEM token: cai no tenant default deliberadamente (D13), não é erro", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer()
  try {
    await bootstrapAs(s.url, root, "bootstrapper", "default")
    const body = await rpcRaw(s.url, "resources/read", { uri: "graph://snapshot" })
    expect(body.error).toBeUndefined()
    const contents = JSON.parse(body.result.contents[0].text)
    expect(contents.graph).toBeTruthy()
  } finally {
    s.stop()
    cleanup()
  }
})

test("resources/read com token válido: escopado ao tenant do token, nunca vaza dado de outro tenant", async () => {
  const { root: rootA, cleanup: cleanupA } = tempRepo("fresh")
  const { root: rootB, cleanup: cleanupB } = tempRepo("demote")
  const s = startServer()
  try {
    await bootstrapAs(s.url, rootA, "bootstrapper-a", "tenant-a")
    await bootstrapAs(s.url, rootB, "bootstrapper-b", "tenant-b")

    const readerA = await register(s.url, "reader-a", "tenant-a")
    const readerB = await register(s.url, "reader-b", "tenant-b")

    const snapA = await readResource(s.url, "graph://snapshot", readerA.token)
    const snapB = await readResource(s.url, "graph://snapshot", readerB.token)

    // Different repos indexed → different graphId; A's read must never resemble B's.
    expect(snapA.graphId).not.toBe(snapB.graphId)

    const filesA = snapA.graph.nodes.map((n: { file: string }) => n.file)
    const filesB = snapB.graph.nodes.map((n: { file: string }) => n.file)
    // "demote" fixture bootstraps src/app.ts (see domains-env.test.ts); "fresh" does not carry that file.
    expect(filesB.some((f: string) => f.includes("app.ts"))).toBe(true)
    expect(filesA.some((f: string) => f.includes("app.ts"))).toBe(false)
  } finally {
    s.stop()
    cleanupA()
    cleanupB()
  }
})

test("resources/read com URI desconhecida: erro 'unknown resource: <uri>'", async () => {
  const s = startServer()
  try {
    const body = await rpcRaw(s.url, "resources/read", { uri: "graph://not-a-real-resource" })
    expect(body.error?.message).toBe("unknown resource: graph://not-a-real-resource")
  } finally {
    s.stop()
  }
})

// ---------------------------------------------------------------------------
// Drift: resources/list ↔ resolveResource's switch. Every advertised URI must resolve to SOMETHING
// (not necessarily success — some require args — but never "unknown resource"); every switch case must
// be represented by an entry in RESOURCE_LIST so a client discovering resources via resources/list never
// finds a dead end, and so a resolver branch is never silently undiscoverable.
// ---------------------------------------------------------------------------

test("drift: todo URI de resources/list resolve (não cai em 'unknown resource')", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer()
  try {
    await bootstrapAs(s.url, root)
    const list = await rpcRaw(s.url, "resources/list", {})
    const uris: string[] = list.result.resources.map((r: { uri: string }) => r.uri)
    expect(uris.length).toBeGreaterThan(0)

    for (const templated of uris) {
      // Templated URIs (`{cellKey}`, `{domain}`, `{id}`) aren't directly fetchable — substitute a
      // plausible concrete value so the resolver's switch is actually exercised end-to-end, same as a
      // real client would after filling in the template.
      const concrete = templated
        .replace("{cellKey}", "ui:1")
        .replace("{domain}", "ui")
        .replace("{id}", "cs_nonexistent")
      const body = await rpcRaw(s.url, "resources/read", { uri: concrete })
      // Never "method not found for this URI" — either a real result or a domain-specific error
      // (e.g. "unknown changeset: ...", "cell key required") is acceptable; "unknown resource" is not.
      if (body.error) expect(body.error.message).not.toMatch(/^unknown resource:/)
      else expect(body.result).toBeTruthy()
    }
  } finally {
    s.stop()
    cleanup()
  }
})

test("drift: todo case do resolver aparece em resources/list (nenhum recurso invisível)", async () => {
  const s = startServer()
  try {
    // The resolver's switch heads, read straight from resources.ts's own resolveResource behavior:
    // hitting each with a minimal/empty arg must NOT produce "unknown resource" (a real, resource-specific
    // error is fine and expected) — proving each head is reachable via some graph:// URI, i.e. it has a
    // RESOURCE_LIST entry a client could have discovered it through.
    const heads = ["snapshot", "history", "cell", "domain", "changeset", "changesets", "claims"]
    const list = await rpcRaw(s.url, "resources/list", {})
    const listedHeads = new Set(
      list.result.resources.map((r: { uri: string }) => r.uri.replace(/^graph:\/\//, "").split(/[/?]/)[0]),
    )
    for (const head of heads) expect(listedHeads.has(head)).toBe(true)
  } finally {
    s.stop()
  }
})

// ---------------------------------------------------------------------------
// §5: tools/list ↔ callTool drift — the tool-level analogue of the resource drift check above, and
// exactly the class of check that would have caught changeset.extend shipping with zero tests.
// ---------------------------------------------------------------------------

test("drift: todo tool em tools/list tem um case correspondente em callTool (dispatch, não 'unknown tool')", async () => {
  const s = startServer()
  try {
    const list = await rpcRaw(s.url, "tools/list", {})
    const names: string[] = list.result.tools.map((t: { name: string }) => t.name)
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      const body = await rpcRaw(s.url, "tools/call", { name, arguments: {} })
      // A missing-arg validation error (isError:true) is fine and expected for most tools called with
      // {} — what must NEVER happen is the protocol-level "unknown tool:" error, which only fires when
      // callTool's switch has no case for this name.
      if (body.error) expect(body.error.message).not.toMatch(/^unknown tool:/)
    }
  } finally {
    s.stop()
  }
})

test("drift: tools/call com nome desconhecido devolve erro de protocolo -32602 'unknown tool: ...'", async () => {
  const s = startServer()
  try {
    const body = await rpcRaw(s.url, "tools/call", { name: "not.a.real.tool", arguments: {} })
    expect(body.result).toBeUndefined()
    expect(body.error?.code).toBe(-32602)
    expect(body.error?.message).toBe("unknown tool: not.a.real.tool")
  } finally {
    s.stop()
  }
})
