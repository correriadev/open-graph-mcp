# Cognitive Line Test Automation — Problem Space

**Domain:** `cognitive_line_test_automation` | **Project:** `open-graph-mcp` | **Language:** English
**Date:** 2026-08-12

## Scope and Status Discipline

This is the strategic problem-space model for the **quality/verification subdomain of the already-implemented `cognitive_line` domain (feature F001, Epistemic Admission Protocol)**. The predecessor domain's 13 tactical tasks are COMPLETED; this domain does not add EAP behaviour. It turns a test suite that accreted across five adversarial validation retries into a durable, traceable, gated automated quality system.

Status markers follow the convention of `docs/specs/cognitive_line/003` and `004`:

- `[B]` — evidenced in the current repository (verifiable by reading the named file or running the named command).
- `[E]` — proposed evolution for this domain. An `[E]` element is a target, never a claim that it exists.

**Scope boundary (in):** `packages/graph-core/src/eap/`, `packages/mcp-server/src/eap/`, `packages/mcp-server/src/tools/eap.ts`, `packages/mcp-server/src/gates.ts`, the EAP surface of `packages/mcp-server/src/db.ts` (EAP tables, `serialTransaction`, `allocateSequence`), `packages/client/src/eap.ts`, and their tests.

**Scope boundary (out):** presence, graph, web, and stdio-proxy suites, except where EAP behaviour crosses them (e.g. `f001-transport-delegation.test.ts` `[B]`).

### Evidenced baseline `[B]`

| Fact | Evidence |
|---|---|
| Suite is green: 700 pass, 1 todo, 0 fail, 3293 `expect()` calls, 701 tests across 134 files, 74.55s | `bun test` at repo root |
| 97 test files in `packages/mcp-server/test/`; 10 in `packages/graph-core/test/`; 11 in `packages/client/test/` | directory listing |
| EAP-related test files: `capability-governance`, `contestation`, `eap-conformance`, `eap-mcp-contract`, `eap-refusals`, `f001-retry5-concurrency-authz`, `f001-retry5-durability`, `f001-retry6-readmodel-and-freshness`, `f001-retry7-closure-gate`, `f001-retry8-resume-index`, `f001-transport-delegation`, `f001-validation-audit-vulns`, `horizon-durability`, `persistent-delta`, `promotion`, `recall`, plus `eap-env.ts` | directory listing |
| **Five** EAP file names encode retry archaeology — `f001-retry5-concurrency-authz`, `f001-retry5-durability`, `f001-retry6-readmodel-and-freshness`, `f001-retry7-closure-gate`, `f001-retry8-resume-index` — not behaviour. Two further `f001-*` files (`transport-delegation`, `validation-audit-vulns`) are named behaviourally and are retained as-is | directory listing |
| No coverage tooling and no coverage threshold exist | `bunfig.toml` contains only `[test] timeout = 15000`; `docs/.digest.md` states "Coverage: no tooling configured; no threshold exists" |
| CI jobs: `test` (`bun install`, `bun test`, `bunx tsc --noEmit` + build in `mcp-web`), `client-node` (Node LTS parity for `@open-graph-mcp/client`), `e2e` (Playwright chromium, `bun run test:parity`, blocking), `load` (PR-only, `continue-on-error: true`, `bun run test:load` = presence-load only) | `.github/workflows/ci.yml` |
| No blocking typecheck gate covers `graph-core`, `mcp-server`, or `client` | `ci.yml` runs `tsc --noEmit` only inside `mcp-web`; `bunx tsc --noEmit -p packages/mcp-server/tsconfig.json` resolves an unpinned TypeScript 7 (`tsgo`) and panics with a Go stack trace; `typescript` is not installed at repo root; `ci.yml` itself carries a comment warning that `bunx tsc` resolution is unpinned |
| Documentation instruction is stale | `docs/.digest.md` still directs readers to `bunx tsc -p packages/mcp-server/tsconfig.check.json`; that file was deleted in commit `71887e1` |
| Test index is stale | `docs/feature/cognitive_line.md` graph block has `"tested_by": []`, and its `test_files` list omits `f001-retry6`, `f001-retry7`, `f001-retry8`, `f001-transport-delegation`, `f001-validation-audit-vulns` |
| No scenario→test traceability of any kind exists; the large majority of ~70 scenarios in `004` remain marked `[E]` although implemented | `docs/specs/cognitive_line/004-open-graph-mcp-test-scenarios.md` |
| Three tech-lead open points have no test that would catch them | `docs/specs/cognitive_line/TL.json` (final, score 0.85): (1) synchronous closure re-derivation inside `serialTransaction` after a JSONL rebuild — SQLite write-lock duration under concurrent tenant load; (2) `CapabilityGateway.execute` releasing the idempotency key on timeout when a provider ignores `AbortSignal` — duplicate irreversible effects on retry; (3) `SqlitePromotionRepository.getEvents` / `getProposalsForParent` unpaginated with no retention window |
| QA verdict clean | `docs/specs/cognitive_line/QA.json` (final, score 1.00, no open vulnerabilities) |
| Rework self-reports as NOT closed | `docs/specs/cognitive_line/REWORK-LOG.md`: concurrency proven only structurally and via sequence-reuse/fault-injection tests, never by a multi-process/multi-connection load test; provider cancellation is cooperative with no circuit breaker; the per-batch indexing win is never benchmarked against a 100k-claim tenant; no coverage figure exists |
| Six scenario families are deferred pending an ADR amendment | `docs/specs/cognitive_line/004` §4 |

---

## 1. Big Picture Event Storming

Ordered by temporal flow of the verification lifecycle. Aggregates belong to the quality/verification subdomain, not to EAP.

| # | Domain Event (past tense) | Command (trigger) | Aggregate | External Systems | Read Models |
|---:|---|---|---|---|---|
| 1 | Scenario Registered | Register Scenario | Scenario Register | Architect | Scenario Catalogue |
| 2 | Scenario Identifier Assigned | Assign Scenario Identifier | Scenario Register | — | Scenario Catalogue |
| 3 | Ambiguity Quarantined | Quarantine Ambiguity | Ambiguity Quarantine | Architect, ADR Author | Quarantine Register |
| 4 | Scenario Declared Untestable | Declare Scenario Untestable | Ambiguity Quarantine | — | Quarantine Register |
| 5 | Toolchain Pinned | Pin Toolchain | Toolchain Pin | Package Registry | Toolchain Manifest |
| 6 | Typecheck Gate Restored | Restore Typecheck Gate | Quality Gate | CI Runner | Gate Verdict |
| 7 | Test Case Registered | Register Test Case | Test Corpus | Test Runner | Corpus Inventory |
| 8 | Regression Case Renamed to Behaviour | Rename Regression Case | Test Corpus | — | Corpus Inventory |
| 9 | Retry Archaeology Retired | Retire Retry Archaeology | Test Corpus | — | Corpus Inventory |
| 10 | Traceability Link Established | Link Scenario to Test Case | Traceability Map | — | Traceability Matrix |
| 11 | Scenario Status Promoted to Evidenced | Promote Scenario Status | Scenario Register | — | Scenario Catalogue |
| 12 | Traceability Gap Detected | Reconcile Traceability | Traceability Map | — | Traceability Matrix, Gate Verdict |
| 13 | Quarantine Violation Detected | Reconcile Traceability | Ambiguity Quarantine | — | Quarantine Register, Gate Verdict |
| 14 | Invariant Probe Specified | Specify Invariant Probe | Invariant Probe | Architect | Probe Catalogue |
| 15 | Fault Injected | Inject Fault | Fault Injection Case | Capability Provider Double, Clock Double | Probe Report |
| 16 | Concurrency Probe Executed | Execute Concurrency Probe | Invariant Probe | Test Runner, SQLite, OS Processes | Probe Report |
| 17 | Write-Lock Hold Measured | Measure Write-Lock Hold | Performance Probe | SQLite | Benchmark Ledger |
| 18 | Duplicate Irreversible Effect Observed | Execute Cancellation Probe | Fault Injection Case | Capability Provider Double | Probe Report |
| 19 | Unbounded Read Model Observed | Execute Volume Probe | Performance Probe | SQLite | Benchmark Ledger |
| 20 | Scale Benchmark Recorded | Benchmark Closure at Scale | Performance Probe | SQLite, CI Runner | Benchmark Ledger |
| 21 | Performance Budget Breached | Evaluate Performance Budget | Performance Probe | — | Benchmark Ledger, Gate Verdict |
| 22 | Suite Run Started | Run Suite | Suite Run | CI Runner, Test Runner | Suite Report |
| 23 | Coverage Measured | Measure Coverage | Coverage Baseline | Coverage Tool | Coverage Report |
| 24 | Coverage Baseline Established | Establish Coverage Baseline | Coverage Baseline | — | Coverage Report |
| 25 | Coverage Regression Detected | Evaluate Coverage Baseline | Coverage Baseline | — | Coverage Report, Gate Verdict |
| 26 | Flake Observed | Report Suite Result | Suite Run | CI Runner | Flake Ledger |
| 27 | Flake Quarantined | Quarantine Flake | Test Corpus | — | Flake Ledger, Corpus Inventory |
| 28 | Quality Gate Evaluated | Evaluate Quality Gate | Quality Gate | CI Runner | Gate Verdict |
| 29 | Merge Blocked | Evaluate Quality Gate | Quality Gate | Version Control Host | Gate Verdict |
| 30 | Test Index Reconciled | Reconcile Test Index | Test Index | — | Feature Graph Block |
| 31 | Documentation Drift Detected | Reconcile Documentation | Test Index | — | Drift Report, Gate Verdict |
| 32 | Suite Verdict Published | Publish Suite Verdict | Suite Run | Version Control Host | Suite Report |

### Event-flow notes

- The protected flow is `REGISTER SCENARIO → LINK → EVALUATE GATE → PUBLISH VERDICT`. A test case that exists without a linked scenario, and a scenario that exists without a linked test case, are both **Traceability Gaps** — the map is bidirectional.
- **Quarantine precedes linking.** A scenario belonging to a deferred ADR family must reach `Scenario Declared Untestable` and never acquire a Traceability Link. A test that asserts an outcome inside a quarantined family raises `Quarantine Violation Detected` — the automation must fail rather than let a test silently decide an open architectural question.
- `Scenario Status Promoted to Evidenced` is the `[E] → [B]` transition of `004`'s markers. It is derived from an established Traceability Link plus a passing Suite Run — never asserted by hand.
- **Renaming is not refactoring.** `Regression Case Renamed to Behaviour` must preserve the assertion set of the retry-era test; the retry provenance moves into metadata, it is not deleted. The five failed validation passes are the regression corpus's justification and must remain readable as history.
- Probes (14–21) exist because `TL.json` and `REWORK-LOG.md` name specific risks that the current 701 tests cannot observe. A probe that cannot fail is not a probe.
- `Toolchain Pinned` (5) gates `Typecheck Gate Restored` (6): an unpinned `bunx tsc` resolution is itself the defect `[B]`.

---

## 2. Subdomain Classification

| Subdomain | Type | Justification |
|---|---|---|
| Scenario Traceability and Specification Binding | Core | The differentiator: a governed domain whose specification cannot be mapped to executable evidence has no verified specification, only prose. |
| Ambiguity Quarantine Governance | Core | Preserves the project's own method — deferred ADR questions must stay explicitly undecided; a passing test is a silent decision. |
| Epistemic Regression Corpus | Core | Encodes what five adversarial validation retries actually learned; its value is destroyed if it reads as archaeology instead of specification. |
| Invariant Probing (Concurrency, Durability, Idempotency) | Core | Reaches exactly the EAP invariants — single gate, monotonic Sequence, idempotent Recall cascade, single-use irreversible authorization — that structural tests cannot observe. |
| Quality Gate Composition | Supporting | Decides which signals block a merge and which merely inform; enables the Core but is not itself the differentiator. |
| Toolchain Determinism | Supporting | Pinned compiler and runner versions make every other signal reproducible; without it a gate verdict is not evidence. |
| Test Index Reconciliation | Supporting | Keeps `docs/feature/cognitive_line.md` and `docs/.digest.md` truthful about what is tested and how to run it. |
| Performance and Scale Probing | Supporting | Converts `REWORK-LOG.md`'s unbenchmarked claims into measured budgets; supports Core invariants without defining them. |
| Flake Management | Supporting | Protects the credibility of the gate; a gate that lies intermittently is a gate that will be bypassed. |
| Test Execution Runtime | Generic | `bun test` is a commodity runner; no domain semantics belong in it. |
| Coverage Instrumentation | Generic | Off-the-shelf measurement; the domain owns the threshold policy, not the instrument. |
| Continuous Integration Orchestration | Generic | GitHub Actions is replaceable infrastructure; replacing it must not change what any gate means. |
| Result Reporting and Artifact Retention | Generic | Report rendering and artifact storage are commodity concerns adapted to the vocabulary below. |

---

## 3. Ubiquitous Language Glossary

### 3.1 Inherited from `cognitive_line` — meaning is unchanged and may not be redefined here

| Term | Definition | Notes for this domain |
|---|---|---|
| Horizon | A governed scope in which knowledge completes its own epistemic lifecycle and receives only horizon-relative authority. | A test fixture that creates a Horizon must also honour its budget and parent edge; "test horizon" is not a lighter kind of Horizon. |
| Admission Gate | The single decision boundary through which candidate persistent knowledge and corrections pass. | "Exactly one gate" is a testable invariant, not a design comment. A test helper that writes state directly is a second gate in disguise. |
| Refusal | A typed rejection whose reason and required client response are part of the protocol. | Asserting only "it threw" is a non-assertion; the refusal code and its client obligation are the observable. |
| Promotion | A governed proposal from a completed child Horizon into its immediate parent. | Tests must observe that a promotion produces a parent proposal, never inherited authority. |
| Recall Case | An admitted invalidating contestation plus its deterministic dependency-closure cascade. | Its required properties — deterministic, idempotent, monotonic, resumable — are property-shaped, not example-shaped. |
| Truth Ownership | Whether a persistent cell's truth is owned by the source, by the graph, or is suspended. | A distinct coordinate from claim status; a test asserting one must not imply the other. |
| Relative Authority | Permission earned by completing the lifecycle within one Horizon. | Never transfers across Horizons; a fixture that grants it directly invalidates the test. |
| Sequence | The monotonic per-tenant ordering of admitted events. | Sequence reuse and sequence staleness are the two probe surfaces; `allocateSequence` is the unit under probe. |

### 3.2 Verification vocabulary introduced by this domain

| Term | Definition | Notes |
|---|---|---|
| Scenario | A named, Given/When/Then statement of expected behaviour, authored before its test exists. | Lives in `004`; a scenario is a specification, not a test name. |
| Scenario Identifier | The stable handle by which a Scenario is referenced from a test and from a report. | Stable across renames; never reused after retirement. |
| Traceability Link | The bidirectional binding between one Scenario Identifier and one or more executable test cases. | Absence in either direction is a Gap, not a warning. |
| Traceability Gap | A Scenario with no test, or a test asserting behaviour no Scenario describes. | Both directions are defects; the second is how undocumented behaviour becomes load-bearing. |
| Evidenced (`[B]`) / Proposed (`[E]`) | Whether a Scenario's behaviour is demonstrated by a passing linked test or is still only intended. | Promotion `[E] → [B]` is derived from evidence; hand-editing the marker is falsification. |
| Regression Corpus | The body of tests that exist because a specific validation pass previously failed. | Its purpose is preventing recurrence; it must be readable as specification. |
| Retry Archaeology | Test naming that encodes the validation attempt that produced it (`f001-retry5..8`) rather than the behaviour it protects. | An anti-pattern to retire; the retry provenance survives as metadata, not as the file name. |
| Quarantined Ambiguity | A deferred architectural question, recorded as explicitly not to be tested until an ADR amendment resolves it. | Six families are listed in `004` §4. Testing one decides it silently. |
| Quarantine Violation | A test whose assertion picks an outcome inside a Quarantined Ambiguity. | Must fail the build, not merely warn. |
| Invariant Probe | A test designed to observe a stated invariant under adversarial conditions rather than to exercise a happy path. | Concurrency, durability, idempotency, cancellation. A probe that cannot fail proves nothing. |
| Fault Injection | Deliberately making a collaborator misbehave — ignoring cancellation, dying mid-transaction, replaying a request. | The provider that ignores `AbortSignal` is the named case in `TL.json`. |
| Structural Proof vs Behavioural Proof | Proving an invariant by code shape versus proving it by observing behaviour under real concurrency. | `REWORK-LOG.md` `[B]` records concurrency as proven only structurally — this is the gap. |
| Quality Gate | A named signal that blocks integration when it fails. | Blocking or non-blocking is a governed decision, not an implementation accident; `load` is `continue-on-error: true` today `[B]`. |
| Coverage Baseline | The recorded coverage figure a change may not fall below. | No figure exists today `[B]`; a baseline without a policy on what counts is theatre. |
| Toolchain Pin | An exact, reproducible compiler and runner version resolved from the lockfile, not from a registry at run time. | `bunx tsc` is currently unpinned and panics `[B]`. |
| Flake | A test whose verdict varies without a change to the code under test. | Quarantining a flake is a debt entry with an owner, never a deletion. |
| Test Index | The machine-readable record of which files test which feature (`tested_by`, `test_files` in the feature graph block). | Currently stale `[B]`; drift must be detectable mechanically. |
| Suite Verdict | The published, reproducible outcome of one Suite Run against all Quality Gates. | Self-report never counts — the verdict is read from the runner's output, mirroring EAP's "verified by host log". |

---

## 4. Socratic Questions

These questions expose gaps. Their documentation-backed answers and remaining human inputs are recorded in §4.6; an **Open** item must not be resolved implicitly during implementation.

### 4.0 Preconditional — the quarantine (answer first)

1. `004` §4 defers six families: in-flight promotion during a topology change; the destination status of indirect Recall dependents; whether `RecallNotice` and an invalidating Contestation are one object or two; whether an unknown `faulty_since_seq` widens the closure or only the audit window; the `LegacyClaimStatus` migration mapping; and batching limits for very large closures. **Which of the currently passing 701 tests already assert an outcome inside one of those six families, and by what mechanism would you discover that, given no test today names a scenario?**
2. If the automation must make a quarantined family *fail loudly rather than pass quietly*, what is the observable difference between "this behaviour is undecided" and "this test is broken", such that a reader six months from now cannot mistake one for the other?
3. Who owns lifting a quarantine — and what evidence, beyond an ADR amendment being merged, must exist before the corresponding Scenario may acquire a Traceability Link?

### 4.1 Business Invariants and Consistency

4. The `[E]`/`[B]` marker in `004` is currently hand-maintained and stale by roughly 70 scenarios `[B]`. **What invariant prevents a marker from ever being more optimistic than the evidence — i.e. what makes falsifying `[B]` mechanically impossible rather than merely discouraged?**
5. EAP's own rule is "exactly one gate". Does the test corpus honour it? **Which EAP test helpers construct admitted state without passing through the Admission Gate, and if any do, is the invariant being tested or being assumed?**
6. If a Traceability Link may be many-to-many (one Scenario covered by several tests; one test covering several Scenarios), what stops "coverage by association" — a Scenario counted as evidenced because a distantly related test passes?
7. Renaming `f001-retry5..8` to behavioural names risks losing why each assertion exists. **What guarantees that a rename cannot silently drop an assertion, given that the suite passing after the rename proves only that what remains passes?**

### 4.2 Scalability and Performance

8. `REWORK-LOG.md` `[B]` records that the per-batch indexing win was never benchmarked against a 100k-claim tenant. **Where does such a fixture live, how long may building it take, and does it run on every push, on PRs only, or nightly — and what makes that choice defensible rather than convenient?**
9. `TL.json` `[B]` flags `SqlitePromotionRepository.getEvents` and `getProposalsForParent` as unpaginated with no retention window. **What volume must a probe reach before the absence of pagination becomes observable rather than theoretical, and what is the failure signal — wall time, memory ceiling, or row count?**
10. The suite is 701 tests in 74.55s `[B]`. Adding coverage instrumentation, scale fixtures, and multi-process concurrency probes will multiply that. **What is the maximum acceptable feedback latency for the blocking path, and which probes are therefore forbidden from blocking?**
11. A performance budget that is only ever measured on a shared CI runner is measuring the runner. **How will a Benchmark Ledger distinguish a real regression from runner noise, and how many consecutive breaches constitute a breach?**

### 4.3 Security and Sensitive Data

12. EAP's threat model includes hostile identity producing an identical verdict (`[G4]` in `001`). **Which existing tests actually submit under a hostile identity, and which merely assert the authorization check was called?**
13. Scale fixtures and JSONL rebuild fixtures materialise tenant data on disk and into CI artifacts. **What classification applies to fixture content, and what prevents a failing-test artifact from publishing evidence anchors, provenance, or operator identities into a build log?**
14. `001` question 13 records as **Open** whether a malicious client can infer protected content from refusal codes, timing, or closure counts. **May the automation add a timing-differential probe, or would specifying its expected outcome constitute deciding an open architectural question — and therefore belong in quarantine?**
15. `f001-validation-audit-vulns.test.ts` exists `[B]` as the audit-vulnerability suite. **When a new vulnerability class is found, does it extend that file or create a new one — and what stops that file from becoming an untraceable dumping ground?**

### 4.4 Concurrency and Failures

16. `TL.json` `[B]` open point 1: closure re-derivation runs synchronously inside `serialTransaction` after a JSONL rebuild, holding the SQLite write lock for an unmeasured duration. **What does a probe have to do that the existing single-process tests do not — separate processes, separate connections, or both — and what is the measured observable: lock hold time, writer starvation, or a timeout?**
17. `TL.json` `[B]` open point 2: `CapabilityGateway.execute` releases the idempotency key on timeout when a provider ignores `AbortSignal`, risking duplicate irreversible effects on retry. **How does a test double prove a duplicate *irreversible* effect occurred without performing one — and what counter or ledger is the authoritative observable?**
18. `REWORK-LOG.md` `[B]` says concurrency is proven structurally and by sequence-reuse and fault-injection tests, never by a multi-process load test. **What would the multi-process test have to break for the structural proof to be wrong, and if you cannot name that, what is the test for?**
19. Recall cascade must be deterministic, idempotent, monotonic, and resumable. Three of those are properties over an input space, not examples. **Are property-based or fuzzed probes in scope, and if so, how is a failing seed made reproducible in a gate that must be deterministic?**
20. A probe that stresses SQLite write locks is itself a flake generator. **What distinguishes "the probe found contention" from "the runner was slow", and who arbitrates?**

### 4.5 Responsibility Boundaries Between Layers

21. EAP's architecture forbids reimplementing a domain rule inside an MCP adapter `[B]`. **Does the test corpus mirror that boundary — are `graph-core` EAP rules tested purely in `graph-core`, or do `mcp-server` tests re-assert domain rules and thereby couple the gate to the transport?**
22. `packages/client/test/eap-conformance.test.ts` and `packages/mcp-server/test/eap-conformance.test.ts` share a name `[B]`. **Are they two halves of one contract or two independent assertions of the same thing — and which side owns the contract if they disagree?**
23. `docs/.digest.md` still instructs readers to typecheck via a `tsconfig.check.json` deleted in commit `71887e1` `[B]`, and `docs/feature/cognitive_line.md` has `"tested_by": []` with five EAP test files missing from `test_files` `[B]`. **Should documentation truthfulness be a Quality Gate, or is it a human review responsibility — and if a gate, what is the authoritative source it compares against?**
24. CI's `test` job runs `bunx tsc --noEmit` only inside `mcp-web`, and the direct invocation against `packages/mcp-server/tsconfig.json` panics with a Go stack trace from an unpinned TypeScript 7 `[B]`. **Is restoring a typecheck gate over `graph-core`, `mcp-server`, and `client` part of this domain, or a prerequisite that must land first — and what is the test corpus worth in the interim if types are unchecked?**
25. The `load` job is `continue-on-error: true` and covers presence only `[B]`. **When the EAP concurrency and scale probes exist, do they join a non-blocking job — where a red result changes nothing — or do they block? If they block, what is the rollback when a probe is wrong?**

### 4.6 Documentation-backed resolution record

The answers below follow the authority order in `docs/README.md` and reconcile the decisions already recorded in this domain's `002`, `003`, and `004` artifacts. **Settled** means the documentation supplies a decision. **Partial** means it supplies a safe boundary but leaves an input open. **Open** means implementation must not choose a value by convenience.

**This table is the authoritative status record.** `003`'s "Open Inputs Carried Forward" table cites these rows as `SQ<n>` and records only where each residue lands in the design; where the two differ, this table wins. Note the numbering convention binding on all four documents: Socratic questions are `SQ1`–`SQ25` (the row numbers below); Quarantined Ambiguity families are `QA1`–`QA7` (§5). A bare `Q<n>` is ambiguous and must not be written.

| SQ | Status | Answer |
|---:|---|---|
| 1 | Open | No current test can be identified as inside QA1–QA7 from documentation alone because no test names a Scenario Identifier. The annotation and quarantine gates can surface candidates only after the corpus is annotated; the initial audit of all 701 tests remains unscheduled. No existing test may be presumed safe or violating. |
| 2 | Partial | A Quarantine Violation must be a distinct blocking diagnostic that says **the behaviour is undecided**, and names the quarantine family, source clause, test file, test name, and lifting ADR. A broken-test result instead reports execution or assertion failure. The exact machine-readable error shape and wording remain open. |
| 3 | Partial | A merged ADR amendment naming the family is necessary but does not directly create evidence. The quarantine record must be lifted, the Scenario must re-enter the register as `proposed`, and only a later `asserts` link plus a passing run may make it `evidenced`. The human/team owner authorized to lift the quarantine is not assigned. |
| 4 | Settled | `docs/specs/cognitive_line/004` remains read-only. Status is generated in `docs/verification/scenario-status.md`; `evidenced` is reachable only when a non-quarantined Scenario has at least one runtime-emitted `asserts` link whose exact test passed in the same run. `covers-partially` never promotes. Regeneration overwrites or rejects authored optimism and records run id and commit. |
| 5 | Open | The rule is explicit — no fixture may construct admitted state without the Admission Gate — but the existing helper audit has not been performed or scheduled. Therefore the present corpus must be described as **assuming** this invariant until the audit proves otherwise. |
| 6 | Partial | Every link identifies the exact test file and test name, and only `kind: asserts` may discharge a Scenario; a suite-level association and any number of `covers-partially` links cannot do so. The criterion for converting partial coverage into `asserts`, or for splitting an over-broad Scenario, remains open. |
| 7 | Settled | Capture an order-insensitive `AssertionFingerprint` — the multiset of matcher and normalized subject pairs — before renaming and require exact equality afterward. Preserve `RetryProvenance` metadata and regenerate the Traceability Map. A green suite without fingerprint equality is insufficient and the rename gate blocks on every missing assertion. |
| 8 | Partial | The fixture belongs in `packages/mcp-server/test/probes/scale-probe.ts` and runs in the non-blocking `eap-probes` path, not on every push's blocking path. Its build-time budget and exact trigger cadence (PR, scheduled, or manual) remain open and require measured baseline data rather than convenience. |
| 9 | Partial | The specified probe volume is 100,000 claims. It records read-model row count, wall time, peak heap, fixture-build time, and closure re-derivation time with a runner fingerprint. Documentation does not select one as the failure signal; QA6 permits measurement but forbids asserting a page size, batch size, or completion bound until an ADR decides it. |
| 10 | Partial | An individual check admitted to the blocking `bun test` path must fit the configured 15,000 ms test timeout. Deterministic correctness assertions may block; concurrency timing, scale, and volume measurements are explicitly non-blocking. The maximum acceptable end-to-end blocking feedback latency remains unset. |
| 11 | Partial | Compare samples only within the same `RunnerFingerprint` and evaluate a metric against a median/tolerance band over `k` consecutive comparable runs; one excursion is noise by definition. The tolerance, `k`, and arbiter are still unset, so a breach may open debt but may not block a merge. |
| 12 | Open | The existing hostile-identity coverage has not been audited. The L2 caller-blindness item cannot be `claimed` until a test actually submits identical content under multiple distinct identities and compares verdicts; merely verifying that an authorization function was called does not qualify. |
| 13 | Open | No fixture-data classification or redaction policy exists. Verification evidence must stay outside the tenant audit plane (`docs/verification/` for committed records and `.verification/` for per-run artifacts), but location and retention do not prevent log leakage. Artifact upload for such a failing fixture is blocked until classification and redaction rules are decided. |
| 14 | Settled | A timing-differential probe may **measure and record**, but it may not assert an expected security outcome. Refusal-code, timing, and closure-count leakage is QA7, a Declared Untestable family; an expected-outcome assertion would silently decide the open architecture question. |
| 15 | Partial | The naming policy — extend `f001-validation-audit-vulns.test.ts` or create a behavioural file — remains open. Regardless of file choice, every test case must emit a Scenario Identifier annotation, so the bidirectional Traceability Map makes an untraceable dumping ground mechanically visible and blocking. |
| 16 | Partial | The probe uses **both** separate OS processes and separate SQLite connections. It blocks only on deterministic correctness observations such as Sequence reuse or a lost admitted write; lock-hold time and writer starvation are measured into the Benchmark Ledger without a bound. No single authoritative timing observable has been selected. |
| 17 | Settled | The provider double performs no irreversible operation. It writes to its own deterministic Effect Ledger, keyed by idempotency key, while ignoring `AbortSignal`; the timeout-then-retry sequence reports the count. A count greater than one is the authoritative duplicate-effect observation. |
| 18 | Settled | The multi-process probe must falsify the structural claim by producing a reused Sequence or a lost admitted write under separate writers and connections. It must also be mutation-tested against a deliberately broken `allocateSequence`; if that defect cannot make the probe fail, the probe is inadmissible. Timing alone does not falsify monotonicity. |
| 19 | Open | Property-based/fuzzed Recall probes are not scheduled and no deterministic seed-capture/replay contract has been chosen. They may not enter a blocking gate until a failing seed is persisted and reproducible for the same code and environment; the concrete mechanism remains a required design input. |
| 20 | Partial | Each contention sample and flake record carries run id, commit, runner fingerprint, and probe context; samples with different fingerprints are not compared, and only repeated same-fingerprint breaches may become a budget breach. The tolerance, consecutive-run count, and human arbiter remain open, so timing contention remains advisory. |
| 21 | Partial | Ownership is clear: pure EAP rules belong in `graph-core`; `mcp-server` may test durable services and adapter/transport contracts but must not re-specify domain semantics on wire shapes. Whether the current suite violates that boundary is unknown because the corpus audit is unscheduled. |
| 22 | Partial | They are role-specific assessments against one upstream contract, not competing owners: the Working Paper's Appendix D owns the published conformance language, with host and client verdicts reported independently. A disagreement is therefore exposed per role and must be reconciled against Appendix D; the operational owner responsible for that reconciliation is not assigned. |
| 23 | Settled | Documentation truthfulness is a blocking Quality Gate. `tested_by` and `test_files` are derived from the Traceability Map; the documented typecheck command is derived from the pinned toolchain task; and the document graph must index the normative Working Paper and PRD. Any difference between regenerated and committed content fails with file, field, expected, and actual values. |
| 24 | Settled | Restoring typecheck is **task 01 inside this domain**, not a prerequisite outside it: pin one TypeScript version in the root lockfile and add a blocking job over `graph-core`, `mcp-server`, and `client`. The 24 existing unrelated errors form a frozen per-file ratchet that may shrink but not grow. Until this lands, the suite supplies runtime evidence only; it does not establish type safety. |
| 25 | Partial | Concurrency and 100k scale/timing probes run in a dedicated `eap-probes` job with `continue-on-error: true`; their measurements are advisory and open debt after sustained breach. Deterministic correctness assertions extracted from them may remain in the blocking suite. A wrong advisory probe cannot block a merge; the concrete rollback procedure for a wrong blocking correctness assertion is not specified and must be declared with that Quality Gate before activation. |

---

## 5. Deferred Ambiguities — Must Remain Untested

Restated as a constraint on every downstream phase of this domain. QA1–QA6 are recorded in `docs/specs/cognitive_line/004` §4 `[B]` and trace to Appendix A ambiguities in `docs/adr/ADR.md`; QA7 is the unresolved leakage question promoted to quarantine by settled decision D3 in this domain's tactical design:

| # | Quarantined Ambiguity | Why a passing test would be a decision |
|---:|---|---|
| QA1 | Promotion already in flight when the Horizon DAG changes | `001` question 2 records the criteria for a legitimate topology extension as unwritten; a test would fix the semantics by fiat. |
| QA2 | Exact destination status of indirect dependents in a Recall cascade | `001` question 5 is **Open [A]**; §10.1 names `contested` for targets, §11 rule 1 says only "do not remain admitted". A test would pick one. |
| QA3 | Whether `RecallNotice` and an invalidating Contestation are one admitted object or two | Identity determines the audit shape; asserting either shape settles it. |
| QA4 | Whether unknown `faulty_since_seq` widens the closure or only the audit window | Ambiguity A7; asserting a closure size decides contamination scope. |
| QA5 | Mapping `LegacyClaimStatus` values into the Epistemic Lifecycle | A migration test is a migration specification. |
| QA6 | Page size, batching limits, and completion bounds for very large closures | Overlaps `TL.json` open point 3; a benchmark that *measures* is permitted, an assertion that *bounds* is a decision. |
| QA7 | Whether refusal codes, timing, or closure counts leak protected content | A timing-differential probe may measure and record; asserting an expected outcome would decide the open threat-model question. |

**Rules `[E]`:**

1. Every QA1–QA7 family carries a Scenario Identifier and the status **Declared Untestable**, never `[E]` and never `[B]`.
2. No Traceability Link may be created for a quarantined Scenario. Creating one is a Quarantine Violation and fails the gate.
3. QA6 admits **measurement without assertion**: a Benchmark Ledger entry recording observed closure cost is evidence; a test asserting a maximum batch size is a decision and is forbidden.
4. A quarantine is lifted only by a merged ADR amendment that names the family, after which the Scenario re-enters the register as `[E]` and follows the ordinary path.

---

## Architecture Tip

Treat the Traceability Map as the aggregate that owns truth about what is verified — derive scenario status, coverage claims, and the feature graph's `tested_by` from it rather than maintaining any of them by hand — and make the Ambiguity Quarantine a first-class blocking gate so an undecided architectural question can never be settled by a green test.
