import { describe, it, expect } from "bun:test";
import { assembleGraphSnapshotV2 } from "../src/build";
import { computeGraphSnapshotId } from "../src/graph-checksum";
import type {
  CoverageManifest,
  GraphNodeV2,
  PublishedRelationship,
  EvidenceRecord,
} from "../src/relationship-types";

describe("Assemble Atomic Graph V2 Snapshots (Task 05)", () => {
  const dummyCoverage: CoverageManifest = {
    scope: { tenantId: "tenant-alpha", horizonId: "negotiation", graphId: "placeholder" },
    byFormat: { md: 2, ts: 3 },
    byFamily: { markdown: 2, code: 3 },
    failures: [],
  };

  const sampleNodes: GraphNodeV2[] = [
    { id: "src/a.ts", file: "src/a.ts", kind: "file" },
    { id: "skills/SKILL.md", file: "skills/SKILL.md", kind: "file" },
  ];

  const sampleRelationships: PublishedRelationship[] = [
    {
      id: "rel-1",
      source: "skills/SKILL.md",
      target: "src/a.ts",
      type: "references",
      grade: "B",
      evidenceIds: ["ev-1", "ev-2"],
    },
  ];

  const sampleEvidence: EvidenceRecord[] = [
    {
      id: "ev-1",
      sourceId: "skills/SKILL.md",
      kind: "path-reference",
      targetText: "src/a.ts",
      location: { startLine: 10, startCol: 1 },
    },
    {
      id: "ev-2",
      sourceId: "skills/SKILL.md",
      kind: "markdown-link",
      targetText: "src/a.ts",
      location: { startLine: 15, startCol: 5 },
    },
  ];

  it("produces identical graphId for identical scoped input (content-addressed)", () => {
    const s1 = assembleGraphSnapshotV2({
      tenantId: "tenant-alpha",
      horizonId: "negotiation",
      policyVersion: "1.0.0",
      nodes: sampleNodes,
      relationships: sampleRelationships,
      evidence: sampleEvidence,
      coverage: dummyCoverage,
    });

    const s2 = assembleGraphSnapshotV2({
      tenantId: "tenant-alpha",
      horizonId: "negotiation",
      policyVersion: "1.0.0",
      nodes: [...sampleNodes].reverse(), // reverse input order to verify canonical sort
      relationships: sampleRelationships,
      evidence: [...sampleEvidence].reverse(),
      coverage: dummyCoverage,
    });

    expect(s1.scope.graphId).toBe(s2.scope.graphId);
    expect(s1.coverage.scope.graphId).toBe(s1.scope.graphId);
    expect(s1.scope.tenantId).toBe("tenant-alpha");
    expect(s1.scope.horizonId).toBe("negotiation");
  });

  it("keeps conflicting/multiple evidence records observable in the snapshot", () => {
    const s = assembleGraphSnapshotV2({
      tenantId: "tenant-alpha",
      horizonId: "negotiation",
      policyVersion: "1.0.0",
      nodes: sampleNodes,
      relationships: sampleRelationships,
      evidence: sampleEvidence,
      coverage: dummyCoverage,
    });

    expect(s.relationships[0].evidenceIds).toEqual(["ev-1", "ev-2"]);
    expect(s.evidence.length).toBe(2);
    expect(s.evidence.map((e) => e.id)).toContain("ev-1");
    expect(s.evidence.map((e) => e.id)).toContain("ev-2");
  });

  it("prevents mixing relationships and coverage with wrong horizon scope", () => {
    const badScopeCoverage: CoverageManifest = {
      scope: { tenantId: "tenant-beta", horizonId: "persistent", graphId: "different" },
      byFormat: {},
      byFamily: {},
      failures: [],
    };

    const s = assembleGraphSnapshotV2({
      tenantId: "tenant-alpha",
      horizonId: "negotiation",
      policyVersion: "1.0.0",
      nodes: sampleNodes,
      relationships: sampleRelationships,
      evidence: sampleEvidence,
      coverage: badScopeCoverage,
    });

    // assembled snapshot normalizes coverage scope to match the snapshot's tenant and horizon
    expect(s.coverage.scope.tenantId).toBe("tenant-alpha");
    expect(s.coverage.scope.horizonId).toBe("negotiation");
    expect(s.coverage.scope.graphId).toBe(s.scope.graphId);
  });
});
