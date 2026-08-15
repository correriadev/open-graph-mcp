# Test Scenarios — harness-kit

**Domain:** `markdown_impact_relationships`  
**Project:** `harness-kit`  
**Framework:** Python unittest  
**Date:** 2026-08-15

## 1. Unit Tests

### 1.1 Markdown Impact Acceptance Manifest

#### Should create Markdown Impact Acceptance Manifest when every case is valid

- **Given:** a positive CorpusContractVersion, deterministic case ids, repository-relative source and target paths, Evidence Kinds, directions, minimum grades and unique markers
- **When:** the Markdown Impact Acceptance Manifest is loaded
- **Then:** it exposes the complete ordered positive and exclusion case sets without embedding OpenGraph output

#### Should reject Markdown Impact Acceptance Manifest when CorpusContractVersion is not positive

- **Given:** a manifest with zero or negative CorpusContractVersion
- **When:** the fixture contract is validated
- **Then:** validation fails before corpus facts are inspected

#### Should reject CorpusArtifactId when it is absolute or escapes the repository

- **Given:** a source or target path that is absolute or contains parent traversal outside HarnessKit
- **When:** CorpusArtifactId is validated
- **Then:** the acceptance case is rejected without reading outside the repository

#### Should distinguish ExpectedEvidenceCase from ExpectedNonRelationshipCase

- **Given:** one case declaring a resolvable Declarative Delegation and another declaring a fenced import example
- **When:** the fixture contract is loaded
- **Then:** the first requires source, target, kind, direction and minimum grade while the second requires marker and rejection reason and neither is converted into OpenGraph logic

#### Should reject ExpectedEvidenceCase when its stable marker is absent

- **Given:** a positive acceptance case whose declared source exists but whose unique marker is absent
- **When:** `VerifyMarkdownImpactCorpus` validates the case
- **Then:** it returns `CorpusContractDrifted` with the deterministic case id and marker reason

#### Should reject ExpectedEvidenceCase when its marker is ambiguous

- **Given:** a positive acceptance case whose marker occurs more than once in the declared source
- **When:** `VerifyMarkdownImpactCorpus` locates the marker
- **Then:** it returns a named ambiguous-marker drift result rather than choosing a location

### 1.2 Corpus integrity service

#### Should verify representative documentary evidence without invoking OpenGraph

- **Given:** manifest cases for an explicit path, workflow reference and Declarative Delegation targeting existing HarnessKit artifacts
- **When:** `VerifyMarkdownImpactCorpus` runs against the repository root
- **Then:** it verifies paths and unique markers and returns `CorpusContractVerified` without importing an OpenGraph parser or graph client

#### Should verify a fenced import false-edge control as source text only

- **Given:** an ExpectedNonRelationshipCase whose unique marker is an import inside a Markdown code fence
- **When:** `VerifyMarkdownImpactCorpus` checks the corpus
- **Then:** it confirms only that the marker exists and leaves rejection as a code dependency to the OpenGraph acceptance test

#### Should carry no state between corpus verifications

- **Given:** two separate HarnessKit checkouts with different manifest facts
- **When:** `VerifyMarkdownImpactCorpus` runs sequentially for both roots
- **Then:** each result reflects only its supplied manifest and repository without cached paths or markers

### 1.3 Corpus events

#### Should emit CorpusContractVerified with immutable aggregate counts

- **Given:** every declared path and unique marker is valid
- **When:** corpus verification succeeds
- **Then:** `CorpusContractVerified` contains CorpusContractVersion and exact case count and cannot be mutated after creation

#### Should emit CorpusContractDrifted with no absolute path

- **Given:** one declared artifact or marker is missing or ambiguous
- **When:** corpus verification fails
- **Then:** `CorpusContractDrifted` contains case id and reason code without tenant credentials, absolute paths or graph state

## 2. Integration Tests

### 2.1 Manifest repository and repository reader

#### Should load the version-controlled manifest with deterministic case identities

- **Given:** `tests/fixtures/open-graph/markdown-impact.expected.json` in a HarnessKit checkout
- **When:** `MarkdownImpactCorpusManifest` loads it
- **Then:** all positive and exclusion cases retain deterministic ids, semantic labels and repository-relative paths

#### Should return a unique SourceLocation for every pinned marker

- **Given:** a valid manifest and unchanged HarnessKit Source Corpus
- **When:** `HarnessKitRepositoryReader` reads each declared artifact and locates its marker
- **Then:** every marker resolves to exactly one repository-confined SourceLocation

#### Should report absence when a declared target no longer exists

- **Given:** a manifest case pointing to a missing CorpusArtifactId
- **When:** the repository reader verifies target existence
- **Then:** it returns a named missing-artifact result without retrying, inferring an alternative or scanning outside the root

#### Should reject non-allowlisted JSON as acceptance input

- **Given:** HarnessKit contains unrelated distribution JSON beside the configured Markdown Impact Acceptance Manifest
- **When:** the corpus fixture loader discovers its input
- **Then:** only the versioned manifest is loaded and unrelated JSON is not treated as evidence or a relationship fixture

### 2.2 VerifyMarkdownImpactCorpus use case

#### Should validate the autonomous orchestrator acceptance facts

- **Given:** the manifest pins resolvable workflow references and Declarative Delegations involving `skills/autonomous-orchestrator/SKILL.md`
- **When:** `VerifyMarkdownImpactCorpus` runs against the current HarnessKit checkout
- **Then:** it confirms the pinned source, target and unique markers needed for OpenGraph to test that the orchestrator no longer yields an unqualified 0/0 result

#### Should fail atomically when any manifest fact drifts

- **Given:** all but one manifest case are valid and one marker has drifted
- **When:** the complete corpus contract is verified
- **Then:** the verification fails as a whole with `CorpusContractDrifted` and does not publish a partially verified case set

## 3. Functional Tests

### 3.1 Happy path flows

#### Should provide a stable external acceptance corpus when a maintainer runs the fixture test

- **Given:** natural HarnessKit skills, agents, workflow documents and distribution metadata plus a valid versioned manifest
- **When:** the maintainer runs the HarnessKit Markdown impact corpus test
- **Then:** the report confirms every positive and non-relationship fixture fact without modifying the source corpus or invoking OpenGraph

### 3.2 Alternative and error flows

#### Should explain corpus drift when a referenced workflow changes

- **Given:** a workflow document no longer contains the unique marker declared by its ExpectedEvidenceCase
- **When:** the maintainer runs the corpus integrity test
- **Then:** the test fails with the case id, repository-relative artifact and drift reason needed to update the manifest intentionally

#### Should preserve natural source documents when the fixture contract changes

- **Given:** an intentional semantic change requires a new CorpusContractVersion and marker
- **When:** the maintainer updates and verifies the manifest
- **Then:** only the version-controlled fixture contract changes and HarnessKit source documents are not rewritten to satisfy an indexer

### 3.3 Security scenarios

#### Should prevent corpus verification from reading outside HarnessKit

- **Given:** a malicious manifest contains traversal, an absolute path or a symlink target outside the repository
- **When:** `HarnessKitRepositoryReader` validates the CorpusArtifactId
- **Then:** verification rejects the case before external content is read

#### Should exclude credentials and generated graph state from the manifest

- **Given:** a manifest candidate contains a tenant token, absolute local path or generated OpenGraph snapshot
- **When:** the fixture contract is validated
- **Then:** validation fails and the sensitive or environment-specific field is not accepted as corpus data
