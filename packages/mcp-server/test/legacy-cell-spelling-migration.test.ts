/**
 * legacy-cell-spelling-migration.test.ts — resíduo §7.6 de
 * docs/CHANGELOG.md
 *
 * As correções de F1/F7 canonicalizaram a chave de célula (`auth:P4` → `auth:4`) em toda BORDA de
 * leitura e escrita, mas não tocaram no que já estava gravado. Uma linha de `locks` na grafia antiga
 * vira uma trava que ninguém consegue liberar (o abort procura `auth:4`); uma de `authority`, uma
 * promoção a `graph` que a célula deixou de enxergar. Estes testes montam esse passado à mão — via SQL
 * cru, que é a única forma de produzi-lo hoje — e provam que o boot o resolve.
 */
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { openDb, rebuildFromJsonl } from "../src/db"

function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "og-mig-"))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test("boot canonicaliza lock e authority gravados na grafia antiga", () => {
  const { dir, cleanup } = tempDir()
  const file = path.join(dir, "state.sqlite")
  try {
    const first = openDb(file)
    first.query("INSERT INTO locks (tenant_id, cell, cs_id, mode, acquired_at, expires_at, holder) VALUES (?,?,?,?,?,?,?)")
      .run("t1", "auth:P4", "cs-1", "exclusive", "2026-01-01T00:00:00Z", "2999-01-01T00:00:00Z", "u1")
    first.query("INSERT INTO authority (tenant_id, cell, value, last_flip_seq, last_flip_by) VALUES (?,?,?,?,?)")
      .run("t1", "auth:P4", "graph", 7, "u1")
    first.close()

    const second = openDb(file)
    try {
      const locks = second.query("SELECT cell, holder FROM locks").all() as any[]
      expect(locks).toEqual([{ cell: "auth:4", holder: "u1" }])
      const auth = second.query("SELECT cell, value, last_flip_seq FROM authority").all() as any[]
      expect(auth).toEqual([{ cell: "auth:4", value: "graph", last_flip_seq: 7 }])
    } finally {
      second.close()
    }
  } finally {
    cleanup()
  }
})

test("colisão entre as duas grafias: authority mantém o flip mais recente", () => {
  const { dir, cleanup } = tempDir()
  const file = path.join(dir, "state.sqlite")
  try {
    const first = openDb(file)
    const ins = first.query("INSERT INTO authority (tenant_id, cell, value, last_flip_seq, last_flip_by) VALUES (?,?,?,?,?)")
    ins.run("t1", "auth:P4", "graph", 3, "antigo")
    ins.run("t1", "auth:4", "suspended", 9, "recente")
    first.close()

    const second = openDb(file)
    try {
      const rows = second.query("SELECT cell, value, last_flip_seq FROM authority").all() as any[]
      // Uma linha só, e é a do seq maior — o mesmo critério que authorityOf já usa para ler a tabela.
      expect(rows).toEqual([{ cell: "auth:4", value: "suspended", last_flip_seq: 9 }])
    } finally {
      second.close()
    }
  } finally {
    cleanup()
  }
})

test("colisão entre as duas grafias: lock mantém o que ainda vale, não o vencido", () => {
  const { dir, cleanup } = tempDir()
  const file = path.join(dir, "state.sqlite")
  try {
    const first = openDb(file)
    const ins = first.query("INSERT INTO locks (tenant_id, cell, cs_id, mode, acquired_at, expires_at, holder) VALUES (?,?,?,?,?,?,?)")
    ins.run("t1", "auth:P4", "cs-vivo", "exclusive", "2026-01-01T00:00:00Z", "2999-01-01T00:00:00Z", "vivo")
    ins.run("t1", "auth:4", "cs-vencido", "exclusive", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z", "vencido")
    first.close()

    const second = openDb(file)
    try {
      const rows = second.query("SELECT cell, holder FROM locks").all() as any[]
      // Descartar a trava viva em favor da vencida liberaria uma célula que alguém está segurando.
      expect(rows).toEqual([{ cell: "auth:4", holder: "vivo" }])
    } finally {
      second.close()
    }
  } finally {
    cleanup()
  }
})

test("tenants diferentes com a mesma célula não se fundem", () => {
  const { dir, cleanup } = tempDir()
  const file = path.join(dir, "state.sqlite")
  try {
    const first = openDb(file)
    const ins = first.query("INSERT INTO authority (tenant_id, cell, value, last_flip_seq, last_flip_by) VALUES (?,?,?,?,?)")
    ins.run("t1", "auth:P4", "graph", 1, "a")
    ins.run("t2", "auth:P4", "suspended", 1, "b")
    first.close()

    const second = openDb(file)
    try {
      const rows = second.query("SELECT tenant_id, cell, value FROM authority ORDER BY tenant_id").all() as any[]
      expect(rows).toEqual([
        { tenant_id: "t1", cell: "auth:4", value: "graph" },
        { tenant_id: "t2", cell: "auth:4", value: "suspended" },
      ])
    } finally {
      second.close()
    }
  } finally {
    cleanup()
  }
})

test("migração é idempotente: reabrir de novo não muda mais nada", () => {
  const { dir, cleanup } = tempDir()
  const file = path.join(dir, "state.sqlite")
  try {
    const first = openDb(file)
    first.query("INSERT INTO authority (tenant_id, cell, value, last_flip_seq, last_flip_by) VALUES (?,?,?,?,?)")
      .run("t1", "auth:P4", "graph", 7, "u1")
    first.close()

    const snapshots: string[] = []
    for (let i = 0; i < 2; i++) {
      const db = openDb(file)
      snapshots.push(JSON.stringify(db.query("SELECT * FROM authority ORDER BY cell").all()))
      db.close()
    }
    expect(snapshots[0]).toBe(snapshots[1])
    expect(snapshots[0]).toContain("auth:4")
  } finally {
    cleanup()
  }
})

test("rebuild do JSONL canonicaliza a célula — senão o replay desfaz a migração", () => {
  const { dir, cleanup } = tempDir()
  try {
    const file = path.join(dir, "state.sqlite")
    // O JSONL é append-only: uma linha gravada na grafia antiga está lá para sempre, e a migração de
    // boot não a alcança (ela roda no SQLite, que o rebuild acabou de apagar).
    const tenantDir = path.join(dir, "tenants", "t1")
    mkdirSync(tenantDir, { recursive: true })
    appendFileSync(
      path.join(tenantDir, "authority.jsonl"),
      JSON.stringify({ tenant_id: "t1", cell: "auth:P4", value: "graph", last_flip_seq: 7, last_flip_by: "u1" }) + "\n",
    )

    const db = openDb(file)
    try {
      rebuildFromJsonl(db, dir, "t1")
      const rows = db.query("SELECT cell, value FROM authority").all() as any[]
      expect(rows).toEqual([{ cell: "auth:4", value: "graph" }])
    } finally {
      db.close()
    }
  } finally {
    cleanup()
  }
})
