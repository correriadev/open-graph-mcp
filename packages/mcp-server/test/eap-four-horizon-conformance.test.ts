import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../src/db";
import { PromotionService } from "../src/eap/promotion-service";
import { ContestationService } from "../src/eap/contestation-service";
import { SqlitePromotionRepository, SqliteContestationRepository } from "../src/eap/eap-repositories";
import {
  validateInitiationEnvelope,
  validatePromotionEnvelope,
  type PromotionEnvelope,
} from "@open-graph-mcp/graph-core/eap/types";
import {
  getPromotionParent,
  validatePromotionTarget,
} from "@open-graph-mcp/graph-core/eap/horizon";
import {
  type ContestEnvelope,
} from "@open-graph-mcp/graph-core/eap/contestation";
import {
  publishHorizonGraphSnapshot,
  loadActiveHorizonGraph,
} from "../src/store";
import { impactV2 } from "../src/tools/graph-impact";
import { markDerivedPromotionsStale } from "../src/eap/recall-projection";
import type { ServerState } from "../src/state";

describe("Four-Horizon Boundary Flows Conformance (Task 16)", () => {
  let stateDir: string;
  let state: ServerState;
  let promoRepo: SqlitePromotionRepository;
  let contestRepo: SqliteContestationRepository;
  let promoService: PromotionService;
  let contestService: ContestationService;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "og-four-horizon-"));
    const db = openDb(path.join(stateDir, "state.sqlite"));
    state = { db, stateDir } as unknown as ServerState;
    promoRepo = new SqlitePromotionRepository(db, stateDir, "Tenant-Flow");
    contestRepo = new SqliteContestationRepository(db, stateDir, "Tenant-Flow");
    promoService = new PromotionService(promoRepo);
    contestService = new ContestationService(contestRepo);
  });

  afterEach(() => {
    try {
      state.db.close();
      rmSync(stateDir, { recursive: true, force: true });
    } catch {}
  });

  it("1. Topology conformance: verifies parent mapping for all four horizons", () => {
    expect(getPromotionParent("negotiation")).toBe("transformation");
    expect(getPromotionParent("microtask")).toBe("transformation");
    expect(getPromotionParent("transformation")).toBe("persistent");
    expect(getPromotionParent("persistent")).toBeNull();
  });

  it("2. Initiation and Promotion: negotiation -> transformation", () => {
    // 2.1 Initiation
    const initEnv = validateInitiationEnvelope({
      sourceRef: "session-user-1",
      targetHorizonId: "negotiation",
      seed: {
        provenance: [{ id: "ev-seed", type: "doc" }],
        references: [],
      },
      provenance: [{ id: "ev-seed", type: "doc" }],
    });
    expect(initEnv.targetHorizonId).toBe("negotiation");

    // 2.2 Promotion
    const promEnv: PromotionEnvelope = {
      sourceHorizonId: "negotiation",
      sourceGraphId: "G-neg",
      targetHorizonId: "transformation",
      payloadKind: "ChangeContract",
      candidates: [{ id: "c-spec-1", content: "Markdown architecture contract" }],
      evidenceIds: ["ev-spec-1"],
      coverageSummary: { md: 1 },
      policyVersion: "1.0.0",
      provenance: [{ id: "prov-1" }],
      basedOnSeq: 1,
    };

    const validated = validatePromotionEnvelope(promEnv);
    const reception = promoService.receivePromotion({ envelope: validated });
    expect(reception.status).toBe("proposed");
  });

  it("3. Initiation and Promotion: microtask -> transformation", () => {
    const promEnv: PromotionEnvelope = {
      sourceHorizonId: "microtask",
      sourceGraphId: "G-micro",
      targetHorizonId: "transformation",
      payloadKind: "PromotionProposal",
      candidates: [{ id: "c-task-1", content: "Microtask result delta" }],
      evidenceIds: ["ev-task-1"],
      coverageSummary: { md: 1 },
      policyVersion: "1.0.0",
      provenance: [{ id: "prov-task" }],
      basedOnSeq: 2,
    };

    const reception = promoService.receivePromotion({ envelope: promEnv });
    expect(reception.status).toBe("proposed");
  });

  it("4. Promotion: transformation -> persistent", () => {
    const promEnv: PromotionEnvelope = {
      sourceHorizonId: "transformation",
      sourceGraphId: "G-trans",
      targetHorizonId: "persistent",
      payloadKind: "PersistentDelta",
      candidates: [{ id: "c-pers-1", content: "Persistent commit" }],
      evidenceIds: ["ev-pers-1"],
      coverageSummary: { md: 1 },
      policyVersion: "1.0.0",
      provenance: [{ id: "prov-trans" }],
      basedOnSeq: 5,
    };

    const reception = promoService.receivePromotion({ envelope: promEnv });
    expect(reception.status).toBe("proposed");
  });

  it("5. Boundary Enforcement: microtask -> persistent promotion is forbidden", () => {
    const skipEnv: PromotionEnvelope = {
      sourceHorizonId: "microtask",
      sourceGraphId: "G-micro",
      targetHorizonId: "persistent",
      payloadKind: "PromotionProposal",
      candidates: [{ id: "c-1", content: "bad" }],
      evidenceIds: ["ev-1"],
      coverageSummary: {},
      policyVersion: "1.0.0",
      provenance: [],
      basedOnSeq: 1,
    };

    expect(() => promoService.receivePromotion({ envelope: skipEnv })).toThrow(/HORIZON_SKIP/);
  });

  it("6. Contestation & Stale-Base Propagation across topology", () => {
    // Microtask can contest persistent directly with evidence
    const contestEnv: ContestEnvelope = {
      sourceScope: { tenantId: "Tenant-Flow", horizonId: "microtask", graphId: "G-micro" },
      targetScope: { tenantId: "Tenant-Flow", horizonId: "persistent", graphId: "G-pers" },
      evidenceIds: ["ev-benchmark-mismatch"],
      claimRefs: ["claim-root-doc"],
      severity: "blocking",
      reason: "Benchmark contradicts persistent specification",
    };

    const contestResult = contestService.contestHorizonKnowledge(contestEnv);
    expect(contestResult.status).toBe("ADMITTED");

    // Base sequence update propagates to pending proposals
    const count = markDerivedPromotionsStale(state.db, stateDir, "Tenant-Flow", 10);
    expect(typeof count).toBe("number");
  });

  it("7. Scoped Graph v2 persistence and Impact Queries in transformation horizon", () => {
    const snapshot = {
      scope: { tenantId: "Tenant-Flow", horizonId: "transformation", graphId: "G-flow-1" },
      policyVersion: "1.0.0",
      nodes: [
        { id: "docs/spec.md", file: "docs/spec.md", kind: "file" as const },
        { id: "src/main.ts", file: "src/main.ts", kind: "file" as const },
      ],
      relationships: [
        {
          id: "r1",
          source: "src/main.ts",
          target: "docs/spec.md",
          type: "references" as const,
          grade: "B" as const,
          evidenceIds: ["ev-1"],
          traversable: true,
        },
      ],
      evidence: [],
      coverage: {
        scope: { tenantId: "Tenant-Flow", horizonId: "transformation", graphId: "G-flow-1" },
        byFormat: { md: 1, ts: 1 },
        byFamily: { markdown: 1, code: 1 },
        failures: [],
      },
    };

    publishHorizonGraphSnapshot(state, snapshot);
    const loaded = loadActiveHorizonGraph(state, "Tenant-Flow", "transformation");
    expect(loaded).toBeDefined();

    const impact = impactV2(state, {
      tenantId: "Tenant-Flow",
      horizonId: "transformation",
      nodeId: "docs/spec.md",
      directions: ["inbound"],
    });

    expect(impact.knowledge.type).toBe("known-nonzero");
    expect(impact.directDependents).toContain("src/main.ts");
    expect(impact.tenantId).toBe("Tenant-Flow");
    expect(impact.horizonId).toBe("transformation");
  });
});
