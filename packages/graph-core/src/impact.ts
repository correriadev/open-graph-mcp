/**
 * impact.ts — Horizon Impact Knowledge and Blast Radius Analyzer for Graph v2.
 */
import type {
  GraphSnapshotV2,
  ImpactQueryV2,
  ImpactKnowledge,
  HorizonGraphScope,
  CoverageManifest,
  RelationshipType,
  EvidenceGrade,
} from "./relationship-types";

export type ImpactPathExplanation = {
  path: string[];
  relationshipType: RelationshipType;
  grade: EvidenceGrade;
};

export type ExplainedImpact = {
  scope: HorizonGraphScope;
  nodeId: string;
  knowledge: ImpactKnowledge;
  directDependents: string[];
  transitiveDependents: string[];
  directDependencies: string[];
  transitiveDependencies: string[];
  hypotheses: Array<{ source: string; target: string }>;
  coverage: CoverageManifest;
  explanations: ImpactPathExplanation[];
  warnings: string[];
};

export function analyzeHorizonImpact(
  snapshot: GraphSnapshotV2,
  query: ImpactQueryV2
): ExplainedImpact {
  const { nodeId, directions } = query;
  const warnings: string[] = [];

  // 1. Check local coverage sufficiency
  const nodeFailure = snapshot.coverage.failures.find((f) => f.artifactId === nodeId);
  if (nodeFailure) {
    return {
      scope: snapshot.scope,
      nodeId,
      knowledge: {
        type: "unknown",
        reasonCodes: [`COVERAGE_FAILURE_${nodeFailure.reason}`],
      },
      directDependents: [],
      transitiveDependents: [],
      directDependencies: [],
      transitiveDependencies: [],
      hypotheses: [],
      coverage: snapshot.coverage,
      explanations: [],
      warnings: [`Node '${nodeId}' has coverage failure: ${nodeFailure.reason}`],
    };
  }

  // 2. Build adjacency maps for traversable relationships
  const outboundMap = new Map<string, Array<{ target: string; type: RelationshipType; grade: EvidenceGrade }>>();
  const inboundMap = new Map<string, Array<{ source: string; type: RelationshipType; grade: EvidenceGrade }>>();
  const hypotheses: Array<{ source: string; target: string }> = [];

  for (const rel of snapshot.relationships) {
    if (rel.type === "behavioral-hypothesis" || rel.traversable === false) {
      if (rel.source === nodeId || rel.target === nodeId) {
        hypotheses.push({ source: rel.source, target: rel.target });
      }
      continue;
    }

    // Outbound: from source to target
    if (!outboundMap.has(rel.source)) outboundMap.set(rel.source, []);
    outboundMap.get(rel.source)!.push({ target: rel.target, type: rel.type, grade: rel.grade });

    // Inbound: from target to source
    if (!inboundMap.has(rel.target)) inboundMap.set(rel.target, []);
    inboundMap.get(rel.target)!.push({ source: rel.source, type: rel.type, grade: rel.grade });
  }

  const directDependencies: string[] = [];
  const transitiveDependencies: string[] = [];
  const directDependents: string[] = [];
  const transitiveDependents: string[] = [];
  const explanations: ImpactPathExplanation[] = [];

  // Traversal for Outbound (Dependencies)
  if (directions.includes("outbound")) {
    const visited = new Set<string>([nodeId]);
    const queue: Array<{ current: string; path: string[] }> = [{ current: nodeId, path: [nodeId] }];

    while (queue.length > 0) {
      const { current, path } = queue.shift()!;
      const neighbors = outboundMap.get(current) ?? [];

      for (const next of neighbors) {
        explanations.push({
          path: [...path, next.target],
          relationshipType: next.type,
          grade: next.grade,
        });

        if (!visited.has(next.target)) {
          visited.add(next.target);
          if (current === nodeId) {
            directDependencies.push(next.target);
          } else {
            transitiveDependencies.push(next.target);
          }
          queue.push({ current: next.target, path: [...path, next.target] });
        }
      }
    }
  }

  // Traversal for Inbound (Dependents)
  if (directions.includes("inbound")) {
    const visited = new Set<string>([nodeId]);
    const queue: Array<{ current: string; path: string[] }> = [{ current: nodeId, path: [nodeId] }];

    while (queue.length > 0) {
      const { current, path } = queue.shift()!;
      const neighbors = inboundMap.get(current) ?? [];

      for (const prev of neighbors) {
        explanations.push({
          path: [prev.source, ...path],
          relationshipType: prev.type,
          grade: prev.grade,
        });

        if (!visited.has(prev.source)) {
          visited.add(prev.source);
          if (current === nodeId) {
            directDependents.push(prev.source);
          } else {
            transitiveDependents.push(prev.source);
          }
          queue.push({ current: prev.source, path: [prev.source, ...path] });
        }
      }
    }
  }

  const directCount = directDependencies.length + directDependents.length;
  const transitiveCount = transitiveDependencies.length + transitiveDependents.length;
  const totalCount = directCount + transitiveCount;

  let knowledge: ImpactKnowledge;
  if (totalCount > 0) {
    knowledge = {
      type: "known-nonzero",
      directCount,
      transitiveCount,
    };
  } else {
    // If no failures, it is known-zero
    knowledge = {
      type: "known-zero",
    };
  }

  return {
    scope: snapshot.scope,
    nodeId,
    knowledge,
    directDependents,
    transitiveDependents,
    directDependencies,
    transitiveDependencies,
    hypotheses,
    coverage: snapshot.coverage,
    explanations,
    warnings,
  };
}
