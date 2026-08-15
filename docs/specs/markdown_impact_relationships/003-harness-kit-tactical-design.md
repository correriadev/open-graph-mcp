# Tactical Design — harness-kit

**Domain:** `markdown_impact_relationships`  
**Project:** `harness-kit`  
**Architecture role:** external acceptance corpus only; no OpenGraph product or horizon-host logic belongs here.

## Section 1 — Main Structure

HarnessKit preserves the natural Markdown topology that reproduces the original defect: `skills/autonomous-orchestrator/SKILL.md` is indexed but returns 0/0 despite workflow references and declarative couplings. The project supplies versioned corpus facts and negative controls; OpenGraph remains solely responsible for extraction, Graph v2, horizon isolation, promotion, contestation, recall and impact semantics.

| Element | Layer / Type | Invariants / Tech Rules | 4-line Snippet |
|---|---|---|---|
| HarnessKitSourceCorpus | Existing content | Skills, agents and workflows remain natural; never rewritten to satisfy an indexer. | Abaixo |
| MarkdownImpactAcceptanceManifest | Test fixture contract | Casos determinísticos de relação interna, escopo de horizonte esperado e exclusões; nenhuma regra OpenGraph. | Abaixo |
| CorpusIntegrityCheck | Python test support | Confirma caminhos/markers únicos e allowlist do manifest; não invoca OpenGraph. | Abaixo |

```text
HarnessKitSourceCorpus:
  skills; agents; workflowDocs; distributionMetadata
  // unchanged product-independent input
```

```text
MarkdownImpactAcceptanceManifest:
  graphCases; horizonCases; exclusions
  contractVersion
```

```text
CorpusIntegrityCheck:
  verify(manifest, repository): Result
  // validates facts, not graph behavior
```

### Boundary rules

- O manifest descreve fatos observáveis: source, target, marker, Evidence Kind, direção, minimum grade e Horizon Fixture Label.
- Casos de horizonte apenas rotulam entradas que o teste OpenGraph usará para provar isolamento, promoção imediata, revalidação, `HORIZON_SKIP`, authority non-transfer, contestation e stale base; HarnessKit não decide esses resultados.
- Imports cercados, termos genéricos e JSON fora da allowlist são controles negativos.
- Nenhum snapshot, token, tenant real, policy engine, parser, banco, endpoint ou operação EAP é implementado aqui.

## Section 2 — Value Objects / Types / Interfaces

| Name | Context / Layer | Validation & Typing Rules | 4-line Snippet |
|---|---|---|---|
| CorpusArtifactId | Fixture | Caminho POSIX relativo; deve existir; não pode escapar da raiz. | Abaixo |
| ExpectedEvidenceCase | Fixture | Source/target, kind, direction, minimumGrade e marker único. | Abaixo |
| ExpectedHorizonCase | Fixture | Label, source/target horizon labels, payload label e marker; declara entrada, não veredito. | Abaixo |
| ExpectedNonRelationshipCase | Fixture | Marker observável e razão esperada de exclusão. | Abaixo |
| CorpusContractVersion | Fixture | Inteiro positivo, alterado somente por mudança intencional de semântica do corpus. | Abaixo |

```text
type CorpusArtifactId = string
rule: repository-relative existing path
```

```text
type ExpectedEvidenceCase = {
  id; source; target; kind; direction; minimumGrade; marker
}
```

```text
type ExpectedHorizonCase = {
  id; sourceHorizon; targetHorizon; payloadKind; marker
}
```

```text
type ExpectedNonRelationshipCase = {
  id; source; marker; rejectionReason
}
```

```text
type CorpusContractVersion = int
rule: positive and intentionally versioned
```

## Section 3 — Domain Services / Use Cases / Actions

| Operation / Hook | Responsibility | Coordinates / Subscriptions | 4-line Snippet |
|---|---|---|---|
| VerifyMarkdownImpactCorpus | Verificar existência, confinamento e unicidade dos fatos declarados. | Manifest, repository reader | Abaixo |

```text
VerifyMarkdownImpactCorpus(manifest, root): Result
// no OpenGraph imports or inferred relationships
```

O serviço não classifica relações, não calcula coverage, não constrói GraphSnapshotV2, não determina Parent Topology e não simula admissão. Os testes end-to-end em `open-graph-mcp` consomem o manifest e fazem todas essas asserções.

## Section 4 — Events / Messages / Async Flows

Não há runtime ou fluxo assíncrono neste domínio no HarnessKit. O teste produz resultados síncronos locais.

| Event / Action Name | Trigger | Minimum Payload | Consumers |
|---|---|---|---|
| CorpusContractVerified | Todos os fatos são íntegros | `{ contractVersion, evidenceCount, horizonCaseCount, exclusionCount }` | Test report; OpenGraph acceptance precondition |
| CorpusContractDrifted | Path/marker ausente, ambíguo ou inseguro | `{ caseId, reasonCode, relativeArtifactId }` | Maintainer diagnostics |

## Section 5 — Persistence / Repository / Data Access Interfaces

O único estado persistido é o manifest JSON versionado. Ele não contém graphId, HorizonGraphScope real, credenciais, caminho absoluto, snapshot gerado ou resposta OpenGraph.

| Resource / Adapter | Methods / Actions | Return Types / Expected State |
|---|---|---|
| MarkdownImpactCorpusManifest | `load`; `validateSchema` | Contrato ordenado, versionado e sem campos de produto |
| HarnessKitRepositoryReader | `exists`; `findUniqueMarker` | Reads confinadas e falhas nomeadas |

```text
interface MarkdownImpactCorpusManifest:
  load(): CorpusContract
  validateSchema(): ValidationResult
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
    "title": "Define Markdown Impact Acceptance Manifest",
    "description": "Create a versioned fixture contract that pins natural HarnessKit documentary evidence, four-horizon input labels, and false-positive controls without encoding OpenGraph decisions.",
    "scope": [
      "tests/fixtures/open-graph/markdown-impact.expected.json",
      "tests/unit/test_markdown_impact_corpus.py"
    ],
    "acceptance": [
      "The manifest pins references and delegations involving the autonomous orchestrator skill",
      "The manifest includes fenced import, generic mention, and non-allowlisted JSON exclusions",
      "Horizon cases label immediate and skipped promotion inputs, contestation, recall, and revalidation without prescribing product algorithms"
    ],
    "depends_on": null
  },
  {
    "id": "02",
    "title": "Implement Corpus Integrity Verification",
    "description": "Validate every manifest path and unique marker atomically while keeping all OpenGraph parsing and horizon behavior outside HarnessKit.",
    "scope": [
      "tests/unit/test_markdown_impact_corpus.py",
      "tests/fixtures/open-graph/markdown-impact.expected.json"
    ],
    "acceptance": [
      "Missing, ambiguous, absolute, traversing, or symlink-escaped artifacts fail with deterministic drift reasons",
      "Only the configured acceptance manifest JSON is loaded",
      "The test imports no OpenGraph client, parser, policy, graph, persistence, or EAP implementation"
    ],
    "depends_on": "01"
  }
]
```
