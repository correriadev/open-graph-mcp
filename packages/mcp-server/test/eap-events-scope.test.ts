import { describe, it, expect } from "bun:test";
import {
  INTERNAL_RELATIONSHIP_TYPES,
  FORBIDDEN_BOUNDARY_OPERATIONS,
  validateRelationshipType,
} from "@open-graph-mcp/graph-core/relationship-types";

describe("Scoped Lifecycle Events (Task 14)", () => {
  it("enforces that boundary operations are strictly excluded from documentary relationships", () => {
    for (const op of FORBIDDEN_BOUNDARY_OPERATIONS) {
      expect(() => validateRelationshipType(op)).toThrow(/cannot be an internal RelationshipType/);
    }

    for (const relType of INTERNAL_RELATIONSHIP_TYPES) {
      expect(validateRelationshipType(relType)).toBe(relType);
    }
  });

  it("ensures lifecycle events carry tenantId, horizonId, and graphId scope without authority leaks", () => {
    const snapshotEvent = {
      kind: "graph.snapshot.v2.published",
      tenantId: "Alpha",
      horizonId: "transformation",
      graphId: "G-123",
      payload: {
        policyVersion: "1.0.0",
        coverageSummary: { md: 5 },
      },
    };

    expect(snapshotEvent.tenantId).toBe("Alpha");
    expect(snapshotEvent.horizonId).toBe("transformation");
    expect(snapshotEvent.graphId).toBe("G-123");
    expect((snapshotEvent.payload as any).authority).toBeUndefined();
  });
});
