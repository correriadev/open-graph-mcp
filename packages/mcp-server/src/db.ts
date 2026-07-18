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
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs"
import path from "node:path"

/** Tabelas duráveis espelhadas em JSONL, na ordem de replay do rebuild. */
export const DURABLE_TABLES = ["users", "nodes", "edges", "claims", "authority", "changesets", "cs_deltas", "events"] as const
/** Todas as tabelas com tenant_id (durables + índice live). */
const ALL_TABLES = [...DURABLE_TABLES, "locks", "system_messages"] as const

const SCHEMA = `
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
`

export function openDb(sqlitePath: string): Database {
  if (sqlitePath !== ":memory:") mkdirSync(path.dirname(sqlitePath), { recursive: true })
  const db = new Database(sqlitePath, { create: true })
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  db.exec(SCHEMA)
  return db
}

type Row = Record<string, string | number | null>

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
  insertRow(db, table, row)
  if (stateDir) mirror(stateDir, tenant, table, row)
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
  const tx = db.transaction(() => {
    for (const t of ALL_TABLES) db.query(`DELETE FROM ${t} WHERE tenant_id = ?`).run(tenant)
    for (const table of DURABLE_TABLES) {
      const file = path.join(tenantDir(stateDir, tenant), `${table}.jsonl`)
      if (!existsSync(file)) continue
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue
        insertRow(db, table, JSON.parse(line) as Row)
      }
    }
  })
  tx()
}
