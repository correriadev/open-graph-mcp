import { describe, it, expect } from "bun:test";
import { analyzeHorizonImpact } from "../src/impact";
import type { GraphSnapshotV2 } from "../src/relationship-types";

describe("Horizon Impact Knowledge (Task 12)", () => {
  const baseSnapshot: GraphSnapshotV2 = {
    scope: { tenantId: "Alpha", horizonId: "transformation", graphId: "G1" },
    policyVersion: "1.0.0",
    nodes: [
      { id: "skills/orchestrator.md", file: "skills/orchestrator.md", kind: "file" },
      { id: "docs/workflows/wf.md", file: "docs/workflows/wf.md", kind: "file" },
      { id: "agents/agent.md", file: "agents/agent.md", kind: "file" },
      { id: "src/isolated.ts", file: "src/isolated.ts", kind: "file" },
    ],
    relationships: [
      {
        id: "r1",
        source: "skills/orchestrator.md",
        target: "docs/workflows/wf.md",
        type: "references",
        grade: "B",
        evidenceIds: ["e1"],
        traversable: true,
      },
      {
        id: "r2",
        source: "docs/workflows/wf.md",
        target: "agents/agent.md",
        type: "delegates-to",
        grade: "A",
        evidenceIds: ["e2"],
        traversable: true,
      },
      {
        id: "r3",
        source: "skills/orchestrator.md",
        target: "src/isolated.ts",
        type: "behavioral-hypothesis",
        grade: "C",
        evidenceIds: [],
        traversable: false,
      },
    ],
    evidence: [],
    coverage: {
      scope: { tenantId: "Alpha", horizonId: "transformation", graphId: "G1" },
      byFormat: { md: 3, ts: 1 },
      byFamily: { markdown: 3, code: 1 },
      failures: [],
    },
  };

  it("returns known-nonzero with direct and transitive dependencies", () => {
    const impact = analyzeHorizonImpact(baseSnapshot, {
      scope: baseSnapshot.scope,
      nodeId: "skills/orchestrator.md",
      directions: ["outbound"],
    });

    expect(impact.knowledge.type).toBe("known-nonzero");
    expect(impact.directDependencies).toContain("docs/workflows/wf.md");
    expect(impact.transitiveDependencies).toContain("agents/agent.md");
    // Behavioral hypothesis must not be in dependencies
    expect(impact.directDependencies).not.toContain("src/isolated.ts");
    expect(impact.hypotheses.length).toBe(1);
  });

  it("returns known-zero from sufficient local coverage when no paths exist", () => {
    const impact = analyzeHorizonImpact(baseSnapshot, {
      scope: baseSnapshot.scope,
      nodeId: "src/isolated.ts",
      directions: ["outbound", "inbound"],
    });

    expect(impact.knowledge.type).toBe("known-zero");
    expect(impact.directDependencies.length).toBe(0);
    expect(impact.directDependents.length).toBe(0);
  });

  it("returns unknown when coverage for the node failed", () => {
    const failingSnapshot: GraphSnapshotV2 = {
      ...baseSnapshot,
      coverage: {
        ...baseSnapshot.coverage,
        failures: [{ artifactId: "skills/orchestrator.md", reason: "PARSE_ERROR" }],
      },
    };

    const impact = analyzeHorizonImpact(failingSnapshot, {
      scope: failingSnapshot.scope,
      nodeId: "skills/orchestrator.md",
      directions: ["outbound"],
    });

    expect(impact.knowledge.type).toBe("unknown");
    if (impact.knowledge.type === "unknown") {
      expect(impact.knowledge.reasonCodes).toContain("COVERAGE_FAILURE_PARSE_ERROR");
    }
  });

  it("terminates deterministically on cyclic dependencies", () => {
    const cyclicSnapshot: GraphSnapshotV2 = {
      ...baseSnapshot,
      relationships: [
        {
          id: "r1",
          source: "skills/orchestrator.md",
          target: "docs/workflows/wf.md",
          type: "references",
          grade: "B",
          evidenceIds: [],
          traversable: true,
        },
        {
          id: "r2",
          source: "docs/workflows/wf.md",
          target: "skills/orchestrator.md", // cycle back!
          type: "references",
          grade: "B",
          evidenceIds: [],
          traversable: true,
        },
      ],
    };

    const impact = analyzeHorizonImpact(cyclicSnapshot, {
      scope: cyclicSnapshot.scope,
      nodeId: "skills/orchestrator.md",
      directions: ["outbound"],
    });

    expect(impact.knowledge.type).toBe("known-nonzero");
    expect(impact.directDependencies).toContain("docs/workflows/wf.md");
  });
});
