# Test Scenarios — open-graph-mcp

**Domain:** `markdown_impact_relationships`  
**Project:** `open-graph-mcp`  
**Framework:** Bun Test  
**Date:** 2026-08-15

## 1. Unit Tests

### 1.1 Graph Snapshot aggregate

#### Should create Graph Snapshot V2 when all members describe one repository snapshot

- **Given:** canonically ordered Artefatos Indexados, Relacionamentos Publicados, Evidence Outcomes, a reconciled Coverage Manifest, a Policy Version and their content checksum
- **When:** `AssembleGraphSnapshot` creates the Graph Snapshot
- **Then:** the Graph Snapshot contains all supplied members under one deterministic `graphId`

#### Should reject Graph Snapshot V2 when coverage belongs to another snapshot

- **Given:** relationships from one repository scan and a Coverage Manifest identified by a different candidate snapshot
- **When:** `AssembleGraphSnapshot` validates the consistency boundary
- **Then:** creation is rejected without producing a publishable Graph Snapshot

#### Should reject Graph Snapshot V2 when a relationship endpoint is outside the snapshot

- **Given:** a Published Relationship whose source or target is absent from the Artifact Inventory
- **When:** `AssembleGraphSnapshot` validates the relationship
- **Then:** creation is rejected and no `graphId` is assigned

#### Should preserve conflicting evidence when assembling a Graph Snapshot

- **Given:** compatible and conflicting Evidence Records for the same source and target
- **When:** `AssembleGraphSnapshot` aggregates classification outcomes
- **Then:** compatible evidence is aggregated deterministically and conflicting evidence remains observable as a separate outcome

#### Should produce the same graphId when repository content and policy are unchanged

- **Given:** two Graph Snapshot candidates with identical canonical content and Policy Version but different discovery order
- **When:** each candidate is assembled
- **Then:** both Graph Snapshots have the same `graphId`, relationship identities and canonical ordering

### 1.2 Value Objects

#### Should create ArtifactId when the path is repository-relative POSIX

- **Given:** the path `skills/autonomous-orchestrator/SKILL.md`
- **When:** an ArtifactId is created
- **Then:** the ArtifactId preserves the normalized repository-relative path

#### Should reject ArtifactId when the path escapes the repository root

- **Given:** a path containing a parent traversal outside the repository root
- **When:** an ArtifactId is created
- **Then:** creation is rejected before inventory or file access

#### Should admit only configured JSON families when ArtifactFormat is JSON

- **Given:** a format policy whose JSON allowlist contains the Markdown Impact Acceptance Manifest family
- **When:** the Artifact Inventory classifies an allowlisted JSON file and an unrelated JSON file
- **Then:** the allowlisted file is eligible as `configured-json` and the unrelated file is explicitly excluded with a reason

#### Should create SourceLocation without leaking an absolute path or document body

- **Given:** a Markdown Evidence location with ArtifactId, one-based line and column
- **When:** SourceLocation is created
- **Then:** it contains only repository-relative location metadata and no absolute path or raw Markdown body

#### Should reject SourceLocation when line or column is not positive

- **Given:** a SourceLocation with line zero or a negative column
- **When:** the location is validated
- **Then:** validation fails before the Evidence Record is accepted

#### Should create deterministic EvidenceRecord identity from normalized evidence fields

- **Given:** two equivalent Markdown signals with the same source, target text, syntax and SourceLocation
- **When:** Evidence Records are created independently
- **Then:** they have equal deterministic identities and behave as one key in Set and Map collections

#### Should distinguish EvidenceKind without equating grade and relationship type

- **Given:** a resolved Markdown path and an unambiguous Declarative Delegation, both with Evidence Grade A
- **When:** their Evidence Records are classified
- **Then:** the first remains a path reference and the second remains a delegation rather than both becoming `depends-on`

#### Should preserve all candidates in an ambiguous ResolutionOutcome

- **Given:** one explicit artifact alias that identifies multiple Artefatos Indexados
- **When:** Artifact Identity Resolution produces a ResolutionOutcome
- **Then:** the outcome is `ambiguous`, retains every deterministic candidate id and exposes no resolved target

#### Should keep ImpactKnowledge unknown when coverage has named failures

- **Given:** a Coverage Manifest with a relevant Markdown read or parse failure in the dependency direction
- **When:** ImpactKnowledge is evaluated for that direction
- **Then:** it is `unknown` with machine-readable reason codes rather than `known-zero`

#### Should create ImpactCursorV2 bound to graphId and query identity

- **Given:** a Graph Snapshot, tenant-scoped impact request and deterministic page boundary
- **When:** the cursor is encoded
- **Then:** the opaque cursor binds the exact `graphId`, query hash and last keys with an integrity check

#### Should reject ImpactResponseV2 when it represents bare ambiguous zero totals

- **Given:** zero dependents and dependencies without directional ImpactKnowledge or Coverage Manifest
- **When:** an ImpactResponseV2 is created
- **Then:** creation is rejected because the Graph v2 contract cannot express unqualified 0/0

### 1.3 Domain Services

#### Should account for every eligible artifact when building Artifact Inventory

- **Given:** a repository snapshot containing readable Markdown, allowlisted JSON, excluded formats and one unreadable eligible artifact
- **When:** `BuildArtifactInventory` completes
- **Then:** every candidate is counted as analyzed, explicitly excluded or failed with a reason and no eligible artifact silently disappears

#### Should extract resolved Markdown links and repository paths with provenance

- **Given:** Markdown containing a link and a repository-relative path to existing Artefatos Indexados
- **When:** `ExtractMarkdownEvidence` analyzes the artifact
- **Then:** it emits distinct Evidence Records with normalized targets, syntax kinds and SourceLocations

#### Should extract Declarative Delegation with source-to-target direction

- **Given:** a skill declaration that assigns work to another named skill or agent represented by a unique ArtifactId
- **When:** Markdown Evidence is extracted and classified
- **Then:** a `delegates-to` Published Relationship points from the declaring artifact to the delegated artifact

#### Should reject a fenced import example as a code dependency

- **Given:** Markdown whose fenced or inline code example contains an import statement
- **When:** `ExtractMarkdownEvidence` analyzes the document
- **Then:** no `code-import` Evidence Record or `depends-on` Published Relationship is produced from that example

#### Should reject generic textual mentions as Proven Relationships

- **Given:** prose containing a generic term or repeated lexical coincidence without a unique Artifact Identity
- **When:** extraction, resolution and classification complete
- **Then:** the signal remains a rejected auditable outcome and does not enter confirmed traversal

#### Should resolve canonical path deterministically without per-evidence filesystem scans

- **Given:** a prebuilt Artifact Identity Index and many Evidence Records targeting the same canonical repository path
- **When:** `ResolveEvidenceTargets` runs
- **Then:** every target resolves to the same ArtifactId in bounded index lookups without rescanning the filesystem per mention

#### Should keep unresolved and ambiguous references outside published relationships

- **Given:** one Evidence Record with no target and another with multiple alias candidates
- **When:** `ClassifyRelationships` applies the versioned policy
- **Then:** neither creates a Published Relationship and both outcomes remain explainable in coverage and evidence results

#### Should keep Behavioral Hypothesis outside confirmed Blast Radius

- **Given:** a behavioral correlation between two contracts without an explicit structural relationship
- **When:** `ClassifyRelationships` and `AnalyzeGraphImpact` process the correlation
- **Then:** a Coupling Hypothesis is available separately and never increments confirmed dependent or dependency totals

#### Should aggregate duplicate evidence with bounded explanations

- **Given:** many equivalent Evidence Records supporting one Published Relationship
- **When:** classification and impact explanation are produced
- **Then:** the exact evidence count is retained while only a deterministic bounded sample of SourceLocations appears in the response

#### Should terminate deterministic traversal when relationships contain cycles

- **Given:** a Graph Snapshot whose confirmed relationships form a cycle
- **When:** `AnalyzeGraphImpact` traverses to the configured maximum depth
- **Then:** each ArtifactId is visited at most once per traversal path and results have stable ordering and totals

#### Should declare truncated impact when traversal budget is exhausted

- **Given:** a high-fanout Graph Snapshot whose traversal exceeds the explicit budget
- **When:** `AnalyzeGraphImpact` reaches the budget
- **Then:** the result is marked `truncated`, includes a warning and does not present partial totals as complete

#### Should return an explained path for every confirmed impact hit

- **Given:** a confirmed path composed of `references` and `delegates-to` relationships eligible under the Policy Version
- **When:** `AnalyzeGraphImpact` returns the affected artifact
- **Then:** its Impact Explanation identifies the typed path, grades, bounded evidence locations and Policy Version

#### Should carry no state between Impact Analyzer executions

- **Given:** two Graph Snapshots with different relationships and coverage
- **When:** `AnalyzeGraphImpact` runs sequentially against each snapshot
- **Then:** each result depends only on its supplied Graph Snapshot and request

### 1.4 Domain Events

#### Should emit ArtifactInventoryCompleted with reconciled counts

- **Given:** Artifact Inventory reaches terminal outcomes for all candidates
- **When:** inventory completes
- **Then:** `ArtifactInventoryCompleted` contains candidate id, inventory counts and failure count without evidence content

#### Should emit RelationshipEvidenceClassified with aggregate classifications

- **Given:** every Evidence Record has a classification outcome
- **When:** classification completes
- **Then:** `RelationshipEvidenceClassified` contains candidate id and exact proven, hypothesis and rejected counts

#### Should emit GraphSnapshotPublished only after durable publication

- **Given:** a valid Graph Snapshot candidate
- **When:** persistence commits and the hot graph swaps successfully
- **Then:** `GraphSnapshotPublished` contains graphId, Policy Version, statistics and coverage summary and is immutable

#### Should emit GraphSnapshotPublicationFailed without exposing evidence locations

- **Given:** candidate assembly or durable persistence fails
- **When:** publication aborts
- **Then:** `GraphSnapshotPublicationFailed` contains candidate id, stage and reason code while the prior snapshot remains authoritative

#### Should emit ImpactCoverageInsufficient for each unknown direction

- **Given:** dependency or dependent coverage cannot support a conclusive impact answer
- **When:** impact analysis produces `unknown`
- **Then:** `ImpactCoverageInsufficient` names graphId, node id, affected directions and reason codes without crossing tenant boundaries

## 2. Integration Tests

### 2.1 Snapshot and evidence repositories

#### Should persist and hydrate one complete tenant-scoped Graph Snapshot

- **Given:** a Graph Snapshot containing nodes, Published Relationships, Evidence Outcomes and Coverage Manifest for tenant Alpha
- **When:** `GraphSnapshotRepository` publishes and reloads it from SQLite
- **Then:** every member and the `graphId` match exactly and no tenant Beta data is visible

#### Should rebuild the same Graph Snapshot from the append-only mirror deterministically

- **Given:** a committed Graph v2 snapshot mirrored to JSONL with its Policy Version and coverage records
- **When:** the tenant state is rebuilt from the mirror
- **Then:** hydration produces the same canonical content and `graphId` without treating JSONL as an unrelated mixed-generation snapshot

#### Should reject old schema data rather than synthesize Graph v2 knowledge

- **Given:** persisted nodes-and-edges data without Graph v2 Coverage Manifest and snapshot identity
- **When:** the active snapshot is loaded
- **Then:** the data is rejected or scheduled for rebuild and is never projected as a qualified ImpactResponseV2

#### Should leave the active snapshot unchanged when publication fails mid-transaction

- **Given:** tenant Alpha has an active Graph Snapshot and a candidate publication fails while writing evidence or coverage
- **When:** the transaction rolls back
- **Then:** readers continue to hydrate the complete prior `graphId` and no candidate rows are visible

#### Should expose only the old or new graphId during concurrent rebuild

- **Given:** impact queries run while a new Graph Snapshot is being persisted for one tenant
- **When:** the durable transaction commits and the hot graph swaps
- **Then:** every reader observes a complete old or complete new snapshot and never mixed nodes, relationships, evidence or coverage

#### Should recompute unresolved and ambiguous outcomes during rebuild

- **Given:** an alias was ambiguous in the prior snapshot but repository content now resolves it uniquely
- **When:** rebuild inventories, extracts, resolves and classifies the current repository snapshot
- **Then:** the current outcome is resolved under the current Policy Version without carrying the stale ambiguity forward

### 2.2 Bootstrap and graph impact use cases

#### Should publish documentary relationships when bootstrapping a Markdown-heavy repository

- **Given:** a repository containing resolvable links, paths, Explicit Textual References and Declarative Delegations
- **When:** Graph v2 bootstrap executes inventory through atomic publication
- **Then:** the active Graph Snapshot contains typed documentary relationships, Evidence Outcomes and reconciled coverage

#### Should report unknown instead of zero when a relevant artifact cannot be analyzed

- **Given:** a relevant Markdown artifact is unreadable, excluded by a declared format rule or fails parsing
- **When:** `ServeGraphImpact` queries the affected direction
- **Then:** the response contains `unknown`, named reason codes, Coverage Manifest details and no unqualified zero conclusion

#### Should reject cursor from a previous graphId after rebuild

- **Given:** an ImpactCursorV2 issued for Graph Snapshot A and the same tenant now serving Graph Snapshot B
- **When:** `ServeGraphImpact` receives the old cursor
- **Then:** it returns the named stale-cursor error instead of continuing pagination against Graph Snapshot B

#### Should preserve tenant isolation for identical ArtifactIds

- **Given:** tenants Alpha and Beta each contain `skills/autonomous-orchestrator/SKILL.md` with different Graph Snapshots
- **When:** both tenants request impact and evidence explanations
- **Then:** each response uses only its tenant's graphId, coverage, relationships and SourceLocations

#### Should keep the MCP adapter semantically thin

- **Given:** an Impact Analyzer result with confirmed relationships, hypotheses, unknown coverage and warnings
- **When:** `ServeGraphImpact` serializes it
- **Then:** the MCP response preserves every classification and direction without promoting, rejecting or retyping evidence

### 2.3 External integration with HarnessKit

#### Should produce explained non-zero impact for the autonomous orchestrator skill

- **Given:** the verified HarnessKit corpus includes resolvable workflow references and Declarative Delegations involving `skills/autonomous-orchestrator/SKILL.md`
- **When:** OpenGraph bootstraps the corpus and queries impact for that ArtifactId
- **Then:** the relevant direction is `known-nonzero`, confirmed results include typed explanations, and the response no longer returns unqualified 0 dependents and 0 dependencies

#### Should classify each HarnessKit manifest case according to its declared evidence kind

- **Given:** a valid Markdown Impact Acceptance Manifest with path, workflow reference, delegation and non-relationship controls
- **When:** the OpenGraph acceptance integration consumes the external corpus
- **Then:** each positive case resolves to its expected relationship type and minimum grade while every exclusion remains outside confirmed traversal

#### Should fail the acceptance precondition when the HarnessKit corpus drifts

- **Given:** a manifest path or unique marker no longer exists in the checked-out HarnessKit snapshot
- **When:** the external acceptance flow begins
- **Then:** it stops with a named corpus-drift diagnostic rather than interpreting changed fixture facts as an OpenGraph regression

## 3. Functional Tests

### 3.1 Happy path flows

#### Should explain documentary blast radius when a caller queries a Markdown node

- **Given:** a tenant has a published Graph v2 snapshot with sufficient directional coverage and typed Markdown relationships
- **When:** the caller invokes `graph.impact` for a Markdown ArtifactId
- **Then:** ImpactResponseV2 includes graphId, directional ImpactKnowledge, confirmed totals, explained paths, separate hypotheses, coverage, warnings and a snapshot-bound cursor

#### Should rebuild deterministically when repository content is unchanged

- **Given:** one tenant bootstraps the same repository content twice under the same format and Relationship Classification policies
- **When:** both complete snapshots are published in sequence
- **Then:** the observable canonical graph content, relationship identities, evidence outcomes and `graphId` are identical

#### Should paginate stable impact results within one Graph Snapshot

- **Given:** a high-fanout explained Blast Radius spanning multiple pages under one graphId
- **When:** the caller follows each returned ImpactCursorV2
- **Then:** pages are deterministic, contain no duplicates or omissions and their totals remain bound to the same Graph Snapshot

### 3.2 Alternative and error flows

#### Should expose ambiguity without manufacturing a relationship

- **Given:** a Markdown reference resolves to multiple ArtifactIds
- **When:** the caller queries evidence and impact for its source artifact
- **Then:** the ambiguous outcome and candidates are explainable, no confirmed edge is traversed and insufficient directional coverage is not reported as known zero

#### Should preserve prior availability when rebuild fails

- **Given:** a tenant has a readable active Graph Snapshot and the next rebuild encounters a durable publication failure
- **When:** a caller invokes `graph.impact` during and after the failed rebuild
- **Then:** the prior graphId remains available and the failed candidate is reported only through publication diagnostics

#### Should reject malformed or tampered impact cursor

- **Given:** an opaque cursor whose integrity check or query hash is invalid
- **When:** the caller submits it to `graph.impact`
- **Then:** the request fails with a named cursor error and returns no results from another query or Graph Snapshot

### 3.3 Security and resilience scenarios

#### Should confine repository inventory to the configured root

- **Given:** a symlink, Markdown path or encoded target attempts to escape the repository root
- **When:** inventory or identity resolution processes it
- **Then:** the artifact is rejected with an auditable reason and no external file content or SourceLocation is exposed

#### Should redact sensitive Markdown content from evidence and events

- **Given:** a source line contains a credential adjacent to a valid reference
- **When:** evidence, impact explanation and lifecycle events are produced
- **Then:** only bounded normalized provenance is exposed and the credential and raw body are absent

#### Should remain within measured budget for the repository-scale corpus

- **Given:** the documented hostile, cyclic, ambiguous and high-fanout Markdown scale corpus
- **When:** bootstrap and explained impact probes execute
- **Then:** the run records elapsed time, memory, evidence aggregation, truncation and deterministic checks against the documented baseline without claiming an unsupported one-million-file SLO

#### Should bound adversarial evidence fanout

- **Given:** one Markdown artifact repeats the same resolvable reference enough times to exceed the explanation sample limit
- **When:** the Graph Snapshot is built and queried
- **Then:** processing retains the exact evidence count, bounds returned SourceLocations, respects traversal budget and produces deterministic warnings
