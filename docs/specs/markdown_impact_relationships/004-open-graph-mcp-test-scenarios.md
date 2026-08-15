# Test Scenarios — open-graph-mcp

**Domain:** `markdown_impact_relationships`
**Project:** `open-graph-mcp`
**Framework:** Bun Test e Playwright
**Date:** 2026-08-15

Todos os cenários derivam de `003-open-graph-mcp-tactical-design.md`.

## 1. Unit Tests

### 1.1 GraphSnapshotV2 and Promotion aggregates

#### Should create GraphSnapshotV2 when every member shares one HorizonGraphScope

- **Given:** nodes, internal relationships, evidence, Coverage Manifest and Policy Version for tenant Alpha, negotiation horizon N1 and graph G1
- **When:** GraphSnapshotV2 is assembled
- **Then:** the immutable snapshot is created with scope Alpha/N1/G1

#### Should reject GraphSnapshotV2 when coverage belongs to another horizon

- **Given:** relationships for transformation horizon T1 and a Coverage Manifest for microtask horizon M1
- **When:** GraphSnapshotV2 is assembled
- **Then:** assembly fails before a graphId is published

#### Should reject GraphSnapshotV2 when an inter-horizon operation is supplied as an internal relationship

- **Given:** a candidate relationship typed `PROMOTE`, `CONTEST`, `RECALL`, `INITIATE` or `parent`
- **When:** GraphSnapshotV2 validates its relationship set
- **Then:** the candidate is rejected because only the four Graph v2 internal types are accepted

#### Should create Promotion in proposed state when envelope targets the immediate parent

- **Given:** a complete microtask PromotionEnvelope targeting its originating transformation with a PromotionProposal
- **When:** ProposePromotion validates the envelope
- **Then:** Promotion is created as `proposed` without any source authority field

#### Should reject Promotion with HORIZON_SKIP when microtask targets persistent

- **Given:** a microtask PromotionEnvelope whose target is the persistent horizon
- **When:** HorizonTopology validates the target
- **Then:** proposal fails with `HORIZON_SKIP` and no target candidate is created

#### Should keep source history unchanged when target refuses a Promotion

- **Given:** a proposed ChangeContract whose evidence is insufficient under the transformation policy
- **When:** ReceivePromotion records a refusal
- **Then:** the target transition is append-only and the negotiation snapshot and envelope remain unchanged

### 1.2 Value Objects and contracts

#### Should reject HorizonGraphScope when tenantId, horizonId or graphId is absent

- **Given:** a scope missing one member of the required triple
- **When:** HorizonGraphScope is created
- **Then:** validation fails with no default tenant, horizon or graph

#### Should exclude session from HorizonKind

- **Given:** the value `session`
- **When:** HorizonKind validates the value
- **Then:** validation fails while negotiation, microtask, transformation and persistent remain valid

#### Should reject ArtifactId when path escapes repository root

- **Given:** an absolute path or a normalized path containing parent traversal
- **When:** ArtifactId is created
- **Then:** validation fails without reading the external target

#### Should preserve EvidenceGrade independently from RelationshipType

- **Given:** grade A evidence classified as `references` and grade B evidence classified as `references`
- **When:** Published Relationships are created
- **Then:** each retains its own grade and neither is rewritten as `depends-on`

#### Should require every PromotionEnvelope field

- **Given:** an envelope missing provenance, evidenceIds, coverageSummary or Policy Version
- **When:** PromotionEnvelope is validated
- **Then:** validation fails before topology or reception is evaluated

#### Should reject PromotionPayload when source-target pair is incompatible

- **Given:** a PersistentDelta sent from negotiation to transformation
- **When:** PromotionPayload is validated against HorizonTopology
- **Then:** the payload is rejected and no Promotion is stored

#### Should consider two ImpactCursorV2 values unequal when horizonId differs

- **Given:** cursors with equal tenantId, graphId and query hash but different horizonIds
- **When:** cursor equality is evaluated
- **Then:** the cursors are not equal and cannot continue the same query

### 1.3 Domain services

#### Should extract Markdown links and delegations without executing fenced imports

- **Given:** Markdown containing a resolvable link, a declarative delegation and an import inside a code fence
- **When:** ExtractMarkdownEvidence runs
- **Then:** link and delegation evidence retain SourceLocation while the import is a rejected signal

#### Should classify behavioral evidence outside confirmed traversal

- **Given:** a behavioral correlation without structural evidence
- **When:** ResolveAndClassifyRelationships applies the horizon Policy Version
- **Then:** it emits `behavioral-hypothesis` with grade C and `traversable=false`

#### Should return known-zero only from sufficient local coverage

- **Given:** a persistent snapshot with complete relevant coverage and no eligible internal paths
- **When:** AnalyzeHorizonImpact evaluates both directions
- **Then:** it returns `known-zero` without consulting a child horizon Coverage Manifest

#### Should return unknown when Markdown analysis failed

- **Given:** a relevant Markdown artifact with a named read or parse failure in the local Coverage Manifest
- **When:** AnalyzeHorizonImpact evaluates the affected direction
- **Then:** it returns `unknown` with the failure reason instead of zero

#### Should receive promoted content as proposed and reclassify it locally

- **Given:** grade A negotiation evidence included in a ChangeContract and a transformation policy that classifies it as grade B `references`
- **When:** ReceivePromotion runs against the transformation snapshot
- **Then:** the candidate remains `proposed` until local grade B validation completes and no grade A authority is inherited

#### Should initiate negotiation and microtask without transferring authority

- **Given:** a session NegotiationSeed and a transformation WorkOrder with complete provenance
- **When:** InitiateHorizon registers each seed in its target horizon
- **Then:** negotiation and microtask contexts start `proposed` and contain no Relative Authority from their initiator

#### Should carry no state between ReceivePromotion executions

- **Given:** envelopes for two tenants with identical candidate ids and different target policies
- **When:** ReceivePromotion runs sequentially
- **Then:** each decision uses only its supplied target scope, policy and coverage

#### Should allow CONTEST to cross non-parent horizons with evidence

- **Given:** a persistent claim contested by microtask evidence
- **When:** ContestHorizonKnowledge validates the ContestEnvelope
- **Then:** the contest reaches the persistent target without `HORIZON_SKIP` and creates no internal relationship

#### Should mark derived promotions STALE_BASE after recall

- **Given:** a transformation Promotion derived from persistent base sequence 41
- **When:** RecallPersistentKnowledge admits proof and advances the base to sequence 42
- **Then:** MarkDerivedPromotionsStale appends `STALE_BASE` and preserves the original envelope

### 1.4 Domain events

#### Should emit HorizonInitiated after proposed context is registered

- **Given:** InitiateHorizon durably records a NegotiationSeed or WorkOrder
- **When:** HorizonInitiated is emitted
- **Then:** it identifies tenant, target horizon, target graph, seed kind and provenance reference without authority

#### Should emit GraphSnapshotV2Published with complete isolation scope

- **Given:** a durable snapshot commit and successful hot swap
- **When:** GraphSnapshotV2Published is emitted
- **Then:** it contains tenantId, horizonId, graphId, Policy Version and coverage summary and is immutable

#### Should emit PromotionAdmitted only after local revalidation

- **Given:** a target candidate that completed local resolution, classification, coverage and policy checks
- **When:** reception transitions it from proposed to admitted
- **Then:** PromotionAdmitted identifies target horizon, target graph and target Policy Version

#### Should emit PromotionBaseStaled without candidate content

- **Given:** a recall invalidates a derived Promotion
- **When:** PromotionBaseStaled is emitted
- **Then:** it contains promotion id, source graph and `STALE_BASE` reason without raw Markdown or mutated candidate data

#### Should emit HorizonKnowledgeContested without documentary edge fields

- **Given:** an evidence-backed ContestEnvelope accepted for delivery
- **When:** HorizonKnowledgeContested is emitted
- **Then:** it carries source scope, target scope and evidence ids and no RelationshipType

## 2. Integration Tests

### 2.1 Repositories and atomic publication

#### Should persist and hydrate one complete horizon-scoped GraphSnapshotV2

- **Given:** a GraphSnapshotV2 for tenant Alpha, transformation T1 and graph G1
- **When:** HorizonGraphRepository publishes and reloads it from SQLite
- **Then:** nodes, relationships, evidence, coverage, policy and scope match exactly

#### Should isolate identical graphId values across tenants and horizons

- **Given:** identical graphId text stored for Alpha/N1, Alpha/T1 and Beta/N1
- **When:** each active snapshot is loaded
- **Then:** every load returns only the exact tenant-horizon rows requested

#### Should rebuild the same scoped snapshot from JSONL deterministically

- **Given:** a committed Graph v2 snapshot mirrored append-only with scope and Policy Version
- **When:** the horizon state is rebuilt
- **Then:** it produces the same canonical content and graphId without treating JSONL as a complete unrelated snapshot

#### Should leave active snapshot unchanged when publication fails

- **Given:** graph G1 is active and publication of G2 fails while writing evidence or coverage
- **When:** serialTransaction rolls back
- **Then:** readers keep complete G1 and no G2 rows are visible

#### Should expose only old or new graphId during concurrent rebuild

- **Given:** impact queries run while G2 replaces G1 for one horizon
- **When:** publication commits and hot graph swaps
- **Then:** every query observes complete G1 or complete G2 with no mixed relationships, evidence or coverage

#### Should persist only one Promotion transition under concurrent reception

- **Given:** two receivers attempt to admit the same proposed Promotion version
- **When:** PromotionRepository compares expected state in serial transactions
- **Then:** one transition commits and the other receives a named conflict without duplicate event

### 2.2 Use cases and boundary flows

#### Should publish explained Markdown relationships in every selected horizon

- **Given:** the same Markdown-heavy repository is bootstrapped into negotiation and transformation with distinct policies
- **When:** BuildHorizonArtifactInventory through PublishHorizonGraph completes for each
- **Then:** each active GraphSnapshotV2 has independent relationships, evidence, coverage and Policy Version

#### Should promote negotiation content only to transformation

- **Given:** an AcceptedPredictiveHypothesis and ChangeContract admitted in negotiation
- **When:** ProposePromotion targets transformation
- **Then:** the target records proposed content and performs its own revalidation

#### Should promote microtask content only to its originating transformation

- **Given:** a PromotionProposal admitted in microtask M1 created by transformation T1
- **When:** ProposePromotion targets T1
- **Then:** T1 receives a proposed candidate and another transformation cannot receive it as parent

#### Should promote transformation content only to persistent

- **Given:** a PersistentDelta admitted in transformation T1 on a current base
- **When:** ProposePromotion targets persistent P1
- **Then:** P1 receives proposed content and admits it only after persistent policy and coverage validation

#### Should refuse direct negotiation-to-persistent promotion with HORIZON_SKIP

- **Given:** a ChangeContract envelope from negotiation whose target is persistent
- **When:** ProposePromotion validates Parent Topology
- **Then:** it logs `HORIZON_SKIP`, persists no target candidate and emits no PromotionAdmitted

#### Should prevent authority transfer across immediate promotion

- **Given:** a child candidate with Relative Authority and grade A evidence
- **When:** the immediate parent receives its PromotionEnvelope
- **Then:** authority is absent, status is proposed and local admission may refuse or reclassify the candidate

#### Should keep CONTEST outside the documentary graph

- **Given:** a negotiation artifact contests persistent knowledge with evidence
- **When:** ContestRepository and target service accept it
- **Then:** the contest is queryable in its own store and GraphSnapshotV2 relationships remain unchanged

#### Should block stale Promotion until explicit revalidation

- **Given:** recall changed the source base after a PromotionEnvelope was proposed
- **When:** reception attempts to admit the Promotion
- **Then:** it returns `STALE_BASE` and succeeds only after a new envelope or explicit revalidation against the current base

#### Should reject cursor from a prior graphId

- **Given:** an ImpactCursorV2 for graph G1 and active graph G2 in the same horizon
- **When:** ServeGraphImpactV2 decodes the cursor
- **Then:** it returns `CURSOR_GRAPH_STALE` with no G2 page

#### Should reject cursor from another horizonId

- **Given:** an ImpactCursorV2 issued for negotiation N1 and a query scoped to transformation T1
- **When:** ServeGraphImpactV2 decodes the cursor
- **Then:** it returns `CURSOR_HORIZON_MISMATCH` with no cross-horizon result

### 2.3 External HarnessKit corpus

#### Should replace the original Markdown 0/0 with explained knowledge

- **Given:** the verified HarnessKit corpus containing references and delegations involving `skills/autonomous-orchestrator/SKILL.md`
- **When:** OpenGraph publishes Graph v2 and queries that ArtifactId
- **Then:** relevant confirmed directions are `known-nonzero`, while any uncovered direction is `unknown` rather than unqualified 0/0

#### Should honor HarnessKit negative controls

- **Given:** fenced imports, generic mentions and non-allowlisted JSON pinned by the corpus manifest
- **When:** the Markdown pipeline builds its snapshot
- **Then:** those signals create no confirmed internal relationship and their exclusion outcomes remain explainable

#### Should fail acceptance precondition when HarnessKit corpus drifts

- **Given:** a pinned path or unique marker no longer exists
- **When:** the external acceptance flow begins
- **Then:** it stops with CorpusContractDrifted before interpreting drift as an OpenGraph regression

## 3. Functional Tests

### 3.1 Happy path flows

#### Should explain Markdown blast radius within one horizon

- **Given:** a tenant has a published scoped GraphSnapshotV2 with sufficient directional coverage
- **When:** a caller invokes `graph.impact` for a Markdown ArtifactId and horizonId
- **Then:** ImpactResponseV2 includes full scope, knowledge, typed paths, separate hypotheses, coverage, totals, warnings and scoped cursor

#### Should complete the four-horizon governed knowledge flow

- **Given:** a session initiates negotiation, transformation initiates a microtask and every local cycle produces valid evidence
- **When:** negotiation and microtask promote separately to transformation and transformation promotes a PersistentDelta to persistent
- **Then:** every receiver starts proposed, revalidates locally and only the persistent horizon gains persistent Relative Authority

#### Should contest urgent persistent knowledge without shortcut promotion

- **Given:** microtask execution finds evidence invalidating a persistent claim
- **When:** it submits CONTEST directly to persistent
- **Then:** the contest is delivered without `HORIZON_SKIP`, no PersistentDelta is admitted and no documentary edge is created

#### Should recover a stale promotion through explicit revalidation

- **Given:** recall marks a transformation-to-persistent Promotion `STALE_BASE`
- **When:** transformation rebases, regenerates evidence and submits a new envelope
- **Then:** the old envelope remains stale and the new proposed candidate may enter persistent validation

### 3.2 Alternative and error flows

#### Should expose unknown when relevant format coverage is incomplete

- **Given:** relevant JSON belongs to no configured allowlist family in the queried horizon
- **When:** a caller requests impact
- **Then:** response reports `unknown` with format exclusion warning and does not claim known zero

#### Should reject malformed or tampered scoped cursor

- **Given:** an opaque cursor with invalid integrity or query hash
- **When:** it is submitted to `graph.impact`
- **Then:** the request fails with a named cursor error and returns no data from another scope

#### Should preserve prior availability after failed rebuild

- **Given:** one complete horizon snapshot is active and its replacement fails durably
- **When:** impact queries continue
- **Then:** the prior graphId remains available and the failed candidate appears only in publication diagnostics

#### Should refuse skipped promotion without operator override

- **Given:** an operator approves a microtask-to-persistent shortcut
- **When:** ProposePromotion validates the target
- **Then:** it still returns `HORIZON_SKIP` because approval cannot replace the intermediate transformation cycle

### 3.3 Security and resilience scenarios

#### Should prevent tenant and horizon evidence leakage

- **Given:** Alpha/N1 and Beta/N1 contain equal ArtifactIds with different evidence and Alpha/T1 has another graph
- **When:** Alpha/N1 requests impact and evidence explanations
- **Then:** only Alpha/N1 data is returned and event correlation cannot expose Beta/N1 or Alpha/T1

#### Should confine inventory and resolution to repository root

- **Given:** a symlink or encoded Markdown path escapes the configured repository
- **When:** inventory or identity resolution processes it
- **Then:** the artifact is rejected with an auditable reason and external content is not read

#### Should redact sensitive Markdown from evidence and boundary events

- **Given:** a credential appears beside a valid reference
- **When:** evidence, impact, promotion and contestation outputs are produced
- **Then:** only bounded normalized provenance is exposed and the credential and raw body are absent

#### Should bound repeated evidence and cyclic traversal deterministically

- **Given:** a high-fanout cyclic corpus repeats the same resolvable reference beyond the explanation limit
- **When:** the graph is built and queried
- **Then:** exact evidence totals are retained, locations are bounded and truncation is explicitly named without claiming a one-million-file SLO
