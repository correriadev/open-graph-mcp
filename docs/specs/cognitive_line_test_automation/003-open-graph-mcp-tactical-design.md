# Tactical Design — open-graph-mcp

**Domain:** `cognitive_line_test_automation` | **Project:** `open-graph-mcp` | **Language:** English
**Date:** 2026-08-12

## Scope and Status Discipline

This solution-space model designs the **automated-verification system** for the already-implemented `cognitive_line` domain (feature F001, EAP). It adds no EAP behaviour: the EAP aggregates modelled in `docs/specs/cognitive_line/003` are **upstream, frozen, read-only collaborators** (Conformist, per `002` §2.3). Every element below belongs to the quality/verification subdomain.

`[B]` denotes behaviour evidenced in the current repository (verifiable by reading the named file or running the named command). `[E]` denotes proposed evolution — an acceptance target, never a claim that it exists.

Governing rule inherited from **ADR-0021**: *verification by host log, never self-report*; `[C]` migrates to `[B]` only via an adversarial test. This domain exists to make that rule mechanically enforceable rather than culturally observed.

**Ubiquitous Language reconciliation (obligation from `002` §5 item 1):** all terms below are used verbatim as defined in `001-problem-space.md` §3 — Scenario Identifier, Traceability Link, Traceability Gap, Quarantined Ambiguity, Quarantine Violation, Invariant Probe, Fault Injection, Structural vs Behavioural Proof, Quality Gate, Coverage Baseline, Toolchain Pin, Flake, Test Index, Suite Verdict, Benchmark Ledger, Regression Corpus, Retry Archaeology. Where `002` used a local synonym, `001` wins: *Check* → **test case** of the Test Corpus; *Discharge Link* → **Traceability Link**; *Scenario Id* → **Scenario Identifier**; *Mark Transition* → **Scenario Status Promoted to Evidenced**; *Measured Bound* → **Benchmark Ledger** entry; *Evidence Record* → **Suite Verdict** / Benchmark Ledger entry.

### Settled human decisions carried into this design

| # | Decision | Where it lands |
|---|---|---|
| D1 | Typecheck restoration is **in scope as task 01**: pin `typescript` in the lockfile, keep exactly one `packages/mcp-server/tsconfig.json`, add a CI typecheck job over graph-core + mcp-server + client. The 24 pre-existing errors are recorded as a **frozen, ratcheting baseline that may not grow**, not fixed in this domain. | Toolchain Pin, Quality Gate, task `01` |
| D2 | Multi-process concurrency and 100k-claim scale probes are **non-blocking** and write to a durable **Benchmark Ledger**; only a sustained multi-run breach opens a debt entry. Deterministic correctness assertions may still block; timing/volume claims may not. | Benchmark Ledger, Performance Probe, tasks `16`–`20` |
| D3 | The `001` §4 question **SQ14** (refusal-code / timing side channel) becomes a **seventh Declared Untestable family, `QA7`**, with the same rules as `QA1`–`QA6`. | Ambiguity Quarantine, task `04` |
| D4 | The conformance claim is **L2 full + L3 partial + L0/L1 client**; each L3 item is individually `claimed` or `not-yet-claimed`; **L4 federation is out of scope**. The L3 budget item is `not-yet-claimed` — the Horizon Budget Ledger is stored but never enforced and `HorizonBudgetExhausted` is never recorded `[B]`. | Conformance Manifest, tasks `10`–`11` |

**Numbering convention (binding on all four documents).** Quarantined Ambiguity families are `QA1`–`QA7`. Socratic questions from `001` §4 are `SQ1`–`SQ25`. A bare `Q<n>` is ambiguous and must not be written.

### Verified current state `[B]` this design is built on

| Fact | Evidence |
|---|---|
| Suite green: 700 pass, 1 todo, 0 fail, 3293 `expect()` calls, 701 tests, 134 files, 74.55s | root `bun test` |
| Root `package.json` `test` script runs **only** `packages/mcp-server`; CI runs root `bun test` | `package.json`, `.github/workflows/ci.yml` |
| `bunfig.toml` holds only `[test] timeout = 15000`; no coverage tooling, no threshold, no figure ever reported | `bunfig.toml`, `docs/.digest.md:22` |
| CI jobs: `test`, `client-node`, `e2e` (blocking); `load` (PR-only, `continue-on-error: true`, presence only — nothing EAP) | `.github/workflows/ci.yml` |
| `bunx tsc --noEmit` runs only inside `mcp-web`; `ci.yml` carries its own comment warning the resolution is unpinned | `.github/workflows/ci.yml` |
| `typescript@5.8.2` is a devDependency of `packages/client` and `packages/graph-core` only — absent from the root and from `packages/mcp-server` | `packages/*/package.json` |
| `packages/mcp-server/tsconfig.json` **already inlines** the former `@tsconfig/bun` base and is self-contained; `tsconfig.check.json` was deleted in `71887e1` | `packages/mcp-server/tsconfig.json` header comment |
| 24 pre-existing type errors, in files unrelated to EAP, are recorded and explicitly unresolved | `docs/specs/cognitive_line/TDD-OUTPUT.json` |
| `docs/.digest.md:21` still routes typecheck through the deleted `tsconfig.check.json` | `docs/.digest.md` |
| `docs/feature/cognitive_line.md` graph block has `"tested_by": []` and a `test_files` list omitting `f001-retry6`, `f001-retry7`, `f001-retry8`, `f001-transport-delegation`, `f001-validation-audit-vulns` | `docs/feature/cognitive_line.md` |
| `docs/.graph.json` indexes exactly two nodes (`adr:adr`, `feature:cognitive-line`) and does not index `docs/PRD/` | `docs/.graph.json` |
| Apêndice D exists at `docs/PRD/OpenGraph_Working_Paper_v1_0.md` line 1164, marked `[E → G2]`, five levels L0–L4, rule *"Cada item verificável por log do host — autorrelato não conta, nunca"* | Working Paper |
| ADR-0007 records L0/L1 `[B]` (client), L2 `[B]` (host), **L3 `[E]` — gradua com VS-1**, L4 `[C]` | `docs/adr/ADR.md:465` |
| `EapEnv` publishes `{ dir, dbPath, db, tenantId, promotions, contestations, recalls, approvals, audit, sequences, setObservedSeq, restart, cleanup }` over real on-disk SQLite + JSONL | `packages/mcp-server/test/eap-env.ts` |
| Zero scenario→test traceability exists; ~70 scenarios in `004` remain `[E]` though implemented | `docs/specs/cognitive_line/004` |
| Three tech-lead open points have no test that would catch them | `docs/specs/cognitive_line/TL.json` (0.85) |
| QA verdict clean, no open vulnerabilities | `docs/specs/cognitive_line/QA.json` (1.00) |

**Read-only boundary.** `docs/specs/cognitive_line/**` and `docs/harness-history/**` are inputs. This domain never edits them; a scenario's `[E]`→`[B]` promotion is published as a **derived report** beside the register, never as an in-place edit of `004`.

---

## Section 1 — Main Structure

| Element | Layer / Type | Invariants / Technical Rules | 4-line Snippet |
|---|---|---|---|
| Scenario Register `[E]` | Verification domain aggregate root | Every Scenario has exactly one Scenario Identifier; identifiers are stable across renames and never reused after retirement; status is one of `declared-untestable` \| `[E]` \| `[B]` and `[B]` is derived, never authored. | Snippet A |
| Ambiguity Quarantine `[E]` | Verification domain aggregate root | Holds exactly **seven** families QA1–QA7; every member Scenario is `declared-untestable`; a quarantined Scenario may never hold a Traceability Link; lifted only by a merged ADR amendment naming the family. | Snippet B |
| Traceability Map `[E]` | Derived aggregate (generated, never hand-edited) | Bidirectional: a Scenario with no test case and a test case asserting behaviour no Scenario describes are both Traceability Gaps; links are many-to-many but each link names the asserting test case by file + test name, never by suite. | Snippet C |
| Conformance Manifest `[E]` | Versioned published-language artefact | One row per Apêndice D obligation item, carrying source line, level, role, refusal codes touched, host-log evidence predicate, and claim state; transcription may not add, reword, or reinterpret an item; L4 rows are absent by decision D4. | Snippet D |
| Test Corpus `[B]` → `[E]` | Executable inventory (`packages/*/test/**`) | Every retained EAP test case states one falsifiable claim and carries a discharge annotation; Retry Archaeology is retired to behavioural names with retry lineage preserved as metadata; a rename may not reduce the assertion set. | Snippet E |
| Verification Environment `[B]` | Shared Kernel (`test/eap-env.ts`, `test/helpers.ts`) | Real on-disk SQLite + JSONL only; `restart()` is the sole restart boundary; no fixture may construct admitted state without passing the Admission Gate; co-owned type surface — changes need both owners' consent (`002` §4). | Snippet F |
| Invariant Probe `[E]` | Adversarial test aggregate | Declares a pre-registered falsification criterion before it runs; a probe that cannot fail is rejected at review; observes behaviour, never code shape (Structural vs Behavioural Proof). | Snippet G |
| Fault Injection Case `[E]` | Invariant Probe specialization | The collaborator misbehaves deliberately (ignores `AbortSignal`, dies mid-transaction, replays a request); the irreversible effect is counted by a double's ledger, never actually performed. | Snippet H |
| Benchmark Ledger `[E]` | Append-only measurement aggregate | Every sample carries run, commit, runner fingerprint, and measured value; a breach is declared only when `k` consecutive runs exceed the budget band; never fails a blocking gate (D2). | Snippet I |
| Coverage Baseline `[E]` | Threshold policy aggregate | Records a measured figure with its scope definition; the ratchet is monotonic — a change may not lower it; a baseline without a stated scope is theatre and is rejected. | Snippet J |
| Quality Gate `[E]` | CI policy aggregate | Blocking-versus-non-blocking is a governed, declared decision, never an implementation accident; each gate names its signal source, its trigger, and its rollback. | Snippet K |
| Toolchain Pin `[B]`→`[E]` | Determinism aggregate | Compiler and runner versions resolve from the lockfile, never from a registry at run time; an unpinned resolution is itself the defect; the typecheck error baseline is frozen and may only shrink (D1). | Snippet L |
| Test Index `[B]`→`[E]` | Documentation-truth aggregate | `tested_by` and `test_files` are derived from the Traceability Map, not maintained by hand; any drift between the derived value and the committed file fails the gate. | Snippet M |
| Suite Run `[E]` | Execution/reporting aggregate | Publishes exactly one Suite Verdict per run, read from runner output; a Flake is an observed verdict variance without a code change and becomes a debt entry, never a deletion. | Snippet N |

```text
ScenarioRegister [E]:
  scenarios: Map<ScenarioIdentifier, ScenarioRecord>
  register(source, text): ScenarioIdentifier  // stable, never reused
```

```text
AmbiguityQuarantine [E]:
  families: QuarantineFamily[QA1..QA7]  // exactly seven
  assert(noLinkExists): QuarantineViolation?
```

```text
TraceabilityMap [E]:
  links: TraceabilityLink[]  // scenario <-> testCase, many-to-many
  gaps(): { unlinkedScenarios, unclaimedTests }
```

```text
ConformanceManifest [E]:
  version: SemVer; source: WorkingPaperRef
  items: ConformanceItem[]  // L0,L1 client; L2,L3 host
```

```text
TestCorpus [B]:
  cases: TestCase[]  // file + test name + annotation
  lineage: Map<TestCase, RetryProvenance>
```

```text
EapEnv [B]:  // Shared Kernel, unchanged type surface
  db, tenantId, promotions, contestations, recalls, approvals
  restart(): EapEnv  // real host-restart boundary
```

```text
InvariantProbe [E]:
  claim: string; falsifiedWhen: FalsificationCriterion
  observe(): ProbeReport  // behavioural, never structural
```

```text
FaultInjectionCase [E] extends InvariantProbe:
  misbehaviour: ignoreAbort | dieMidTx | replayRequest
  effectLedger: EffectCounter  // counts, never performs
```

```text
BenchmarkLedger [E]:  // append-only JSONL
  append(sample: MeasurementSample): void
  breached(metric, k): boolean  // k consecutive runs
```

```text
CoverageBaseline [E]:
  figure: CoverageFigure; scope: CoverageScope
  ratchet: monotonic  // may rise, never fall
```

```text
QualityGate [E]:
  name: GateName; blocking: boolean; trigger: TriggerPolicy
  evaluate(signals): GateVerdict
```

```text
ToolchainPin [E]:
  typescript: ExactVersion  // from lockfile, not registry
  typecheckBaseline: FrozenErrorSet  // may only shrink
```

```text
TestIndex [E]:
  testedBy: ScenarioIdentifier[]; testFiles: Path[]
  derivedFrom: TraceabilityMap  // never hand-authored
```

```text
SuiteRun [E]:
  runId, commit, runner: RunnerFingerprint
  verdict: SuiteVerdict  // read from runner output only
```

---

## Section 2 — Value Objects / Types / Interfaces

| Name | Context / Layer | Validation and Typing Rules | 4-line Snippet |
|---|---|---|---|
| `ScenarioIdentifier` `[E]` | Scenario Traceability | Format `EAP-<AREA>-<NNN>`; `AREA` from the closed set defined in the area map below, which covers every section of `004`; monotonic within area; never reused after retirement. | Snippet A |
| `ScenarioStatus` `[E]` | Scenario Traceability | Closed union `declared-untestable \| proposed \| evidenced`; `evidenced` is only ever written by the derivation service. | Snippet B |
| `TraceabilityLink` `[E]` | Scenario Traceability | `{ scenario, testFile, testName, kind }`; `kind ∈ asserts \| covers-partially`; `covers-partially` alone can never promote a Scenario to `evidenced`. | Snippet C |
| `DischargeAnnotation` `[E]` | Conformance Corpus (Published Language) | Emitted by the test itself at runtime; carries Scenario Identifiers, optional Conformance Item ids, and defect ids; test titles are never parsed. | Snippet D |
| `QuarantineFamilyId` `[E]` | Ambiguity Quarantine | Closed union `QA1..QA7`; every family names its ADR/spec source clause and its lifting condition. | Snippet E |
| `ConformanceItem` `[E]` | Conformance Manifest | `{ itemId, level, role, sourceLine, refusalCodes, evidencePredicate, claimState }`; `evidencePredicate` must be host-log observable or the item is inadmissible. | Snippet F |
| `ConformanceClaimState` `[E]` | Conformance Manifest | Closed union `claimed \| not-yet-claimed \| out-of-scope`; L4 rows are absent, not `out-of-scope` placeholders. | Snippet G |
| `AssertionFingerprint` `[E]` | Test Corpus | Order-insensitive multiset of `(matcher, normalized-subject)` pairs per test case; used to prove a rename dropped nothing. | Snippet H |
| `RetryProvenance` `[E]` | Regression Corpus | `{ retryPass, findingClass, findingId }`; survives the rename as metadata; deleting it deletes the justification for the test. | Snippet I |
| `FalsificationCriterion` `[E]` | Invariant Probe | Pre-registered before execution; states the observable and the value that refutes the claim; a probe without one is not admissible. | Snippet J |
| `MeasurementSample` `[E]` | Benchmark Ledger | `{ metric, value, unit, runId, commit, runnerFingerprint, at }`; a sample with no runner fingerprint is unusable for noise separation. | Snippet K |
| `BudgetBand` `[E]` | Benchmark Ledger | `{ metric, median, tolerance, consecutiveBreaches k }`; a single-run excursion is noise by definition (`001` SQ11, SQ20). | Snippet L |
| `CoverageFigure` `[E]` | Coverage Baseline | `{ lines, functions, scope }`; scope enumerates the counted paths explicitly — a global percentage over an unstated scope is rejected. | Snippet M |
| `GateVerdict` `[E]` | Quality Gate | `{ gate, outcome: pass\|fail\|advisory, evidenceRef }`; `advisory` never blocks and never silently becomes `pass`. | Snippet N |
| `FrozenErrorSet` `[E]` | Toolchain Pin | `{ file, count }[]` plus a total; the gate fails when any count rises or a new file appears; a fallen count must be committed down. | Snippet O |
| `RunnerFingerprint` `[E]` | Suite Run | `{ os, arch, cpuCount, bunVersion, ci }`; two samples with different fingerprints are never compared directly. | Snippet P |
| `FlakeRecord` `[E]` | Flake Management | `{ testCase, observedVerdicts, firstSeen, owner }`; an owner is mandatory — a flake without one cannot be quarantined. | Snippet Q |
| `SuiteVerdict` `[E]` | Suite Run | `{ runId, gates: GateVerdict[], outcome }`; derived from runner output only — self-report is inadmissible (ADR-0021). | Snippet R |

```text
type ScenarioIdentifier [E] = `EAP-${Area}-${NNN}`
validate: area in closed set; never reused after retirement
```

### Area map `[E]` — closed set, covering all 71 scenarios of `docs/specs/cognitive_line/004`

Every section of `004` has exactly one covering area, so no scenario can fail area validation during task `03`. Counts are the measured heading counts of `004` `[B]`.

| `004` section | AREA | Scenarios |
|---|---|---:|
| §1.1 Epistemic Lifecycle | `LIFE` | 3 |
| §1.1 Horizon | `HRZN` | 4 |
| §1.1 Admission Decision | `ADMS` | 3 |
| §1.1 Promotion | `PROM` | 3 |
| §1.1 Recall Case | `RECL` | 4 |
| §1.2 Value Objects and Contract Types | `VOBJ` | 12 |
| §1.3 Domain Services | `SVCS` | 10 |
| §1.4 Domain Events | `EVNT` | 2 |
| §2.1 Repositories and Persistence | `PERS` | 9 |
| §2.2 Use Cases and MCP Binding | `XPRT` | 5 |
| §2.3 External Capability Integration | `CAPB` | 3 |
| §3.1 Happy Paths | `FUNC` | 4 |
| §3.2 Alternative and Error Paths | `ERRP` | 4 |
| §3.3 Security and Authority Boundary | `SEC` | 5 |
| — | **total** | **71** |

Three further areas are reserved and carry no `004` scenario today: `CNTS` (Contestation, whose scenarios currently live under `SVCS`), `CLNT` (client-adapter scenarios beyond `XPRT`), and `QUAR` (identifiers minted for `QA1`–`QA7` members, which are `declared-untestable` and may never hold a Traceability Link). Adding an area is a change to this table, not an ad-hoc decision by the seeder.

```text
type ScenarioStatus [E] = declared-untestable | proposed | evidenced
validate: `evidenced` writable only by derivation
```

```text
interface TraceabilityLink [E]:
  scenario: ScenarioIdentifier; testFile: Path; testName: string
  kind: asserts | covers-partially
```

```text
interface DischargeAnnotation [E]:
  scenarios: ScenarioIdentifier[]; items?: ConformanceItemId[]
  emittedAt: runtime  // never parsed from the test title
```

```text
type QuarantineFamilyId [E] = QA1 | QA2 | QA3 | QA4 | QA5 | QA6 | QA7
validate: each names source clause + lifting ADR
```

```text
interface ConformanceItem [E]:
  itemId; level: L0|L1|L2|L3; role: client|host
  evidencePredicate: HostLogObservable; sourceLine: number
```

```text
type ConformanceClaimState [E] = claimed | not-yet-claimed | out-of-scope
validate: L3 items are stated individually, never per level
```

```text
type AssertionFingerprint [E] = Multiset<(matcher, subject)>
validate: order-insensitive; comparison is subset-free equality
```

```text
interface RetryProvenance [E]:
  retryPass: 1..8; findingClass: string; findingId: string
```

```text
interface FalsificationCriterion [E]:
  observable: string; refutesWhen: Predicate
```

```text
interface MeasurementSample [E]:
  metric; value; unit; runId; commit
  runnerFingerprint: RunnerFingerprint; at: Instant
```

```text
interface BudgetBand [E]:
  metric; median; tolerance; consecutiveBreaches: k
```

```text
interface CoverageFigure [E]:
  lines: Percent; functions: Percent; scope: Path[]
```

```text
interface GateVerdict [E]:
  gate: GateName; outcome: pass | fail | advisory
  evidenceRef: EvidenceRef
```

```text
type FrozenErrorSet [E] = { file: Path; count: int }[]
validate: no count may rise; no new file may appear
```

```text
interface RunnerFingerprint [E]:
  os; arch; cpuCount; bunVersion; ci: boolean
```

```text
interface FlakeRecord [E]:
  testCase; observedVerdicts: Verdict[]; owner: Person
```

```text
interface SuiteVerdict [E]:
  runId; gates: GateVerdict[]; outcome: pass | fail
```

---

## Section 3 — Domain Services / Use Cases / Actions

| Operation | Responsibility | Coordinates / Subscriptions | 4-line Snippet |
|---|---|---|---|
| `PinToolchain` `[E]` | Resolves compiler and runner to exact lockfile versions and freezes the current typecheck error set. | root `package.json`, `bun.lock`, Toolchain Pin, `docs/.digest.md`. | Snippet A |
| `RestoreTypecheckGate` `[E]` | Runs the pinned compiler over graph-core, mcp-server, and client, and compares against the Frozen Error Set. | Toolchain Pin, Quality Gate, CI Runner. | Snippet B |
| `RegisterScenario` `[E]` | Assigns a Scenario Identifier to each Given/When/Then in `004` and seeds the Scenario Register. | `004` (read-only), Scenario Register. | Snippet C |
| `QuarantineAmbiguity` `[E]` | Records the seven Quarantined Ambiguity families and marks their Scenarios Declared Untestable. | Ambiguity Quarantine, Scenario Register, ADR. | Snippet D |
| `TranscribeConformanceManifest` `[E]` | Transcribes Apêndice D L0–L3 into versioned machine-readable items with host-log evidence predicates. | Working Paper (read-only), Conformance Manifest, ADR-0007. | Snippet E |
| `LinkScenarioToTestCase` `[E]` | Collects Discharge Annotations from a Suite Run and materialises Traceability Links. | Test Corpus, Traceability Map, Suite Run. | Snippet F |
| `ReconcileTraceability` `[E]` | Computes Traceability Gaps in both directions and emits the gate signal. | Traceability Map, Scenario Register, Quality Gate. | Snippet G |
| `DetectQuarantineViolation` `[E]` | Fails the build when any test case discharges a Scenario inside QA1–QA7. | Ambiguity Quarantine, Traceability Map, Quality Gate. | Snippet H |
| `PromoteScenarioStatus` `[E]` | Derives `[E]`→`[B]` from an `asserts` link plus a passing Suite Run and publishes the derived report. | Traceability Map, Suite Run, Scenario Register. | Snippet I |
| `FingerprintAssertions` `[E]` | Captures the assertion multiset of a test case before a rename and proves equality after. | Test Corpus, Regression Corpus. | Snippet J |
| `RetireRetryArchaeology` `[E]` | Renames `f001-retry*` files to behavioural names while preserving assertions and moving retry lineage into metadata. | Test Corpus, `FingerprintAssertions`, Test Index. | Snippet K |
| `MeasureCoverage` `[E]` | Produces the first coverage figure for the EAP scope and records its scope definition. | Coverage tool, Coverage Baseline, Benchmark Ledger. | Snippet L |
| `EvaluateCoverageBaseline` `[E]` | Compares the measured figure against the ratchet and fails on regression. | Coverage Baseline, Quality Gate. | Snippet M |
| `ExecuteConcurrencyProbe` `[E]` | Drives writers from separate OS processes and separate SQLite connections and measures write-lock hold and writer starvation. | `serialTransaction`, `allocateSequence`, Benchmark Ledger. | Snippet N |
| `ExecuteCancellationProbe` `[E]` | Makes a capability provider double ignore `AbortSignal` and proves whether a retry double-counts an irreversible effect. | `CapabilityGateway.execute`, Fault Injection Case, effect counter. | Snippet O |
| `ExecuteVolumeProbe` `[E]` | Builds a 100k-claim tenant and measures unpaginated read-model cost and per-batch indexing behaviour. | `SqlitePromotionRepository`, closure re-derivation, Benchmark Ledger. | Snippet P |
| `EvaluatePerformanceBudget` `[E]` | Declares a breach only after `k` consecutive same-fingerprint runs exceed the band, and opens a debt entry. | Benchmark Ledger, debt register. | Snippet Q |
| `ReconcileTestIndex` `[E]` | Regenerates `tested_by` / `test_files` and the typecheck instruction, and fails on drift from the committed files. | Traceability Map, `docs/feature/cognitive_line.md`, `docs/.digest.md`, `docs/.graph.json`. | Snippet R |
| `QuarantineFlake` `[E]` | Records verdict variance without a code change as an owned debt entry rather than deleting the test. | Suite Run, Flake ledger, Test Corpus. | Snippet S |
| `EvaluateQualityGate` `[E]` | Composes all gate signals into one verdict and decides blocking versus advisory per declared policy. | All gates, CI Runner. | Snippet T |
| `PublishSuiteVerdict` `[E]` | Appends the run's verdict, read from runner output, to the append-only evidence record. | Suite Run, evidence ledger, Version Control Host. | Snippet U |

```text
PinToolchain [E](): ToolchainPin
  // exact versions from bun.lock + frozen error set
```

```text
RestoreTypecheckGate [E](packages): GateVerdict
  // pinned tsc --noEmit vs FrozenErrorSet
```

```text
RegisterScenario [E](source, gwt): ScenarioIdentifier
  // stable id; 004 stays read-only
```

```text
QuarantineAmbiguity [E](familyId, scenarios): void
  // status := declared-untestable; no link permitted
```

```text
TranscribeConformanceManifest [E](appendixD): Manifest
  // one item per clause; predicate must be log-observable
```

```text
LinkScenarioToTestCase [E](annotations): TraceabilityLink[]
  // from runtime annotation, never from test titles
```

```text
ReconcileTraceability [E](): { gaps, verdict }
  // both directions: unlinked scenario AND unclaimed test
```

```text
DetectQuarantineViolation [E](links): GateVerdict
  // any link into QA1..QA7 is a build failure
```

```text
PromoteScenarioStatus [E](run): DerivedStatusReport
  // asserts-link + passing run -> evidenced
```

```text
FingerprintAssertions [E](file): AssertionFingerprint
  // multiset of (matcher, normalized subject)
```

```text
RetireRetryArchaeology [E](file, newName): RenameResult
  // fingerprint(before) must equal fingerprint(after)
```

```text
MeasureCoverage [E](scope): CoverageFigure
  // figure is meaningless without its scope
```

```text
EvaluateCoverageBaseline [E](figure): GateVerdict
  // monotonic ratchet; regressions block
```

```text
ExecuteConcurrencyProbe [E](writers, procs): ProbeReport
  // separate processes AND separate connections
```

```text
ExecuteCancellationProbe [E](provider): ProbeReport
  // provider ignores AbortSignal; count effects
```

```text
ExecuteVolumeProbe [E](claims=100_000): ProbeReport
  // measure; never assert a bound (QA6)
```

```text
EvaluatePerformanceBudget [E](metric, k): BreachVerdict
  // k consecutive same-fingerprint breaches only
```

```text
ReconcileTestIndex [E](): DriftReport
  // regenerate, diff, fail on drift
```

```text
QuarantineFlake [E](testCase, owner): FlakeRecord
  // debt entry with an owner, never a deletion
```

```text
EvaluateQualityGate [E](signals): GateVerdict
  // blocking vs advisory is declared, not accidental
```

```text
PublishSuiteVerdict [E](run): SuiteVerdict
  // read from runner output; self-report inadmissible
```

---

## Section 4 — Events / Messages / Async Flows

| Event / Action Name | Trigger | Minimum Payload | Consumers |
|---|---|---|---|
| `ToolchainPinned` `[E]` | `PinToolchain` writes exact versions and the Frozen Error Set. | `{ typescript, bun, baselineTotal, commit }` | Quality Gate, `docs/.digest.md` reconciliation. |
| `TypecheckGateRestored` `[E]` | The pinned compiler runs clean against the Frozen Error Set for all three packages. | `{ packages, errorsByFile, baselineTotal }` | CI Runner, Suite Verdict. |
| `ScenarioIdentifierAssigned` `[E]` | `RegisterScenario` succeeds. | `{ scenarioId, sourceRef, area }` | Scenario Register, Traceability Map. |
| `ScenarioDeclaredUntestable` `[E]` | `QuarantineAmbiguity` records a family member. | `{ scenarioId, familyId, sourceClause, liftingCondition }` | Quarantine gate, conformance exclusions. |
| `ConformanceManifestPublished` `[E]` | Transcription of Apêndice D L0–L3 completes. | `{ manifestVersion, itemCount, claimedCount, sourceRef }` | Conformance runner, Suite Verdict, ADR-0007 review. |
| `TraceabilityLinkEstablished` `[E]` | A Discharge Annotation is collected from a passing test case. | `{ scenarioId, testFile, testName, kind, runId }` | Traceability Map, Test Index. |
| `TraceabilityGapDetected` `[E]` | `ReconcileTraceability` finds an unlinked Scenario or an unclaimed test case. | `{ direction, subject, count }` | Quality Gate, drift report. |
| `QuarantineViolationDetected` `[E]` | A Traceability Link points into QA1–QA7. | `{ scenarioId, familyId, testFile, testName }` | Quality Gate (blocking), architect review. |
| `ScenarioStatusPromotedToEvidenced` `[E]` | An `asserts` link plus a passing Suite Run. | `{ scenarioId, runId, commit, testRefs }` | Derived status report, Test Index. |
| `RetryArchaeologyRetired` `[E]` | A rename passes the assertion-fingerprint equality check. | `{ oldFile, newFile, fingerprintHash, retryProvenance }` | Test Corpus inventory, Test Index. |
| `AssertionSetReduced` `[E]` | A rename's post-fingerprint is a proper subset of its pre-fingerprint. | `{ file, missingAssertions }` | Quality Gate (blocking), reviewer. |
| `CoverageMeasured` `[E]` | The coverage tool completes for the declared scope. | `{ lines, functions, scope, runId }` | Coverage Baseline, Benchmark Ledger. |
| `CoverageRegressionDetected` `[E]` | A measured figure falls below the ratchet. | `{ metric, baseline, measured, runId }` | Quality Gate, debt register. |
| `ConcurrencyProbeExecuted` `[E]` | The multi-process probe completes. | `{ processes, connections, lockHoldMs, starvedWriters, runId }` | Benchmark Ledger, probe report. |
| `DuplicateIrreversibleEffectObserved` `[E]` | The provider double records two effects for one idempotency key. | `{ idempotencyKey, effectCount, retryCount }` | Quality Gate (blocking — deterministic), TL debt entry. |
| `UnboundedReadModelObserved` `[E]` | The volume probe measures `getEvents` / `getProposalsForParent` at scale. | `{ method, rowCount, wallMs, peakHeapBytes }` | Benchmark Ledger (measurement only, no assertion). |
| `PerformanceBudgetBreached` `[E]` | `k` consecutive same-fingerprint runs exceed a band. | `{ metric, band, samples, runIds }` | Debt register, architect review. |
| `FlakeObserved` `[E]` | A test case yields differing verdicts with no code change. | `{ testFile, testName, verdicts, runIds }` | Flake ledger, Quality Gate credibility report. |
| `DocumentationDriftDetected` `[E]` | Regenerated index or command text differs from the committed file. | `{ file, field, expected, actual }` | Quality Gate, project-memory follow-up. |
| `SuiteVerdictPublished` `[E]` | All gates evaluated for one Suite Run. | `{ runId, commit, gates, outcome }` | Version Control Host, evidence ledger. |

Events are append-only observations of the verification system, not alternative command paths. No event may write into EAP's tenant-visible audit plane — the verification ledger and EAP's `Audit and Evidence` context stay **Separate Ways** (`002` §2.3). A green history is append-only and cannot be rewritten.

---

## Section 5 — Persistence / Repository / Data Access Interfaces

Physical layout. Committed state lives under `docs/verification/` (human-reviewable, diffable, versioned). Per-run artefacts live under `.verification/` (git-ignored, uploaded as CI artifacts). Tooling lives under `scripts/verification/`. Nothing writes into `docs/specs/cognitive_line/**` or `docs/harness-history/**`.

| Resource / Adapter | Methods / Actions | Return Types / Expected State |
|---|---|---|
| `ScenarioRegisterStore` `[E]` — `docs/verification/scenario-register.json` | `load`, `upsert`, `retire` | Sorted, stable-id JSON; retired ids remain present with `retired: true` so they are never reused. |
| `QuarantineStore` `[E]` — `docs/verification/quarantine.json` | `load`, `families`, `membersOf` | Exactly seven families QA1–QA7, each with source clause and lifting condition; edited only alongside a merged ADR amendment. |
| `ConformanceManifestStore` `[E]` — `docs/verification/conformance-manifest.json` | `load`, `itemsByLevel`, `version` | Versioned document; every item carries `sourceLine` into `docs/PRD/OpenGraph_Working_Paper_v1_0.md` and a host-log evidence predicate. |
| `TraceabilityMapStore` `[E]` — `docs/verification/traceability-map.json` | `regenerate`, `load`, `diff` | **Generated**; committed so drift is reviewable; regeneration must be byte-stable for an unchanged corpus. |
| `DerivedScenarioStatusReport` `[E]` — `docs/verification/scenario-status.md` | `render` | Human-readable `[E]`/`[B]` per Scenario Identifier, derived; `004` itself stays untouched. |
| `AnnotationSink` `[E]` — `.verification/annotations.jsonl` | `emit`, `collect` | One record per test case execution carrying its Discharge Annotation; written by the test process, read by the reconciler. |
| `AssertionFingerprintStore` `[E]` — `docs/verification/assertion-fingerprints.json` | `capture`, `compare` | Per-file multiset hash plus assertion list; a rename commit must update path and keep the hash. |
| `BenchmarkLedgerStore` `[E]` — `docs/verification/benchmark-ledger.jsonl` | `append`, `samplesFor`, `breached` | Append-only JSONL; never rewritten, never pruned by a build; queried by metric and runner fingerprint. |
| `CoverageBaselineStore` `[E]` — `docs/verification/coverage-baseline.json` | `load`, `ratchet` | Figure plus explicit scope path list; `ratchet` refuses any decrease. |
| `ToolchainPinStore` `[E]` — root `package.json` devDependencies + `bun.lock` + `docs/verification/typecheck-baseline.json` | `resolve`, `baseline`, `verify` | Exact `typescript` version resolved from the lockfile; `FrozenErrorSet` by file with a total. |
| `FlakeLedgerStore` `[E]` — `docs/verification/flake-ledger.jsonl` | `append`, `open`, `close` | Append-only; each open record carries an owner; closing requires a named cause. |
| `SuiteVerdictSink` `[E]` — `.verification/run/<runId>.json` + CI artifact | `publish`, `read` | Verdict parsed from runner output; uploaded with 30-day retention; never authored by hand. |
| `TestIndexAdapter` `[E]` — `docs/feature/cognitive_line.md` graph block, `docs/.digest.md`, `docs/.graph.json` | `render`, `diff` | Regenerated `tested_by` / `test_files`, corrected typecheck command, and `docs/PRD/` nodes added to the index. |
| `VerificationEnvironmentPort` `[B]` — `packages/mcp-server/test/eap-env.ts`, `test/helpers.ts` | `createEapEnv`, `restart`, `cleanup`, `startServer`, `callTool` | Shared Kernel; probes consume it only through an ACL that adds multi-process and multi-connection handles (`002` §2.2). |
| `ProbeHostPort` `[E]` — `packages/mcp-server/test/probes/host.ts` | `spawnWriters`, `openSeparateConnection`, `fingerprintRunner` | Multi-process handle set that never mutates `EapEnv`'s type surface. |

```text
interface TraceabilityMapStore [E]:
  regenerate(annotations, register): TraceabilityMap
  diff(committed): DriftReport  // byte-stable output
```

```text
interface BenchmarkLedgerStore [E]:
  append(sample: MeasurementSample): void  // append-only
  breached(metric, band, k): BreachVerdict
```

```text
interface ProbeHostPort [E]:
  spawnWriters(n): ProcessHandle[]  // separate OS processes
  openSeparateConnection(dbPath): Database
```

---

## Section 6 — Ordered Development Tasks
```json
[
  {
    "id": "01",
    "title": "Pin Toolchain and Restore Typecheck Gate",
    "description": "Pins typescript in the lockfile and adds a blocking CI typecheck job over graph-core, mcp-server and client, comparing results against a frozen error baseline that may only shrink.",
    "scope": [
      "package.json",
      "bun.lock",
      "docs/verification/typecheck-baseline.json",
      ".github/workflows/ci.yml"
    ],
    "acceptance": [
      "`typescript` resolves to one exact version from the lockfile at the repo root and `bunx tsc --noEmit -p packages/mcp-server/tsconfig.json` runs to completion without falling through to an unpinned compiler",
      "DECIDED: the 24 pre-existing errors are RECORDED as a frozen baseline (per file with a total) and NOT fixed in this domain; the gate fails when any per-file count rises or a new file appears, and a reduced count must be committed down",
      "A `typecheck` CI job covers graph-core, mcp-server and client and blocks the merge"
    ],
    "depends_on": null,
    "also_requires": []
  },
  {
    "id": "02",
    "title": "Unify Local and CI Verification Entrypoint",
    "description": "Makes one command mean the same thing locally and in CI, ending the divergence between root package.json's mcp-server-only test script and CI's root bun test.",
    "scope": [
      "package.json",
      "packages/mcp-server/package.json",
      ".github/workflows/ci.yml"
    ],
    "acceptance": [
      "Root `bun run test` executes the same test set as the CI `test` job, verified by comparing reported test and file counts",
      "A `bun run verify` script runs typecheck plus the full suite and is the single documented local entrypoint",
      "No package-level test script silently narrows the set the gate evaluates"
    ],
    "depends_on": "01",
    "also_requires": []
  },
  {
    "id": "03",
    "title": "Define Scenario Identifier Scheme and Seed the Scenario Register",
    "description": "Assigns a stable Scenario Identifier to every Given/When/Then in the frozen 004 document and materialises the Scenario Register as committed data. Reads docs/specs/cognitive_line/004-open-graph-mcp-test-scenarios.md; that file is a read-only input and is never written.",
    "scope": [
      "docs/verification/scenario-register.json",
      "scripts/verification/register-scenarios.ts"
    ],
    "reads": [
      "docs/specs/cognitive_line/004-open-graph-mcp-test-scenarios.md"
    ],
    "acceptance": [
      "All 71 scenario headings in 004 map to exactly one `EAP-<AREA>-<NNN>` identifier drawn from the Section 2 area map, every section of 004 has a covering area, and 004 itself is byte-identical afterwards",
      "Re-running the seeder on an unchanged 004 reproduces the register byte for byte and reassigns no identifier",
      "Every register entry starts at status `proposed` except quarantined ones, which task 04 sets"
    ],
    "depends_on": null,
    "also_requires": []
  },
  {
    "id": "04",
    "title": "Record the Seven Quarantined Ambiguity Families",
    "description": "Records QA1-QA6 from 004 section 4 plus QA7 (the refusal/timing side-channel question left Open in 001) as Declared Untestable families with source clauses and lifting conditions.",
    "scope": [
      "docs/verification/quarantine.json",
      "docs/verification/scenario-register.json",
      "scripts/verification/register-scenarios.ts"
    ],
    "acceptance": [
      "Exactly seven families QA1-QA7 exist, each naming its source clause and the ADR amendment that would lift it",
      "Every member scenario carries status `declared-untestable` and neither `[E]` nor `[B]`",
      "QA7 records that a timing-differential probe may measure but may not assert an expected outcome"
    ],
    "depends_on": "03",
    "also_requires": []
  },
  {
    "id": "05",
    "title": "Implement the Discharge Annotation Surface",
    "description": "Adds a runtime helper that lets a test case declare the Scenario Identifiers and Conformance Item ids it discharges, so traceability never depends on parsing test titles, and fixes the ignore rules for verification state.",
    "scope": [
      "packages/mcp-server/test/verification/annotate.ts",
      ".gitignore",
      "packages/mcp-server/test/eap-conformance.test.ts"
    ],
    "acceptance": [
      "A test case annotated with one or more identifiers emits exactly one annotation record per execution into `.verification/annotations.jsonl`, containing file, test name and identifiers",
      "An annotation naming an identifier absent from the register fails the run with a named error",
      "`.gitignore` ignores `.verification/` and does NOT ignore `docs/verification/`, and annotations from graph-core, mcp-server and client suites land in one collectable sink"
    ],
    "depends_on": "03",
    "also_requires": []
  },
  {
    "id": "06",
    "title": "Annotate the Existing EAP Corpus",
    "description": "Applies Discharge Annotations across every EAP test file so the Traceability Map has real input. This is the bulk of the domain's manual labour and no downstream gate produces meaningful output without it.",
    "scope": [
      "packages/mcp-server/test",
      "packages/graph-core/test",
      "packages/client/test",
      "docs/verification/scenario-register.json"
    ],
    "acceptance": [
      "Every test case in the 21 EAP test files (16 in packages/mcp-server/test, 2 in packages/client/test, 3 in packages/graph-core/test; 131 test cases) carries a Discharge Annotation naming the Scenario Identifiers it discharges, or is explicitly recorded as out-of-scope with a reason",
      "Annotating changes no assertion: the suite's pass count, file count and total expect() count are unchanged from the pre-annotation baseline of 700 pass / 3293 expect() calls",
      "Any scenario left with no annotating test is listed in the register as a known gap rather than silently absent, and any test discharging a QA1-QA7 identifier is reported for task 08 rather than committed"
    ],
    "depends_on": "05",
    "also_requires": ["04"]
  },
  {
    "id": "07",
    "title": "Build the Bidirectional Traceability Map",
    "description": "Generates the committed Traceability Map from collected annotations and the register, and reports Traceability Gaps in both directions.",
    "scope": [
      "docs/verification/traceability-map.json",
      "scripts/verification/reconcile-traceability.ts"
    ],
    "acceptance": [
      "A scenario with no linked test case and a test case discharging no scenario are both reported as gaps, in separate lists",
      "Regeneration is byte-stable for an unchanged corpus, so drift is reviewable as a diff",
      "A `covers-partially` link is reported distinctly from an `asserts` link"
    ],
    "depends_on": "06",
    "also_requires": []
  },
  {
    "id": "08",
    "title": "Add the Quarantine Violation Gate",
    "description": "Fails the build whenever any test case discharges a scenario inside one of the seven Quarantined Ambiguity families, so an open architectural question cannot be settled by a green test.",
    "scope": [
      "scripts/verification/quarantine-gate.ts",
      "docs/verification/quarantine.json",
      ".github/workflows/ci.yml"
    ],
    "acceptance": [
      "A deliberately added link into any of QA1-QA7 fails the gate with the family id, test file and test name in the message",
      "The failure message distinguishes 'this behaviour is undecided' from 'this test is broken'",
      "The gate is blocking and covers all seven families, including QA7; every violation surfaced by task 06 is resolved or explicitly quarantined before the gate is turned on"
    ],
    "depends_on": "07",
    "also_requires": ["04"]
  },
  {
    "id": "09",
    "title": "Derive Scenario Status From Evidence",
    "description": "Publishes the [E] to [B] transition as a derived report computed from an asserts link plus a passing suite run, making a hand-written optimistic marker impossible.",
    "scope": [
      "docs/verification/scenario-status.md",
      "scripts/verification/derive-status.ts",
      "docs/verification/traceability-map.json"
    ],
    "acceptance": [
      "A scenario reaches `evidenced` only with at least one `asserts` link whose test passed in the same run",
      "`covers-partially` links alone never promote a scenario",
      "The report names the run id and commit for every `evidenced` scenario and docs/specs/cognitive_line/004 stays unmodified"
    ],
    "depends_on": "07",
    "also_requires": []
  },
  {
    "id": "10",
    "title": "Transcribe Apendice D Into a Conformance Manifest",
    "description": "Transcribes the Apendice D L0-L3 checklist into a versioned machine-readable manifest, one item per clause with a host-log evidence predicate and an explicit claim state. The Working Paper and the ADR are read-only sources and are never written.",
    "scope": [
      "docs/verification/conformance-manifest.json",
      "scripts/verification/conformance-report.ts"
    ],
    "reads": [
      "docs/PRD/OpenGraph_Working_Paper_v1_0.md",
      "docs/adr/ADR.md"
    ],
    "acceptance": [
      "Every item carries itemId, level, role, source line, refusal codes touched, and a host-log observable evidence predicate; no item is reworded or reinterpreted",
      "L2 items are `claimed` in full, L0/L1 client items are `claimed`, and each L3 item carries its own claim state - the R9 budget item is `not-yet-claimed` because the Horizon Budget Ledger is stored but never enforced and HorizonBudgetExhausted is never recorded",
      "L4 federation rows are absent and the manifest records that Apendice D is still marked [E to G2] pending graduation"
    ],
    "depends_on": "03",
    "also_requires": []
  },
  {
    "id": "11",
    "title": "Execute Conformance Assessment Against the Manifest",
    "description": "Runs the manifest black-box over real transport, attributing each item to its discharging test case and emitting a per-level, per-role verdict.",
    "scope": [
      "packages/mcp-server/test/eap-conformance.test.ts",
      "packages/client/test/eap-conformance.test.ts",
      "scripts/verification/conformance-report.ts"
    ],
    "acceptance": [
      "Every `claimed` item resolves to at least one annotated test case; a claimed item with no discharging test fails the gate",
      "Host and client verdicts are reported independently and never merged into one pass rate",
      "`not-yet-claimed` items are reported as declared exclusions, never as failures and never as green"
    ],
    "depends_on": "10",
    "also_requires": ["06"]
  },
  {
    "id": "12",
    "title": "Implement the Assertion Fingerprint Tool",
    "description": "Captures the assertion multiset of each EAP test file so a later rename can be mechanically proven to have dropped nothing.",
    "scope": [
      "scripts/verification/assertion-fingerprint.ts",
      "docs/verification/assertion-fingerprints.json"
    ],
    "acceptance": [
      "The fingerprint is an order-insensitive multiset of matcher plus normalised subject and is stable across reformatting and test reordering",
      "Removing a single expect() call from any fingerprinted file changes the hash and is reported with the missing assertion listed",
      "Baseline fingerprints are captured for all seven f001-* files before any rename occurs"
    ],
    "depends_on": null,
    "also_requires": []
  },
  {
    "id": "13",
    "title": "Retire Retry Archaeology Into Behavioural Names",
    "description": "Renames all five f001-retry* files to names stating the behaviour they protect, preserving every assertion and moving retry provenance into metadata.",
    "scope": [
      "packages/mcp-server/test/f001-retry5-concurrency-authz.test.ts",
      "packages/mcp-server/test/f001-retry5-durability.test.ts",
      "packages/mcp-server/test/f001-retry6-readmodel-and-freshness.test.ts",
      "packages/mcp-server/test/f001-retry7-closure-gate.test.ts",
      "packages/mcp-server/test/f001-retry8-resume-index.test.ts"
    ],
    "acceptance": [
      "All five retry-named files are renamed; post-rename fingerprints equal pre-rename fingerprints exactly, and a proper subset fails the gate with the missing assertions named",
      "Each renamed file carries a RetryProvenance metadata block naming the retry pass and finding class it closed",
      "The Traceability Map is regenerated and no scenario loses a link as a result of the rename"
    ],
    "depends_on": "12",
    "also_requires": ["07"]
  },
  {
    "id": "14",
    "title": "Instrument Coverage and Record the First Figure",
    "description": "Adds coverage instrumentation scoped to the EAP surface and records the first coverage figure this repository has ever produced, together with its explicit scope.",
    "scope": [
      "bunfig.toml",
      "docs/verification/coverage-baseline.json",
      "scripts/verification/measure-coverage.ts"
    ],
    "acceptance": [
      "A coverage run produces line and function figures for an explicitly enumerated path list covering graph-core/src/eap, mcp-server/src/eap, tools/eap.ts, gates.ts and client/src/eap.ts",
      "The recorded figure is unusable without its scope: a baseline entry lacking the path list is rejected by the loader",
      "Instrumented run time is measured and reported so its cost against the blocking path is known"
    ],
    "depends_on": "02",
    "also_requires": []
  },
  {
    "id": "15",
    "title": "Add the Coverage Baseline Ratchet Gate",
    "description": "Turns the recorded figure into a monotonic ratchet so a change may raise coverage but never lower it, with the policy on what counts stated in the baseline itself.",
    "scope": [
      "docs/verification/coverage-baseline.json",
      "scripts/verification/coverage-gate.ts",
      ".github/workflows/ci.yml"
    ],
    "acceptance": [
      "A change lowering line or function coverage inside the declared scope fails the gate with baseline, measured and delta reported",
      "Raising the figure requires committing the new baseline in the same change, so the ratchet cannot drift silently",
      "The gate's blocking status is declared explicitly in the workflow rather than inherited"
    ],
    "depends_on": "14",
    "also_requires": []
  },
  {
    "id": "16",
    "title": "Define the Benchmark Ledger and Its Noise Policy",
    "description": "Creates the append-only Benchmark Ledger with runner fingerprints and budget bands, so a real regression is separable from runner noise.",
    "scope": [
      "docs/verification/benchmark-ledger.jsonl",
      "scripts/verification/benchmark-ledger.ts",
      "packages/mcp-server/test/probes/host.ts"
    ],
    "acceptance": [
      "Every sample carries metric, value, unit, run id, commit and a runner fingerprint; a sample missing the fingerprint is rejected on append",
      "Samples with differing runner fingerprints are never compared, and a breach requires k consecutive same-fingerprint runs outside the band with k recorded in the band",
      "The ledger is append-only: a rewrite or deletion of past samples fails the reconciliation check"
    ],
    "depends_on": "02",
    "also_requires": []
  },
  {
    "id": "17",
    "title": "Implement the Multi-Process Concurrency Probe",
    "description": "Drives writers from separate OS processes on separate SQLite connections to convert the structurally-argued concurrency guarantee into behavioural proof, measuring write-lock hold after a JSONL rebuild.",
    "scope": [
      "packages/mcp-server/test/probes/concurrency-probe.ts",
      "packages/mcp-server/test/probes/host.ts",
      "packages/mcp-server/src/db.ts"
    ],
    "acceptance": [
      "The probe uses separate OS processes AND separate connections, and states its falsification criterion before running: a reused Sequence or a lost admitted write refutes the monotonicity claim",
      "Deterministic correctness observations (no Sequence reuse, no lost write) are asserted and blocking; write-lock hold time and writer starvation are recorded to the Benchmark Ledger only",
      "The probe fails when run against a deliberately broken allocateSequence, proving it can fail"
    ],
    "depends_on": "16",
    "also_requires": []
  },
  {
    "id": "18",
    "title": "Implement the Cancellation Fault Injection Probe",
    "description": "Makes a capability provider double ignore AbortSignal and hang past timeoutMs, proving whether releasing the idempotency key lets a retry produce a duplicate irreversible effect.",
    "scope": [
      "packages/mcp-server/test/probes/cancellation-probe.ts",
      "packages/mcp-server/src/eap/capability-gateway.ts",
      "docs/verification/traceability-map.json"
    ],
    "acceptance": [
      "The provider double counts effects in its own ledger and performs none, so a duplicate is observable without being executed",
      "The probe reports the effect count per idempotency key across a timeout-then-retry sequence and is deterministic, so it blocks",
      "TL.json open point 2 acquires a named discharging test case in the Traceability Map"
    ],
    "depends_on": "16",
    "also_requires": []
  },
  {
    "id": "19",
    "title": "Implement the 100k-Claim Scale and Read-Model Volume Probes",
    "description": "Builds a 100k-claim tenant and measures per-batch indexing, closure re-derivation cost, and the unpaginated getEvents and getProposalsForParent read models.",
    "scope": [
      "packages/mcp-server/test/probes/scale-probe.ts",
      "packages/mcp-server/src/eap/eap-repositories.ts",
      "docs/verification/benchmark-ledger.jsonl"
    ],
    "acceptance": [
      "Fixture build time, closure re-derivation wall time, read-model row count, wall time and peak heap are appended to the Benchmark Ledger with runner fingerprints",
      "The probe MEASURES only and asserts no maximum batch size, page size or completion bound, honouring quarantine family QA6",
      "TL.json open points 1 and 3 acquire named measurements attributable to a run and commit"
    ],
    "depends_on": "16",
    "also_requires": []
  },
  {
    "id": "20",
    "title": "Reconcile CI Job Topology for Probes and Evidence",
    "description": "Adds a non-blocking EAP probe job with its own trigger and artifact retention, and wires the blocking jobs so every gate's blocking status is a declared decision.",
    "scope": [
      ".github/workflows/ci.yml",
      "packages/mcp-server/package.json",
      ".verification/run"
    ],
    "acceptance": [
      "An `eap-probes` job runs the concurrency, cancellation and scale probes on its own trigger with continue-on-error true, uploads the Benchmark Ledger delta as an artifact, and never gates the merge on a timing or volume claim",
      "The deterministic correctness assertions inside the probes still run in the blocking suite, separated from the timing measurements",
      "Every job in ci.yml carries an explicit comment stating whether it blocks and on what signal"
    ],
    "depends_on": "19",
    "also_requires": ["08", "11", "15", "17", "18"]
  },
  {
    "id": "21",
    "title": "Add the Test Index and Documentation Reconciliation Gate",
    "description": "Regenerates the feature graph block, the digest's typecheck instruction, and the document index from the Traceability Map, and fails the build on drift.",
    "scope": [
      "docs/feature/cognitive_line.md",
      "docs/.digest.md",
      "docs/.graph.json",
      "scripts/verification/reconcile-index.ts"
    ],
    "acceptance": [
      "`tested_by` is populated from the Traceability Map and `test_files` lists every EAP test file including all five former f001-retry* files, f001-transport-delegation and f001-validation-audit-vulns under their post-rename names",
      "docs/.digest.md states the pinned typecheck command from task 01 and no longer references the deleted tsconfig.check.json, and docs/.graph.json indexes docs/PRD/OpenGraph_Working_Paper_v1_0.md and docs/PRD/PRD.md",
      "Any drift between the regenerated content and the committed files fails the gate with file, field, expected and actual"
    ],
    "depends_on": "07",
    "also_requires": ["13"]
  },
  {
    "id": "22",
    "title": "Add the Flake Ledger and Quarantine Policy",
    "description": "Records verdict variance without a code change as an owned debt entry so the gate's credibility is protected without deleting tests.",
    "scope": [
      "docs/verification/flake-ledger.jsonl",
      "scripts/verification/flake-ledger.ts",
      ".github/workflows/ci.yml"
    ],
    "acceptance": [
      "A test case yielding differing verdicts across runs at the same commit is appended with its verdicts and run ids",
      "Quarantining a flake requires a named owner and never removes the test file; closing an entry requires a named cause",
      "Probe-generated contention is distinguished from runner slowness by the runner fingerprint recorded with each observation"
    ],
    "depends_on": "16",
    "also_requires": []
  },
  {
    "id": "23",
    "title": "Compose Quality Gates and Publish the Suite Verdict",
    "description": "Composes typecheck, traceability, quarantine, conformance, coverage and flake signals into one Suite Verdict read from runner output and published append-only.",
    "scope": [
      "scripts/verification/publish-verdict.ts",
      ".verification/run",
      ".github/workflows/ci.yml"
    ],
    "acceptance": [
      "One verdict per run names every gate, its outcome (pass, fail or advisory) and its evidence reference, with advisory outcomes never counted as pass",
      "The verdict is parsed from runner and gate output; a hand-authored or self-reported verdict is rejected, per ADR-0021",
      "Published verdicts are append-only and retained as CI artifacts so a green history cannot be rewritten"
    ],
    "depends_on": "20",
    "also_requires": ["09", "21", "22"]
  }
]
```

---

## Open Inputs Carried Forward — Not Decided Here

**Numbering.** Socratic questions from `001` §4 are cited as `SQ<n>`. Quarantined Ambiguity families are `QA1`–`QA7`. The two schemes are disjoint and must never be written as a bare `Q<n>`.

**Authority.** `001` §4.6 is the documentation-backed resolution record and is the authoritative status for each question. The Status column below is copied from it; this table adds only *where the residue lands in this design*. Where §4.6 says **Settled**, implementation follows it. Where it says **Partial** or **Open**, the value is still the human's to supply, and a task whose acceptance depends on it requires that decision first.

| `001` SQ | Status per `001` §4.6 | Residue carried into this design | Lands in |
|---|---|---|---|
| SQ1 | Open | Which of the 701 passing tests already assert inside QA1–QA6 cannot be known from documentation; the audit of the whole corpus is not scheduled. | Task `06` surfaces candidates as it annotates; task `08` blocks them. The audit itself is unscheduled. |
| SQ2 | Partial | The quarantine diagnostic must name family, source clause, file, test and lifting ADR; the machine-readable error shape and wording are unset. | Task `08` acceptance requires the distinction; the message contract is unspecified. |
| SQ3 | Partial | A merged ADR amendment is necessary but creates no evidence; the human authorised to lift a quarantine is unassigned. | `QuarantineStore.liftingCondition` is required; its owner field has no value. |
| SQ5 | Open | The rule is explicit — no fixture may build admitted state outside the Admission Gate — but the helper audit has not been performed. | Verification Environment invariant is stated; the corpus must be described as *assuming* it until audited. |
| SQ6 | Partial | Only `kind: asserts` discharges a Scenario; the criterion for converting partial coverage into `asserts`, or splitting an over-broad Scenario, is open. | Task `09` enforces the rule; the threshold is unset. |
| SQ8 | Partial | The fixture lives in `packages/mcp-server/test/probes/scale-probe.ts` on the non-blocking path; its build-time budget and trigger cadence are unset. | Tasks `19`/`20`. |
| SQ9 | Partial | All five observables are recorded; which one is *the* failure signal is undecided, and QA6 forbids asserting a bound regardless. | Task `19` records; nothing asserts. |
| SQ10 | Partial | An individual blocking check must fit the configured 15,000 ms timeout; the end-to-end blocking latency ceiling is unset. | Task `14` measures instrumented run time. |
| SQ11 / SQ20 | Partial | Compare only within a `RunnerFingerprint` over `k` consecutive runs; tolerance, `k` and the arbiter are unset, so a breach may open debt but may not block. | `BudgetBand` carries both fields (task `16`); values absent. |
| SQ12 | Open | Existing hostile-identity coverage is unaudited; asserting that an authorization function was called does not qualify. | The L2 caller-blindness item (task `10`) may not be marked `claimed` until the audit lands. |
| SQ13 | Open | No fixture-data classification or redaction policy exists; location and retention do not prevent log leakage. | Artifact upload for such a fixture is blocked (tasks `20`/`23`). |
| SQ15 | Partial | The naming policy for new vulnerability classes is open; annotation makes an untraceable dump mechanically visible regardless. | Task `07` detects it; the policy is undecided. |
| SQ16 | Partial | Both separate processes and separate connections; no single authoritative timing observable selected. | Task `17`. |
| SQ17 | Settled | The provider double writes to its own Effect Ledger keyed by idempotency key and performs nothing; a count greater than one is the authoritative observation. | Task `18` implements it as stated. |
| SQ18 | Settled | The probe must produce a reused Sequence or a lost admitted write, and must fail against a deliberately broken `allocateSequence` or it is inadmissible. | Task `17` acceptance encodes both. |
| SQ19 | Open | Property-based Recall probes are unscheduled and no deterministic seed-capture contract is chosen. | No property-testing task exists; they may not enter a blocking gate. |
| SQ21 | Partial | Ownership is clear (pure rules in `graph-core`); whether the current suite violates it is unknown because the corpus audit is unscheduled. | ACL declared in `002`; audit unscheduled. |
| SQ22 | Partial | Two role-specific assessments against one upstream contract — Apêndice D owns the language; the reconciliation owner is unassigned. | Task `11` reports host and client verdicts independently. |
| SQ23 | Settled | Documentation truthfulness is a blocking Quality Gate whose authoritative source is the Traceability Map. | Task `21`. |
| SQ24 | Settled | Typecheck is task `01` inside this domain; the 24 errors are a frozen per-file ratchet. | Task `01`. |
| SQ25 | Partial | Probes run in a `continue-on-error` `eap-probes` job; the rollback for a wrong *blocking* correctness assertion is unspecified and must be declared before activation. | Task `20` must declare it. |

## Explicitly Deferred Decisions

Implementation must stop at these boundaries rather than silently decide them. The seven Quarantined Ambiguity families — QA1 in-flight promotion during a topology change; QA2 destination status of indirect Recall dependents; QA3 whether `RecallNotice` and an invalidating Contestation are one admitted object or two; QA4 whether unknown `faulty_since_seq` widens the closure or only the audit window; QA5 the `LegacyClaimStatus` migration mapping; QA6 page size, batching limits and completion bounds for very large closures; and QA7 whether refusal codes, timing, or closure counts leak protected content — may be **measured** but never **asserted**. Graduating Apêndice D past `[E → G2]` is a Working Paper decision this domain requests and does not perform; transcription may not resolve an item the skeleton leaves open. Promotion of any probe from advisory to blocking stays out of scope until a stable measured baseline exists in the Benchmark Ledger.
