import { describe, it, expect } from "bun:test";
import path from "node:path";
import { buildHorizonArtifactInventory } from "../src/inventory";
import type { HorizonGraphScope } from "../src/relationship-types";

describe("Horizon Coverage Inventory", () => {
  const corpusDir = path.resolve(__dirname, "../../../tests/fixtures/corpus");

  it("builds inventory with isolated scope", () => {
    const scope: HorizonGraphScope = {
      tenantId: "Alpha",
      horizonId: "negotiation",
      graphId: "G1",
    };
    const inv = buildHorizonArtifactInventory({
      root: corpusDir,
      scope,
    });

    expect(inv.scope.tenantId).toBe("Alpha");
    expect(inv.scope.horizonId).toBe("negotiation");
    expect(inv.items.length).toBeGreaterThan(0);
    expect(inv.coverage.byFormat["md"]).toBeGreaterThan(0);
    expect(inv.coverage.byFamily["markdown"]).toBeGreaterThan(0);
  });

  it("excludes non-allowlisted JSON files", () => {
    const scope: HorizonGraphScope = {
      tenantId: "Alpha",
      horizonId: "negotiation",
      graphId: "G1",
    };
    const inv = buildHorizonArtifactInventory({
      root: corpusDir,
      scope,
      policy: {
        jsonAllowlist: ["package.json"],
      },
    });

    const nonAllowed = inv.items.find(
      (item) => item.artifactId === "config/distribution-metadata.json"
    );
    if (nonAllowed) {
      expect(nonAllowed.status).toBe("excluded");
      expect(nonAllowed.failureReason).toBe("NON_ALLOWLISTED_JSON");
    }
  });

  it("terminates every eligible artifact as analyzed or failed", () => {
    const scope: HorizonGraphScope = {
      tenantId: "Alpha",
      horizonId: "transformation",
      graphId: "G1",
    };
    const inv = buildHorizonArtifactInventory({
      root: corpusDir,
      scope,
    });

    for (const item of inv.items) {
      if (item.family === "markdown" || item.family === "code") {
        expect(["analyzed", "failed"]).toContain(item.status);
      }
    }
  });
});
