import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../src/db";
import { ContestationService } from "../src/eap/contestation-service";
import { SqliteContestationRepository } from "../src/eap/eap-repositories";
import type { ContestEnvelope } from "@open-graph-mcp/graph-core/eap/contestation";

describe("Separate Contestation From Documentary Edges (Task 10)", () => {
  let stateDir: string;
  let repo: SqliteContestationRepository;
  let service: ContestationService;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "og-contest-"));
    const dbPath = path.join(stateDir, "state.sqlite");
    const db = openDb(dbPath);
    repo = new SqliteContestationRepository(db, stateDir, "Alpha");
    service = new ContestationService(repo);
  });

  afterEach(() => {
    try {
      rmSync(stateDir, { recursive: true, force: true });
    } catch {}
  });

  it("allows CONTEST to target non-parent horizons with evidence (no HORIZON_SKIP)", () => {
    const envelope: ContestEnvelope = {
      sourceScope: { tenantId: "Alpha", horizonId: "microtask", graphId: "G-micro" },
      targetScope: { tenantId: "Alpha", horizonId: "persistent", graphId: "G-pers" },
      evidenceIds: ["ev-contest-1"],
      claimRefs: ["claim-persistent-root"],
      severity: "blocking",
      reason: "Microtask benchmark contradicts persistent claim",
    };

    const result = service.contestHorizonKnowledge(envelope);
    expect(result.status).toBe("ADMITTED");
    if (result.status === "ADMITTED") {
      expect(result.contestation.sourceHorizonId).toBe("microtask");
      expect(result.contestation.evidenceRefs).toEqual(["ev-contest-1"]);
    }
  });

  it("strictly forbids cross-tenant contestation", () => {
    const crossTenantEnvelope: ContestEnvelope = {
      sourceScope: { tenantId: "Alpha", horizonId: "negotiation", graphId: "G1" },
      targetScope: { tenantId: "Beta", horizonId: "persistent", graphId: "G2" },
      evidenceIds: ["ev-1"],
    };

    expect(() => service.contestHorizonKnowledge(crossTenantEnvelope)).toThrow(
      /Cross-tenant contestation is strictly forbidden/
    );
  });

  it("rejects contestation when evidence is empty", () => {
    const noEvidenceEnvelope: ContestEnvelope = {
      sourceScope: { tenantId: "Alpha", horizonId: "negotiation", graphId: "G1" },
      targetScope: { tenantId: "Alpha", horizonId: "transformation", graphId: "G2" },
      evidenceIds: [],
    };

    expect(() => service.contestHorizonKnowledge(noEvidenceEnvelope)).toThrow(
      /EVIDENCE_REQUIRED/
    );
  });
});
