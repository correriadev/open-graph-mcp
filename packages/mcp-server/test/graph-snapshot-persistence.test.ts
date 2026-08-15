import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, rebuildFromJsonl } from "../src/db";
import {
  publishHorizonGraphSnapshot,
  findHorizonGraphById,
  loadActiveHorizonGraph,
} from "../src/store";
import type { ServerState } from "../src/state";
import type { GraphSnapshotV2 } from "@open-graph-mcp/graph-core/relationship-types";

describe("Horizon Snapshot Persistence (Task 06)", () => {
  let stateDir: string;
  let state: ServerState;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "og-persist-v2-"));
    const dbPath = path.join(stateDir, "state.sqlite");
    const db = openDb(dbPath);
    state = {
      db,
      stateDir,
      tenants: new Map(),
      sessions: new Map(),
      locks: new Map(),
      claimsCache: new Map(),
    } as unknown as ServerState;
  });

  afterEach(() => {
    try {
      state.db.close();
      rmSync(stateDir, { recursive: true, force: true });
    } catch {}
  });

  const sampleSnapshot1: GraphSnapshotV2 = {
    scope: { tenantId: "Alpha", horizonId: "transformation", graphId: "G1" },
    policyVersion: "1.0.0",
    nodes: [
      { id: "src/a.ts", file: "src/a.ts", kind: "file", domain: "core" },
      { id: "docs/doc.md", file: "docs/doc.md", kind: "file", domain: "docs" },
    ],
    relationships: [
      {
        id: "rel-1",
        source: "docs/doc.md",
        target: "src/a.ts",
        type: "references",
        grade: "B",
        evidenceIds: ["ev-1"],
        traversable: true,
      },
    ],
    evidence: [
      {
        id: "ev-1",
        sourceId: "docs/doc.md",
        kind: "markdown-link",
        targetText: "src/a.ts",
        location: { startLine: 1, startCol: 1 },
      },
    ],
    coverage: {
      scope: { tenantId: "Alpha", horizonId: "transformation", graphId: "G1" },
      byFormat: { md: 1, ts: 1 },
      byFamily: { markdown: 1, code: 1 },
      failures: [],
      analyzedCount: 2,
    },
  };

  it("persists and hydrates one complete horizon-scoped GraphSnapshotV2", () => {
    publishHorizonGraphSnapshot(state, sampleSnapshot1);

    const loaded = loadActiveHorizonGraph(state, "Alpha", "transformation");
    expect(loaded).toBeDefined();
    expect(loaded?.scope.tenantId).toBe("Alpha");
    expect(loaded?.scope.horizonId).toBe("transformation");
    expect(loaded?.scope.graphId).toBe("G1");
    expect(loaded?.nodes.length).toBe(2);
    expect(loaded?.relationships.length).toBe(1);
    expect(loaded?.evidence.length).toBe(1);
    expect(loaded?.coverage.byFormat["md"]).toBe(1);
  });

  it("isolates identical graphId across tenants and horizons", () => {
    publishHorizonGraphSnapshot(state, sampleSnapshot1);

    const betaSnap: GraphSnapshotV2 = {
      ...sampleSnapshot1,
      scope: { tenantId: "Beta", horizonId: "transformation", graphId: "G1" },
      coverage: {
        ...sampleSnapshot1.coverage,
        scope: { tenantId: "Beta", horizonId: "transformation", graphId: "G1" },
      },
    };
    publishHorizonGraphSnapshot(state, betaSnap);

    const alphaLoaded = loadActiveHorizonGraph(state, "Alpha", "transformation");
    const betaLoaded = loadActiveHorizonGraph(state, "Beta", "transformation");
    const microLoaded = loadActiveHorizonGraph(state, "Alpha", "microtask");

    expect(alphaLoaded?.scope.tenantId).toBe("Alpha");
    expect(betaLoaded?.scope.tenantId).toBe("Beta");
    expect(microLoaded).toBeNull();
  });

  it("rebuilds from JSONL mirror deterministically", () => {
    publishHorizonGraphSnapshot(state, sampleSnapshot1);

    // Rebuild SQLite from JSONL
    rebuildFromJsonl(state.db, stateDir, "Alpha");

    const reloaded = loadActiveHorizonGraph(state, "Alpha", "transformation");
    expect(reloaded).toBeDefined();
    expect(reloaded?.scope.graphId).toBe("G1");
    expect(reloaded?.relationships[0].id).toBe("rel-1");
  });
});
