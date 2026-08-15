/**
 * extract-markdown.ts — Pure Markdown Evidence Extractor for Graph v2.
 */
import { createHash } from "node:crypto";
import type {
  EvidenceRecord,
  SourceLocation,
  ArtifactId,
} from "./relationship-types";

export type ExtractedEvidence = {
  evidence: EvidenceRecord[];
  rejectedSignals: Array<{
    kind: string;
    sourceId: ArtifactId;
    text: string;
    reason: string;
    location: SourceLocation;
  }>;
};

function generateEvidenceId(sourceId: string, kind: string, targetText: string, line: number): string {
  const hash = createHash("sha256")
    .update(`${sourceId}:${kind}:${targetText}:${line}`)
    .digest("hex")
    .slice(0, 16);
  return `ev-${hash}`;
}

export function extractMarkdownEvidence(
  artifactId: ArtifactId,
  content: string
): ExtractedEvidence {
  const evidence: EvidenceRecord[] = [];
  const rejectedSignals: ExtractedEvidence["rejectedSignals"] = [];

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    // Check code fences
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) {
      // Any import pattern inside a code fence is explicitly a rejected signal
      if (
        /\bimport\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/.test(line) ||
        /\bimport\s*['"]([^'"]+)['"]/.test(line) ||
        /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/.test(line)
      ) {
        rejectedSignals.push({
          kind: "fenced-import-rejected",
          sourceId: artifactId,
          text: trimmed,
          reason: "FENCED_IMPORT",
          location: { startLine: lineNum, startCol: 1 },
        });
      }
      continue;
    }

    // 1. Declarative Delegation pattern:
    // e.g. "Delegates [execution ]to <target>"
    const delegationMatch = /(?:delegates(?:\s+execution)?\s+to)\s+([a-zA-Z0-9_.\-\/]+\.[a-zA-Z0-9]+)/i.exec(line);
    if (delegationMatch) {
      const targetText = delegationMatch[1];
      const startCol = delegationMatch.index + 1;
      evidence.push({
        id: generateEvidenceId(artifactId, "declarative-delegation", targetText, lineNum),
        sourceId: artifactId,
        kind: "declarative-delegation",
        targetText,
        location: { startLine: lineNum, startCol, endLine: lineNum, endCol: startCol + delegationMatch[0].length },
      });
    }

    // 2. Markdown Links: [label](path)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(line)) !== null) {
      const targetText = match[2].trim();
      // Exclude external web links from internal relationship evidence
      if (!targetText.startsWith("http://") && !targetText.startsWith("https://") && !targetText.startsWith("#")) {
        const startCol = match.index + 1;
        evidence.push({
          id: generateEvidenceId(artifactId, "markdown-link", targetText, lineNum),
          sourceId: artifactId,
          kind: "markdown-link",
          targetText,
          location: { startLine: lineNum, startCol, endLine: lineNum, endCol: startCol + match[0].length },
        });
      }
    }

    // 3. Raw Path references mentioning files with extensions (e.g., docs/workflows/autonomous-orchestration.md or agents/orchestrator-agent.md or src/index.ts)
    // Avoid double counting if already captured by delegation or link
    const pathRegex = /(?:^|[\s(])([a-zA-Z0-9_.\-\/]+\.(?:md|markdown|ts|js|go|rs|py|json))(?=[\s),.]|$)/g;
    let pathMatch: RegExpExecArray | null;
    while ((pathMatch = pathRegex.exec(line)) !== null) {
      const targetText = pathMatch[1].trim();
      // Skip if already in evidence on this line
      const alreadyCaptured = evidence.some(
        (e) => e.location.startLine === lineNum && e.targetText === targetText
      );
      if (!alreadyCaptured) {
        const startCol = pathMatch.index + 1;
        evidence.push({
          id: generateEvidenceId(artifactId, "path-reference", targetText, lineNum),
          sourceId: artifactId,
          kind: "path-reference",
          targetText,
          location: { startLine: lineNum, startCol, endLine: lineNum, endCol: startCol + targetText.length },
        });
      }
    }

    // 4. Generic mention exclusion check
    if (trimmed.toLowerCase().startsWith("generic mention")) {
      rejectedSignals.push({
        kind: "generic-mention-rejected",
        sourceId: artifactId,
        text: trimmed,
        reason: "GENERIC_MENTION",
        location: { startLine: lineNum, startCol: 1 },
      });
    }
  }

  return { evidence, rejectedSignals };
}
