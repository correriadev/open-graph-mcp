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
import { canonicalCell } from "./cell"

/** Tabelas duráveis espelhadas em JSONL, na ordem de replay do rebuild. */
export const DURABLE_TABLES = [
  "tenants",
  "users",
  "nodes",
  "edges",
  "claims",
  "authority",
  "changesets",
  "cs_deltas",
  "events",
  "horizons",
  "admission_decisions",
  "contestations",
  "recalls",
  "candidates",
  "proposals",
  "promotion_events",
  "recall_cases",
  "recall_checkpoints",
  "recall_scars",
  "operator_approvals",
] as const
/**
 * Todas as tabelas com tenant_id (durables + índice live).
 *
 * `eap_sequences` e `capability_executions` estão FORA das duas listas de propósito (como `tokens`):
 *  - `eap_sequences` é o alocador monotônico de sequência. Espelhá-lo no JSONL append-only e
 *    replayá-lo é inofensivo, mas APAGÁ-LO num rebuild permitiria reemitir uma sequência já usada —
 *    exatamente o que o alocador existe para impedir. Fica só no SQLite e nunca é zerado.
 *  - `capability_executions` é log de auditoria com POLÍTICA DE RETENÇÃO (DELETE dos mais antigos).
 *    O espelho JSONL é append-only: replayar traria de volta toda linha já evictada e o limite de
 *    memória/disco deixaria de existir. Retenção e append-only são incompatíveis por construção.
 */
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
  covers TEXT,
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

CREATE TABLE IF NOT EXISTS horizons (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  parent_id TEXT,
  state TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  budget_allocated INTEGER NOT NULL DEFAULT 0,
  budget_consumed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_horizons_tenant_parent ON horizons (tenant_id, parent_id);

CREATE TABLE IF NOT EXISTS admission_decisions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  horizon_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  refusal_code TEXT,
  refusal_obligation TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_admission_decisions_tenant_seq ON admission_decisions (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_admission_decisions_tenant_candidate ON admission_decisions (tenant_id, candidate_id);

CREATE TABLE IF NOT EXISTS contestations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  target_claim_ids TEXT NOT NULL,
  severity TEXT NOT NULL,
  evidence TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_contestations_tenant_seq ON contestations (tenant_id, seq);

CREATE TABLE IF NOT EXISTS recalls (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  contestation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  affected_claim_ids TEXT NOT NULL,
  checkpoint INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_recalls_tenant_seq ON recalls (tenant_id, seq);

CREATE TABLE IF NOT EXISTS candidates (
  tenant_id TEXT NOT NULL,
  horizon_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  state TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, horizon_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_candidates_tenant_horizon ON candidates (tenant_id, horizon_id);

CREATE TABLE IF NOT EXISTS proposals (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  candidates TEXT NOT NULL,
  status TEXT NOT NULL,
  based_on_seq INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_proposals_tenant_parent ON proposals (tenant_id, parent_id);

/* Alocador de sequencia monotonico por (tenant, nome). Substitui todo COALESCE(MAX(seq),0)+1:
   aquele padrao le e escreve em dois passos, entao duas chamadas concorrentes leem o mesmo maximo e
   emitem a MESMA sequencia; e reusa uma sequencia assim que a linha mais alta e removida. Aqui a
   alocacao e um unico UPSERT ... RETURNING dentro de uma transacao IMMEDIATE, indivisivel. */
CREATE TABLE IF NOT EXISTS eap_sequences (
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, name)
);

/* Aprovacoes de operador. Duravel: o gateway de capability valida a aprovacao ARMAZENADA, nunca a
   copia enviada pelo cliente, e o flag consumed precisa sobreviver a restart para que uma aprovacao
   de uso unico continue sendo de uso unico. */
CREATE TABLE IF NOT EXISTS operator_approvals (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  approver TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  based_on_seq INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  PRIMARY KEY (tenant_id, id)
);

/* Auditoria append-only de execucoes de capability + indice de idempotencia. ordinal e monotonico
   por tenant e define a ordem de eviccao da politica de retencao. */
CREATE TABLE IF NOT EXISTS capability_executions (
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  execution_id TEXT NOT NULL,
  classification TEXT NOT NULL,
  contract_ref TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  approval_id TEXT,
  outcome TEXT,
  ts INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_capability_executions_ordinal ON capability_executions (tenant_id, ordinal);

CREATE TABLE IF NOT EXISTS promotion_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_promotion_events_ordinal ON promotion_events (tenant_id, ordinal);

CREATE TABLE IF NOT EXISTS recall_cases (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  contestation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  notice TEXT NOT NULL,
  closure TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS recall_checkpoints (
  tenant_id TEXT NOT NULL,
  recall_id TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, recall_id)
);

CREATE TABLE IF NOT EXISTS recall_scars (
  tenant_id TEXT NOT NULL,
  recall_id TEXT NOT NULL,
  scar TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, recall_id)
);
`

/** ALTER TABLE idempotente: só adiciona a coluna se o PRAGMA não a listar. */
function addColumnIfMissing(db: Database, table: string, column: string, type: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export function openDb(sqlitePath: string): Database {
  if (sqlitePath !== ":memory:") mkdirSync(path.dirname(sqlitePath), { recursive: true })
  const db = new Database(sqlitePath, { create: true })
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  db.exec(SCHEMA)
  // F4: `CREATE TABLE IF NOT EXISTS` does NOT add a column to a table that already exists — a
  // STATE_DIR from a server started before this change has a `claims` table without `covers`, and
  // SCHEMA above silently no-ops on it. Migrate explicitly, idempotently: check PRAGMA table_info and
  // ALTER TABLE only if the column is actually missing. Runs on every openDb call; safe to repeat.
  const claimsCols = db.query("PRAGMA table_info(claims)").all() as { name: string }[]
  if (!claimsCols.some((c) => c.name === "covers")) {
    db.exec("ALTER TABLE claims ADD COLUMN covers TEXT")
  }
  // Mesmo motivo do `covers` acima: um STATE_DIR criado antes da linha cognitiva tem `contestations`
  // sem as colunas de proveniencia, e `CREATE TABLE IF NOT EXISTS` no-opa silenciosamente.
  addColumnIfMissing(db, "contestations", "source_horizon_id", "TEXT")
  addColumnIfMissing(db, "contestations", "reason", "TEXT")
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
  try {
    migrateLegacyCellSpelling(db)
  } catch (error) {
    db.close()
    throw error
  }
  return db
}

/**
 * F1/F7, resíduo §7.6 — linhas de `locks` e `authority` gravadas ANTES da canonicalização ficaram na
 * grafia antiga (`auth:P4`). Nada mais escreve nessa grafia, e nada mais a lê: todo lookup passa por
 * `canonicalCell` agora. O efeito é uma linha órfã — uma trava que ninguém consegue liberar (nem o
 * dono, porque `changeset.abort` procura `auth:4`) e uma autoridade `graph` conquistada que a célula
 * deixou de enxergar, exigindo re-flip manual.
 *
 * Migra em UMA transação, idempotente, a cada `openDb`. As duas tabelas têm PRIMARY KEY
 * (tenant_id, cell), então canonicalizar pode COLIDIR com uma linha já existente na grafia nova. A
 * colisão não pode ser resolvida por `INSERT OR REPLACE` cego — isso deixaria o vencedor à mercê da
 * ordem de varredura. Cada tabela tem sua regra, e ela é a mesma que a semântica da tabela já implica:
 *
 *   - `locks`: vence o `expires_at` mais distante. Trava é coordenação viva; descartar a que ainda vale
 *     em favor de uma vencida liberaria uma célula que alguém está de fato segurando.
 *   - `authority`: vence o `last_flip_seq` maior. Autoridade é histórico; o flip mais recente é o
 *     estado corrente por definição, e é assim que `authorityOf` já lê a tabela.
 *
 * `authority` é DURÁVEL (espelhada em JSONL), então esta migração do SQLite sozinha seria desfeita por
 * um `rebuildFromJsonl` — que replaya as linhas legadas do espelho append-only, onde nada pode ser
 * reescrito. Por isso o rebuild canonicaliza a célula no replay (ver `rebuildFromJsonl`). `locks` não
 * é espelhada; para ela o SQLite é a única cópia.
 */
function migrateLegacyCellSpelling(db: Database): void {
  db.transaction(() => {
    for (const table of ["locks", "authority"] as const) {
      const rows = db.query(`SELECT * FROM ${table}`).all() as Record<string, string | number | null>[]
      const legacy = rows.filter((r) => typeof r.cell === "string" && canonicalCell(r.cell) !== r.cell)
      if (legacy.length === 0) continue
      const byCanonical = new Map<string, Record<string, string | number | null>>()
      for (const r of rows) {
        const key = `${r.tenant_id} ${canonicalCell(String(r.cell))}`
        const prior = byCanonical.get(key)
        byCanonical.set(key, prior === undefined ? r : winner(table, prior, r))
      }
      const del = db.query(`DELETE FROM ${table} WHERE tenant_id = ? AND cell = ?`)
      for (const r of legacy) del.run(r.tenant_id, r.cell)
      for (const r of byCanonical.values()) insertRow(db, table, { ...r, cell: canonicalCell(String(r.cell)) })
    }
  })()
}

/** Desempate da migração acima. Fora da transação para deixar a regra legível e testável isolada. */
function winner(
  table: "locks" | "authority",
  a: Record<string, string | number | null>,
  b: Record<string, string | number | null>,
): Record<string, string | number | null> {
  if (table === "locks") return String(b.expires_at ?? "") > String(a.expires_at ?? "") ? b : a
  return Number(b.last_flip_seq ?? -1) > Number(a.last_flip_seq ?? -1) ? b : a
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
export function durableTransaction<T>(db: Database, fn: () => T, opts?: { serialized?: boolean }): T {
  if (mirrorUnits.has(db)) return fn()
  const pending: PendingMirror[] = []
  mirrorUnits.set(db, pending)
  try {
    const tx = db.transaction(() => {
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
    })
    return opts?.serialized ? tx.immediate() : tx()
  } finally {
    mirrorUnits.delete(db)
  }
}

/**
 * serialTransaction — `durableTransaction` com BEGIN IMMEDIATE.
 *
 * O BEGIN default do SQLite é DEFERRED: a transação só toma o write lock na primeira ESCRITA, então
 * duas transações podem LER o mesmo estado, decidir com base nele, e só então competir pela escrita —
 * a segunda vê `SQLITE_BUSY` ou, pior, grava em cima de uma decisão tomada sobre um snapshot já
 * obsoleto. É essa a janela que produzia colisão de sequência em `eapContest`/`eapRecall`/`eapPromote`
 * (ler `MAX(seq)`, decidir, escrever). IMMEDIATE toma o write lock no BEGIN: a seção read-decide-write
 * inteira fica serializada entre escritores, que é o que o alocador de sequência exige.
 */
export function serialTransaction<T>(db: Database, fn: () => T): T {
  return durableTransaction(db, fn, { serialized: true })
}

/**
 * allocateSequence — reserva a próxima sequência de `(tenant, name)` num único UPSERT atômico.
 *
 * Substitui `SELECT COALESCE(MAX(seq),0)+1`: aquele padrão (a) colide sob concorrência, porque duas
 * chamadas leem o mesmo máximo, e (b) REUSA uma sequência assim que a linha mais alta é apagada ou
 * expurgada — sequência reusada quebra ordenação de auditoria e dedup por seq. O contador é durável e
 * nunca regride, mesmo que a tabela de destino fique vazia.
 *
 * Deve ser chamado dentro de `serialTransaction` (ou de uma transação já serializada) para que a
 * reserva e a escrita que a consome commitem juntas.
 */
export function allocateSequence(db: Database, tenant: string, name: string): number {
  const row = db
    .query(
      `INSERT INTO eap_sequences (tenant_id, name, value) VALUES (?, ?, 1)
       ON CONFLICT(tenant_id, name) DO UPDATE SET value = value + 1
       RETURNING value`,
    )
    .get(tenant, name) as { value: number } | null
  if (!row) throw new Error(`failed to allocate sequence '${name}' for tenant '${tenant}'`)
  return Number(row.value)
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
      } else if (table === "authority" && typeof parsed.cell === "string") {
        // Mesma razão de `normalizeRecoveredClaimLevel` acima, aplicada à chave de célula: o JSONL é
        // append-only, então linhas gravadas na grafia pré-F1/F7 (`auth:P4`) estão lá para sempre e a
        // migração de boot (migrateLegacyCellSpelling) não as alcança — ela roda no SQLite, que este
        // replay acabou de apagar. Canonicalizar AQUI é o que torna a migração durável. Como o replay
        // é ordenado (append-only = ordem cronológica) e usa INSERT OR REPLACE, duas grafias da mesma
        // célula convergem para a linha mais recente — que é o mesmo critério de `last_flip_seq` que
        // a migração de boot aplica.
        recovered.push({ table, row: { ...parsed, cell: canonicalCell(parsed.cell) } })
      } else recovered.push({ table, row: parsed })
    }
  }
  const tx = db.transaction(() => {
    for (const t of ALL_TABLES) db.query(`DELETE FROM ${t} WHERE tenant_id = ?`).run(tenant)
    for (const entry of recovered) insertRow(db, entry.table, entry.row)
  })
  tx()
}
