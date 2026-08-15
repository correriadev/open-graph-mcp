# Tactical Design — open-graph-mcp

**Domain:** `markdown_impact_relationships`
**Project:** `open-graph-mcp`
**Architecture:** protocol core puro + reference host MCP + SQLite/JSONL
**Contract posture:** Graph v2 substitui v1; breaking changes são permitidas e não há clientes atuais.

## Section 1 — Main Structure

| Element | Layer / Type | Invariants / Tech Rules | 4-line Snippet |
|---|---|---|---|
| HorizonGraphScope | `graph-core` Value Object | Exige `tenantId`, `horizonId`, `graphId`; nenhuma parte do snapshot existe fora desse escopo. | Abaixo |
| ArtifactInventory | `graph-core` contract + `mcp-server` adapter | Conta elegíveis, excluídos, lidos, analisados e falhos; JSON só por allowlist. | Abaixo |
| MarkdownEvidenceExtractor | `graph-core` pure extractor | Extrator específico; imports cercados/inline não viram code import; preserva localização. | Abaixo |
| RelationshipClassifier | `graph-core` domain policy | Separa `depends-on`, `references`, `delegates-to` e `behavioral-hypothesis`; grade não implica tipo. | Abaixo |
| GraphSnapshotV2 | `graph-core` Aggregate Root | Snapshot atômico por escopo; relations, evidence, coverage e policy são inseparáveis. | Abaixo |
| HorizonTopology | `graph-core/eap` domain policy | Pai de promoção: negociação→transformação, microtask→transformação, transformação→persistente. | Abaixo |
| HorizonInitiation | `graph-core/eap` boundary contract | Sessão inicia negociação por NegotiationSeed; transformação inicia microtask por WorkOrder; contexto entra proposed e sem autoridade. | Abaixo |
| Promotion | `graph-core/eap` Aggregate | Envelope imutável; alvo deve ser pai imediato; estado recebido começa `proposed`. | Abaixo |
| PromotionReception | `mcp-server/eap` application service | Resolve, reclassifica e revalida sob policy/coverage do receptor; nunca copia autoridade. | Abaixo |
| ContestAndRecall | `graph-core/eap` + host services | CONTEST carrega evidência sem edge documental; recall/base change gera `STALE_BASE` por lineage. | Abaixo |
| SnapshotPublisher | `mcp-server` durable service | `serialTransaction`, sequência monotônica e hot swap; readers veem snapshot antigo ou novo. | Abaixo |
| ImpactAnalyzer | `graph-core` pure service | Travessia interna apenas; knowledge por direção; hipóteses ficam separadas. | Abaixo |
| GraphImpactAdapter | `mcp-server` thin MCP adapter | Carrega escopo completo e traduz erros nomeados sem reclassificar. | Abaixo |

```text
HorizonGraphScope:
  tenantId; horizonId; graphId
  rule: all three are required
```

```text
ArtifactInventory:
  artifacts; byFormat; failures
  rule: every eligible item terminates
```

```text
MarkdownEvidenceExtractor:
  extract(artifact): EvidenceRecord[]
  rule: fenced imports are rejected signals
```

```text
RelationshipClassifier:
  classify(evidence, policy): Outcome
  rule: hypotheses are never confirmed traversal
```

```text
GraphSnapshotV2:
  scope; nodes; relationships; evidence
  coverage; policyVersion
```

```text
HorizonTopology:
  parentOf(sourceHorizonId): HorizonId?
  rule: promotion crosses exactly one parent
```

```text
HorizonInitiation:
  initiate(seed): ProposedContext
  rule: provenance crosses, authority never does
```

```text
Promotion:
  envelope; status: proposed | admitted | refused
  rule: source authority is never a field
```

```text
PromotionReception:
  receive(envelope, targetSnapshot): Decision
  // resolve, reclassify, revalidate locally
```

```text
ContestAndRecall:
  contest(evidenceRefs); recall(proof)
  // lineage changes state, never history
```

```text
SnapshotPublisher:
  publish(scope, candidate): PublishedSnapshot
  // transaction then hot swap
```

```text
ImpactAnalyzer:
  analyze(snapshot, query): ExplainedImpact
  // internal relationships only
```

```text
GraphImpactAdapter:
  call(scope, query, cursor): ImpactResponseV2
  // named scope/cursor refusals
```

### Invariants

- Os quatro Horizons governados são negociação, microtask, transformação e persistente. Sessão só inicia negociação por `NegotiationSeed`.
- `INITIATE`, `PROMOTE`, `CONTEST`, `RECALL` e `parent` jamais aparecem em `PublishedRelationship`.
- `GraphSnapshotV2`, persistence rows, coverage, evidence, relationships, events, queries e cursores carregam `tenantId + horizonId + graphId`.
- `PromotionEnvelope` contém exatamente o contexto mínimo verificável e não possui campo de autoridade.
- Candidato recebido é `proposed`; admissão no receptor depende de resolução, classificação, Evidence Grade, Coverage Manifest e Policy Version locais.
- `CONTEST` pode atravessar o DAG com evidência. `RECALL` ou troca de base preserva histórico e marca derivações `STALE_BASE`.
- `known-zero` requer cobertura suficiente no horizonte consultado; cobertura/Grau A do filho não conta no pai.

## Section 2 — Value Objects / Types / Interfaces

| Name | Context / Layer | Validation & Typing Rules | 4-line Snippet |
|---|---|---|---|
| HorizonKind | EAP core | Closed union: negotiation, microtask, transformation, persistent; session excluded. | Abaixo |
| HorizonGraphScope | Graph core | Tríplice obrigatória e imutável; tenant/horizon non-empty. | Abaixo |
| ArtifactId | Inventory | Caminho POSIX relativo, normalizado, sem escape da raiz. | Abaixo |
| EvidenceRecord | Extraction | Id determinístico, source, kind, targetText, location; sem corpo bruto. | Abaixo |
| EvidenceGrade | Classification | `A`, `B`, `C`; ortogonal a tipo e autoridade. | Abaixo |
| RelationshipType | Graph v2 | União fechada de quatro relações internas. | Abaixo |
| CoverageManifest | Publication | Escopado; contagens reconciliáveis por formato/família e falhas nomeadas. | Abaixo |
| PolicyVersion | Classification | Identifica política do próprio horizonte; mudança requer novo snapshot/revalidação. | Abaixo |
| GraphSnapshotV2 | Publication | Content-addressed; todos membros compartilham o mesmo scope. | Abaixo |
| InitiationEnvelope | EAP boundary | NegotiationSeed ou WorkOrder com proveniência; conteúdo chega proposed e sem autoridade. | Abaixo |
| PromotionEnvelope | EAP boundary | Campos obrigatórios definidos; candidates/evidence não vazios; provenance completa. | Abaixo |
| PromotionPayload | EAP boundary | ChangeContract/AcceptedPredictiveHypothesis, PromotionProposal ou PersistentDelta conforme source/target. | Abaixo |
| PromotionStatus | EAP boundary | `proposed`, `admitted`, `refused`, `stale-base`; recepção inicia proposed. | Abaixo |
| ContestEnvelope | EAP boundary | Evidência referenciada e destino explícito; não exige parent imediato. | Abaixo |
| PromotionLineage | EAP boundary | Liga candidato a source graph/evidence/base sequence sem mutar origem. | Abaixo |
| ImpactKnowledge | Impact | `known-zero`, `known-nonzero`, `unknown(reasonCodes)`. | Abaixo |
| ImpactQueryV2 | Impact/MCP | Carrega HorizonGraphScope, nodeId, direção e paginação. | Abaixo |
| ImpactCursorV2 | MCP | Integridade e query hash; scope completo; erros distintos para graph/horizon stale. | Abaixo |

```text
type HorizonKind =
  'negotiation' | 'microtask' |
  'transformation' | 'persistent'
```

```text
type HorizonGraphScope = {
  tenantId; horizonId; graphId
}
```

```text
type ArtifactId = string
rule: relative POSIX path, no '..'
```

```text
type EvidenceRecord = {
  id; sourceId; kind; targetText; location
}
```

```text
type EvidenceGrade = 'A' | 'B' | 'C'
rule: no cross-horizon authority
```

```text
type RelationshipType = 'depends-on' | 'references' |
  'delegates-to' | 'behavioral-hypothesis'
```

```text
type CoverageManifest = {
  scope; byFormat; byFamily; failures
}
```

```text
type PolicyVersion = string
rule: owned by one horizon snapshot
```

```text
type GraphSnapshotV2 = {
  scope; policyVersion; nodes; relationships
  evidence; coverage
}
```

```text
type InitiationEnvelope = {
  sourceRef; targetHorizonId; seed; provenance
  // seed is NegotiationSeed or WorkOrder
}

```text
type PromotionEnvelope = {
  sourceHorizonId; sourceGraphId; targetHorizonId
  candidates; evidenceIds; coverageSummary; policyVersion; provenance
}
```

```text
type PromotionPayload =
  ChangeContract | AcceptedPredictiveHypothesis |
  PromotionProposal | PersistentDelta
```

```text
type PromotionStatus =
  'proposed' | 'admitted' | 'refused' | 'stale-base'
```

```text
type ContestEnvelope = {
  sourceScope; targetScope; evidenceIds; claimRefs
}
```

```text
type PromotionLineage = {
  promotionId; sourceGraphId; basedOnSeq; evidenceIds
}
```

```text
type ImpactKnowledge =
  KnownZero | KnownNonzero | UnknownReasons
```

```text
type ImpactQueryV2 = {
  scope; nodeId; directions; pageSize
}

```text
type ImpactCursorV2 = {
  tenantId; horizonId; graphId; queryHash; lastKeys
}
```

### Relationship and promotion matrices

| Evidence interna | Relação Graph v2 | Confirmed traversal |
|---|---|---:|
| Import resolvido | `depends-on` | Sim |
| Link/caminho Markdown resolvido | `references` | Conforme policy do horizonte |
| Delegação inequívoca | `delegates-to` | Sim |
| Correlação comportamental | `behavioral-hypothesis` | Não |
| Import cercado, genérico, unresolved/ambiguous | Nenhuma edge | Não |

| Source | Target obrigatório | Payload | Estado no receptor |
|---|---|---|---|
| negotiation | transformation | `ChangeContract`/`AcceptedPredictiveHypothesis` | `proposed` |
| microtask | transformation originadora | `PromotionProposal` | `proposed` |
| transformation | persistent | `PersistentDelta` | `proposed` |
| qualquer outro par | — | — | recusa `HORIZON_SKIP` |

## Section 3 — Domain Services / Use Cases / Actions

| Operation / Hook | Responsibility | Coordinates / Subscriptions | 4-line Snippet |
|---|---|---|---|
| BuildHorizonArtifactInventory | Inventariar formatos e coverage em um horizon scope. | Filesystem, format allowlist, ignore rules | Abaixo |
| ExtractMarkdownEvidence | Extrair sinais Markdown sem interpretar exemplos como código. | Markdown parser, Artifact Identity Index | Abaixo |
| ResolveAndClassifyRelationships | Resolver identidades e aplicar policy do horizonte. | Evidence records, identity index, Policy Version | Abaixo |
| AssembleGraphSnapshotV2 | Ordenar e endereçar conteúdo do snapshot completo. | Relationships, evidence, coverage | Abaixo |
| PublishHorizonGraph | Persistir e ativar snapshot atômico. | SQLite, JSONL mirror, hot registry | Abaixo |
| InitiateHorizon | Registrar seed como proposed no novo horizonte sem autoridade herdada. | Session/transform reference, target host, provenance | Abaixo |
| ProposePromotion | Validar pai, payload, provenance e base antes de registrar envelope. | HorizonTopology, source snapshot, lineage store | Abaixo |
| ReceivePromotion | Recriar decisão no target como proposed. | Target snapshot/policy/coverage, classifier | Abaixo |
| ContestHorizonKnowledge | Entregar evidência a qualquer destino permitido sem edge documental. | Contest store, evidence repository | Abaixo |
| RecallPersistentKnowledge | Registrar proof e avançar base persistente. | Recall closure, sequence allocator | Abaixo |
| MarkDerivedPromotionsStale | Marcar lineage afetada como `STALE_BASE`. | Recall/base events, promotion repository | Abaixo |
| AnalyzeHorizonImpact | Consultar relações internas com coverage local. | GraphSnapshotV2, traversal policy | Abaixo |
| ServeGraphImpactV2 | Validar scope/cursor e serializar resposta/refusas. | Tenant resolution, cursor codec, analyzer | Abaixo |

```text
BuildHorizonArtifactInventory(scope, root, policy): Inventory
// terminal outcome for every eligible artifact
```

```text
ExtractMarkdownEvidence(artifact): EvidenceRecord[]
// fences and inline examples are non-code
```

```text
ResolveAndClassifyRelationships(scope, evidence): Outcomes
// policy belongs to this horizon
```

```text
AssembleGraphSnapshotV2(parts): GraphSnapshotV2
// canonical sort and content graphId
```

```text
PublishHorizonGraph(scope, candidate): Result
// serial transaction then hot swap
```

```text
InitiateHorizon(envelope): ProposedContext
// NegotiationSeed or WorkOrder, no authority
```

```text
ProposePromotion(envelope): Result
// target must equal topology parent
```

```text
ReceivePromotion(envelope, target): Decision
// proposed then locally revalidated
```

```text
ContestHorizonKnowledge(contest): Result
// evidence travels, documentary edges do not
```

```text
RecallPersistentKnowledge(proof): RecallResult
// advance seq and calculate closure
```

```text
MarkDerivedPromotionsStale(baseEvent): count
// append state transition, preserve history
```

```text
AnalyzeHorizonImpact(snapshot, query): ExplainedImpact
// local coverage determines knowledge
```

```text
ServeGraphImpactV2(scope, args): ImpactResponseV2
// thin adapter with named cursor errors
```

## Section 4 — Events / Messages / Async Flows

| Event / Action Name | Trigger | Minimum Payload | Consumers |
|---|---|---|---|
| ArtifactInventoryCompleted | Coverage reconciliada | `{ tenantId, horizonId, candidateGraphId, counts, failureCount }` | Build telemetry |
| RelationshipEvidenceClassified | Outcomes fechados | `{ tenantId, horizonId, candidateGraphId, proven, hypotheses, rejected }` | Build telemetry |
| GraphSnapshotV2Published | Commit e hot swap concluídos | `{ tenantId, horizonId, graphId, policyVersion, coverageSummary }` | SSE, resources, audit |
| GraphSnapshotV2PublicationFailed | Build/persistência falha | `{ tenantId, horizonId, candidateGraphId, stage, reasonCode }` | Diagnostics |
| HorizonInitiated | Seed registrado como proposed | `{ tenantId, targetHorizonId, targetGraphId, seedKind, provenanceRef }` | Target workflow, audit |
| PromotionProposed | Envelope validado na origem | `{ promotionId, tenantId, sourceHorizonId, sourceGraphId, targetHorizonId }` | Target receiver, audit |
| PromotionReceived | Target registra proposed | `{ promotionId, tenantId, targetHorizonId, targetGraphId, status }` | Reception workflow |
| PromotionAdmitted | Revalidação local completa | `{ promotionId, tenantId, targetHorizonId, targetGraphId, policyVersion }` | Lineage, audit |
| PromotionRefused | Policy/topology/base falha | `{ promotionId, tenantId, targetHorizonId, targetGraphId, reasonCode }` | Client, audit |
| HorizonKnowledgeContested | Contest entregue | `{ contestId, sourceScope, targetScope, evidenceIds }` | Target host |
| PersistentKnowledgeRecalled | Recall admitido | `{ recallId, tenantId, horizonId, graphId, newSeq }` | Lineage projector |
| PromotionBaseStaled | Derivação atingida | `{ promotionId, tenantId, sourceHorizonId, sourceGraphId, reasonCode: STALE_BASE }` | Promotion workflow |
| ImpactCoverageInsufficient | Knowledge é unknown | `{ tenantId, horizonId, graphId, nodeId, directions, reasonCodes }` | Audit, response telemetry |

Todos os eventos carregam o escopo suficiente para impedir correlação cross-tenant/cross-horizon. Eventos inter-horizonte referenciam evidência; nunca inserem `INITIATE`, `PROMOTE`, `CONTEST`, `RECALL` ou `parent` no conjunto de relações documentais.

## Section 5 — Persistence / Repository / Data Access Interfaces

| Resource / Adapter | Methods / Actions | Return Types / Expected State |
|---|---|---|
| RepositorySnapshotReader | `inventory`; `read` | Reads confinadas e outcomes tipados |
| HorizonGraphRepository | `publish`; `loadActive`; `findById` | Snapshot completo por tenant+horizon+graph |
| EvidenceRepository | `listByRelationship`; `listOutcomesByArtifact` | Evidência no mesmo scope |
| CoverageRepository | `getManifest` | Manifest exato do snapshot/horizonte |
| HorizonTopologyRepository | `loadDeclaredTopology` | DAG declarado e versionado |
| PromotionRepository | `propose`; `receive`; `transition`; `findDerivedFrom` | Envelope/lineage append-only e estado atual |
| ContestRepository | `append`; `listForTarget` | Contestação separada do grafo documental |
| RecallRepository | `append`; `loadClosure` | Proof, closure e seq persistente |
| ImpactCursorCodec | `encode`; `decodeAndVerify` | Cursor íntegro e escopado |

```text
interface HorizonGraphRepository:
  publish(scope, snapshot): void
  loadActive(tenantId, horizonId): GraphSnapshotV2?
```

```text
interface EvidenceRepository:
  listByRelationship(scope, id): EvidenceSummary[]
  listOutcomesByArtifact(scope, id): Outcome[]
```

```text
interface CoverageRepository:
  getManifest(scope): CoverageManifest
  // missing manifest invalidates hydration
```

```text
interface HorizonTopologyRepository:
  loadDeclaredTopology(tenantId): HorizonTopology
```

```text
interface PromotionRepository:
  propose(envelope): Promotion
  transition(id, expected, next): Promotion
```

```text
interface ContestRepository:
  append(contest): void
  listForTarget(scope): ContestEnvelope[]
```

```text
interface RecallRepository:
  append(recall): void
  loadClosure(recallId): RecallClosure
```

```text
interface ImpactCursorCodec:
  encode(cursor): string
  decodeAndVerify(raw, scope): ImpactCursorV2
```

### Physical schema direction

- Todas as tabelas v2 de snapshots, nodes, relationships, evidence, coverage e query metadata usam `tenant_id`, `horizon_id`, `graph_id`.
- Promotion/contest/recall usam stores próprios e referências de scope; não reutilizam tabela de edges.
- `PromotionEnvelope` e lineage preservam source graph, evidence, coverage summary, policy version, provenance e based-on sequence.
- SQLite é fonte durável; JSONL é mirror append-only e não snapshot completo. Publicação ocorre em `serialTransaction` com `allocateSequence`.
- Não existe reader v1 nem síntese de coverage v2. Banco de desenvolvimento antigo é recusado ou rebuilt.
- Cursor com graphId anterior retorna `CURSOR_GRAPH_STALE`; cursor de outro horizonId retorna `CURSOR_HORIZON_MISMATCH`.

## Section 6 — Ordered Development Tasks

```json
[
  {
    "id": "01",
    "title": "Define Horizon-Scoped Graph V2 Contracts",
    "description": "Replace Graph v1 with immutable tenant-horizon-graph scoped contracts for snapshots, relationships, evidence, coverage, impact knowledge, and cursors.",
    "scope": ["packages/graph-core/src/build.ts", "packages/graph-core/src/relationship-types.ts", "packages/graph-core/test/build-v2.test.ts", "packages/graph-core/test/relationship-types.test.ts"],
    "acceptance": ["Every GraphSnapshotV2 member carries one HorizonGraphScope", "Internal relationship types exclude all horizon boundary operations", "No v1 compatibility union or ambiguous 0/0 response remains"],
    "depends_on": null
  },
  {
    "id": "02",
    "title": "Implement Horizon Coverage Inventory",
    "description": "Account for every eligible artifact and configured format independently in each horizon.",
    "scope": ["packages/graph-core/src/inventory.ts", "packages/graph-core/test/inventory.test.ts", "packages/mcp-server/src/tools/graph-bootstrap.ts"],
    "acceptance": ["Eligible artifacts terminate as analyzed or failed with a reason", "Coverage is isolated by tenantId and horizonId", "Only configured JSON families enter inventory"],
    "depends_on": "01"
  },
  {
    "id": "03",
    "title": "Implement Markdown Evidence Extraction",
    "description": "Extract links, paths, explicit symbols, and declarative delegations with deterministic provenance while rejecting Markdown examples as code dependencies.",
    "scope": ["packages/graph-core/src/extract-markdown.ts", "packages/graph-core/test/extract-markdown.test.ts", "packages/graph-core/src/extract.ts"],
    "acceptance": ["Fenced and inline example imports create no code-import edge", "Signals retain bounded SourceLocation", "Generic mentions remain rejected outcomes"],
    "depends_on": "02"
  },
  {
    "id": "04",
    "title": "Implement Scoped Relationship Classification",
    "description": "Resolve identities and classify the four internal relationship types under the current horizon policy.",
    "scope": ["packages/graph-core/src/resolve.ts", "packages/graph-core/src/relationship-policy.ts", "packages/graph-core/test/classify-relationships.test.ts"],
    "acceptance": ["depends-on, references, delegates-to, and behavioral-hypothesis remain distinct", "Evidence Grades are preserved without implying authority", "Unresolved and ambiguous evidence creates no confirmed edge"],
    "depends_on": "03"
  },
  {
    "id": "05",
    "title": "Assemble Atomic Graph V2 Snapshots",
    "description": "Compose canonical nodes, internal relationships, evidence, policy, and coverage into one content-addressed horizon snapshot.",
    "scope": ["packages/graph-core/src/build.ts", "packages/graph-core/src/graph-checksum.ts", "packages/graph-core/test/build-v2.test.ts"],
    "acceptance": ["Identical scoped input produces identical graphId", "Coverage and relationships cannot be assembled from different graphIds", "Conflicting evidence remains observable"],
    "depends_on": "04"
  },
  {
    "id": "06",
    "title": "Migrate Horizon Snapshot Persistence",
    "description": "Persist and hydrate Graph v2 atomically with tenant, horizon, and graph isolation in SQLite and the append-only mirror.",
    "scope": ["packages/mcp-server/src/db.ts", "packages/mcp-server/src/store.ts", "packages/mcp-server/test/graph-snapshot-persistence.test.ts", "packages/mcp-server/test/rebuild-from-jsonl.test.ts"],
    "acceptance": ["Readers observe complete old or new snapshots only", "Cross-tenant and cross-horizon hydration is impossible", "Old schema is rejected or rebuilt instead of projected as v2"],
    "depends_on": "05"
  },
  {
    "id": "07",
    "title": "Declare Promotion Parent Topology",
    "description": "Encode the normative promotion DAG separately from the internal graph and cell DAG.",
    "scope": ["packages/graph-core/src/eap/horizon.ts", "packages/graph-core/src/eap/promotion.ts", "packages/graph-core/test/horizon.test.ts"],
    "acceptance": ["Negotiation and microtask name transformation as parent and transformation names persistent", "Session is excluded from promotion parents", "Any non-parent target returns HORIZON_SKIP"],
    "depends_on": "01"
  },
  {
    "id": "08",
    "title": "Define Boundary Envelope Contracts",
    "description": "Create typed initiation and promotion envelopes for NegotiationSeed, WorkOrder, ChangeContract, AcceptedPredictiveHypothesis, PromotionProposal, and PersistentDelta.",
    "scope": ["packages/graph-core/src/eap/promotion.ts", "packages/graph-core/src/eap/types.ts", "packages/graph-core/test/eap-types.test.ts"],
    "acceptance": ["Initiation seeds enter proposed with provenance while PromotionEnvelope requires all specified source, target, evidence, coverage, policy, and provenance fields", "Neither contract exposes source authority", "Payload kind is valid only for its declared initiation or immediate promotion pair"],
    "depends_on": "07"
  },
  {
    "id": "09",
    "title": "Implement Promotion Reception Revalidation",
    "description": "Receive promoted candidates as proposed and rerun resolution, classification, coverage, and policy checks in the target horizon.",
    "scope": ["packages/mcp-server/src/eap/promotion-service.ts", "packages/mcp-server/src/eap/horizon-store.ts", "packages/mcp-server/test/eap-promotion-reception.test.ts"],
    "acceptance": ["Every received candidate starts proposed", "Grade A or admission in the child never auto-admits in the parent", "Target policy can reclassify or refuse without mutating source history"],
    "depends_on": "08"
  },
  {
    "id": "10",
    "title": "Separate Contestation From Documentary Edges",
    "description": "Allow evidence-backed CONTEST across horizon topology without adding an internal Graph v2 relationship.",
    "scope": ["packages/graph-core/src/eap/contestation.ts", "packages/mcp-server/src/eap/contestation-service.ts", "packages/mcp-server/test/eap-contestation.test.ts"],
    "acceptance": ["CONTEST can target non-parent horizons with evidence", "No contest creates depends-on, references, delegates-to, or behavioral-hypothesis", "Tenant and horizon evidence isolation is enforced"],
    "depends_on": "08"
  },
  {
    "id": "11",
    "title": "Propagate Recall Stale Base State",
    "description": "Project recall and base changes onto derived promotion lineage as explicit STALE_BASE transitions.",
    "scope": ["packages/graph-core/src/eap/recall.ts", "packages/mcp-server/src/eap/recall-projection.ts", "packages/mcp-server/test/eap-recall-stale-base.test.ts"],
    "acceptance": ["Affected promotions become STALE_BASE after recall or base change", "Historical envelope content is never silently rewritten", "Promotion remains blocked until explicit rebase or revalidation"],
    "depends_on": "09"
  },
  {
    "id": "12",
    "title": "Implement Horizon Impact Knowledge",
    "description": "Calculate explained internal blast radius with local coverage and separate behavioral hypotheses.",
    "scope": ["packages/graph-core/src/impact.ts", "packages/graph-core/test/impact.test.ts", "packages/graph-core/test/impact-properties.test.ts"],
    "acceptance": ["Known zero requires sufficient coverage in the queried horizon", "Hypotheses never inflate confirmed totals", "Cycles and traversal budgets produce deterministic named outcomes"],
    "depends_on": "06"
  },
  {
    "id": "13",
    "title": "Replace Graph Impact MCP Contract",
    "description": "Expose scoped ImpactResponseV2 and integrity-checked pagination through a semantically thin adapter.",
    "scope": ["packages/mcp-server/src/tools/graph-impact.ts", "packages/mcp-server/test/graph-impact.test.ts", "packages/mcp-server/test/graph-impact-cursor.test.ts"],
    "acceptance": ["Every response includes tenantId, horizonId, graphId, knowledge, coverage, explanations, totals, and warnings", "Stale graph cursor returns CURSOR_GRAPH_STALE", "Wrong horizon cursor returns CURSOR_HORIZON_MISMATCH"],
    "depends_on": "12"
  },
  {
    "id": "14",
    "title": "Wire Scoped Lifecycle Events",
    "description": "Emit snapshot, promotion, contestation, recall, stale-base, and impact events with complete isolation scope.",
    "scope": ["packages/mcp-server/src/eap/services.ts", "packages/graph-core/src/events-snapshot.ts", "packages/mcp-server/test/eap-events-scope.test.ts"],
    "acceptance": ["Every event carries tenantId and the relevant horizonId and graphId", "Boundary events never appear as documentary relationships", "Retries do not duplicate committed transitions"],
    "depends_on": "11"
  },
  {
    "id": "15",
    "title": "Validate HarnessKit Markdown Acceptance",
    "description": "Exercise the complete Graph v2 pipeline against the external HarnessKit corpus and its negative controls.",
    "scope": ["packages/mcp-server/test/graph-impact-markdown-integration.test.ts", "packages/mcp-server/test/fixtures/markdown-impact", "packages/mcp-server/test/graph-bootstrap-markdown.test.ts"],
    "acceptance": ["The autonomous orchestrator node no longer returns an unqualified 0/0", "Fenced imports and generic mentions remain non-relationships", "Unreadable or excluded relevant inputs produce unknown rather than known-zero"],
    "depends_on": "13"
  },
  {
    "id": "16",
    "title": "Verify Four-Horizon Boundary Flows",
    "description": "Run deterministic conformance flows covering immediate promotion, authority non-transfer, contestation, and stale-base recovery.",
    "scope": ["packages/mcp-server/test/eap-four-horizon-conformance.test.ts", "packages/graph-core/test/eap-lifecycle.test.ts", "packages/mcp-server/test/eap-refusals.test.ts"],
    "acceptance": ["All three promotion edges succeed only through their immediate parent", "Microtask-to-persistent promotion logs HORIZON_SKIP", "Revalidation, authority non-transfer, CONTEST, and STALE_BASE are observable by log"],
    "depends_on": "15"
  }
]
```
