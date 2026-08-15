# Test Scenarios — harness-kit

**Domain:** `markdown_impact_relationships`  
**Project:** `harness-kit`  
**Framework:** Python unittest  
**Date:** 2026-08-15

Todos os cenários derivam de `003-harness-kit-tactical-design.md`. Eles verificam somente o corpus e seu contrato; nenhum cenário avalia lógica OpenGraph dentro do HarnessKit.

## 1. Unit Tests

### 1.1 Markdown Impact Acceptance Manifest

#### Should create Markdown Impact Acceptance Manifest when every case is valid

- **Given:** a positive CorpusContractVersion and ordered graph, horizon and exclusion cases with repository-relative paths and unique markers
- **When:** MarkdownImpactAcceptanceManifest validates the fixture
- **Then:** it returns the complete immutable contract without GraphSnapshotV2 or OpenGraph output

#### Should reject Markdown Impact Acceptance Manifest when CorpusContractVersion is not positive

- **Given:** a manifest with zero or negative CorpusContractVersion
- **When:** the manifest validates its schema
- **Then:** validation fails before repository facts are read

#### Should reject CorpusArtifactId when path is absolute or traversing

- **Given:** a Windows absolute path, POSIX absolute path or parent traversal
- **When:** CorpusArtifactId is validated
- **Then:** the case is rejected without reading outside HarnessKit

#### Should distinguish evidence, horizon and exclusion cases

- **Given:** a declarative delegation case, a microtask-to-persistent horizon input and a fenced import exclusion
- **When:** the manifest is loaded
- **Then:** each retains its own schema and none is converted into an OpenGraph decision

#### Should reject ExpectedEvidenceCase when marker is missing or ambiguous

- **Given:** a marker occurring zero times or more than once in its declared source
- **When:** VerifyMarkdownImpactCorpus locates it
- **Then:** it returns CorpusContractDrifted with deterministic case id and reason

#### Should reject ExpectedHorizonCase when payload label is absent

- **Given:** a horizon case with source and target labels but no payload kind
- **When:** the fixture schema is validated
- **Then:** validation fails without inferring ChangeContract, PromotionProposal or PersistentDelta

#### Should reject ExpectedNonRelationshipCase when rejection reason is absent

- **Given:** a fenced import marker with no declared exclusion reason
- **When:** the fixture schema is validated
- **Then:** validation fails rather than blessing the marker as evidence

### 1.2 Corpus integrity service

#### Should verify documentary evidence without invoking OpenGraph

- **Given:** manifest cases for path reference and Declarative Delegation targeting existing HarnessKit artifacts
- **When:** VerifyMarkdownImpactCorpus runs
- **Then:** it verifies paths and markers and imports no OpenGraph parser, client, graph, persistence or EAP module

#### Should verify four-horizon input labels without deciding outcomes

- **Given:** cases labeled negotiation-to-transformation, microtask-to-transformation, transformation-to-persistent and microtask-to-persistent
- **When:** VerifyMarkdownImpactCorpus runs
- **Then:** it confirms only declared markers and payload labels and does not decide admission or `HORIZON_SKIP`

#### Should verify contestation and recall markers as corpus facts

- **Given:** horizon cases labeled CONTEST and RECALL with unique source markers
- **When:** VerifyMarkdownImpactCorpus runs
- **Then:** it confirms marker integrity without creating an edge, contest store or stale-base state

#### Should verify fenced import control as source text only

- **Given:** an exclusion marker containing an import inside a Markdown code fence
- **When:** VerifyMarkdownImpactCorpus checks it
- **Then:** it confirms the unique text and leaves relationship rejection to OpenGraph acceptance tests

#### Should carry no state between corpus verifications

- **Given:** two HarnessKit roots with different contract versions and marker facts
- **When:** VerifyMarkdownImpactCorpus runs sequentially
- **Then:** each result reflects only its supplied manifest and repository

### 1.3 Corpus events

#### Should emit CorpusContractVerified with reconciled counts

- **Given:** every graph, horizon and exclusion case is valid
- **When:** verification completes
- **Then:** CorpusContractVerified contains contract version and exact counts and is immutable

#### Should emit CorpusContractDrifted without absolute paths

- **Given:** a declared path or marker is missing, ambiguous or unsafe
- **When:** verification fails
- **Then:** CorpusContractDrifted contains case id, reason and relative artifact id without credentials or absolute paths

## 2. Integration Tests

### 2.1 Manifest repository and repository reader

#### Should load only the configured acceptance manifest JSON

- **Given:** unrelated JSON files exist beside the configured fixture path
- **When:** MarkdownImpactCorpusManifest loads its input
- **Then:** only `tests/fixtures/open-graph/markdown-impact.expected.json` is accepted

#### Should return one repository-confined SourceLocation per marker

- **Given:** a valid manifest and unchanged HarnessKit source corpus
- **When:** HarnessKitRepositoryReader locates every marker
- **Then:** each resolves exactly once within the declared CorpusArtifactId

#### Should reject a symlink target outside HarnessKit

- **Given:** a declared artifact resolves through a symlink outside the repository root
- **When:** HarnessKitRepositoryReader validates confinement
- **Then:** it returns a named unsafe-artifact drift result before external content is read

#### Should fail verification atomically when one case drifts

- **Given:** all cases except one have valid paths and markers
- **When:** VerifyMarkdownImpactCorpus checks the complete contract
- **Then:** it returns CorpusContractDrifted and does not publish a partially verified case set

### 2.2 Acceptance corpus use case

#### Should validate autonomous orchestrator coupling facts

- **Given:** manifest references involving `skills/autonomous-orchestrator/SKILL.md` and workflow documentation
- **When:** VerifyMarkdownImpactCorpus runs against the current checkout
- **Then:** it confirms the exact source, target and markers required to reproduce the original Markdown 0/0 defect externally

#### Should validate false-positive controls independently from positive cases

- **Given:** valid positive references plus fenced import, generic mention and non-allowlisted JSON exclusions
- **When:** VerifyMarkdownImpactCorpus runs
- **Then:** each category is preserved with its own deterministic identity and no category changes another

#### Should validate horizon acceptance inputs without product logic

- **Given:** immediate promotion, skipped promotion, revalidation, authority non-transfer, contestation and recall/stale-base labels in the manifest
- **When:** VerifyMarkdownImpactCorpus runs
- **Then:** all required input facts are available for OpenGraph tests and HarnessKit produces no protocol verdict

## 3. Functional Tests

### 3.1 Happy path flows

#### Should provide a stable external acceptance corpus

- **Given:** natural HarnessKit skills, agents and workflow documents plus a valid versioned manifest
- **When:** a maintainer runs the Markdown impact corpus test
- **Then:** every graph, horizon and exclusion fixture fact is confirmed without modifying source documents or invoking OpenGraph

### 3.2 Alternative and error flows

#### Should explain corpus drift when a workflow marker changes

- **Given:** a workflow document no longer contains its declared unique marker
- **When:** the maintainer runs corpus verification
- **Then:** the test fails with case id, relative artifact and drift reason needed for intentional manifest update

#### Should preserve natural documents when contract version changes

- **Given:** an intentional semantic change requires a new CorpusContractVersion and marker
- **When:** the maintainer updates and verifies the manifest
- **Then:** only fixture contract and its test change while production-like Markdown remains natural

### 3.3 Security scenarios

#### Should prevent corpus verification from reading outside HarnessKit

- **Given:** a malicious manifest contains traversal, an absolute path or an escaping symlink
- **When:** HarnessKitRepositoryReader validates the case
- **Then:** it rejects the case before external content is read

#### Should exclude secrets and generated graph state from the manifest

- **Given:** a manifest candidate contains a tenant token, absolute local path, graphId-specific snapshot or generated OpenGraph response
- **When:** MarkdownImpactAcceptanceManifest validates the schema
- **Then:** validation fails and environment-specific data is not accepted as corpus input

#### Should keep HarnessKit free of OpenGraph product dependencies

- **Given:** the complete corpus verification test environment
- **When:** dependency and import boundaries are inspected during the test run
- **Then:** no OpenGraph parser, client, graph store, horizon host or promotion implementation is loaded
