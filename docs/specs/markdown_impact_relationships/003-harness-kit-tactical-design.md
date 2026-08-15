# Tactical Design — harness-kit

**Domain:** `markdown_impact_relationships`  
**Project:** `harness-kit`  
**Role in this domain:** external acceptance corpus and integration evidence; no OpenGraph product logic belongs here.

## Section 1 — Main Structure

HarnessKit already contains the real Markdown topology that exposed the defect: skills declare delegations, workflow documents reference skills, agents participate in mappings, and distribution files reference the orchestrator. The repository is not a second implementation site. Its only justified addition is a stable, machine-readable acceptance manifest describing a small set of expected evidence and non-evidence cases without rewriting the source documents to suit the indexer.

| Element | Layer / Type | Invariants / Tech Rules | 4-line Snippet |
|---|---|---|---|
| HarnessKit Source Corpus | Existing repository content | Remains natural production-like Markdown/JSON/code; OpenGraph must adapt to it, not the reverse. | See below |
| Markdown Impact Acceptance Manifest | Test fixture contract | Pins representative source, target, evidence kind, direction, and expected classification; contains no extraction algorithm. | See below |
| Corpus Integrity Check | Test support | Verifies referenced fixture locations still exist and declared signals remain present before OpenGraph uses the corpus as evidence. | See below |

```text
HarnessKitSourceCorpus:
  skills; agents; workflowDocs; distributionMetadata
  // unchanged product-independent inputs
```

```text
MarkdownImpactAcceptanceManifest:
  cases: ExpectedEvidenceCase[]
  exclusions: ExpectedNonRelationshipCase[]
```

```text
CorpusIntegrityCheck:
  verify(manifest, repository): Result
  // validates fixture facts, not OpenGraph behavior
```

## Section 2 — Value Objects / Types / Interfaces

| Name | Context / Layer | Validation & Typing Rules | 4-line Snippet |
|---|---|---|---|
| `CorpusArtifactId` | Fixture contract | POSIX repository-relative path; target must exist in the checked-out HarnessKit snapshot. | See below |
| `ExpectedEvidenceCase` | Fixture contract | Declares source, target, evidence kind, direction, and minimum grade; must cite a stable locator or unique marker. | See below |
| `ExpectedNonRelationshipCase` | Fixture contract | Declares an observable lexical/code-example signal that must not be treated as a confirmed relationship. | See below |
| `CorpusContractVersion` | Fixture contract | Explicit integer version; changes only when fixture semantics intentionally change. | See below |

```text
type CorpusArtifactId = string
rule: relative path exists in HarnessKit checkout
```

```text
type ExpectedEvidenceCase = {
  source; target; kind; direction; minimumGrade; marker
}
```

```text
type ExpectedNonRelationshipCase = {
  source; marker; rejectionReason
}
```

```text
type CorpusContractVersion = int
rule: positive and changed intentionally
```

## Section 3 — Domain Services / Use Cases / Actions

No domain service for indexing, resolving, classifying, publishing, or impact analysis is permitted in HarnessKit. The sole action validates that the external corpus contract still describes facts present in this repository.

| Operation / Hook | Responsibility | Coordinates / Subscriptions | 4-line Snippet |
|---|---|---|---|
| `VerifyMarkdownImpactCorpus` | Ensures all fixture artifacts and unique markers exist and every declared target remains addressable. | Acceptance manifest, repository filesystem | See below |

```text
VerifyMarkdownImpactCorpus(manifest, root): Result
// fail when a pinned fixture fact drifts
```

The verification must not invoke OpenGraph, infer relationships, duplicate its parser, or bless graph output. End-to-end assertions remain owned by `open-graph-mcp` and consume this corpus as an external input.

## Section 4 — Events / Messages / Async Flows

HarnessKit introduces no runtime event or asynchronous flow for this domain. The fixture check produces a synchronous test result only.

| Event / Action Name | Trigger | Minimum Payload | Consumers |
|---|---|---|---|
| `CorpusContractVerified` | Local fixture-integrity test succeeds | `{ contractVersion, caseCount }` | HarnessKit test report; OpenGraph integration precondition |
| `CorpusContractDrifted` | A declared path or marker is missing/ambiguous | `{ caseId, reasonCode }` | HarnessKit test failure and maintainer diagnostics |

## Section 5 — Persistence / Repository / Data Access Interfaces

There is no runtime persistence. The acceptance manifest is version-controlled test data. It must contain only repository-relative paths, semantic labels, and unique markers; it must not embed absolute paths, tenant credentials, OpenGraph database state, or generated graph snapshots.

| Resource / Adapter | Methods / Actions | Return Types / Expected State |
|---|---|---|
| `MarkdownImpactCorpusManifest` | Load versioned JSON fixture | Valid contract with resolvable source/target paths and deterministic case ids |
| `HarnessKitRepositoryReader` | Read declared artifacts for integrity verification | Repository-confined text reads and named missing/ambiguous failures |

```text
interface MarkdownImpactCorpusManifest:
  load(): CorpusContract
  // static test data only
```

```text
interface HarnessKitRepositoryReader:
  exists(id): boolean
  findUniqueMarker(id, marker): SourceLocation
```

## Section 6 — Ordered Development Tasks

```json
[
  {
    "id": "01",
    "title": "Establish Markdown Impact Acceptance Corpus",
    "description": "Create a minimal versioned manifest that pins real HarnessKit documentary relationships and false-positive controls for external OpenGraph integration tests.",
    "scope": [
      "tests/fixtures/open-graph/markdown-impact.expected.json",
      "tests/unit/test_markdown_impact_corpus.py",
      "skills/autonomous-orchestrator/SKILL.md",
      "docs/workflow/AUTONOMOUS-ORCHESTRATOR.md"
    ],
    "acceptance": [
      "The manifest includes representative delegation, workflow reference, and explicit path cases targeting existing artifacts",
      "The manifest includes at least one generic mention or code-example case that must not become a confirmed relationship",
      "The integrity test validates paths and unique markers without importing or reproducing OpenGraph logic"
    ],
    "depends_on": null
  }
]
```

This task is deliberately limited to fixture evidence. Any proposed parser, relationship policy, database schema, MCP response, or traversal implementation in HarnessKit violates the bounded-context allocation and must be rejected.
