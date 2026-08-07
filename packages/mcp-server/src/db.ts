/**
 * db.ts — SQLite (bun:sqlite, WAL) é o índice live rebuildável; o espelho JSONL por tenant é a
 * verdade durável (ADR §4.1). Toda escritura de estado durável passa por `write()`: insere no SQLite
 * E anexa a linha ao JSONL do tenant, na mesma chamada síncrona. `rebuildFromJsonl` apaga o estado
 * SQLite de um tenant e o reconstrói lendo os JSONL — prova a regra canônica (JSONL > SQLite).
 *
 * D13 multi-tenant: `tenant_id TEXT NOT NULL` em todas as tabelas; espelho em
 * STATE_DIR/tenants/<tenantId>/<table>.jsonl. Locks e sessions NÃO são espelhados (índice live puro,
 * reconstruído do estado corrente / memória) — só o estado durável (users, nodes, edges, claims,
 * authority, changesets, cs_deltas, events).
 */
import { Database } from "bun:sqlite"
import { appendFileSync, mkdirSync, readFileSync, existsSync, statSync, truncateSync, unlinkSync } from "node:fs"
import path from "node:path"
import { normalizeRecoveredClaimLevel } from "./claim-level"

/** Tabelas duráveis espelhadas em JSONL, na ordem de replay do rebuild. */
export const DURABLE_TABLES = ["tenants", "users", "nodes", "edges", "claims", "authority", "changesets", "cs_deltas", "events"] as const
/** Todas as tabelas com tenant_id (durables + índice live). */
const ALL_TABLES = [...DURABLE_TABLES, "locks", "system_messages"] as const

const SCHEMA = `
/* Qual repo cada tenant indexou. DURAVEL de proposito: sem isto, depois de um restart o servidor
   nao sabe onde reindexar nem onde checar drift, e a unica memoria disso era uma env var global do
   processo (GRAPH_REPO_PATH) -- que amarrava o servidor inteiro a UM repo, justamente o contrario
   de multi-tenant. O repo e argumento da tool graph.bootstrap, nao configuracao do servidor.
   (Sem crase neste comentario: o SCHEMA e um template literal.) */
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT NOT NULL, repo_path TEXT, domains TEXT, indexed_at TEXT,
  PRIMARY KEY (tenant_id)
);
CREATE TABLE IF NOT EXISTS users (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS nodes (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, domain TEXT, level TEXT, file TEXT, kind TEXT, sig TEXT,
  anchor TEXT, symbol_path TEXT, token_hash TEXT, exposed INTEGER, responsibility TEXT, confidence REAL,
  created_seq INTEGER, supersede_seq INTEGER,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS edges (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL,
  created_seq INTEGER, supersede_seq INTEGER,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS claims (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, subject TEXT, domain TEXT, level TEXT,
  refs TEXT, anchor TEXT, file TEXT, verdict_confidence REAL, verdict_overclaim INTEGER, supersedes TEXT,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS claims_tenant_seq ON claims (tenant_id, seq);
CREATE INDEX IF NOT EXISTS claims_tenant_cell_seq ON claims (tenant_id, domain, level, seq);
CREATE TABLE IF NOT EXISTS authority (
  tenant_id TEXT NOT NULL, cell TEXT NOT NULL, value TEXT NOT NULL, last_flip_seq INTEGER, last_flip_by TEXT,
  PRIMARY KEY (tenant_id, cell)
);
CREATE TABLE IF NOT EXISTS changesets (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, intent TEXT NOT NULL, parent TEXT, status TEXT NOT NULL,
  opened_by TEXT NOT NULL, opened_at TEXT NOT NULL, closed_at TEXT, base_seq INTEGER, admit_seq INTEGER,
  blast_cells TEXT,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS cs_deltas (
  tenant_id TEXT NOT NULL, cs_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, cs_id, seq)
);
CREATE TABLE IF NOT EXISTS locks (
  tenant_id TEXT NOT NULL, cell TEXT NOT NULL, cs_id TEXT NOT NULL, mode TEXT NOT NULL, acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, holder TEXT NOT NULL,
  PRIMARY KEY (tenant_id, cell)
);
CREATE TABLE IF NOT EXISTS events (
  tenant_id TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL, kind TEXT NOT NULL, target_kind TEXT,
  target_id TEXT, payload TEXT, by_user TEXT,
  PRIMARY KEY (tenant_id, seq)
);
-- INT-3: a queue for stateless poll-based drain (system.pending). Live index only, like locks — a
-- consumer that missed a message because it wasn't connected when the server restarted has nothing
-- to recover anyway (system.message itself is ephemeral: true), so no JSONL mirror.
CREATE TABLE IF NOT EXISTS system_messages (
  tenant_id TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
);

/* D10-lite: tokens sobrevivem a restart. SQLite SIM, JSONL NAO -- e a unica tabela com tenant_id
   deliberadamente fora do espelho duravel, e por dois motivos. (1) Token e CREDENCIAL, nao
   conhecimento: a verdade duravel deste sistema e o grafo, e o JSONL e append-only, ou seja,
   espelhar tokens ali seria manter todo token ja emitido, em claro, para sempre, sem caminho de
   revogacao. (2) Perder o SQLite nao perde trabalho: o cliente re-registra sob o mesmo nome, o
   userId e deterministico (sha256 de tenant:name), e os changesets dele continuam la -- e
   exatamente o caminho de recuperacao QA-1 que ja existe no packages/client.
   token_hash e o sha256 do token: um SQLite vazado nao entrega credencial utilizavel.
   (Sem crase neste comentario: o SCHEMA e um template literal.) */
CREATE TABLE IF NOT EXISTS tokens (
  tenant_id TEXT NOT NULL, token_hash TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  PRIMARY KEY (token_hash)
);
CREATE INDEX IF NOT EXISTS idx_tokens_expires ON tokens (expires_at);
`

export function openDb(sqlitePath: string): Database {
  if (sqlitePath !== ":memory:") mkdirSync(path.dirname(sqlitePath), { recursive: true })
  const db = new Database(sqlitePath, { create: true })
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  db.exec(SCHEMA)
  // Canonicalize legacy numeric levels once so cell pagination can use equality and the full
  // (tenant, domain, level, seq) index instead of an IN predicate plus a tenant-scale sort.
  try {
    db.transaction(() => {
      const rows = db.query("SELECT tenant_id, id, level FROM claims WHERE level IS NOT NULL").all() as { tenant_id: string; id: string; level: unknown }[]
      const update = db.query("UPDATE claims SET level = ? WHERE tenant_id = ? AND id = ?")
      for (const row of rows) {
        const normalized = normalizeRecoveredClaimLevel(row.level)
        if (!normalized.ok) throw new Error(normalized.reason)
        if (row.level !== normalized.stored) update.run(normalized.stored, row.tenant_id, row.id)
      }
    })()
  } catch (error) {
    db.close()
    throw error
  }
  return db
}

type Row = Record<string, string | number | null>
type PendingMirror = { stateDir: string; tenant: string; table: string; row: Row }
const mirrorUnits = new WeakMap<Database, PendingMirror[]>()
const mirrorAppendFailures = new WeakMap<Database, { target: number; count: number }>()

/** Per-database deterministic fault injection for durability regression tests. */
export function injectMirrorAppendFailure(db: Database, appendNumber: number): () => void {
  if (!Number.isInteger(appendNumber) || appendNumber < 1) throw new Error("invalid mirror append number")
  mirrorAppendFailures.set(db, { target: appendNumber, count: 0 })
  return () => mirrorAppendFailures.delete(db)
}

/** INSERT OR REPLACE genérico a partir das chaves do row (colunas = chaves). */
export function insertRow(db: Database, table: string, row: Row): void {
  const cols = Object.keys(row)
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${cols.map((c) => `@${c}`).join(",")})`
  const params: Record<string, string | number | null> = {}
  for (const c of cols) params[`@${c}`] = row[c] ?? null
  db.query(sql).run(params)
}

function tenantDir(stateDir: string, tenant: string): string {
  return path.join(stateDir, "tenants", tenant)
}

/** Anexa uma linha ao JSONL durável do tenant. Row é exatamente a linha SQLite (colunas = chaves). */
export function mirror(stateDir: string, tenant: string, table: string, row: Row): void {
  const dir = tenantDir(stateDir, tenant)
  mkdirSync(dir, { recursive: true })
  appendFileSync(path.join(dir, `${table}.jsonl`), JSON.stringify(row) + "\n")
}

/**
 * write — a única porta de escritura durável: SQLite + JSONL, síncrono, na ordem. Se `stateDir` for
 * `:memory:`-mode (sem espelho pedido) ainda insere no SQLite; o espelho só é pulado se stateDir vazio.
 */
export function write(db: Database, stateDir: string, tenant: string, table: string, row: Row): void {
  if (!mirrorUnits.has(db)) {
    durableTransaction(db, () => write(db, stateDir, tenant, table, row))
    return
  }
  insertRow(db, table, row)
  if (!stateDir) return
  const unit = mirrorUnits.get(db)
  if (unit) unit.push({ stateDir, tenant, table, row })
  else mirror(stateDir, tenant, table, row)
}

/** SQLite transaction plus rollbackable synchronous mirror batch. The mirror flush runs before the
 * SQLite transaction returns; an append failure truncates every touched file to its original size,
 * then the thrown error rolls SQLite back as well. */
export function durableTransaction<T>(db: Database, fn: () => T): T {
  if (mirrorUnits.has(db)) return fn()
  const pending: PendingMirror[] = []
  mirrorUnits.set(db, pending)
  try {
    return db.transaction(() => {
      const result = fn()
      const originals = new Map<string, number | null>()
      try {
        for (const item of pending) {
          const file = path.join(tenantDir(item.stateDir, item.tenant), `${item.table}.jsonl`)
          if (!originals.has(file)) originals.set(file, existsSync(file) ? statSync(file).size : null)
          const fault = mirrorAppendFailures.get(db)
          if (fault && ++fault.count === fault.target) throw new Error("injected mirror append failure")
          mirror(item.stateDir, item.tenant, item.table, item.row)
        }
      } catch (error) {
        for (const [file, size] of originals) {
          try { size === null ? unlinkSync(file) : truncateSync(file, size) } catch { /* best effort; original error wins */ }
        }
        throw error
      }
      return result
    })()
  } finally {
    mirrorUnits.delete(db)
  }
}

/**
 * rebuildFromJsonl — apaga o estado SQLite do tenant e o reconstrói a partir dos JSONL duráveis.
 * Prova a regra canônica: JSONL é a verdade; SQLite é derivado/rebuildável. Locks (índice live puro)
 * não são espelhados, então somem no rebuild — coordenação, não durabilidade.
 *
 * Escreve claims direto via `insertRow` (bypassa `writeClaim`) — se o chamador usa `state.claimsCache`
 * (store.ts `readClaims`), chame `invalidateClaimsCache(state, tenant)` depois desta função. `db.ts`
 * não conhece `ServerState` de propósito (módulo de baixo nível); a invalidação é responsabilidade do
 * chamador, não desta função.
 */
export function rebuildFromJsonl(db: Database, stateDir: string, tenant: string): void {
  const recovered: { table: (typeof DURABLE_TABLES)[number]; row: Row }[] = []
  for (const table of DURABLE_TABLES) {
    const file = path.join(tenantDir(stateDir, tenant), `${table}.jsonl`)
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue
      const parsed = JSON.parse(line) as Row
      if (parsed.tenant_id !== tenant) throw new Error("recovery tenant mismatch")
      if (table === "claims") {
        const normalized = normalizeRecoveredClaimLevel(parsed.level)
        if (!normalized.ok) throw new Error(normalized.reason)
        recovered.push({ table, row: { ...parsed, level: normalized.stored } })
      } else recovered.push({ table, row: parsed })
    }
  }
  const tx = db.transaction(() => {
    for (const t of ALL_TABLES) db.query(`DELETE FROM ${t} WHERE tenant_id = ?`).run(tenant)
    for (const entry of recovered) insertRow(db, entry.table, entry.row)
  })
  tx()
}
