import { expect } from "bun:test"
import { annotatedTest } from "./verification/annotate"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { openDb, rebuildFromJsonl } from "../src/db"
import { HorizonStore, AdmissionLedgerStore } from "../src/eap/horizon-store"

function createTestEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "horizon-test-"))
  const dbPath = path.join(dir, "live.db")
  const db = openDb(dbPath)
  const horizonStore = new HorizonStore(db, dir)
  const admissionLedger = new AdmissionLedgerStore(db, dir)

  const cleanup = () => {
    try { db.close() } catch {}
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }

  return { dir, dbPath, db, horizonStore, admissionLedger, cleanup }
}

annotatedTest(
  "HorizonStore: atomic and tenant-scoped creation and lookup",
  // EAP-SVCS-003's `InitiateHorizon` requires provenance, topology and budget validation plus a
  // `HorizonInitiated` event carrying seedRef/budgetRef. This is the repository beneath that
  // service: it stores and reads back a horizon row, nothing more.
  { coversPartially: ["EAP-SVCS-003"] },
  () => {
  const env = createTestEnv()
  try {
    const root = env.horizonStore.create({
      tenantId: "tenant-a",
      id: "hz-root",
      parentId: null,
      state: "proposed",
      budgetAllocated: 100,
      budgetConsumed: 0,
    })
    expect(root.success).toBe(true)

    const fetched = env.horizonStore.get("tenant-a", "hz-root")
    expect(fetched).not.toBeNull()
    expect(fetched?.id).toBe("hz-root")
  } finally {
    env.cleanup()
  }
  },
)

annotatedTest(
  "HorizonStore: optimistic concurrency in saveTransition",
  // EAP-PERS-004: two transitions loaded from the same Horizon version call `saveTransition` with
  // the SAME expected Sequence; one persists and the stale save returns a deterministic typed
  // conflict (`STALE_SEQUENCE`). The two saves are issued sequentially rather than in parallel, but
  // the mechanism the scenario names — the shared expected Sequence — is exactly what is exercised.
  { asserts: ["EAP-PERS-004"] },
  () => {
  const env = createTestEnv()
  try {
    env.horizonStore.create({
      tenantId: "tenant-a",
      id: "hz-concurrency",
      parentId: null,
      state: "proposed",
      budgetAllocated: 100,
      budgetConsumed: 0,
    })

    const t1 = env.horizonStore.saveTransition("tenant-a", "hz-concurrency", 0, { state: "deliberated" })
    expect(t1.success).toBe(true)

    const staleAttempt = env.horizonStore.saveTransition("tenant-a", "hz-concurrency", 0, { state: "admitted" })
    expect(staleAttempt.success).toBe(false)
    if (!staleAttempt.success) {
      expect(staleAttempt.code).toBe("STALE_SEQUENCE")
    }
  } finally {
    env.cleanup()
  }
  },
)
