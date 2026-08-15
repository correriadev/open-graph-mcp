import { describe, it, expect } from "bun:test";
import { extractMarkdownEvidence } from "../src/extract-markdown";

describe("Markdown Evidence Extraction", () => {
  it("extracts markdown links and declarative delegations with bounded SourceLocation", () => {
    const content = `# Title
See [workflow](docs/workflows/wf.md) for details.
Delegates execution to agents/orchestrator.md when running.
`;
    const result = extractMarkdownEvidence("skills/test.md", content);

    expect(result.evidence.length).toBeGreaterThanOrEqual(2);
    const link = result.evidence.find((e) => e.kind === "markdown-link");
    expect(link).toBeDefined();
    expect(link?.targetText).toBe("docs/workflows/wf.md");
    expect(link?.location.startLine).toBe(2);

    const delegation = result.evidence.find((e) => e.kind === "declarative-delegation");
    expect(delegation).toBeDefined();
    expect(delegation?.targetText).toBe("agents/orchestrator.md");
    expect(delegation?.location.startLine).toBe(3);
  });

  it("rejects imports inside code fences as executable code dependencies", () => {
    const content = `# Guide

\`\`\`typescript
import { helper } from './helper';
const x = 1;
\`\`\`
`;
    const result = extractMarkdownEvidence("docs/guide.md", content);
    const codeDeps = result.evidence.filter((e) => e.targetText.includes("helper"));
    expect(codeDeps.length).toBe(0);

    const rejected = result.rejectedSignals.find((s) => s.reason === "FENCED_IMPORT");
    expect(rejected).toBeDefined();
    expect(rejected?.location.startLine).toBe(4);
  });

  it("classifies generic mentions as rejected signals", () => {
    const content = `# Overview
Generic mention of autonomous orchestrator pattern without concrete link.
`;
    const result = extractMarkdownEvidence("docs/overview.md", content);
    const genericRejected = result.rejectedSignals.find(
      (s) => s.reason === "GENERIC_MENTION"
    );
    expect(genericRejected).toBeDefined();
  });
});
