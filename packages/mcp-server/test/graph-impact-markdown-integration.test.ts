import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildHorizonArtifactInventory } from "@open-graph-mcp/graph-core/inventory";
import { extractMarkdownEvidence } from "@open-graph-mcp/graph-core/extract-markdown";
import { classifyRelationships } from "@open-graph-mcp/graph-core/relationship-policy";
import { assembleGraphSnapshotV2 } from "@open-graph-mcp/graph-core/build";
import { openDb } from "../src/db";
import { publishHorizonGraphSnapshot, loadActiveHorizonGraph } from "../src/store";
import { impactV2 } from "../src/tools/graph-impact";
import type { ServerState } from "../src/state";

describe("Validate HarnessKit Markdown Acceptance (Task 15)", () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const manifestPath = path.join(projectRoot, "tests/fixtures/open-graph/markdown-impact.expected.json");
  const corpusDir = path.join(projectRoot, "tests/fixtures/corpus");
  let stateDir: string;
  let state: ServerState;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "og-harness-accept-"));
    const db = openDb(path.join(stateDir, "state.sqlite"));
    state = { db, stateDir } as unknown as ServerState;
  });

  afterEach(() => {
    try {
      state.db.close();
      rmSync(stateDir, { recursive: true, force: true });
    } catch {}
  });

  it("reproduces markdown-impact.expected.json manifest without schema mismatches", () => {
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.contractVersion).toBe(1);

    const scope = { tenantId: "HarnessTenant", horizonId: "transformation", graphId: "G-harness-1" };

    // 1. Inventory
    const inventory = buildHorizonArtifactInventory({ root: corpusDir, scope });
    expect(inventory.items.length).toBeGreaterThanOrEqual(3);
    expect(inventory.coverage.byFamily["markdown"]).toBeGreaterThanOrEqual(3);

    // 2. Evidence extraction across all discovered markdown files
    const allEvidence: any[] = [];
    for (const art of inventory.items) {
      if (art.format === "md" && art.content) {
        const res = extractMarkdownEvidence(art.artifactId, art.content);
        allEvidence.push(...res.evidence);
      }
    }

    // Assert exclusions are rejected by the pure extractor
    for (const excl of manifest.exclusions) {
      const found = allEvidence.find((e) => e.rawSnippet && e.rawSnippet.includes(excl.marker));
      expect(found).toBeUndefined();
    }

    // 3. Classification
    const classification = classifyRelationships({
      evidence: allEvidence,
      knownArtifacts: new Set(inventory.items.map((i) => i.artifactId)),
      scope,
    });

    // Assert graphCases are present with correct kinds and grades
    for (const gc of manifest.graphCases) {
      const rel = classification.relationships.find(
        (r) => r.source === gc.source && r.target === gc.target && r.type === gc.kind
      );
      expect(rel).toBeDefined();
      if (rel) {
        expect(rel.grade).toBe(gc.minimumGrade);
      }
    }

    // 4. Assemble snapshot
    const nodes = inventory.items.map((i) => ({
      id: i.artifactId,
      file: i.artifactId,
      kind: "file" as const,
    }));

    const snapshot = assembleGraphSnapshotV2({
      tenantId: "HarnessTenant",
      horizonId: "transformation",
      policyVersion: "1.0.0",
      nodes,
      relationships: classification.relationships,
      evidence: allEvidence,
      coverage: inventory.coverage,
    });

    // 5. Persist snapshot
    publishHorizonGraphSnapshot(state, snapshot);
    const loaded = loadActiveHorizonGraph(state, "HarnessTenant", "transformation");
    expect(loaded).toBeDefined();
    expect(loaded?.scope.graphId).toBe(snapshot.scope.graphId);

    // 6. Query Impact through MCP v2
    const impactRes = impactV2(state, {
      tenantId: "HarnessTenant",
      horizonId: "transformation",
      nodeId: "skills/autonomous-orchestrator/SKILL.md",
      directions: ["outbound"],
    });

    expect(impactRes.knowledge.type).toBe("known-nonzero");
    expect(impactRes.directDependencies).toContain("docs/workflows/autonomous-orchestration.md");
    expect(impactRes.directDependencies).toContain("agents/orchestrator-agent.md");
  });
});
