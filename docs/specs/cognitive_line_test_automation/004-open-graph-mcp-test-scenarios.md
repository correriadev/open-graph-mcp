# Test Scenarios — open-graph-mcp

**Domain:** `cognitive_line_test_automation`  
**Project:** `open-graph-mcp`  
**Framework:** Bun Test (`bun test`, `bunfig.toml` `[test] timeout = 15000`) for executable scenarios; `scripts/verification/*` gate tooling invoked from `.github/workflows/ci.yml`; Playwright remains confined to `mcp-web` browser E2E and asserts nothing about EAP  
**Date:** 2026-08-12

## Scope and Status Discipline

These scenarios are specifications derived exclusively from `003-open-graph-mcp-tactical-design.md` of this domain. **The system under test is the verification machinery itself** — the Scenario Register, the Ambiguity Quarantine, the Traceability Map, the Conformance Manifest, the Test Corpus and its assertion fingerprints, the Coverage Baseline, the Benchmark Ledger, the Invariant Probes and Fault Injection Cases, the Toolchain Pin, the Test Index, the Quality Gates, and the Suite Run. EAP behaviour is **not** under test here: the ~70 scenarios of `docs/specs/cognitive_line/004` are the *data* this domain must render traceable, and no scenario below restates one of them.

`[B]` marks behaviour evidenced in the current repository (verifiable by reading the named file or running the named command). `[E]` marks proposed behaviour — an acceptance target, never a claim that the capability exists. Almost every gate below is `[E]`: today zero scenario→test traceability exists, no coverage figure has ever been produced, and no typecheck gate covers `graph-core`, `mcp-server`, or `client`.

Governing rule inherited from **ADR-0021**: *verification by host log, never self-report*. Every scenario that promotes a status, publishes a verdict, or claims a conformance item resolves to runner or gate output, never to an authored assertion.

`docs/specs/cognitive_line/**` and `docs/harness-history/**` are read-only inputs throughout. A `[E]`→`[B]` promotion is published as a derived report beside the Scenario Register, never as an in-place edit of the frozen `004`.

**Quarantine constraint.** The seven Quarantined Ambiguity families QA1–QA7 (§4) may be **measured** but never **asserted**. No scenario below picks an outcome inside one; the scenarios that mention them specify how the machinery *refuses* to let one be picked.

---

## 1. Unit Scenarios

> Isolated verification-domain logic — no CI runner, no real suite execution, no external registry. Stores and runner output are supplied as fixtures.

### 1.1 Aggregates and Decision Models

#### Scenario Register `[E]`

##### Should assign exactly one Scenario Identifier when a Given/When/Then heading is registered `[E]`

- **Given** a scenario heading read from the frozen `docs/specs/cognitive_line/004` and an empty Scenario Register
- **When** `RegisterScenario` runs over that heading
- **Then** exactly one `EAP-<AREA>-<NNN>` Scenario Identifier is assigned, its status is `proposed`, and `docs/specs/cognitive_line/004` is byte-identical to its pre-run content

##### Should reproduce every Scenario Identifier when the seeder re-runs against an unchanged source `[E]`

- **Given** a populated Scenario Register produced from `004`
- **When** `RegisterScenario` runs again with `004` unchanged
- **Then** the register is reproduced byte for byte and no Scenario Identifier is reassigned, renumbered, or dropped

##### Should keep the Scenario Identifier stable when the scenario heading text is renamed `[E]`

- **Given** a registered scenario whose heading wording is edited without changing the behaviour it describes
- **When** the register is regenerated
- **Then** the Scenario Identifier is unchanged and the register records the new heading text against the same identifier

##### Should refuse to reuse a Scenario Identifier when its scenario has been retired `[E]`

- **Given** a Scenario Register containing an entry marked `retired: true`
- **When** a new scenario is registered in the same area
- **Then** the new scenario receives the next unused number, the retired entry remains present with its identifier, and no new scenario ever carries a retired identifier

##### Should reject an area outside the closed set when a Scenario Identifier is minted `[E]`

- **Given** a scenario whose proposed area is absent from the closed area map of `003` §2 — `LIFE`, `HRZN`, `ADMS`, `PROM`, `RECL`, `VOBJ`, `SVCS`, `EVNT`, `PERS`, `XPRT`, `CAPB`, `FUNC`, `ERRP`, `SEC`, plus the reserved `CNTS`, `CLNT`, `QUAR`
- **When** identifier assignment is attempted
- **Then** assignment is refused with the offending area named and no register entry is created

##### Should refuse an authored `evidenced` status when the register is loaded `[E]`

- **Given** a committed `scenario-register.json` in which a scenario's status has been hand-edited to `evidenced`
- **When** the register is loaded
- **Then** loading fails naming the scenario, because `evidenced` is writable only by the derivation service and never by an author

#### Ambiguity Quarantine `[E]`

##### Should hold exactly seven families when the Ambiguity Quarantine is loaded `[E]`

- **Given** `docs/verification/quarantine.json`
- **When** it is loaded
- **Then** exactly seven families `QA1`–`QA7` are present, each naming its source clause and the ADR amendment that would lift it, and a sixth-or-eighth-family document is rejected

##### Should mark every member Declared Untestable when a family is recorded `[E]`

- **Given** the QA1–QA6 families of `docs/specs/cognitive_line/004` §4 and the QA7 refusal-code timing side channel
- **When** `QuarantineAmbiguity` records their member scenarios
- **Then** every member carries status `declared-untestable` and carries neither `[E]` nor `[B]`

##### Should record measurement-without-assertion when the timing side-channel family is stored `[E]`

- **Given** family QA7, the refusal-code, timing, and closure-count leakage question left Open
- **When** the family is recorded
- **Then** it states that a timing-differential probe may measure and record an observation but may never assert an expected outcome

##### Should refuse a lift when no merged ADR amendment names the family `[E]`

- **Given** a quarantined family whose lifting condition names an ADR amendment that is not merged
- **When** removal of the family is attempted
- **Then** the removal is refused, the family remains, and its members keep status `declared-untestable`

#### Traceability Map `[E]`

##### Should report an unlinked Scenario as a Traceability Gap when no test case discharges it `[E]`

- **Given** a Scenario Register entry with status `proposed` and no Discharge Annotation naming its Scenario Identifier
- **When** `ReconcileTraceability` runs
- **Then** the scenario appears in the unlinked-scenario gap list with its Scenario Identifier

##### Should report an unclaimed test case as a Traceability Gap when it discharges no Scenario `[E]`

- **Given** an executed EAP test case that emitted no Discharge Annotation
- **When** `ReconcileTraceability` runs
- **Then** the test case appears in the unclaimed-test gap list by file and test name, in a list separate from the unlinked scenarios

##### Should distinguish an `asserts` link from a `covers-partially` link when both target one Scenario `[E]`

- **Given** one Scenario Identifier discharged by one `asserts` annotation and two `covers-partially` annotations
- **When** the Traceability Map is generated
- **Then** all three links are recorded and the two kinds are reported distinctly, never summed into a single coverage count

##### Should name the asserting test case by file and test name when a link is materialised `[E]`

- **Given** a Discharge Annotation emitted at runtime by a test case
- **When** `LinkScenarioToTestCase` materialises the link
- **Then** the link carries file plus test name, and a link identifying only a suite or a file is rejected

##### Should produce byte-stable output when the map is regenerated for an unchanged corpus `[E]`

- **Given** a committed Traceability Map and an unchanged Test Corpus and Scenario Register
- **When** regeneration runs
- **Then** the output equals the committed file byte for byte, so any diff is real drift and reviewable

#### Conformance Manifest `[E]`

##### Should carry a host-log evidence predicate on every item when the manifest is transcribed `[E]`

- **Given** the Apêndice D L0–L3 clauses at `docs/PRD/OpenGraph_Working_Paper_v1_0.md` line 1164
- **When** `TranscribeConformanceManifest` runs
- **Then** every item carries `itemId`, `level`, `role`, `sourceLine`, refusal codes touched, and a host-log observable `evidencePredicate`, and an item without an observable predicate is inadmissible

##### Should reject a reworded or reinterpreted item when transcription runs `[E]`

- **Given** an Apêndice D clause and a proposed manifest item whose text adds, merges, or reinterprets an obligation
- **When** transcription validates the item against its source line
- **Then** the item is rejected, because transcription may not add, reword, or reinterpret

##### Should carry an individual claim state on each L3 item when the manifest is published `[E]`

- **Given** the L3 host-recursive clause list
- **When** the manifest is published
- **Then** each L3 item carries its own `claimed` or `not-yet-claimed` state, never a single per-level claim, and the R9 budget item is `not-yet-claimed` because the Horizon Budget Ledger is stored but never enforced and `HorizonBudgetExhausted` is never recorded

##### Should contain no L4 row when the manifest is published `[E]`

- **Given** the decision that L4 host-federated conformance is out of scope
- **When** the manifest is published
- **Then** no L4 row exists at all — absence, not an `out-of-scope` placeholder row — and the manifest records that Apêndice D remains marked `[E → G2]` pending graduation

##### Should claim L2 in full and L0/L1 for the client role when claim states are set `[E]`

- **Given** the transcribed manifest
- **When** claim states are assigned
- **Then** every L2 host-admitter item is `claimed`, every L0 and L1 client item is `claimed`, and host and client roles are recorded separately

#### Test Corpus `[E]`

##### Should carry a falsifiable claim and a discharge annotation when a retained EAP test case is registered `[E]`

- **Given** an EAP test case retained in the corpus
- **When** the corpus inventory is built
- **Then** the case states exactly one falsifiable claim and carries a Discharge Annotation, and a case carrying neither is reported

##### Should preserve Retry Archaeology as metadata when a regression case is renamed to behaviour `[E]`

- **Given** `f001-retry5-concurrency-authz`, `f001-retry5-durability`, `f001-retry6-readmodel-and-freshness`, `f001-retry7-closure-gate`, or `f001-retry8-resume-index`
- **When** `RetireRetryArchaeology` renames the file to a behavioural name
- **Then** the file carries a `RetryProvenance` block naming its retry pass, finding class, and finding id, and deleting that block deletes the justification for the test and is rejected

##### Should change no assertion when the existing corpus is annotated `[E]`

- **Given** the pre-annotation baseline of the suite — 700 pass, 1 todo, 0 fail, 3293 `expect()` calls across 134 files `[B]`
- **When** Discharge Annotations are applied across the 17 EAP test files
- **Then** every one of those counts is unchanged, because annotation declares what a test already proves and may never add, remove, or weaken an assertion

##### Should record an unannotatable test as an explicit exclusion when no Scenario describes it `[E]`

- **Given** an EAP test case whose behaviour matches no Scenario in the register
- **When** the annotation pass reaches it
- **Then** it is recorded as an explicit out-of-scope exclusion carrying a reason, never left silently unannotated, so the Traceability Gap it represents stays visible

##### Should report rather than commit a test that discharges a quarantined identifier `[E]`

- **Given** an existing test case whose behaviour falls inside one of `QA1`–`QA7`
- **When** the annotation pass would bind it to that family's Scenario Identifier
- **Then** the binding is reported for adjudication and is not committed, because a Traceability Link into a quarantined family is a Quarantine Violation by construction

#### Invariant Probe `[E]`

##### Should reject an Invariant Probe when it declares no falsification criterion `[E]`

- **Given** a probe specification with no pre-registered `FalsificationCriterion`
- **When** it is admitted to the probe catalogue
- **Then** admission is refused, because a probe without a stated observable and refuting value is not admissible

##### Should reject an Invariant Probe when it cannot fail `[E]`

- **Given** a probe and a deliberately broken collaborator that violates the probe's own claim
- **When** the probe is executed against the broken collaborator during review
- **Then** the probe must report failure; a probe that still passes is rejected as incapable of failing

##### Should reject an Invariant Probe when it observes code shape rather than behaviour `[E]`

- **Given** a probe whose criterion inspects source structure, call arrangement, or the presence of a function
- **When** the probe is reviewed
- **Then** it is rejected as a Structural Proof where a Behavioural Proof is required

#### Fault Injection Case `[E]`

##### Should count an irreversible effect without performing it when the provider double misbehaves `[E]`

- **Given** a capability provider double instructed to ignore `AbortSignal`
- **When** the Fault Injection Case runs a timeout-then-retry sequence
- **Then** the double increments its own effect ledger per idempotency key and performs no external effect, so a duplicate is observable without being executed

#### Benchmark Ledger `[E]`

##### Should reject a MeasurementSample when it carries no runner fingerprint `[E]`

- **Given** a sample with metric, value, unit, run id, and commit but no `RunnerFingerprint`
- **When** append is attempted
- **Then** the append is refused, because a sample without a fingerprint is unusable for noise separation

##### Should refuse to compare samples when their runner fingerprints differ `[E]`

- **Given** two samples for the same metric with different `os`, `arch`, `cpuCount`, `bunVersion`, or `ci` values
- **When** a breach evaluation is requested over them
- **Then** they are not compared and the evaluation reports insufficient same-fingerprint samples

##### Should treat a single excursion as noise when only one run exceeds the band `[E]`

- **Given** a `BudgetBand` with a median, a tolerance, and `consecutiveBreaches` `k` greater than one, and one same-fingerprint run outside the band
- **When** `EvaluatePerformanceBudget` runs
- **Then** no breach is declared and no debt entry is opened

##### Should declare a breach when `k` consecutive same-fingerprint runs exceed the band `[E]`

- **Given** `k` consecutive samples of one metric, all with the same runner fingerprint and all outside the band
- **When** `EvaluatePerformanceBudget` runs
- **Then** a breach is declared, a debt entry is opened naming the metric, band, samples, and run ids, and no blocking gate is failed

##### Should reject a ledger rewrite when past samples are altered or removed `[E]`

- **Given** a committed `benchmark-ledger.jsonl` and a candidate version in which an earlier line is edited or deleted
- **When** the reconciliation check runs
- **Then** it fails, because the ledger is append-only and a green measurement history cannot be rewritten

#### Coverage Baseline `[E]`

##### Should reject a Coverage Baseline when it states no scope `[E]`

- **Given** a baseline entry recording line and function percentages with no enumerated path list
- **When** the loader reads it
- **Then** it is rejected as theatre: a figure over an unstated scope proves nothing about what was counted

##### Should fail the ratchet when a measured figure falls below the baseline `[E]`

- **Given** a baseline figure for the declared EAP scope and a run measuring lower line or function coverage inside the same scope
- **When** `EvaluateCoverageBaseline` runs
- **Then** the gate fails reporting baseline, measured, and delta

##### Should require the new baseline in the same change when coverage rises `[E]`

- **Given** a run measuring coverage above the committed baseline
- **When** the gate evaluates the change
- **Then** the change is required to commit the raised baseline, so the ratchet cannot drift upward silently or be re-lowered later without a visible diff

#### Toolchain Pin `[E]`

##### Should resolve the compiler from the lockfile when the Toolchain Pin is applied `[E]`

- **Given** `typescript` recorded at the repository root with an exact version in `bun.lock`
- **When** the typecheck command runs
- **Then** it resolves that exact version rather than whatever a registry offers at run time, and an unpinned resolution is itself reported as the defect

##### Should fail the baseline gate when a per-file error count rises `[E]`

- **Given** a `FrozenErrorSet` recording the 24 pre-existing errors by file with a total
- **When** the pinned compiler reports a higher count for any listed file
- **Then** the gate fails naming the file, the baseline count, and the observed count, and the errors are not fixed by this domain

##### Should fail the baseline gate when a file absent from the baseline reports an error `[E]`

- **Given** the same `FrozenErrorSet`
- **When** the pinned compiler reports an error in a file the baseline does not list
- **Then** the gate fails naming the new file, because a new erroring file is a growth of the frozen set

##### Should require the reduced count to be committed down when a file's error count falls `[E]`

- **Given** a baseline file whose observed error count is now lower than recorded
- **When** the gate evaluates the run
- **Then** the gate requires the reduced count to be committed into the baseline in the same change, so the ratchet only ever shrinks

#### Test Index `[E]`

##### Should derive `tested_by` from the Traceability Map when the Test Index is rendered `[E]`

- **Given** a Traceability Map containing established links
- **When** the Test Index is rendered
- **Then** `tested_by` and `test_files` are computed from the map, and a hand-authored value in either field is not honoured

#### Suite Run `[E]`

##### Should publish exactly one Suite Verdict when a Suite Run completes `[E]`

- **Given** one Suite Run with all gates evaluated
- **When** the verdict is published
- **Then** exactly one `SuiteVerdict` exists for that run id, naming every gate, its outcome, and its evidence reference

##### Should record a Flake when a test case yields differing verdicts at the same commit `[E]`

- **Given** two Suite Runs at the same commit with no change to the code under test and differing verdicts for one test case
- **When** the runs are compared
- **Then** a `FlakeRecord` is appended carrying the test case, the observed verdicts, and the run ids

### 1.2 Value Objects and Contract Types

##### Should reject a `ScenarioIdentifier` when its format is not `EAP-<AREA>-<NNN>` `[E]`

- **Given** a candidate identifier missing the prefix, the area, or the numeric suffix
- **When** construction is attempted
- **Then** construction is rejected and no register entry is created

##### Should treat two `ScenarioIdentifier` values as one key when their spellings match `[E]`

- **Given** two identifier inputs resolving to the same `EAP-<AREA>-<NNN>`
- **When** they are compared or used as keys in a Set or Map
- **Then** they behave as one equal value and the register holds a single entry

##### Should reject a `ScenarioStatus` outside its closed union `[E]`

- **Given** a status value other than `declared-untestable`, `proposed`, or `evidenced`
- **When** it is set on a register entry
- **Then** it is rejected and the entry keeps its previous status

##### Should reject a `TraceabilityLink` whose kind is neither `asserts` nor `covers-partially` `[E]`

- **Given** a link record with any other kind value
- **When** the map is generated
- **Then** the link is rejected and the run reports the offending annotation

##### Should reject a `DischargeAnnotation` naming a Scenario Identifier absent from the register `[E]`

- **Given** a test case annotated with an identifier that the Scenario Register does not contain
- **When** the annotation is emitted at run time
- **Then** the run fails with a named error identifying the unknown identifier, the file, and the test name

##### Should never derive a `DischargeAnnotation` from a test title `[E]`

- **Given** a test case whose title contains a string resembling a Scenario Identifier but which emits no annotation
- **When** annotations are collected
- **Then** no link is created and the test case is reported as unclaimed, because titles are never parsed

##### Should reject a `QuarantineFamilyId` outside `QA1`–`QA7` `[E]`

- **Given** a family id such as `QA8` or a free-text family name
- **When** the quarantine document is loaded
- **Then** loading fails and no family is admitted

##### Should reject a `ConformanceItem` whose evidence predicate is not host-log observable `[E]`

- **Given** an item whose predicate requires reading host internal state or trusting a self-reported value
- **When** the manifest is validated
- **Then** the item is inadmissible and named in the failure

##### Should reject a `ConformanceClaimState` outside its closed union `[E]`

- **Given** a claim state other than `claimed`, `not-yet-claimed`, or `out-of-scope`
- **When** the manifest is loaded
- **Then** loading fails naming the item

##### Should compare `AssertionFingerprint` values order-insensitively when a file is reformatted `[E]`

- **Given** a fingerprinted test file whose tests are reordered and whose formatting changes without adding or removing any `expect()`
- **When** the fingerprint is recomputed
- **Then** the multiset of `(matcher, normalized-subject)` pairs is equal and the hash is unchanged

##### Should report a changed hash and the missing assertion when one `expect()` is removed `[E]`

- **Given** a fingerprinted test file
- **When** exactly one `expect()` call is deleted and the fingerprint is recomputed
- **Then** the hash differs and the comparison names the missing `(matcher, normalized-subject)` pair

##### Should reject a subset match when fingerprint comparison runs `[E]`

- **Given** a post-change fingerprint that is a proper subset of the pre-change fingerprint
- **When** the two are compared
- **Then** the comparison fails: equality is required and a subset is never accepted as equal

##### Should reject a `RetryProvenance` whose retry pass is outside 1..8 `[E]`

- **Given** a provenance block naming a retry pass outside the observed range or omitting the finding class
- **When** the corpus inventory validates it
- **Then** validation fails and the rename is not accepted

##### Should reject a `FalsificationCriterion` that states no refuting value `[E]`

- **Given** a criterion naming an observable but no predicate that would refute the claim
- **When** the probe is admitted
- **Then** admission is refused

##### Should reject a `MeasurementSample` missing its run id or commit `[E]`

- **Given** a sample without a run id or without a commit
- **When** append is attempted
- **Then** the append is refused, because a measured bound unattached to the run and commit that produced it is not evidence

##### Should reject a `BudgetBand` that states no `k` `[E]`

- **Given** a band with a median and tolerance but no `consecutiveBreaches` value
- **When** the band is loaded
- **Then** loading fails, because noise separation is undefined without `k`

##### Should never count an `advisory` `GateVerdict` as a pass `[E]`

- **Given** a gate whose outcome is `advisory`
- **When** the Suite Verdict is composed
- **Then** the outcome is reported as `advisory`, is not counted as `pass`, and does not contribute to a pass rate

##### Should reject a `FlakeRecord` with no owner when a flake is quarantined `[E]`

- **Given** an observed verdict variance with no named owner
- **When** quarantine is attempted
- **Then** quarantine is refused and the test file is neither skipped nor deleted

##### Should reject a `SuiteVerdict` that was hand-authored `[E]`

- **Given** a verdict file written by hand rather than parsed from runner and gate output
- **When** it is published
- **Then** publication is refused, per ADR-0021's rule that self-report never counts

### 1.3 Domain Services

##### Should fail the build when a Traceability Link points into any of the seven quarantined families `[E]`

- **Given** a Traceability Link whose Scenario Identifier belongs to `QA1`, `QA2`, `QA3`, `QA4`, `QA5`, `QA6`, or `QA7`
- **When** `DetectQuarantineViolation` runs
- **Then** the gate fails, blocking, with the family id, the test file, and the test name in the message — for each of the seven families independently

##### Should distinguish an undecided behaviour from a broken test when a Quarantine Violation is reported `[E]`

- **Given** a Quarantine Violation and, separately, an ordinary failing test case
- **When** each failure message is read
- **Then** the Quarantine Violation states that the behaviour is undecided and names the ADR amendment that would lift it, and cannot be mistaken for a broken test

##### Should permit a measurement inside a quarantined family when it asserts no outcome `[E]`

- **Given** a probe that records closure cost, batch behaviour, or refusal-code timing for a `QA6` or `QA7` subject and appends the observation to the Benchmark Ledger
- **When** the quarantine gate evaluates the run
- **Then** the gate passes, because measurement without assertion is permitted while an assertion bounding the observed value is forbidden

##### Should promote a Scenario to `evidenced` only when an `asserts` link passed in the same run `[E]`

- **Given** a Scenario Identifier with at least one `asserts` link whose test case passed in Suite Run `R` at commit `C`
- **When** `PromoteScenarioStatus` runs over `R`
- **Then** the derived report marks the scenario `evidenced` and names run id `R`, commit `C`, and the discharging test references

##### Should refuse promotion when only `covers-partially` links exist `[E]`

- **Given** a Scenario Identifier with three `covers-partially` links, all of whose test cases passed
- **When** `PromoteScenarioStatus` runs
- **Then** the scenario remains `proposed` and no partial-link count is sufficient to promote it

##### Should refuse promotion when the linked test case did not pass in that run `[E]`

- **Given** an `asserts` link whose test case failed, was skipped, or did not execute in the evaluated run
- **When** `PromoteScenarioStatus` runs
- **Then** the scenario remains `proposed` and the report records the absence of a passing execution

##### Should discard a hand-written `evidenced` marker when status is derived `[E]`

- **Given** a committed derived status report that has been edited by hand to mark a scenario `evidenced` with no supporting link or run
- **When** the report is regenerated
- **Then** the edit is overwritten, the scenario reverts to `proposed`, and the regeneration diff exposes the falsification attempt

##### Should leave `docs/specs/cognitive_line/004` unmodified when any status is promoted `[E]`

- **Given** any number of scenarios promoted to `evidenced`
- **When** the derived report is published
- **Then** `docs/specs/cognitive_line/004-open-graph-mcp-test-scenarios.md` is byte-identical to its pre-run content and the promotion lives only in the derived report

##### Should prove a rename dropped nothing when the assertion multiset is compared `[E]`

- **Given** a pre-rename `AssertionFingerprint` captured for `f001-retry5-durability.test.ts`
- **When** the file is renamed to a behavioural name and the fingerprint is recaptured
- **Then** the two multisets are equal, the stored path is updated, the hash is unchanged, and `RetryArchaeologyRetired` is recorded

##### Should fail the gate naming the missing assertions when a rename silently drops one `[E]`

- **Given** a rename in which one `expect()` is removed while the suite still passes
- **When** `RetireRetryArchaeology` compares fingerprints
- **Then** `AssertionSetReduced` is raised, the gate fails blocking, and the missing `(matcher, normalized-subject)` pairs are named — the suite passing after the rename proving only that what remains passes

##### Should lose no Traceability Link when the Test Corpus is renamed `[E]`

- **Given** a Traceability Map generated before the rename of the `f001-retry*` files
- **When** the map is regenerated after the rename
- **Then** every Scenario Identifier retains at least the links it held before, under the new file paths

##### Should compose one verdict from all gate signals when the Quality Gate is evaluated `[E]`

- **Given** typecheck, traceability, quarantine, conformance, coverage, and flake signals for one run
- **When** `EvaluateQualityGate` composes them
- **Then** one verdict names each gate with `pass`, `fail`, or `advisory` and its evidence reference, and each gate's blocking status is read from its declared policy rather than inferred

##### Should carry no state between executions when a verification service runs twice `[E]`

- **Given** any of `ReconcileTraceability`, `PromoteScenarioStatus`, `FingerprintAssertions`, or `ReconcileTestIndex` executed twice over identical inputs
- **When** the second execution completes
- **Then** its output equals the first exactly, with no accumulated state from the earlier run

### 1.4 Domain Events

##### Should contain its tactical minimum payload when a verification event is emitted `[E]`

- **Given** any successful trigger defined for `ToolchainPinned`, `TypecheckGateRestored`, `ScenarioIdentifierAssigned`, `ScenarioDeclaredUntestable`, `ConformanceManifestPublished`, `TraceabilityLinkEstablished`, `TraceabilityGapDetected`, `QuarantineViolationDetected`, `ScenarioStatusPromotedToEvidenced`, `RetryArchaeologyRetired`, `AssertionSetReduced`, `CoverageMeasured`, `CoverageRegressionDetected`, `ConcurrencyProbeExecuted`, `DuplicateIrreversibleEffectObserved`, `UnboundedReadModelObserved`, `PerformanceBudgetBreached`, `FlakeObserved`, `DocumentationDriftDetected`, or `SuiteVerdictPublished`
- **When** the corresponding event is emitted
- **Then** it contains every minimum payload field listed for that event in the tactical design

##### Should remain an append-only observation when a verification event is consumed `[E]`

- **Given** an emitted verification event and a consumer such as a gate, a report renderer, or a CI artifact uploader
- **When** the consumer handles it
- **Then** the event cannot be mutated and confers no authority to change a gate outcome or a scenario status

##### Should write into no EAP tenant audit plane when a verification event is recorded `[E]`

- **Given** any verification event emitted during a Suite Run
- **When** it is persisted
- **Then** it lands only in the verification ledger under `docs/verification/` or `.verification/`, and EAP's tenant-visible audit state is unchanged — the two planes stay Separate Ways

---

## 2. Integration Scenarios

> Real stores on disk, the real runner, the real compiler. No mocks for the target dependency.

### 2.1 Repositories and Persistence

##### Should retain a retired entry when the Scenario Register is saved and reloaded `[E]`

- **Given** a register containing an active entry and an entry marked `retired: true`
- **When** the register is written to `docs/verification/scenario-register.json` and reloaded
- **Then** both entries are present with identical Scenario Identifiers and the retired one is still excluded from reuse

##### Should preserve sorted stable order when the Scenario Register is written `[E]`

- **Given** a register whose entries are constructed in arbitrary insertion order
- **When** it is written
- **Then** the file is sorted by Scenario Identifier so that a review diff shows only real changes

##### Should reject an edit to the Quarantine Store when no ADR amendment accompanies it `[E]`

- **Given** a change to `docs/verification/quarantine.json` altering a family's membership or lifting condition
- **When** the gate evaluates the change
- **Then** it fails unless the same change carries the merged ADR amendment naming that family

##### Should resolve each Conformance Item to its source line when the manifest is loaded `[E]`

- **Given** `docs/verification/conformance-manifest.json`
- **When** each item's `sourceLine` is resolved against `docs/PRD/OpenGraph_Working_Paper_v1_0.md`
- **Then** every line reference points into the Apêndice D block at line 1164 or below, and an item whose line does not resolve fails the load

##### Should collect one annotation record per test case execution when the sink is read `[E]`

- **Given** annotated test cases in `graph-core`, `mcp-server`, and `client` suites executed in one run
- **When** `.verification/annotations.jsonl` is collected
- **Then** it holds exactly one record per annotated execution, each carrying file, test name, and Scenario Identifiers, and records from all three packages land in the one sink

##### Should append and never rewrite when the Benchmark Ledger receives new samples `[E]`

- **Given** an existing `benchmark-ledger.jsonl` with prior samples
- **When** a probe appends new samples across several runs
- **Then** all prior lines are byte-identical, new lines are appended, and no build step prunes the file

##### Should keep every open Flake entry until a named cause closes it `[E]`

- **Given** an open entry in `docs/verification/flake-ledger.jsonl` with an owner
- **When** closure is attempted without a named cause
- **Then** closure is refused, the entry stays open, and the underlying test file is never removed

##### Should retain the published verdict as a CI artifact when a run completes `[E]`

- **Given** a Suite Run that published `.verification/run/<runId>.json`
- **When** the run finishes
- **Then** the verdict is uploaded as an artifact with the declared retention, and a later run cannot overwrite or rewrite an earlier verdict

##### Should rebuild identical EAP state across a host restart when the shared fixture restarts `[B]`

- **Given** an `EapEnv` over real on-disk SQLite and JSONL with admitted state
- **When** `restart()` is called as the sole restart boundary
- **Then** the environment returns the same tenant, repositories, and observed Sequence anchor, and probes observe the real durability path rather than an in-memory double

##### Should add multi-process handles without mutating the shared fixture's type surface `[E]`

- **Given** the co-owned `EapEnv` type surface consumed by the mcp-server test files
- **When** `ProbeHostPort` supplies `spawnWriters`, `openSeparateConnection`, and `fingerprintRunner`
- **Then** the probes reach multi-process and multi-connection capability through that Anti-Corruption Layer and `EapEnv`'s published surface is unchanged

### 2.2 Use Cases and CI Binding

##### Should evaluate the same test set locally and in CI when the unified entrypoint runs `[E]`

- **Given** root `package.json`'s `test` script running only `packages/mcp-server` while CI runs root `bun test` `[B]`
- **When** the unified entrypoint is invoked locally and in the CI `test` job
- **Then** both report the same test count and the same file count, and no package-level script silently narrows the set the gate evaluates

##### Should run typecheck and the full suite under one documented command when `verify` is invoked `[E]`

- **Given** a pinned compiler and the unified test entrypoint
- **When** `bun run verify` is executed locally
- **Then** it runs the typecheck against the frozen baseline followed by the full suite, and is the single documented local entrypoint

##### Should complete without a compiler panic when the pinned typecheck runs over `mcp-server` `[E]`

- **Given** `typescript` pinned at the repository root from the lockfile and the self-contained `packages/mcp-server/tsconfig.json`
- **When** `tsc --noEmit -p packages/mcp-server/tsconfig.json` runs
- **Then** it runs to completion and reports diagnostics, rather than resolving an unpinned compiler and aborting with a Go stack trace

##### Should cover graph-core, mcp-server, and client when the typecheck job runs `[E]`

- **Given** the CI `typecheck` job
- **When** it executes
- **Then** all three packages are checked, the job blocks the merge, and its blocking status is stated explicitly in the workflow rather than inherited

##### Should fail a claimed Conformance Item when no annotated test case discharges it `[E]`

- **Given** a manifest item whose claim state is `claimed`
- **When** the conformance assessment runs and no Discharge Annotation names that item id
- **Then** the gate fails naming the item, its level, and its role

##### Should report host and client verdicts independently when conformance is assessed `[E]`

- **Given** annotated conformance test cases in `packages/mcp-server/test/eap-conformance.test.ts` and `packages/client/test/eap-conformance.test.ts`
- **When** the assessment report is produced
- **Then** host and client verdicts are reported separately and are never merged into one pass rate, so a disagreement between the two sides is visible

##### Should report a `not-yet-claimed` item as a declared exclusion when conformance is assessed `[E]`

- **Given** the L3 R9-budget item marked `not-yet-claimed`
- **When** the assessment runs
- **Then** the item is reported as a declared exclusion, is never counted as a failure, and is never counted as green

##### Should fail the reconciliation gate when `tested_by` is stale `[E]`

- **Given** `docs/feature/cognitive_line.md` whose graph block declares `"tested_by": []` `[B]` while the Traceability Map holds established links
- **When** `ReconcileTestIndex` regenerates and diffs
- **Then** `DocumentationDriftDetected` is raised and the gate fails naming file, field, expected, and actual

##### Should fail the reconciliation gate when `test_files` omits an EAP test file `[E]`

- **Given** a `test_files` list omitting `f001-retry6-readmodel-and-freshness`, `f001-retry7-closure-gate`, `f001-retry8-resume-index`, `f001-transport-delegation`, or `f001-validation-audit-vulns` `[B]`
- **When** the index is regenerated
- **Then** the gate fails, and after task 12 the expected list names those files under their post-rename names

##### Should fail the reconciliation gate when the digest documents a deleted typecheck route `[E]`

- **Given** `docs/.digest.md` still directing readers to `packages/mcp-server/tsconfig.check.json`, deleted in commit `71887e1` `[B]`
- **When** the index reconciliation runs
- **Then** the gate fails and the expected content is the pinned typecheck command from the Toolchain Pin

##### Should fail the reconciliation gate when the document index omits the normative source `[E]`

- **Given** `docs/.graph.json` indexing exactly two nodes and omitting `docs/PRD/` `[B]`
- **When** the index reconciliation runs
- **Then** the gate fails, because a Conformance Item cannot be routed from code back to its normative clause while the Working Paper and `PRD.md` are unindexed

##### Should refute the monotonicity claim when the concurrency probe runs against a broken `allocateSequence` `[E]`

- **Given** a pre-registered falsification criterion stating that a reused Sequence or a lost admitted write refutes the monotonicity claim, and a deliberately broken `allocateSequence`
- **When** writers are driven from separate OS processes on separate SQLite connections
- **Then** the probe fails and names the reused Sequence or the lost write, proving the probe can fail

##### Should block on the deterministic observations and only measure the timings when the concurrency probe runs `[E]`

- **Given** the multi-process concurrency probe over an unmodified host
- **When** it completes
- **Then** absence of Sequence reuse and absence of a lost admitted write are asserted and block, while write-lock hold time and writer starvation are appended to the Benchmark Ledger with a runner fingerprint and assert nothing

##### Should observe a duplicate irreversible effect count when the provider ignores `AbortSignal` `[E]`

- **Given** a capability provider double that ignores `AbortSignal` and hangs past the configured timeout, and a request retried after the timeout releases the idempotency key
- **When** the cancellation Fault Injection Case runs
- **Then** the effect ledger's count per idempotency key is reported, the observation is deterministic and blocking, and `TL.json` open point 2 acquires a named discharging test case in the Traceability Map

##### Should measure and never bound the read models when the 100k-claim volume probe runs `[E]`

- **Given** a tenant fixture built with 100,000 claims
- **When** the volume probe exercises closure re-derivation and the unpaginated `getEvents` and `getProposalsForParent` read models
- **Then** fixture build time, closure re-derivation wall time, row count, wall time, and peak heap are appended to the Benchmark Ledger with runner fingerprints, and no maximum batch size, page size, or completion bound is asserted, honouring QA6

##### Should attribute the remaining tech-lead open points to a run and commit when the scale probe completes `[E]`

- **Given** `TL.json` open point 1 (synchronous closure re-derivation inside `serialTransaction` after a JSONL rebuild) and open point 3 (unpaginated read models with no retention window)
- **When** the probes complete
- **Then** each acquires a named measurement in the Benchmark Ledger attributable to a run id and commit, and neither is recorded as closed by a timing claim

##### Should keep the merge ungated by any timing or volume claim when the probe job runs `[E]`

- **Given** an `eap-probes` CI job carrying `continue-on-error: true` and its own trigger
- **When** a probe reports a slow measurement or a breached band
- **Then** the merge is not blocked, the Benchmark Ledger delta is uploaded as an artifact, and the deterministic correctness assertions inside those probes still run in the blocking suite

##### Should distinguish probe contention from runner slowness when a Flake is observed `[E]`

- **Given** a flake observation recorded during a run that also executed the write-lock concurrency probe
- **When** the flake ledger entry is evaluated
- **Then** the runner fingerprint recorded with the observation separates probe-generated contention from a slow runner, and the entry names which it was

### 2.3 External Integrations

##### Should honour the declared timeout budget when a verification check runs under `bun test` `[E]`

- **Given** `bunfig.toml` `[test] timeout = 15000` `[B]`
- **When** a verification or conformance check is admitted to the blocking suite
- **Then** it completes inside that budget, and a check that cannot is not admissible to the blocking path and moves to the probe job

##### Should measure and report the instrumented run cost when coverage instrumentation is enabled `[E]`

- **Given** an uninstrumented baseline suite time of 74.55s for 701 tests across 134 files `[B]`
- **When** coverage instrumentation runs over the declared EAP scope
- **Then** the instrumented run time is measured and reported so its cost against the blocking path is known

##### Should produce line and function figures for the enumerated EAP paths when coverage is measured `[E]`

- **Given** an explicit path list covering `packages/graph-core/src/eap`, `packages/mcp-server/src/eap`, `packages/mcp-server/src/tools/eap.ts`, `packages/mcp-server/src/gates.ts`, and `packages/client/src/eap.ts`
- **When** `MeasureCoverage` runs
- **Then** line and function figures are produced for that scope and recorded together with the path list

##### Should protect the manifest from a source change when Apêndice D is edited `[E]`

- **Given** a manifest transcribed from Apêndice D and a subsequent edit to the Working Paper's appendix text
- **When** the manifest is validated against its source lines
- **Then** the divergence is reported and the manifest is not silently re-interpreted, since graduation past `[E → G2]` is a Working Paper decision this domain requests and does not perform

##### Should state its blocking status explicitly when any CI job is defined `[E]`

- **Given** the CI jobs `test`, `client-node`, `e2e`, `load`, `typecheck`, and `eap-probes`
- **When** the workflow is reviewed
- **Then** each job carries an explicit statement of whether it blocks and on which signal, so blocking-versus-advisory is a governed decision rather than an implementation accident

---

## 3. Functional Scenarios

### 3.1 Happy Paths

##### Should carry a scenario from registration to evidenced status when a full verification run completes `[E]`

- **Given** a seeded Scenario Register, a recorded seven-family Ambiguity Quarantine, and an EAP test case annotated with one `asserts` Discharge Annotation
- **When** the pinned typecheck runs, the unified suite executes, annotations are collected, the Traceability Map is regenerated, and the Suite Verdict is published
- **Then** the derived status report marks that Scenario Identifier `evidenced` naming the run id and commit, the Test Index's `tested_by` includes it, `docs/specs/cognitive_line/004` is unmodified, and the verdict is read from runner output

##### Should retire Retry Archaeology without losing evidence when the corpus is renamed `[E]`

- **Given** baseline fingerprints captured for all seven `f001-*` files and a Traceability Map generated before the rename
- **When** `f001-retry5-concurrency-authz`, `f001-retry5-durability`, `f001-retry6-readmodel-and-freshness`, `f001-retry7-closure-gate`, and `f001-retry8-resume-index` are renamed to behavioural names
- **Then** post-rename fingerprints equal the pre-rename fingerprints exactly, each file carries its `RetryProvenance`, the regenerated map loses no link, and the Test Index lists the new names

##### Should publish a per-level, per-role conformance verdict when the manifest is executed `[E]`

- **Given** a published Conformance Manifest claiming L2 in full, L0 and L1 for the client role, and each L3 item individually
- **When** the assessment runs black-box over real transport
- **Then** every `claimed` item resolves to at least one annotated test case, host and client verdicts are reported independently, the R9 budget item is reported as a declared exclusion, and no L4 row appears anywhere in the report

##### Should record measured bounds without blocking the merge when the probe suite runs `[E]`

- **Given** the multi-process concurrency probe, the cancellation Fault Injection Case, and the 100k-claim volume probe, each with a pre-registered falsification criterion
- **When** the `eap-probes` job runs on its own trigger
- **Then** the deterministic correctness observations pass in the blocking suite, every timing and volume sample is appended to the Benchmark Ledger with a runner fingerprint, and the merge is gated on no timing or volume claim

### 3.2 Alternative and Error Paths

##### Should block the merge when a test case discharges a quarantined Scenario `[E]`

- **Given** a test case annotated with a Scenario Identifier belonging to any of `QA1`–`QA7`
- **When** the quarantine gate runs
- **Then** the merge is blocked, the message names the family, the file, the test name, and the ADR amendment that would lift the family, and it states that the behaviour is undecided rather than that the test is broken

##### Should block the merge when the Traceability Map reports a gap in either direction `[E]`

- **Given** one Scenario Identifier with no discharging test case and one executed EAP test case emitting no annotation
- **When** the reconciliation gate runs
- **Then** the gate fails reporting both directions in separate lists, and neither direction is downgraded to a warning

##### Should block the merge when the typecheck baseline grows `[E]`

- **Given** the frozen per-file `FrozenErrorSet` totalling the 24 pre-existing errors
- **When** a change raises any per-file count or introduces an error in a file absent from the baseline
- **Then** the merge is blocked with file, baseline count, and observed count reported, and the change is not permitted to suppress the error or edit the baseline upward

##### Should block the merge when coverage falls inside the declared scope `[E]`

- **Given** a committed Coverage Baseline with its enumerated path list
- **When** a change lowers line or function coverage inside that scope
- **Then** the merge is blocked with baseline, measured, and delta reported

##### Should reject a Coverage Baseline that proves nothing when its counting policy is absent `[E]`

- **Given** a baseline recording a single global percentage with no enumerated path list and no statement of what counts
- **When** the loader reads it
- **Then** it is rejected: the figure cannot support a claim about the EAP surface because nothing states which paths it counted

##### Should block the merge when a rename reduces the assertion set `[E]`

- **Given** a renamed test file whose post-rename fingerprint is a proper subset of its pre-rename fingerprint
- **When** the fingerprint gate runs
- **Then** the merge is blocked with each missing assertion named, regardless of the suite reporting green

##### Should open an owned debt entry rather than delete the test when a Flake is quarantined `[E]`

- **Given** a test case that yielded differing verdicts across runs at the same commit
- **When** it is quarantined
- **Then** a `FlakeRecord` with a named owner is appended, the test file remains in the corpus and is not deleted or permanently skipped, and closing the entry later requires a named cause

##### Should refuse a self-reported outcome when a Suite Verdict is published `[E]`

- **Given** a candidate verdict whose gate outcomes were authored rather than parsed from runner and gate output
- **When** publication runs
- **Then** publication is refused per ADR-0021, and the run has no published verdict rather than a convenient one

##### Should open a debt entry rather than fail a gate when a performance budget is breached `[E]`

- **Given** `k` consecutive same-fingerprint runs of one metric outside its band
- **When** the budget evaluation runs
- **Then** `PerformanceBudgetBreached` is raised, a debt entry naming the metric, band, samples, and run ids is opened, and no blocking gate fails

### 3.3 Security and Boundary

##### Should write into no read-only input when any verification step runs `[E]`

- **Given** a full verification run touching the Scenario Register, Traceability Map, derived status report, Test Index, and Benchmark Ledger
- **When** the run completes
- **Then** no file under `docs/specs/cognitive_line/**` or `docs/harness-history/**` is modified, and an attempted write there fails the run

##### Should keep the verification ledger out of the tenant audit plane when evidence is persisted `[E]`

- **Given** verification evidence produced by a Suite Run
- **When** it is persisted
- **Then** it lands only under `docs/verification/` or `.verification/`, and no EAP tenant-visible audit record is created, altered, or read as a verification signal

##### Should redact tenant fixture content when a failing-test artifact is uploaded `[E]`

- **Given** a probe or scale fixture that materialised tenant data — evidence anchors, provenance references, or operator identities — on disk
- **When** the run fails and artifacts are uploaded with the declared retention
- **Then** the classification policy for fixture content applies before upload — **this scenario is blocked pending the redaction policy recorded as open in §4 and may not be implemented by choosing a policy**

##### Should require a hostile-identity submission before the caller-blindness item is claimed `[E]`

- **Given** the L2 caller-blind-gate manifest item and the existing tests that assert an authorization check was invoked
- **When** the item's claim state is evaluated
- **Then** it may be `claimed` only if an annotated test case actually submits identical content under N distinct identities and compares verdicts; asserting that the check was called is insufficient

##### Should keep the gate uncoupled from the transport when a domain rule is asserted `[E]`

- **Given** an EAP domain rule owned by `graph-core`
- **When** an `mcp-server` test case asserts it directly on the wire shape rather than through the declared Anti-Corruption Layer
- **Then** the corpus audit reports the coupling, so replacing MCP would invalidate the adapter rather than the domain test cases

##### Should prevent an author from granting evidence when any status, verdict, or claim is written `[E]`

- **Given** hand edits to the derived status report, the Suite Verdict, the Traceability Map, or a `claimed` manifest item unsupported by an annotated test case
- **When** the corresponding artefact is regenerated or validated
- **Then** every edit is overwritten or rejected and named in the diff, so `[E]`→`[B]` promotion, a green verdict, and a conformance claim are each unreachable by authorship

---

## 4. Deferred Scenario Boundaries

### 4.1 Quarantined Ambiguity families — measured, never asserted

Seven families are Declared Untestable. Every member Scenario carries status `declared-untestable`, never `[E]` and never `[B]`; no Traceability Link may be created for one; a link into any of them is a Quarantine Violation and fails the build. A family is lifted only by a merged ADR amendment naming it, after which its scenarios re-enter the register as `proposed` and follow the ordinary path.

| Family | Quarantined Ambiguity | Why a passing test would decide it |
|---|---|---|
| QA1 | Promotion already in flight when the Horizon DAG changes | The criteria for a legitimate topology extension are unwritten; a test would fix the semantics by fiat. |
| QA2 | The exact destination status of indirect dependents in a Recall cascade | The question is Open; a test would pick one of the two candidate statuses. |
| QA3 | Whether `RecallNotice` and an invalidating Contestation are one admitted object or two | Identity determines the audit shape; asserting either shape settles it. |
| QA4 | Whether unknown `faulty_since_seq` widens the closure or only the audit window | Asserting a closure size decides contamination scope. |
| QA5 | Mapping `LegacyClaimStatus` values into the Epistemic Lifecycle | A migration test is a migration specification. |
| QA6 | Page size, batching limits, and completion bounds for very large closures | Measurement is permitted and is recorded in the Benchmark Ledger; an assertion that bounds is a decision and is forbidden. |
| QA7 | Whether refusal codes, timing, or closure counts leak protected content | A timing-differential probe may measure and record; specifying its expected outcome would decide an open architectural question. |

### 4.2 Questions carried forward unanswered — a dependent scenario may not be implemented until each is decided

These are recorded so that no implementer resolves one by choosing a convenient value.

- **Band tolerance and `k`, and who arbitrates a breach.** `BudgetBand` carries `tolerance` and `consecutiveBreaches`; both values and the arbiter are unset. Every breach-versus-noise scenario above is unimplementable until they are fixed.
- **The blocking-path latency ceiling.** Instrumented run time is measured, but the maximum acceptable feedback latency — and therefore which probes are forbidden from blocking — is undecided.
- **The 100k fixture build budget, its location, and its trigger cadence.** Placed in the non-blocking probe job; how long the build may take and on which trigger it runs remain open and may not be settled by convenience.
- **Which of wall time, memory ceiling, or row count is the failure signal for the missing pagination.** All three are recorded; which one constitutes the signal is undecided, and QA6 forbids asserting a bound in any case.
- **The hostile-identity audit gating the L2 caller-blindness item.** Which existing tests actually submit under a hostile identity, versus merely assert the check was called, is unaudited; the item cannot be marked `claimed` until it is.
- **Fixture-artifact redaction policy.** Artifact retention is specified; no classification or redaction policy for fixture content exists, so the redaction scenario in §3.3 is blocked.
- **Whether property-based or fuzzed probes are in scope.** Recall's determinism, idempotency, and monotonicity are property-shaped, but no property-testing task is scheduled and no mechanism for making a failing seed reproducible inside a deterministic gate has been chosen.
- **How a currently passing test that already asserts inside QA1–QA7 is discovered.** No test names a scenario today; the quarantine gate surfaces candidates only once annotations exist, and the audit itself is unscheduled.
- **The exact message contract distinguishing "undecided" from "broken".** Required by the quarantine gate; its wording and machine-readable shape are unspecified.
- **Who owns lifting a quarantine, and what evidence beyond a merged ADR amendment is required.** `liftingCondition` is a required field with no owner assigned.
- **How many `covers-partially` links, if any, justify an `asserts` link.** Partial links can never promote; the threshold above which a scenario should be re-specified rather than partially covered is open.
- **Which EAP test helpers construct admitted state without passing through the Admission Gate.** The Verification Environment invariant is stated; the audit of the existing helpers is unscheduled.
- **The naming policy for a new vulnerability class.** Whether it extends `f001-validation-audit-vulns` or creates a new file is undecided; traceability makes an untraceable dump detectable but does not prevent one.
- **Whether `mcp-server` tests re-assert `graph-core` domain rules.** The Anti-Corruption Layer toward Transport Binding is declared; the corpus audit that would confirm compliance is unscheduled.
- **Who owns the conformance contract when the host and client `eap-conformance` suites disagree.** Independent per-role verdicts expose the disagreement without resolving ownership.
- **The authoritative observable per probe.** Candidate observables are named for the write-lock, cancellation, and volume probes; the authoritative one for each is the architect's call.

Graduating Apêndice D past `[E → G2]` is a Working Paper decision this domain requests and does not perform. Promotion of any probe from advisory to blocking stays out of scope until a stable measured baseline exists in the Benchmark Ledger.
