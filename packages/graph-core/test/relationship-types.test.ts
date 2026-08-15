import { describe, it, expect } from "bun:test";
import {
  validateHorizonKind,
  validateHorizonGraphScope,
  validateArtifactId,
  validateRelationshipType,
  validatePublishedRelationship,
  validateCoverageManifest,
  validateGraphSnapshotV2,
  areImpactCursorsEqual,
  type HorizonGraphScope,
  type PublishedRelationship,
  type CoverageManifest,
  type GraphSnapshotV2,
  type ImpactCursorV2,
} from "../src/relationship-types";

describe("Graph v2 Scoped Contracts and Relationship Types", () => {
  describe("HorizonKind", () => {
    it("accepts valid four horizons", () => {
      expect(validateHorizonKind("negotiation")).toBe("negotiation");
      expect(validateHorizonKind("microtask")).toBe("microtask");
      expect(validateHorizonKind("transformation")).toBe("transformation");
      expect(validateHorizonKind("persistent")).toBe("persistent");
    });

    it("rejects session as a HorizonKind", () => {
      expect(() => validateHorizonKind("session")).toThrow(/session/);
    });

    it("rejects unknown horizon string", () => {
      expect(() => validateHorizonKind("unknown-horizon")).toThrow(/Invalid HorizonKind/);
    });
  });

  describe("HorizonGraphScope", () => {
    it("accepts valid triple", () => {
      const scope = validateHorizonGraphScope({
        tenantId: "tenant-a",
        horizonId: "negotiation",
        graphId: "graph-1",
      });
      expect(scope.tenantId).toBe("tenant-a");
      expect(scope.horizonId).toBe("negotiation");
      expect(scope.graphId).toBe("graph-1");
    });

    it("rejects when tenantId is missing or empty", () => {
      expect(() =>
        validateHorizonGraphScope({ tenantId: "", horizonId: "negotiation", graphId: "g1" })
      ).toThrow(/tenantId/);
    });

    it("rejects when horizonId is missing or empty", () => {
      expect(() =>
        validateHorizonGraphScope({ tenantId: "t1", horizonId: "", graphId: "g1" })
      ).toThrow(/horizonId/);
    });

    it("rejects when graphId is missing or empty", () => {
      expect(() =>
        validateHorizonGraphScope({ tenantId: "t1", horizonId: "negotiation", graphId: "" })
      ).toThrow(/graphId/);
    });
  });

  describe("ArtifactId", () => {
    it("accepts repository-relative POSIX path", () => {
      expect(validateArtifactId("src/index.ts")).toBe("src/index.ts");
      expect(validateArtifactId("skills/orchestrator/SKILL.md")).toBe(
        "skills/orchestrator/SKILL.md"
      );
    });

    it("rejects absolute paths", () => {
      expect(() => validateArtifactId("/etc/passwd")).toThrow(/cannot be absolute/);
      expect(() => validateArtifactId("C:\\repo\\file.ts")).toThrow(/cannot be absolute/);
    });

    it("rejects parent traversal", () => {
      expect(() => validateArtifactId("../file.ts")).toThrow(/cannot contain parent traversal/);
      expect(() => validateArtifactId("src/../../file.ts")).toThrow(/cannot contain parent traversal/);
    });
  });

  describe("RelationshipType and EvidenceGrade", () => {
    it("accepts the four internal relationship types", () => {
      expect(validateRelationshipType("depends-on")).toBe("depends-on");
      expect(validateRelationshipType("references")).toBe("references");
      expect(validateRelationshipType("delegates-to")).toBe("delegates-to");
      expect(validateRelationshipType("behavioral-hypothesis")).toBe("behavioral-hypothesis");
    });

    it("rejects inter-horizon boundary operations as internal relationships", () => {
      const ops = ["INITIATE", "PROMOTE", "CONTEST", "RECALL", "parent"];
      for (const op of ops) {
        expect(() => validateRelationshipType(op)).toThrow(/Inter-horizon operation/);
      }
    });

    it("preserves EvidenceGrade independently from RelationshipType", () => {
      const relA = validatePublishedRelationship({
        id: "rel-1",
        source: "a.md",
        target: "b.md",
        type: "references",
        grade: "A",
        evidenceIds: ["ev-1"],
      });
      const relB = validatePublishedRelationship({
        id: "rel-2",
        source: "a.md",
        target: "c.md",
        type: "references",
        grade: "B",
        evidenceIds: ["ev-2"],
      });
      expect(relA.type).toBe("references");
      expect(relA.grade).toBe("A");
      expect(relB.type).toBe("references");
      expect(relB.grade).toBe("B");
    });
  });

  describe("GraphSnapshotV2 and CoverageManifest", () => {
    const validScope: HorizonGraphScope = {
      tenantId: "Alpha",
      horizonId: "negotiation",
      graphId: "G1",
    };

    it("creates GraphSnapshotV2 when every member shares one HorizonGraphScope", () => {
      const cov: CoverageManifest = {
        scope: validScope,
        byFormat: { md: 5, ts: 10 },
        byFamily: { markdown: 5, typescript: 10 },
        failures: [],
      };
      const snapshot: GraphSnapshotV2 = validateGraphSnapshotV2({
        scope: validScope,
        policyVersion: "1.0.0",
        nodes: [{ id: "node-1", file: "src/a.ts", kind: "file" }],
        relationships: [
          {
            id: "rel-1",
            source: "node-1",
            target: "node-2",
            type: "depends-on",
            grade: "A",
            evidenceIds: ["e1"],
          },
        ],
        evidence: [
          {
            id: "e1",
            sourceId: "src/a.ts",
            kind: "import",
            targetText: "./b",
            location: { startLine: 1, startCol: 1 },
          },
        ],
        coverage: cov,
      });

      expect(snapshot.scope.tenantId).toBe("Alpha");
      expect(snapshot.scope.horizonId).toBe("negotiation");
      expect(snapshot.scope.graphId).toBe("G1");
    });

    it("rejects GraphSnapshotV2 when coverage belongs to another horizon", () => {
      const mismatchedCov: CoverageManifest = {
        scope: { tenantId: "Alpha", horizonId: "microtask", graphId: "G1" },
        byFormat: {},
        byFamily: {},
        failures: [],
      };
      expect(() =>
        validateGraphSnapshotV2({
          scope: validScope,
          policyVersion: "1.0.0",
          nodes: [],
          relationships: [],
          evidence: [],
          coverage: mismatchedCov,
        })
      ).toThrow(/CoverageManifest scope mismatch/);
    });

    it("rejects GraphSnapshotV2 when an inter-horizon operation is supplied as relationship", () => {
      const cov: CoverageManifest = {
        scope: validScope,
        byFormat: {},
        byFamily: {},
        failures: [],
      };
      expect(() =>
        validateGraphSnapshotV2({
          scope: validScope,
          policyVersion: "1.0.0",
          nodes: [],
          relationships: [
            {
              id: "rel-x",
              source: "node-1",
              target: "node-2",
              type: "PROMOTE",
              grade: "A",
              evidenceIds: [],
            },
          ],
          evidence: [],
          coverage: cov,
        })
      ).toThrow(/Inter-horizon operation 'PROMOTE' cannot be an internal RelationshipType/);
    });
  });

  describe("ImpactCursorV2", () => {
    it("considers two cursors unequal when horizonId differs", () => {
      const c1: ImpactCursorV2 = {
        tenantId: "Alpha",
        horizonId: "negotiation",
        graphId: "G1",
        queryHash: "hash-123",
        lastKeys: { a: "1" },
      };
      const c2: ImpactCursorV2 = {
        tenantId: "Alpha",
        horizonId: "transformation",
        graphId: "G1",
        queryHash: "hash-123",
        lastKeys: { a: "1" },
      };
      expect(areImpactCursorsEqual(c1, c2)).toBe(false);
    });

    it("considers identical cursors equal", () => {
      const c1: ImpactCursorV2 = {
        tenantId: "Alpha",
        horizonId: "negotiation",
        graphId: "G1",
        queryHash: "hash-123",
        lastKeys: { a: "1", b: "2" },
      };
      const c2: ImpactCursorV2 = {
        tenantId: "Alpha",
        horizonId: "negotiation",
        graphId: "G1",
        queryHash: "hash-123",
        lastKeys: { b: "2", a: "1" },
      };
      expect(areImpactCursorsEqual(c1, c2)).toBe(true);
    });
  });
});
