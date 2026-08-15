import { describe, it, expect } from "bun:test";
import { classifyRelationships, resolveTargetArtifactId } from "../src/relationship-policy";
import type { EvidenceRecord, HorizonGraphScope } from "../src/relationship-types";

describe("Scoped Relationship Classification", () => {
  const scope: HorizonGraphScope = {
    tenantId: "Alpha",
    horizonId: "transformation",
    graphId: "G1",
  };

  const knownArtifacts = new Set([
    "skills/autonomous-orchestrator/SKILL.md",
    "docs/workflows/autonomous-orchestration.md",
    "agents/orchestrator-agent.md",
    "src/index.ts",
    "src/utils.ts",
  ]);

  it("distinguishes depends-on, references, delegates-to, and behavioral-hypothesis", () => {
    const evidence: EvidenceRecord[] = [
      {
        id: "e1",
        sourceId: "src/index.ts",
        kind: "code-import",
        targetText: "./utils",
        location: { startLine: 1, startCol: 1 },
      },
      {
        id: "e2",
        sourceId: "skills/autonomous-orchestrator/SKILL.md",
        kind: "markdown-link",
        targetText: "docs/workflows/autonomous-orchestration.md",
        location: { startLine: 5, startCol: 1 },
      },
      {
        id: "e3",
        sourceId: "skills/autonomous-orchestrator/SKILL.md",
        kind: "declarative-delegation",
        targetText: "agents/orchestrator-agent.md",
        location: { startLine: 8, startCol: 1 },
      },
    ];

    const result = classifyRelationships({
      scope,
      evidence,
      knownArtifacts,
      hypotheses: [
        {
          source: "skills/autonomous-orchestrator/SKILL.md",
          target: "src/index.ts",
          correlation: "user-session-clustering",
        },
      ],
    });

    expect(result.relationships.length).toBe(4);

    const dep = result.relationships.find((r) => r.type === "depends-on");
    expect(dep).toBeDefined();
    expect(dep?.grade).toBe("A");
    expect(dep?.traversable).toBe(true);

    const ref = result.relationships.find((r) => r.type === "references");
    expect(ref).toBeDefined();
    expect(ref?.grade).toBe("B");

    const del = result.relationships.find((r) => r.type === "delegates-to");
    expect(del).toBeDefined();
    expect(del?.grade).toBe("A");
    expect(del?.traversable).toBe(true);

    const hyp = result.relationships.find((r) => r.type === "behavioral-hypothesis");
    expect(hyp).toBeDefined();
    expect(hyp?.grade).toBe("C");
    expect(hyp?.traversable).toBe(false);
  });

  it("does not create confirmed edges for unresolved or ambiguous evidence", () => {
    const evidence: EvidenceRecord[] = [
      {
        id: "e-unresolved",
        sourceId: "src/index.ts",
        kind: "markdown-link",
        targetText: "non-existent-file.md",
        location: { startLine: 1, startCol: 1 },
      },
    ];

    const result = classifyRelationships({
      scope,
      evidence,
      knownArtifacts,
    });

    expect(result.relationships.length).toBe(0);
    expect(result.outcomes[0].status).toBe("unresolved");
  });
});
