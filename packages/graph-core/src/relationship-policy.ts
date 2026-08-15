/**
 * relationship-policy.ts — Horizon relationship classification policy for Graph v2.
 */
import path from "node:path";
import {
  type HorizonGraphScope,
  type EvidenceRecord,
  type EvidenceGrade,
  type RelationshipType,
  type PublishedRelationship,
  type PolicyVersion,
  validateRelationshipType,
} from "./relationship-types";

export type HorizonRelationshipPolicy = {
  policyVersion: PolicyVersion;
  traversableReferences?: boolean;
  minEvidenceGrade?: EvidenceGrade;
  allowHypotheses?: boolean;
};

export type ResolutionOutcome = {
  evidenceId: string;
  sourceId: string;
  targetText: string;
  status: "resolved" | "unresolved" | "ambiguous" | "rejected";
  resolvedTargetId?: string;
  relationshipType?: RelationshipType;
  grade?: EvidenceGrade;
  reason?: string;
};

export type ClassificationResult = {
  relationships: PublishedRelationship[];
  outcomes: ResolutionOutcome[];
};

export function resolveTargetArtifactId(
  sourceId: string,
  targetText: string,
  knownArtifacts: ReadonlySet<string>
): { status: "resolved" | "unresolved" | "ambiguous"; targetId?: string } {
  // Strip URL anchors or query params if any
  const cleanTarget = targetText.split("#")[0].split("?")[0].replace(/\\/g, "/");
  if (!cleanTarget) return { status: "unresolved" };

  // 1. Direct match (repository-relative)
  if (knownArtifacts.has(cleanTarget)) {
    return { status: "resolved", targetId: cleanTarget };
  }

  // 2. Relative to source directory
  const sourceDir = path.posix.dirname(sourceId);
  const resolvedRelative = path.posix.normalize(path.posix.join(sourceDir, cleanTarget));
  if (knownArtifacts.has(resolvedRelative)) {
    return { status: "resolved", targetId: resolvedRelative };
  }

  // 3. Extension resolution (.md, .ts, .js)
  const extensions = [".md", ".markdown", ".ts", ".tsx", ".js", ".json"];
  for (const ext of extensions) {
    if (knownArtifacts.has(cleanTarget + ext)) {
      return { status: "resolved", targetId: cleanTarget + ext };
    }
    if (knownArtifacts.has(resolvedRelative + ext)) {
      return { status: "resolved", targetId: resolvedRelative + ext };
    }
  }

  // 4. Check if multiple match basename
  const targetBase = path.posix.basename(cleanTarget);
  const matching = [...knownArtifacts].filter(
    (a) => path.posix.basename(a) === targetBase || a.endsWith("/" + cleanTarget)
  );
  if (matching.length === 1) {
    return { status: "resolved", targetId: matching[0] };
  }
  if (matching.length > 1) {
    return { status: "ambiguous" };
  }

  return { status: "unresolved" };
}

export function classifyRelationships(opts: {
  scope: HorizonGraphScope;
  evidence: readonly EvidenceRecord[];
  knownArtifacts: ReadonlySet<string>;
  policy?: HorizonRelationshipPolicy;
  hypotheses?: readonly Array<{ source: string; target: string; correlation: string }>;
}): ClassificationResult {
  const policy = opts.policy ?? { policyVersion: "1.0.0", traversableReferences: true };
  const outcomes: ResolutionOutcome[] = [];
  const relationships: PublishedRelationship[] = [];
  const relMap = new Map<string, PublishedRelationship>();

  for (const ev of opts.evidence) {
    if (ev.kind === "fenced-import-rejected" || ev.kind === "generic-mention-rejected") {
      outcomes.push({
        evidenceId: ev.id,
        sourceId: ev.sourceId,
        targetText: ev.targetText,
        status: "rejected",
        reason: ev.kind === "fenced-import-rejected" ? "FENCED_IMPORT" : "GENERIC_MENTION",
      });
      continue;
    }

    const res = resolveTargetArtifactId(ev.sourceId, ev.targetText, opts.knownArtifacts);
    if (res.status !== "resolved" || !res.targetId) {
      outcomes.push({
        evidenceId: ev.id,
        sourceId: ev.sourceId,
        targetText: ev.targetText,
        status: res.status,
        reason: res.status === "ambiguous" ? "AMBIGUOUS_TARGET" : "TARGET_NOT_FOUND",
      });
      continue;
    }

    let relType: RelationshipType = "references";
    let grade: EvidenceGrade = "B";

    if (ev.kind === "code-import" || ev.kind === "import") {
      relType = "depends-on";
      grade = "A";
    } else if (ev.kind === "declarative-delegation") {
      relType = "delegates-to";
      grade = "A";
    } else if (ev.kind === "markdown-link" || ev.kind === "path-reference") {
      relType = "references";
      grade = "B";
    }

    // Filter by min grade if configured
    if (policy.minEvidenceGrade) {
      if (policy.minEvidenceGrade === "A" && grade !== "A") continue;
      if (policy.minEvidenceGrade === "B" && grade === "C") continue;
    }

    const relKey = `${ev.sourceId}->${res.targetId}:${relType}`;
    const traversable =
      relType === "behavioral-hypothesis"
        ? false
        : relType === "references"
        ? policy.traversableReferences ?? true
        : true;

    if (relMap.has(relKey)) {
      const existing = relMap.get(relKey)!;
      if (!existing.evidenceIds.includes(ev.id)) {
        existing.evidenceIds.push(ev.id);
      }
    } else {
      const publishedRel: PublishedRelationship = {
        id: `rel-${relMap.size + 1}`,
        source: ev.sourceId,
        target: res.targetId,
        type: relType,
        grade,
        evidenceIds: [ev.id],
        traversable,
      };
      relMap.set(relKey, publishedRel);
    }

    outcomes.push({
      evidenceId: ev.id,
      sourceId: ev.sourceId,
      targetText: ev.targetText,
      status: "resolved",
      resolvedTargetId: res.targetId,
      relationshipType: relType,
      grade,
    });
  }

  // Include behavioral hypotheses if supplied
  if (policy.allowHypotheses !== false && opts.hypotheses) {
    for (const hyp of opts.hypotheses) {
      if (opts.knownArtifacts.has(hyp.source) && opts.knownArtifacts.has(hyp.target)) {
        const hypRel: PublishedRelationship = {
          id: `rel-${relMap.size + 1}`,
          source: hyp.source,
          target: hyp.target,
          type: "behavioral-hypothesis",
          grade: "C",
          evidenceIds: [],
          traversable: false,
        };
        relMap.set(`${hyp.source}->${hyp.target}:behavioral-hypothesis`, hypRel);
      }
    }
  }

  return {
    relationships: Array.from(relMap.values()),
    outcomes,
  };
}
