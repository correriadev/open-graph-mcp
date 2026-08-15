import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../src/db";
import { PromotionService } from "../src/eap/promotion-service";
import { SqlitePromotionRepository } from "../src/eap/eap-repositories";
import type { PromotionEnvelope } from "@open-graph-mcp/graph-core/eap/types";

describe("Promotion Reception Revalidation (Task 09)", () => {
  let stateDir: string;
  let repo: SqlitePromotionRepository;
  let service: PromotionService;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "og-eap-prom-"));
    const dbPath = path.join(stateDir, "state.sqlite");
    const db = openDb(dbPath);
    repo = new SqlitePromotionRepository(db, "Alpha", stateDir);
    service = new PromotionService(repo);
  });

  afterEach(() => {
    try {
      rmSync(stateDir, { recursive: true, force: true });
    } catch {}
  });

  const validNegotiationEnvelope: PromotionEnvelope = {
    sourceHorizonId: "negotiation",
    sourceGraphId: "G-neg",
    targetHorizonId: "transformation",
    payloadKind: "ChangeContract",
    candidates: [{ id: "cand-1", content: "markdown-proposal" }],
    evidenceIds: ["ev-link-1"],
    coverageSummary: { md: 1 },
    policyVersion: "1.0.0",
    provenance: [{ id: "prov-1" }],
    basedOnSeq: 1,
  };

  it("receives promoted candidates in proposed status without inherited authority", () => {
    const decision = service.receivePromotion({
      envelope: validNegotiationEnvelope,
    });

    expect(decision.status).toBe("proposed");
    expect(decision.promotionId).toContain("prom-recv-negotiation-transformation");
  });

  it("refuses promotion under stricter target policy without altering source history", () => {
    const decision = service.receivePromotion({
      envelope: validNegotiationEnvelope,
      targetPolicy: {
        policyVersion: "2.0.0",
        minEvidenceGrade: "A", // requires Grade A, but evidence only has link (Grade B)
      },
    });

    expect(decision.status).toBe("refused");
    expect(decision.reasonCode).toBe("INSUFFICIENT_EVIDENCE_GRADE");
    expect(validNegotiationEnvelope.payloadKind).toBe("ChangeContract"); // source unchanged
  });

  it("rejects non-parent promotion target with HORIZON_SKIP", () => {
    const directToPersistentEnvelope: PromotionEnvelope = {
      ...validNegotiationEnvelope,
      targetHorizonId: "persistent",
      payloadKind: "ChangeContract",
    };

    expect(() =>
      service.receivePromotion({
        envelope: directToPersistentEnvelope,
      })
    ).toThrow(/HORIZON_SKIP/);
  });
});
