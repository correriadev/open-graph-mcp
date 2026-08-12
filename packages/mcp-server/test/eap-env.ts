/**
 * eap-env.ts — durable test environment for EAP domain services (Feature F001, retry #5).
 *
 * Every EAP domain service is now repository-backed. These helpers build a real on-disk
 * SQLite + JSONL environment so tests exercise the same durability path production uses,
 * and can reopen it to simulate a host process restart.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Database } from "bun:sqlite"
import { openDb, write } from "../src/db"
import {
  SqliteApprovalRepository,
  SqliteCapabilityAuditRepository,
  SqliteContestationRepository,
  SqliteObservedSequenceSource,
  SqlitePromotionRepository,
  SqliteRecallRepository,
} from "../src/eap/eap-repositories"

export type EapEnv = {
  dir: string
  dbPath: string
  db: Database
  tenantId: string
  promotions: SqlitePromotionRepository
  contestations: SqliteContestationRepository
  recalls: SqliteRecallRepository
  approvals: SqliteApprovalRepository
  audit: SqliteCapabilityAuditRepository
  /** The durable sequence an operator approval is validated against (highest governed Horizon seq). */
  sequences: SqliteObservedSequenceSource
  /** Anchors that observed sequence by writing a governed horizon row at `seq`. */
  setObservedSeq: (seq: number) => void
  /** Closes the DB handle and reopens it from disk — simulates a host process restart. */
  restart: () => EapEnv
  cleanup: () => void
}

function build(dir: string, tenantId: string, auditMaxEntries?: number): EapEnv {
  const dbPath = path.join(dir, "live.db")
  const db = openDb(dbPath)
  const env: EapEnv = {
    dir,
    dbPath,
    db,
    tenantId,
    promotions: new SqlitePromotionRepository(db, dir, tenantId),
    contestations: new SqliteContestationRepository(db, dir, tenantId),
    recalls: new SqliteRecallRepository(db, dir, tenantId),
    approvals: new SqliteApprovalRepository(db, dir, tenantId),
    audit: new SqliteCapabilityAuditRepository(db, dir, tenantId, { maxEntries: auditMaxEntries }),
    sequences: new SqliteObservedSequenceSource(db, tenantId),
    setObservedSeq: (seq: number) => {
      const ts = new Date().toISOString()
      write(db, dir, tenantId, "horizons", {
        tenant_id: tenantId,
        id: "hz-observed",
        parent_id: null,
        state: "proposed",
        seq,
        budget_allocated: 0,
        budget_consumed: 0,
        created_at: ts,
        updated_at: ts,
      })
    },
    restart: () => {
      try {
        db.close()
      } catch {
        /* already closed */
      }
      return build(dir, tenantId, auditMaxEntries)
    },
    cleanup: () => {
      try {
        db.close()
      } catch {
        /* already closed */
      }
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* windows may hold the WAL briefly; the OS temp dir reaper wins eventually */
      }
    },
  }
  return env
}

export function createEapEnv(opts: { tenantId?: string; auditMaxEntries?: number } = {}): EapEnv {
  const dir = mkdtempSync(path.join(tmpdir(), "og-eap-"))
  return build(dir, opts.tenantId ?? "tenant-a", opts.auditMaxEntries)
}
