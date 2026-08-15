/**
 * relationship-types.ts — Graph v2 scoped contracts and relationship types.
 */

export const VALID_HORIZONS = ["negotiation", "microtask", "transformation", "persistent"] as const;
export type HorizonKind = (typeof VALID_HORIZONS)[number];

export function isValidHorizonKind(value: unknown): value is HorizonKind {
  return typeof value === "string" && (VALID_HORIZONS as readonly string[]).includes(value);
}

export function validateHorizonKind(value: unknown): HorizonKind {
  if (value === "session") {
    throw new Error("HorizonKind cannot be 'session'; session is an initiator, not a promotion horizon");
  }
  if (!isValidHorizonKind(value)) {
    throw new Error(`Invalid HorizonKind: '${String(value)}'. Must be one of: ${VALID_HORIZONS.join(", ")}`);
  }
  return value;
}

export type HorizonGraphScope = {
  readonly tenantId: string;
  readonly horizonId: string;
  readonly graphId: string;
};

export function validateHorizonGraphScope(scope: unknown): HorizonGraphScope {
  if (!scope || typeof scope !== "object") {
    throw new Error("HorizonGraphScope must be a non-null object");
  }
  const s = scope as Partial<HorizonGraphScope>;
  if (!s.tenantId || typeof s.tenantId !== "string" || s.tenantId.trim() === "") {
    throw new Error("HorizonGraphScope requires non-empty tenantId");
  }
  if (!s.horizonId || typeof s.horizonId !== "string" || s.horizonId.trim() === "") {
    throw new Error("HorizonGraphScope requires non-empty horizonId");
  }
  if (!s.graphId || typeof s.graphId !== "string" || s.graphId.trim() === "") {
    throw new Error("HorizonGraphScope requires non-empty graphId");
  }
  return {
    tenantId: s.tenantId,
    horizonId: s.horizonId,
    graphId: s.graphId,
  };
}

export type ArtifactId = string;

export function validateArtifactId(pathStr: unknown): ArtifactId {
  if (typeof pathStr !== "string" || pathStr.trim() === "") {
    throw new Error("ArtifactId must be a non-empty string");
  }
  if (pathStr.startsWith("/") || pathStr.startsWith("\\") || /^[a-zA-Z]:/.test(pathStr)) {
    throw new Error(`ArtifactId cannot be absolute: ${pathStr}`);
  }
  const normalized = pathStr.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.includes("..")) {
    throw new Error(`ArtifactId cannot contain parent traversal '..': ${pathStr}`);
  }
  return normalized;
}

export type SourceLocation = {
  startLine: number;
  startCol: number;
  endLine?: number;
  endCol?: number;
};

export type EvidenceRecord = {
  id: string;
  sourceId: ArtifactId;
  kind: string;
  targetText: string;
  location: SourceLocation;
};

export const VALID_EVIDENCE_GRADES = ["A", "B", "C"] as const;
export type EvidenceGrade = (typeof VALID_EVIDENCE_GRADES)[number];

export const INTERNAL_RELATIONSHIP_TYPES = [
  "depends-on",
  "references",
  "delegates-to",
  "behavioral-hypothesis",
] as const;

export type RelationshipType = (typeof INTERNAL_RELATIONSHIP_TYPES)[number];

export const FORBIDDEN_BOUNDARY_OPERATIONS = [
  "INITIATE",
  "PROMOTE",
  "CONTEST",
  "RECALL",
  "parent",
] as const;

export function isInternalRelationshipType(type: unknown): type is RelationshipType {
  return typeof type === "string" && (INTERNAL_RELATIONSHIP_TYPES as readonly string[]).includes(type);
}

export function validateRelationshipType(type: unknown): RelationshipType {
  if (typeof type === "string" && (FORBIDDEN_BOUNDARY_OPERATIONS as readonly string[]).includes(type)) {
    throw new Error(
      `Inter-horizon operation '${type}' cannot be an internal RelationshipType. Allowed: ${INTERNAL_RELATIONSHIP_TYPES.join(", ")}`
    );
  }
  if (!isInternalRelationshipType(type)) {
    throw new Error(
      `Invalid RelationshipType: '${String(type)}'. Allowed: ${INTERNAL_RELATIONSHIP_TYPES.join(", ")}`
    );
  }
  return type;
}

export type PublishedRelationship = {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  grade: EvidenceGrade;
  evidenceIds: string[];
  traversable?: boolean;
};

export function validatePublishedRelationship(rel: unknown): PublishedRelationship {
  if (!rel || typeof rel !== "object") {
    throw new Error("PublishedRelationship must be an object");
  }
  const r = rel as Partial<PublishedRelationship>;
  if (!r.id || typeof r.id !== "string") throw new Error("PublishedRelationship missing id");
  if (!r.source || typeof r.source !== "string") throw new Error("PublishedRelationship missing source");
  if (!r.target || typeof r.target !== "string") throw new Error("PublishedRelationship missing target");
  const validatedType = validateRelationshipType(r.type);
  if (!r.grade || !VALID_EVIDENCE_GRADES.includes(r.grade as EvidenceGrade)) {
    throw new Error(`Invalid EvidenceGrade: '${String(r.grade)}'`);
  }
  if (!Array.isArray(r.evidenceIds)) {
    throw new Error("PublishedRelationship requires evidenceIds array");
  }
  return {
    id: r.id,
    source: r.source,
    target: r.target,
    type: validatedType,
    grade: r.grade as EvidenceGrade,
    evidenceIds: r.evidenceIds,
    traversable: r.traversable !== undefined ? Boolean(r.traversable) : validatedType !== "behavioral-hypothesis",
  };
}

export type CoverageFailure = {
  artifactId: string;
  reason: string;
};

export type CoverageManifest = {
  scope: HorizonGraphScope;
  byFormat: Record<string, number>;
  byFamily: Record<string, number>;
  failures: CoverageFailure[];
  eligibleCount?: number;
  analyzedCount?: number;
  excludedCount?: number;
};

export function validateCoverageManifest(cov: unknown, expectedScope?: HorizonGraphScope): CoverageManifest {
  if (!cov || typeof cov !== "object") throw new Error("CoverageManifest must be an object");
  const c = cov as Partial<CoverageManifest>;
  const validatedScope = validateHorizonGraphScope(c.scope);
  if (expectedScope) {
    if (
      validatedScope.tenantId !== expectedScope.tenantId ||
      validatedScope.horizonId !== expectedScope.horizonId ||
      validatedScope.graphId !== expectedScope.graphId
    ) {
      throw new Error(
        `CoverageManifest scope mismatch: expected ${expectedScope.tenantId}/${expectedScope.horizonId}/${expectedScope.graphId} but got ${validatedScope.tenantId}/${validatedScope.horizonId}/${validatedScope.graphId}`
      );
    }
  }
  if (!c.byFormat || typeof c.byFormat !== "object") throw new Error("CoverageManifest missing byFormat");
  if (!c.byFamily || typeof c.byFamily !== "object") throw new Error("CoverageManifest missing byFamily");
  if (!Array.isArray(c.failures)) throw new Error("CoverageManifest missing failures array");
  return {
    scope: validatedScope,
    byFormat: c.byFormat,
    byFamily: c.byFamily,
    failures: c.failures,
    eligibleCount: c.eligibleCount,
    analyzedCount: c.analyzedCount,
    excludedCount: c.excludedCount,
  };
}

export type PolicyVersion = string;

export type GraphNodeV2 = {
  id: string;
  file: string;
  kind: string;
  domain?: string | null;
  label?: string;
};

export type GraphSnapshotV2 = {
  readonly scope: HorizonGraphScope;
  readonly policyVersion: PolicyVersion;
  readonly nodes: readonly GraphNodeV2[];
  readonly relationships: readonly PublishedRelationship[];
  readonly evidence: readonly EvidenceRecord[];
  readonly coverage: CoverageManifest;
};

export function validateGraphSnapshotV2(snapshot: unknown): GraphSnapshotV2 {
  if (!snapshot || typeof snapshot !== "object") throw new Error("GraphSnapshotV2 must be an object");
  const s = snapshot as Partial<GraphSnapshotV2>;
  const scope = validateHorizonGraphScope(s.scope);
  if (!s.policyVersion || typeof s.policyVersion !== "string") {
    throw new Error("GraphSnapshotV2 missing policyVersion");
  }
  if (!Array.isArray(s.nodes)) throw new Error("GraphSnapshotV2 missing nodes array");
  if (!Array.isArray(s.relationships)) throw new Error("GraphSnapshotV2 missing relationships array");
  if (!Array.isArray(s.evidence)) throw new Error("GraphSnapshotV2 missing evidence array");

  const relationships = s.relationships.map(validatePublishedRelationship);
  const coverage = validateCoverageManifest(s.coverage, scope);

  return {
    scope,
    policyVersion: s.policyVersion,
    nodes: s.nodes,
    relationships,
    evidence: s.evidence,
    coverage,
  };
}

export type ImpactKnowledgeType = "known-zero" | "known-nonzero" | "unknown";

export type ImpactKnowledge =
  | { type: "known-zero" }
  | { type: "known-nonzero"; directCount: number; transitiveCount: number }
  | { type: "unknown"; reasonCodes: string[] };

export type ImpactQueryV2 = {
  scope: HorizonGraphScope;
  nodeId: string;
  directions: ("inbound" | "outbound")[];
  pageSize?: number;
};

export type ImpactCursorV2 = {
  tenantId: string;
  horizonId: string;
  graphId: string;
  queryHash: string;
  lastKeys: Record<string, string>;
};

export function areImpactCursorsEqual(a: ImpactCursorV2, b: ImpactCursorV2): boolean {
  if (a.tenantId !== b.tenantId) return false;
  if (a.horizonId !== b.horizonId) return false;
  if (a.graphId !== b.graphId) return false;
  if (a.queryHash !== b.queryHash) return false;
  const aKeys = Object.keys(a.lastKeys).sort();
  const bKeys = Object.keys(b.lastKeys).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a.lastKeys[k] === b.lastKeys[k]);
}
