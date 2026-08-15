# Tactical Design — open-graph-mcp

**Domain:** `markdown_impact_relationships`  
**Project:** `open-graph-mcp`  
**Contract posture:** breaking changes are permitted; there are no current clients to preserve.

## Section 1 — Main Structure

The implementation follows the existing protocol-core/reference-host architecture. Pure identity, evidence, relationship policy, graph schema, and traversal rules belong in `graph-core`; filesystem discovery, SQLite/JSONL durability, tenant transactions, and MCP translation remain in `mcp-server`. This is a schema replacement, not a compatibility layer over the ambiguous v1 contract.

| Element | Layer / Type | Invariants / Tech Rules | 4-line Snippet |
|---|---|---|---|
| Artifact Inventory | `mcp-server` repository adapter + `graph-core` contract | Enumerates a canonical repository snapshot; records eligible, excluded, read, analyzed, and failed artifacts by format; never silently drops a read failure. | See below |
| Markdown Evidence Extractor | `graph-core` pure extractor | Parses Markdown-specific constructs; fenced code is not interpreted as source imports; every signal carries source location and normalized target text. | See below |
| Artifact Identity Index | `graph-core` immutable index | Resolves only within the current repository snapshot; canonical path wins over aliases; zero, one, and many matches are distinct outcomes. | See below |
| Relationship Classifier | `graph-core` domain policy | Classifies evidence once under a versioned policy; generic mentions are rejected; hypotheses never become confirmed traversal edges. | See below |
| Graph Snapshot | `graph-core` aggregate schema | Nodes, published relationships, evidence outcomes, coverage, policy version, and checksum describe one indivisible snapshot identified by `graphId`. | See below |
| Snapshot Publisher | `mcp-server` application service | Persists a complete candidate snapshot transactionally, then swaps the hot graph; readers observe the prior or new snapshot, never a mixture. | See below |
| Impact Analyzer | `graph-core` pure domain service | Traverses only policy-eligible published relationships; returns explained paths and an explicit knowledge state per direction. | See below |
| Graph Impact Tool | `mcp-server` MCP adapter | Validates request/cursor and serializes the domain result without reclassifying evidence; cursor from a different `graphId` is rejected. | See below |

```text
ArtifactInventory:
  snapshotId: SnapshotId; artifacts: ArtifactRecord[]
  coverage: InventoryCoverage
```

```text
MarkdownEvidenceExtractor:
  extract(artifact, identities): EvidenceRecord[]
  // ignores examples as executable imports
```

```text
ArtifactIdentityIndex:
  byCanonicalPath: Map<ArtifactId, ArtifactRecord>
  resolve(candidate): ResolutionOutcome
```

```text
RelationshipClassifier:
  classify(evidence, policy): ClassificationOutcome
  // rejection and ambiguity stay observable
```

```text
GraphSnapshotV2:
  graphId: GraphId; policyVersion: PolicyVersion
  nodes; relationships; evidence; coverage
```

```text
SnapshotPublisher:
  publish(candidate, tenant): PublishedSnapshot
  // one durable transaction, then hot swap
```

```text
ImpactAnalyzer:
  analyze(snapshot, request): ExplainedImpact
  // confirmed traversal plus separate hypotheses
```

```text
GraphImpactTool:
  call(request, tenant): ImpactResponseV2
  // rejects stale snapshot-bound cursor
```

### Aggregate and consistency boundaries

- `GraphSnapshotV2` is the consistency boundary for publication and consultation. A Coverage Manifest from one scan cannot accompany relationships from another.
- `EvidenceRecord` is immutable inside a snapshot and preserves observable provenance; it is not itself a relationship.
- `PublishedRelationship` aggregates one or more compatible evidence records for a source-target-type-direction tuple. Conflicting evidence is preserved as separate outcomes, never overwritten.
- `CouplingHypothesis` remains queryable evidence but is excluded from confirmed traversal.
- A `known-zero` result is valid only when the relevant source artifact and relationship family were successfully inventoried, read, extracted, resolved, and classified in the queried direction.

## Section 2 — Value Objects / Types / Interfaces

| Name | Context / Layer | Validation & Typing Rules | 4-line Snippet |
|---|---|---|---|
| `ArtifactId` | Artifact Inventory / `graph-core` | Normalized POSIX path relative to repository root; non-empty; cannot escape root. | See below |
| `ArtifactFormat` | Artifact Inventory / `graph-core` | Closed union initially covering source code and Markdown; configured JSON families are explicit, not wildcarded. | See below |
| `SourceLocation` | Evidence Extraction / `graph-core` | Relative artifact id plus one-based line/column span; no absolute path or raw document body. | See below |
| `EvidenceKind` | Evidence Extraction / `graph-core` | Typed as code import, Markdown link/path, explicit symbol, declarative delegation, or behavioral hypothesis. | See below |
| `EvidenceGrade` | Relationship Classification / `graph-core` | `A`, `B`, or `C`; grade and relationship type remain orthogonal. | See below |
| `EvidenceRecord` | Evidence Extraction / `graph-core` | Deterministic id from normalized content fields; carries source, candidate target, syntax, location, and grade candidate. | See below |
| `ResolutionOutcome` | Relationship Classification / `graph-core` | Discriminated union: `resolved`, `unresolved`, or `ambiguous`; ambiguous preserves all candidate ids. | See below |
| `RelationshipType` | Relationship Classification / `graph-core` | Closed union; `depends-on`, `references`, and `delegates-to` have distinct semantics and traversal eligibility. | See below |
| `PublishedRelationship` | Graph Publication / `graph-core` | Deterministic id; typed direction; source and target belong to same snapshot; contains evidence ids and policy decision. | See below |
| `CoverageManifest` | Graph Publication / `graph-core` | Counts and failures are internally reconcilable; scopes coverage by format and relationship family. | See below |
| `ImpactKnowledge` | Impact Traversal / `graph-core` | Per-direction state is `known-zero`, `known-nonzero`, or `unknown`; `unknown` includes machine-readable reasons. | See below |
| `ImpactExplanation` | Impact Traversal / `graph-core` | Identifies relationship path, evidence grade, policy version, and redacted provenance without raw content by default. | See below |
| `ImpactCursorV2` | MCP contract / `mcp-server` | Opaque, integrity-checked, bound to tenant question parameters and exact `graphId`; stale graph is a named error. | See below |
| `ImpactResponseV2` | MCP contract / `mcp-server` | Requires `graphId`, directional knowledge, coverage, warnings, explained results, totals, and cursor; ambiguous legacy 0/0 shape is invalid. | See below |

```text
type ArtifactId = string
rule: repository-relative POSIX path, no '..'
```

```text
type ArtifactFormat =
  'typescript' | 'javascript' | 'markdown' | 'configured-json'
```

```text
type SourceLocation = {
  artifactId: ArtifactId; line: int; column?: int
}
```

```text
type EvidenceKind =
  'code-import' | 'markdown-link' | 'path-reference' |
  'explicit-symbol' | 'declarative-delegation' | 'behavioral-hypothesis'
```

```text
type EvidenceGrade = 'A' | 'B' | 'C'
rule: grade never implies relationship type
```

```text
type EvidenceRecord = {
  id; sourceId; kind; targetText; location; syntax
}
```

```text
type ResolutionOutcome =
  Resolved(targetId) | Unresolved(reason) |
  Ambiguous(candidateIds)
```

```text
type RelationshipType =
  'depends-on' | 'references' | 'delegates-to' |
  'behavioral-hypothesis'
```

```text
type PublishedRelationship = {
  id; from; to; type; grade; evidenceIds; traversable
}
```

```text
type CoverageManifest = {
  inventory; extraction; resolution; classification
  byFormat; byRelationshipFamily; failures
}
```

```text
type ImpactKnowledge =
  KnownZero | KnownNonzero |
  Unknown(reasonCodes)
```

```text
type ImpactExplanation = {
  path; relationshipTypes; grades; evidenceLocations
  policyVersion
}
```

```text
type ImpactCursorV2 = {
  graphId; queryHash; lastKeys
}
```

```text
type ImpactResponseV2 = {
  graphId; knowledge; coverage; results
  totals; warnings; nextCursor
}
```

### Relationship publication matrix

| Evidence | Default relationship | Published? | Confirmed traversal? |
|---|---|---:|---:|
| Resolved code import | `depends-on` | Yes | Yes |
| Resolved Markdown link or repository path | `references` | Yes | Yes only when policy marks reference changes as impactful |
| Unambiguous declarative delegation | `delegates-to` | Yes | Yes |
| Unique explicit symbolic reference | `references` | Yes | Policy-controlled; never silently treated as import |
| Behavioral correlation | `behavioral-hypothesis` | Yes, in hypothesis channel | No |
| Generic term, unresolved or ambiguous target | Rejection/outcome only | No edge | No |

## Section 3 — Domain Services / Use Cases / Actions

| Operation / Hook | Responsibility | Coordinates / Subscriptions | 4-line Snippet |
|---|---|---|---|
| `BuildArtifactInventory` | Produces canonical artifact identities and complete coverage accounting for one repository scan. | Filesystem adapter, format policy, ignore rules | See below |
| `ExtractMarkdownEvidence` | Detects links, repository paths, explicit artifact/skill names, and declarative delegations without executing Markdown examples as code. | Artifact record, identity catalog, Markdown parser | See below |
| `ResolveEvidenceTargets` | Resolves all evidence through a prebuilt identity/alias index in bounded passes, avoiding per-mention global scans. | Evidence records, identity index | See below |
| `ClassifyRelationships` | Applies the versioned evidence policy and emits published relations, hypotheses, and rejected outcomes. | Resolution outcomes, relationship policy | See below |
| `AssembleGraphSnapshot` | Builds deterministic Graph v2 with coverage and provenance and computes its content-derived `graphId`. | Nodes, classified outcomes, coverage manifest | See below |
| `PublishGraphSnapshot` | Writes the entire tenant snapshot transactionally and exposes it atomically to readers. | Snapshot repository, hot graph registry, event publisher | See below |
| `AnalyzeGraphImpact` | Calculates direct/transitive impact, coverage knowledge, hypotheses, explanations, stable totals, and deterministic pages. | Graph snapshot, traversal policy | See below |
| `ServeGraphImpact` | Converts MCP input into a domain request and maps named errors/results without changing semantics. | Tenant resolution, cursor codec, Impact Analyzer | See below |

```text
BuildArtifactInventory(root, policy): Inventory
// every eligible artifact ends read/analyzed/failed
```

```text
ExtractMarkdownEvidence(artifact, identities): Evidence[]
// parse links, paths, names, delegation grammar
```

```text
ResolveEvidenceTargets(evidence, index): Outcome[]
// O(artifacts + evidence), no N+1 filesystem search
```

```text
ClassifyRelationships(outcomes, policy): ClassificationSet
// proven, hypothesis, or rejected
```

```text
AssembleGraphSnapshot(parts): GraphSnapshotV2
// canonical sort and content-derived graphId
```

```text
PublishGraphSnapshot(tenant, candidate): Result
// durable transaction then hot-snapshot swap
```

```text
AnalyzeGraphImpact(snapshot, request): ExplainedImpact
// fail closed when directional coverage is insufficient
```

```text
ServeGraphImpact(args, tenant): ImpactResponseV2
// validate cursor graphId, delegate, serialize
```

### Operational rules

- Extraction stores bounded, redacted provenance: source location and normalized syntax metadata by default, never the full Markdown body.
- Duplicate evidence for the same relationship is aggregated deterministically; only a bounded sample of locations is returned, while total evidence count remains exact.
- Traversal uses `seen`, maximum depth, deterministic ordering, and an explicit traversal budget. Hitting a budget emits `truncated` and a warning; it never reports the truncated total as complete.
- Rebuild recomputes unresolved/ambiguous outcomes from the current snapshot, preserving deterministic identity but not carrying stale conclusions across snapshots.
- Format exclusions and read/parse failures contribute reason codes to directional `unknown` decisions.

## Section 4 — Events / Messages / Async Flows

| Event / Action Name | Trigger | Minimum Payload | Consumers |
|---|---|---|---|
| `ArtifactInventoryCompleted` | Repository scan and coverage reconciliation finish | `{ candidateId, inventoryCounts, failureCount }` | Snapshot build observability |
| `RelationshipEvidenceClassified` | All extraction outcomes are classified | `{ candidateId, provenCount, hypothesisCount, rejectedCount }` | Snapshot build observability |
| `GraphSnapshotPublished` | Durable transaction commits and hot graph swaps | `{ graphId, policyVersion, stats, coverageSummary }` | SSE clients, server resources, audit trail |
| `GraphSnapshotPublicationFailed` | Candidate build or durable write fails | `{ candidateId, stage, reasonCode }` | Operator diagnostics; existing snapshot remains active |
| `ImpactCoverageInsufficient` | Impact query resolves to `unknown` in either direction | `{ graphId, nodeId, directions, reasonCodes }` | Audit/telemetry; MCP response already carries details |

Events contain aggregate counts and reason codes only. Evidence locations stay tenant-scoped in the requested response or snapshot resource and never cross repository boundaries.

## Section 5 — Persistence / Repository / Data Access Interfaces

Graph v2 replaces the current nodes/edges-only reconstruction contract. SQLite remains the live durable index and JSONL remains its append-only mirror, but snapshot identity must be explicit in every row so hydration cannot combine generations.

| Resource / Adapter | Methods / Actions | Return Types / Expected State |
|---|---|---|
| `RepositorySnapshotReader` | `inventory(root, formatPolicy)`; `read(artifactId)` | Canonical inventory plus typed read results/failures confined to repository root |
| `GraphSnapshotRepository` | `publish(tenant, snapshot)`; `loadActive(tenant)`; `findById(tenant, graphId)` | Atomic v2 snapshot; no partially visible nodes, relationships, evidence, or coverage |
| `EvidenceRepository` | `listByRelationship`; `listOutcomesByArtifact` | Snapshot-scoped, tenant-scoped evidence metadata and resolution outcomes |
| `CoverageRepository` | `getManifest(tenant, graphId)` | Exact manifest belonging to the same graph snapshot |
| `ImpactCursorCodec` | `encode(cursor)`; `decodeAndVerify(raw)` | Integrity-checked cursor bound to `graphId` and query hash |

```text
interface RepositorySnapshotReader:
  inventory(root, policy): InventoryResult
  read(id): ArtifactReadResult
```

```text
interface GraphSnapshotRepository:
  publish(tenant, snapshot): void
  loadActive(tenant): GraphSnapshotV2 | null
```

```text
interface EvidenceRepository:
  listByRelationship(tenant, graphId, id): EvidenceSummary[]
  listOutcomesByArtifact(tenant, graphId, id): Outcome[]
```

```text
interface CoverageRepository:
  getManifest(tenant, graphId): CoverageManifest
  // absent manifest invalidates snapshot hydration
```

```text
interface ImpactCursorCodec:
  encode(cursor): string
  decodeAndVerify(raw): ImpactCursorV2
```

### Physical schema direction

- Add an explicit `graph_snapshots` record with `graph_id`, schema version, policy version, checksum, status, repository identity, and coverage summary.
- Scope nodes and published relationships by `(tenant_id, graph_id, id)`; relationship rows carry type, grade, direction, traversability, and policy decision.
- Persist evidence and resolution/classification outcomes separately, keyed by deterministic evidence id and `graph_id`.
- Persist normalized coverage dimensions and failures with the same `graph_id`; loading a snapshot without complete coverage metadata is an integrity failure.
- Mark the active snapshot only after all candidate rows commit. Rebuild failure leaves the previous active snapshot intact.
- Do not maintain a v1 read path or synthesize v2 fields from old 0/0 data. Existing development databases are rebuilt under v2.

## Section 6 — Ordered Development Tasks

```json
[
  {
    "id": "01",
    "title": "Define Graph V2 Domain Contracts",
    "description": "Replace the ambiguous graph model with typed artifacts, evidence, relationships, coverage, impact knowledge, and snapshot-bound pagination contracts.",
    "scope": [
      "packages/graph-core/src/build.ts",
      "packages/graph-core/src/relationship-types.ts",
      "packages/graph-core/test/relationship-types.test.ts",
      "packages/mcp-server/src/tools/graph-impact.ts"
    ],
    "acceptance": [
      "Graph v2 requires graphId, policyVersion, coverage, typed relationships, and evidence outcomes",
      "ImpactResponseV2 cannot represent a bare ambiguous 0/0 result",
      "No v1 compatibility union or fallback contract remains"
    ],
    "depends_on": null
  },
  {
    "id": "02",
    "title": "Implement Artifact Inventory Coverage",
    "description": "Build a canonical repository inventory that accounts for eligible, excluded, read, analyzed, and failed artifacts by format.",
    "scope": [
      "packages/graph-core/src/inventory.ts",
      "packages/graph-core/test/inventory.test.ts",
      "packages/mcp-server/src/tools/graph-bootstrap.ts",
      "packages/mcp-server/test/graph-inventory.test.ts"
    ],
    "acceptance": [
      "Every eligible artifact reaches an analyzed or failed terminal state with a reason",
      "Markdown is explicitly covered and unsupported JSON families are explicitly excluded",
      "Repository paths cannot escape the indexed root"
    ],
    "depends_on": "01"
  },
  {
    "id": "03",
    "title": "Implement Markdown Evidence Extraction",
    "description": "Add a Markdown-specific extractor for links, paths, explicit artifact references, and declarative delegations while rejecting code-example imports as source dependencies.",
    "scope": [
      "packages/graph-core/src/extract-markdown.ts",
      "packages/graph-core/src/relationship-types.ts",
      "packages/graph-core/test/extract-markdown.test.ts"
    ],
    "acceptance": [
      "Resolved links and repository paths retain source locations and syntax kind",
      "A fenced or inline code example containing an import does not create a code-import edge",
      "Generic mentions and repeated prose are not promoted by extraction"
    ],
    "depends_on": "02"
  },
  {
    "id": "04",
    "title": "Implement Artifact Identity Resolution",
    "description": "Resolve evidence candidates against one canonical identity and alias index with explicit resolved, unresolved, and ambiguous outcomes.",
    "scope": [
      "packages/graph-core/src/artifact-identity.ts",
      "packages/graph-core/src/resolve-relationships.ts",
      "packages/graph-core/test/resolve-relationships.test.ts"
    ],
    "acceptance": [
      "Canonical paths resolve deterministically within the repository snapshot",
      "Ambiguous aliases preserve all candidates and create no published relationship",
      "Resolution performs no per-evidence filesystem scan"
    ],
    "depends_on": "03"
  },
  {
    "id": "05",
    "title": "Implement Relationship Classification Policy",
    "description": "Classify resolution outcomes into proven relationships, hypotheses, and rejections under a versioned conservative policy.",
    "scope": [
      "packages/graph-core/src/relationship-policy.ts",
      "packages/graph-core/src/classify-relationships.ts",
      "packages/graph-core/test/classify-relationships.test.ts"
    ],
    "acceptance": [
      "Relationship type, direction, grade, provenance, and traversal eligibility are explicit",
      "Declarative delegation has a tested source-to-target direction",
      "Behavioral hypotheses and generic mentions never enter confirmed traversal"
    ],
    "depends_on": "04"
  },
  {
    "id": "06",
    "title": "Assemble Deterministic Graph Snapshots",
    "description": "Compose inventory, classified outcomes, coverage, and published relationships into a canonically ordered content-addressed Graph v2 snapshot.",
    "scope": [
      "packages/graph-core/src/build.ts",
      "packages/graph-core/src/graph-checksum.ts",
      "packages/graph-core/test/build-v2.test.ts"
    ],
    "acceptance": [
      "Identical repository content and policy produce the same graphId and relationship identities",
      "Conflicting evidence remains observable without overwriting stronger evidence",
      "Coverage and relationships are inseparable members of one snapshot"
    ],
    "depends_on": "05"
  },
  {
    "id": "07",
    "title": "Migrate Snapshot Persistence Schema",
    "description": "Replace the nodes-and-edges persistence model with tenant- and graph-scoped snapshots, relationships, evidence outcomes, and coverage records.",
    "scope": [
      "packages/mcp-server/src/db.ts",
      "packages/mcp-server/src/tools/graph-bootstrap.ts",
      "packages/mcp-server/test/graph-snapshot-persistence.test.ts",
      "packages/mcp-server/test/rebuild-from-jsonl.test.ts"
    ],
    "acceptance": [
      "A committed snapshot hydrates with exactly matching nodes, relationships, evidence, coverage, and graphId",
      "A failed rebuild leaves the previous active snapshot readable",
      "Old schema data is rejected or rebuilt rather than projected into a misleading v2 response"
    ],
    "depends_on": "06"
  },
  {
    "id": "08",
    "title": "Integrate Evidence Pipeline Into Bootstrap",
    "description": "Wire inventory, format-specific extraction, resolution, classification, and snapshot assembly into tenant bootstrap and rebuild.",
    "scope": [
      "packages/mcp-server/src/tools/graph-bootstrap.ts",
      "packages/mcp-server/src/state.ts",
      "packages/mcp-server/test/graph-bootstrap-markdown.test.ts",
      "packages/mcp-server/test/graph-rebuild-snapshot.test.ts"
    ],
    "acceptance": [
      "A Markdown-heavy repository publishes typed documentary relationships and coverage",
      "Read and parse failures appear in the published Coverage Manifest",
      "Readers observe only the old or new graphId during rebuild"
    ],
    "depends_on": "07"
  },
  {
    "id": "09",
    "title": "Implement Explained Impact Traversal",
    "description": "Move impact semantics into a pure graph-core analyzer that returns directional knowledge, confirmed paths, separate hypotheses, and explicit budget truncation.",
    "scope": [
      "packages/graph-core/src/impact.ts",
      "packages/graph-core/test/impact.test.ts",
      "packages/graph-core/test/impact-properties.test.ts"
    ],
    "acceptance": [
      "Known zero is returned only when directional coverage is sufficient",
      "Cycles terminate deterministically and hypotheses never inflate confirmed totals",
      "Every confirmed hit includes a typed path and bounded provenance explanation"
    ],
    "depends_on": "08"
  },
  {
    "id": "10",
    "title": "Replace Graph Impact MCP Contract",
    "description": "Expose ImpactResponseV2 through a thin MCP adapter with integrity-checked cursors bound to the exact graph snapshot.",
    "scope": [
      "packages/mcp-server/src/tools/graph-impact.ts",
      "packages/mcp-server/src/transport.ts",
      "packages/mcp-server/test/graph-impact.test.ts",
      "packages/mcp-server/test/graph-impact-cursor.test.ts"
    ],
    "acceptance": [
      "Every response includes graphId, directional impactKnowledge, coverage, warnings, explanations, totals, and cursor",
      "A cursor issued for a prior graphId fails with a named stale-cursor error",
      "The MCP adapter performs no evidence classification"
    ],
    "depends_on": "09"
  },
  {
    "id": "11",
    "title": "Validate Markdown Impact At Repository Scale",
    "description": "Exercise the complete published pipeline against hostile, ambiguous, cyclic, unreadable, and high-fanout documentary corpora before declaring the new contract complete.",
    "scope": [
      "packages/mcp-server/test/graph-impact-markdown-integration.test.ts",
      "packages/mcp-server/test/fixtures/markdown-impact",
      "packages/mcp-server/test/probes/markdown-impact-scale.test.ts",
      "docs/verification/markdown-impact-baseline.json"
    ],
    "acceptance": [
      "The HarnessKit acceptance corpus produces non-zero explained relationships for the orchestrator skill",
      "Unreadable or excluded relevant artifacts turn directional zero into unknown",
      "Scale results record time, memory, evidence aggregation, and deterministic output without setting an unsupported one-million-file SLO"
    ],
    "depends_on": "10"
  }
]
```
