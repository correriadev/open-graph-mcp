import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, write } from "../src/db";
import { markDerivedPromotionsStale } from "../src/eap/recall-projection";

describe("Propagate Recall Stale Base State (Task 11)", () => {
  let stateDir: string;
  let db: any;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "og-stale-base-"));
    const dbPath = path.join(stateDir, "state.sqlite");
    db = openDb(dbPath);
  });

  afterEach(() => {
    try {
      db.close();
      rmSync(stateDir, { recursive: true, force: true });
    } catch {}
  });

  it("marks derived promotions STALE_BASE when basedOnSeq precedes new base sequence", () => {
    // 1. Insert a proposed promotion based on sequence 41
    const candidateData = JSON.stringify([{ id: "c1", content: "delta-1" }]);
    write(db, stateDir, "Alpha", "proposals", {
      tenant_id: "Alpha",
      id: "prop-1",
      parent_id: "persistent",
      child_id: "transformation",
      candidates: candidateData,
      status: "proposed",
      based_on_seq: 41,
      created_at: new Date().toISOString(),
    });

    // 2. Advance base to 42 and propagate
    const count = markDerivedPromotionsStale(db, stateDir, "Alpha", 42);
    expect(count).toBe(1);

    // 3. Verify proposal is marked stale-base while candidate content is preserved
    const row = db
      .query("SELECT status, candidates, based_on_seq FROM proposals WHERE tenant_id = ? AND id = ?")
      .get("Alpha", "prop-1") as any;

    expect(row.status).toBe("stale-base");
    expect(row.candidates).toBe(candidateData);
    expect(row.based_on_seq).toBe(41);
  });

  it("leaves promotions on current or newer base untouched", () => {
    write(db, stateDir, "Alpha", "proposals", {
      tenant_id: "Alpha",
      id: "prop-fresh",
      parent_id: "persistent",
      child_id: "transformation",
      candidates: "[]",
      status: "proposed",
      based_on_seq: 42,
      created_at: new Date().toISOString(),
    });

    const count = markDerivedPromotionsStale(db, stateDir, "Alpha", 42);
    expect(count).toBe(0);

    const row = db
      .query("SELECT status FROM proposals WHERE tenant_id = ? AND id = ?")
      .get("Alpha", "prop-fresh") as any;
    expect(row.status).toBe("proposed");
  });
});
