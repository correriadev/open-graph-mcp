import { describe, it, expect } from "bun:test";
import { analyzeHorizonImpact } from "../src/impact";
import type { GraphSnapshotV2 } from "../src/relationship-types";

describe("Impact Knowledge Invariants & Properties (Task 12)", () => {
  it("never inflates confirmed counts with behavioral hypotheses", () => {
    const snapshot: GraphSnapshotV2 = {
      scope: { tenantId: "Alpha", horizonId: "negotiation", graphId: "G1" },
      policyVersion: "1.0.0",
      nodes: [
        { id: "a.ts", file: "a.ts", kind: "file" },
        { id: "b.ts", file: "b.ts", kind: "file" },
      ],
      relationships: [
        {
          id: "r-hyp",
          source: "a.ts",
          target: "b.ts",
          type: "behavioral-hypothesis",
          grade: "C",
          evidenceIds: [],
          traversable: false,
        },
      ],
      evidence: [],
      coverage: {
        scope: { tenantId: "Alpha", horizonId: "negotiation", graphId: "G1" },
        byFormat: { ts: 2 },
        byFamily: { code: 2 },
        failures: [],
      },
    };

    const impact = analyzeHorizonImpact(snapshot, {
      scope: snapshot.scope,
      nodeId: "a.ts",
      directions: ["outbound"],
    });

    expect(impact.knowledge.type).toBe("known-zero");
    expect(impact.directDependencies.length).toBe(0);
    expect(impact.hypotheses.length).toBe(1);
  });
});
