/**
 * graph-checksum.ts — deterministic canonical checksum for GraphSnapshotV2.
 */
import { createHash } from "node:crypto";
import type {
  GraphNodeV2,
  PublishedRelationship,
  EvidenceRecord,
  CoverageManifest,
  PolicyVersion,
} from "./relationship-types";

export function computeGraphSnapshotId(params: {
  tenantId: string;
  horizonId: string;
  policyVersion: PolicyVersion;
  nodes: readonly GraphNodeV2[];
  relationships: readonly PublishedRelationship[];
  evidence: readonly EvidenceRecord[];
  coverage: CoverageManifest;
}): string {
  // Sort canonically
  const sortedNodes = [...params.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const sortedRelationships = [...params.relationships].sort((a, b) =>
    a.id.localeCompare(b.id) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
  );
  const sortedEvidence = [...params.evidence].sort((a, b) => a.id.localeCompare(b.id));

  const canonicalPayload = {
    tenantId: params.tenantId,
    horizonId: params.horizonId,
    policyVersion: params.policyVersion,
    nodes: sortedNodes,
    relationships: sortedRelationships,
    evidence: sortedEvidence,
    coverage: {
      byFormat: Object.keys(params.coverage.byFormat)
        .sort()
        .reduce((acc, k) => ({ ...acc, [k]: params.coverage.byFormat[k] }), {}),
      byFamily: Object.keys(params.coverage.byFamily)
        .sort()
        .reduce((acc, k) => ({ ...acc, [k]: params.coverage.byFamily[k] }), {}),
      failures: [...params.coverage.failures].sort((a, b) =>
        a.artifactId.localeCompare(b.artifactId) || a.reason.localeCompare(b.reason)
      ),
    },
  };

  const hash = createHash("sha256")
    .update(JSON.stringify(canonicalPayload))
    .digest("hex")
    .slice(0, 16);

  return `graph-${hash}`;
}
