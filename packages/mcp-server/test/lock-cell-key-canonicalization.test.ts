/**
 * lock-cell-key-canonicalization.test.ts — achado F7
 * (docs/roadmap-server-beta/01-evidencias-fluxo-completo.md).
 *
 * A trava pessimista era adquirida por igualdade de STRING CRUA sobre a chave de célula. Como
 * `auth:P4` e `auth:4` são a mesma célula lógica mas duas strings diferentes, viravam duas linhas
 * distintas na tabela `locks`: Alice trancava numa grafia, Bob na outra, e os DOIS recebiam
 * `ok: true` sobre a mesma célula — exatamente o que a trava pessimista existe para impedir.
 *
 * Mais grave que o F1 irmão: aquele concedia autoridade não merecida; este permite duas pessoas
 * editando a mesma célula ao mesmo tempo, que é a garantia central do produto.
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, readResource, register } from "./helpers"

test("F7: Bob NAO consegue trancar a mesma celula que Alice mudando a grafia da chave", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const bob = await register(s.url, "bob")

    const a = await callTool(s.url, "changeset.open", { token: alice.token, cells: ["auth:P4"], intent: "alice trabalha" })
    expect(a.ok).toBe(true)

    // Mesma célula, grafia numérica. Antes: uma segunda linha em `locks` e `ok: true` para os dois.
    const b = await callTool(s.url, "changeset.open", { token: bob.token, cells: ["auth:4"], intent: "bob tenta pela outra grafia" })
    expect(b.ok).toBe(false)
    expect(b.reason).toBe("cell_locked")
    expect(b.holder).toBe(alice.userId)

    // E o inverso também: quem trancou na numérica bloqueia quem pede na prefixada.
    const c = await callTool(s.url, "changeset.open", { token: bob.token, cells: ["auth:P4"], intent: "bob tenta pela mesma grafia" })
    expect(c.ok).toBe(false)
    expect(c.holder).toBe(alice.userId)

    // Uma única linha de trava para a célula, na forma canônica.
    const locks = s.state.db.query("SELECT cell FROM locks WHERE tenant_id = ? AND cell LIKE 'auth:%'").all("default") as { cell: string }[]
    expect(locks).toEqual([{ cell: "auth:4" }])
  } finally {
    s.stop()
  }
})

test("F7: o proprio dono REUSA o turno ao pedir a mesma celula na outra grafia (nao abre um segundo)", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const first = await callTool(s.url, "changeset.open", { token: alice.token, cells: ["ui:P4"], intent: "turno" })
    const second = await callTool(s.url, "changeset.open", { token: alice.token, cells: ["ui:4"], intent: "mesma celula, outra grafia" })

    expect(second.ok).toBe(true)
    expect(second.csId).toBe(first.csId) // reuse idempotente, não um turno paralelo do mesmo dono
    const mine = await callTool(s.url, "changeset.list_mine", { token: alice.token })
    expect(mine.changesets).toHaveLength(1)
  } finally {
    s.stop()
  }
})

test("F7: as duas grafias na MESMA chamada contam como uma celula so", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    // Sem canonicalizar ANTES do dedup, a segunda entrada bateria na trava que a primeira acabou de
    // criar — o chamador seria bloqueado pela própria trava.
    const open = await callTool(s.url, "changeset.open", { token: alice.token, cells: ["billing:P3", "billing:3"], intent: "duplicada" })
    expect(open.ok).toBe(true)

    const locks = s.state.db.query("SELECT cell FROM locks WHERE tenant_id = ? AND cs_id = ?").all("default", open.csId) as { cell: string }[]
    expect(locks).toEqual([{ cell: "billing:3" }])
  } finally {
    s.stop()
  }
})

test("F7: graph://cell nao reporta 'livre' uma celula trancada pela outra grafia", async () => {
  const s = startServer()
  try {
    const alice = await register(s.url, "alice")
    const open = await callTool(s.url, "changeset.open", { token: alice.token, cells: ["auth:4"], intent: "trancado" })

    // "está livre" é a resposta errada mais perigosa que este recurso pode dar: um cliente que a
    // creia abre turno e leva `cell_locked` na cara, ou pior, assume que pode editar.
    const prefixed = await readResource(s.url, "graph://cell/auth:P4", alice.token)
    const bare = await readResource(s.url, "graph://cell/auth:4", alice.token)
    expect(prefixed.lock).not.toBeNull()
    expect(prefixed.lock.csId).toBe(open.csId)
    expect(prefixed.lock).toEqual(bare.lock)
  } finally {
    s.stop()
  }
})
