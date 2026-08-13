# Context Map — cognitive_line_test_automation

**Domain:** `cognitive_line_test_automation` | **Project:** `open-graph-mcp` | **Language:** English | **Date:** 2026-08-12

## Scope and Status Discipline

This document models the **automated-verification system for the already-implemented EAP / `cognitive_line` domain**. It does not model EAP itself: the EAP bounded contexts are defined in `docs/specs/cognitive_line/002-context-map.md` and are treated here as **upstream, frozen, read-only collaborators**.

Marks follow the repository convention (`docs/adr/ADR.md` §"Como ler", also used in `docs/specs/cognitive_line/003` and `004`):

- `[B]` — evidenced in the current repository (file, measured run, or CI job identified).
- `[E]` — proposed evolution; an acceptance target, not a claim that it exists.

Governing constraint inherited from **ADR-0021**: *verification by log, never by self-report*, and *`[C]` code migrates to `[B]` only via an adversarial test*. This domain exists to make that rule mechanically enforceable instead of culturally observed.

### Input status

`docs/specs/cognitive_line_test_automation/001-problem-space.md` was **not present on disk** when this phase ran (a parallel agent owns it). Ubiquitous Language below is therefore derived from the frozen predecessor specs (`docs/specs/cognitive_line/001–004`), `docs/adr/ADR.md`, `REWORK-LOG.md`, `TL.json`, `QA.json`, and measured repository facts. **Reconciliation obligation:** phase 003 must diff the terms used here against `001-problem-space.md` before tactical design; any term collision is resolved in favour of `001`.

### Measured baseline `[B]`

| Fact | Value |
|---|---|
| Root `bun test` | 700 pass, 1 todo, 0 fail, 3293 `expect()` calls, 701 tests, 134 files, 74.55s |
| Test file distribution | `mcp-server/test` 97, `graph-core/test` 10, `client/test` 11, `stdio-proxy/test` 5, `mcp-web/test` + `mcp-web/e2e` (Playwright) |
| EAP fixture | `packages/mcp-server/test/eap-env.ts` (real on-disk SQLite + JSONL, `restart()` simulates host process restart) |
| CI jobs | `test` (blocking), `client-node` (blocking), `e2e` (blocking), `load` (PR-only, `continue-on-error: true`, presence-only — nothing EAP) |
| Test config | `bunfig.toml` `[test] timeout = 15000`; no coverage tooling; no threshold |
| Typecheck gate | **absent for graph-core / mcp-server / client** — `docs/.digest.md` still routes through `packages/mcp-server/tsconfig.check.json`, deleted in `71887e1`; `bunx tsc -p packages/mcp-server/tsconfig.json` resolves unpinned TypeScript 7 (`tsgo`) and panics; `typescript` is absent from the repo root |
| Root `package.json` `test` script | runs **only** `packages/mcp-server` — diverges from CI's root `bun test` |
| Doc-graph index | `docs/feature/cognitive_line.md` graph block has `"tested_by": []`; `test_files` omits f001-retry6/7/8, f001-transport-delegation, f001-validation-audit-vulns |
| Scenario traceability | `docs/specs/cognitive_line/004` marks ~70 scenarios mostly `[E]` though implemented; **no scenario → test link exists** |
| Conformance contract | **`Apêndice D` exists** — `docs/PRD/OpenGraph_Working_Paper_v1_0.md:1164`, "Checklist de conformidade EAP (esqueleto) `[E → G2]`", five levels L0–L4. It is prose, not yet graduated, and **not indexed by `docs/.graph.json`** |
| Document index coverage | `docs/.graph.json` contains exactly two nodes — `adr:adr` and `feature:cognitive-line`. `docs/PRD/OpenGraph_Working_Paper_v1_0.md` and `docs/PRD/PRD.md` are unindexed despite being the normative source ADR.md cites |

---

## 1. Bounded Context Identification

| Bounded Context | Responsibility | Boundary (excluded) | Team Ownership | Key Entities |
|---|---|---|---|---|
| **Conformance Corpus** `[B]` | Own the inventory, intent, layering, and naming of every executable check that asserts EAP behaviour, and guarantee each retained check states one falsifiable claim about the domain. | Excludes environment construction, gate enforcement, coverage measurement, and any assertion about non-EAP suites (presence, graph, web, stdio-proxy). | Protocol Assurance Team | Check, Check Suite, Check Layer (unit / service / adapter / black-box), Retry Lineage, Regression Anchor |
| **Verification Environment** `[B]` | Build, isolate, restart, and destroy deterministic on-disk SQLite + JSONL hosts and real transport servers, and inject faults on demand. | Excludes deciding what is asserted, judging conformance, publishing evidence, and production composition (`services.ts`). | Protocol Assurance Team | Environment Handle, Tenant Fixture, Restart Boundary, Fault Injection Point, Server Handle |
| **Conformance Assessment Execution** `[E]` | Execute the L0/L1 client and L2 host obligations black-box over real transport and emit a per-role, per-flavor verdict derived only from host-observable output. | Excludes defining the obligations (owned upstream by EAP Protocol Conformance), reaching into host internals, and adapting host behaviour per flavor. | Protocol Assurance Team | Conformance Profile, Obligation Item, Assessment Run, Conformance Verdict, Flavor Under Test |
| **Scenario Traceability** `[E]` | Maintain the bidirectional, machine-checkable mapping between specification scenarios, `[B]`/`[E]` marks, defect findings, and the checks that discharge them, and keep the doc-graph index truthful. | Excludes writing checks, running them, defining scenarios (frozen in `004`), and interpreting failures. | Protocol Assurance Team | Scenario Id, Discharge Link, Mark Transition (`[E]`→`[B]`), Defect Finding, Index Entry (`tested_by`) |
| **Quality Gate Orchestration** `[B]` | Define which verification obligations block integration, on which trigger, with which runtime and timeout budget, and expose one reproducible local-equals-CI entrypoint. | Excludes authoring checks, choosing assertions, deciding adequacy thresholds (consumes them), and release publication. | Platform Engineering Team | Gate, Gate Job, Trigger Policy, Blocking Policy, Runtime Matrix (Bun / Node LTS), Timeout Budget |
| **Stress and Concurrency Proof** `[E]` | Produce falsifiable evidence for the load, multi-process, multi-connection, and hostile-provider claims that the current suite proves only structurally. | Excludes functional correctness assertions, conformance verdicts, and non-EAP load profiles. | Runtime Safety Team | Load Profile, Concurrency Scenario, Contention Window, Measured Bound, Falsification Criterion |
| **Verification Evidence Ledger** `[E]` | Persist append-only, machine-readable run evidence — pass/fail, coverage, measured bounds, conformance pass rate — so quality claims are verified by log rather than by self-report. | Excludes deciding pass/fail policy, authoring checks, and interpreting evidence into decisions. | Platform Observability Team | Evidence Record, Run Manifest, Coverage Figure, Adequacy Signal, Claim Provenance |

**Naming note.** `Conformance Assessment Execution` is deliberately *not* named `Protocol Conformance`: that name is already taken by an upstream EAP bounded context which owns the *model* of conformance. This context owns only its *execution*.

---

## 2. Context Map

### 2.1 Published Language for conformance — explicit designation

```text
DESIGNATED (normative source) : docs/PRD/OpenGraph_Working_Paper_v1_0.md — "Apêndice D — Checklist de
                                conformidade EAP (esqueleto)", line 1164.
Cited by [B]                  : ADR-0007 (line 471) and ADR-0019 (line 1348) both record
                                `Fonte normativa | Working Paper v1.0-rc4 ... Apêndice D`. ADR.md is
                                CITING the Working Paper's appendix series, not promising one of its
                                own — ADR.md's Apêndices A/B/C (1570/1624/1652) are a DIFFERENT,
                                unrelated series from the Working Paper's A/B/C/D (1070/1107/1135/1164).
Content [B]                   : five log-verifiable levels. L0 client-reader; L1 client-proposer
                                (anchor + provenance, based_on_seq on every proposal, refusal as a
                                first-class result honouring the taxonomy obligation); L2 host-admitter
                                (caller-blind gate — same content ⇒ same verdict under N identities;
                                taxonomy refusal code; verbatim anchor with hard lock; β-ownership
                                coverage; graded drift; canonical cell form at every edge; 100% offline
                                verification; audit separated from graph; acyclicity of the derivation
                                graph at admission); L3 host-recursive (declared DAG topology; §19
                                semantic profiles; PromotionProposal's five §7 rules; CHANGE_READY by
                                predicate; contestation by event with three severities; escalation
                                without implicit promotion; R9 budgets; recall cascade with closure
                                computed over the admitted graph; §11 propagation properties);
                                L4 host-federated.
Governing rule [B]            : "Cada item verificável por log do host — autorrelato não conta, nunca."
Status [B]                    : `[E → G2]` — a declared SKELETON, not yet graduated normative text.
```

```text
MATERIALISATION GAP [B] — the checklist is not missing, it is not yet executable. Three specific
defects, none of which is "the artefact does not exist":
  (a) It is prose in a document that `docs/.graph.json` does not index (the index holds exactly
      `adr:adr` and `feature:cognitive-line`), so nothing routes from code or spec to it.
  (b) Its status marker is `[E → G2]`, i.e. it is a skeleton pending graduation, so it cannot yet
      be cited as a settled obligation set.
  (c) It carries no machine-readable structure — no item ids, no per-item evidence predicate — so no
      runner can enumerate it and no per-item verdict can be attributed.
```

```text
EXECUTABLE SUBSET (today) : packages/graph-core/src/eap/refusals.ts
Artefact                  : REFUSAL_CODES (closed vocabulary) + CLIENT_OBLIGATIONS (obligation per code)
Relation to Apêndice D    : it is the machine-expressible SUBSET of the designated Published Language —
                            specifically L1's "recusa como resultado de primeira classe ... cumpre a
                            obrigação da taxonomia" and L2's "recusa com código da taxonomia". It is a
                            partial materialisation, NOT a substitute designation.
Evidence [B]              : packages/mcp-server/test/eap-conformance.test.ts imports it and asserts
                            closure (INV-02: an unlisted code has no obligation, so it cannot be
                            constructed as a protocol refusal); packages/client/test/eap-conformance.test.ts
                            consumes the same module from the client side.
Why it qualifies          : it is the only part of Apêndice D that both host and client sides of the
                            boundary already import unmodified as a shared, versionable schema.
```

```text
TARGET [E] : graduate Apêndice D past [E → G2] and transcribe it into a versioned, machine-readable
             Conformance Manifest — one row per obligation item, each carrying { item id, level
             L0..L4, role client|host, refusal codes touched, host-log evidence predicate, source
             clause }. Conformance Assessment Execution reads the manifest; it does not restate it.
             Until then refusals.ts covers only the taxonomy obligation, and every other Apêndice D
             item (caller-blindness under N identities, verbatim anchor hard lock, offline
             verification, derivation acyclicity, one-edge PROMOTE, recall closure over the admitted
             graph, approval single-use) is asserted by prose-in-test-name only — untraceable by
             machine and unattributable to a level.
```

### 2.2 Relationships among the new contexts

```text
[Verification Environment] → [Conformance Corpus]
Pattern   : Open Host Service
Direction : upstream / downstream
Justification: eap-env.ts, helpers.ts and mcp-client-contract.ts publish a stable construction/restart/fault API that many unrelated check suites consume without negotiating per-suite variants.
```

```text
[Conformance Corpus] → [Conformance Assessment Execution]
Pattern   : Customer-Supplier
Direction : downstream / upstream
Justification: assessment needs specific black-box checks over real transport; the corpus supplies them but retains authority over how checks are structured and layered.
```

```text
[Conformance Corpus] → [Scenario Traceability]
Pattern   : Published Language
Direction : upstream / downstream
Justification: traceability must consume a stable, machine-readable discharge annotation emitted by checks (scenario id, ADR clause, defect id) rather than parsing free-form test titles.
```

```text
[Scenario Traceability] → [Quality Gate Orchestration]
Pattern   : Customer-Supplier
Direction : upstream / downstream
Justification: traceability supplies the untraced-scenario and stale-index signals; the gate decides whether they block, and can demand a cheaper or stricter signal.
```

```text
[Conformance Corpus] → [Quality Gate Orchestration]
Pattern   : Conformist
Direction : downstream / upstream
Justification: checks accept the gate's runtime, timeout budget, and invocation contract as given; a check that cannot run under `bun test` within the timeout budget is not admissible, and the gate does not negotiate per-check runtimes.
```

```text
[Stress and Concurrency Proof] → [Verification Environment]
Pattern   : Anti-Corruption Layer (ACL)
Direction : downstream / upstream
Justification: load scenarios need multi-process, multi-connection hosts that the single-handle `EapEnv` model does not express; they must translate rather than mutate the shared fixture, or every functional check inherits load-shaped complexity.
```

```text
[Stress and Concurrency Proof] → [Quality Gate Orchestration]
Pattern   : Customer-Supplier
Direction : upstream / downstream
Justification: proof runs supply measured bounds on a separate trigger and runtime budget; the gate decides advisory-versus-blocking, matching today's `continue-on-error: true` load job.
```

```text
[Conformance Assessment Execution] → [Verification Evidence Ledger]
Pattern   : Open Host Service
Direction : downstream / upstream
Justification: verdicts, pass rates, and coverage are appended through one stable evidence service; ADR-0021 forbids a quality claim whose only support is the claimant.
```

```text
[Stress and Concurrency Proof] → [Verification Evidence Ledger]
Pattern   : Open Host Service
Direction : downstream / upstream
Justification: a measured bound is worthless unattached to the run, commit, and hardware that produced it; the ledger owns that envelope, not the load profile.
```

```text
[Quality Gate Orchestration] → [Verification Evidence Ledger]
Pattern   : Open Host Service
Direction : downstream / upstream
Justification: gate outcomes are observations, not policy; the ledger stores them append-only so a green history cannot be rewritten.
```

```text
[Verification Evidence Ledger] → [Scenario Traceability]
Pattern   : Customer-Supplier
Direction : upstream / downstream
Justification: an `[E]`→`[B]` mark transition requires named evidence — a passing check and an identified commit (ADR-0021 §"Verificação"); the ledger supplies it, traceability requires its shape.
```

```text
[Conformance Corpus] ↔ [Verification Environment]
Pattern   : Shared Kernel — DECLARED AND BOUNDED
Direction : bidirectional
Justification: the only Shared Kernel in this map. `EapEnv`'s type surface (tenant id, repository handles, restart semantics, observed-sequence anchor) is co-owned: 97 mcp-server check files break on its change. Bounded to the type surface of `packages/mcp-server/test/eap-env.ts` and `test/helpers.ts`; production types stay outside it.
```

### 2.3 Relationships toward the frozen `cognitive_line` contexts

The EAP contexts named below are defined in `docs/specs/cognitive_line/002-context-map.md` and are not restated here.

```text
[Conformance Corpus] → [Epistemic Admission] / [Horizon Governance] / [Persistent Knowledge] / [Correction and Recall] / [Capability Governance]
Pattern   : Conformist
Direction : downstream / upstream
Justification: verification accepts the implemented domain model as-is. A check that requires production code to change shape in order to be observable is a design defect in the check, not a negotiation with the domain.
```

```text
[Conformance Assessment Execution] → [Protocol Conformance] (EAP)
Pattern   : Partnership
Direction : bidirectional
Justification: this context is the operational realization of the upstream Protocol Conformance model; the model cannot declare an obligation with no host-observable evidence predicate, and execution cannot invent an obligation the model does not carry. They co-evolve or the conformance claim is untestable.
```

```text
[Conformance Corpus] → [Transport Binding] (EAP)
Pattern   : Anti-Corruption Layer (ACL)
Direction : downstream / upstream
Justification: black-box checks call `cognitive.*` tools over real transport (`startServer` + `callTool` in `test/helpers.ts`); that wire shape must be translated once so replacing MCP invalidates the adapter, not 97 check files. Direct wire-shape assertions inside domain checks are prohibited.
```

```text
[Verification Environment] → [Durable Graph Storage] (EAP)
Pattern   : Anti-Corruption Layer (ACL)
Direction : downstream / upstream
Justification: the fixture builds real SQLite + JSONL through `openDb`/`write`, but checks must observe domain outcomes; asserting on raw table rows would make the storage schema the de-facto specification — the exact inversion `Persistent Knowledge` already forbids.
```

```text
[Verification Evidence Ledger] → [Audit and Evidence] (EAP)
Pattern   : Separate Ways
Direction : none
Justification: EAP's audit plane records domain observations for tenants at runtime; the verification ledger records CI observations about the repository. Merging them would let test runs write into tenant-visible audit state — a durability and authority contamination with no compensating benefit.
```

```text
[Stress and Concurrency Proof] → [Persistent Knowledge] / [Capability Governance] (EAP)
Pattern   : Conformist
Direction : downstream / upstream
Justification: the three open TL.json points (closure re-derivation inside `serialTransaction` after JSONL rebuild; `CapabilityGateway.execute` idempotency-key release when the provider ignores `AbortSignal`; unpaginated `getEvents` / `getProposalsForParent`) are measured against current behaviour; proof does not redesign the code it measures.
```

### 2.4 Relationships toward external systems

```text
[Quality Gate Orchestration] → [GitHub Actions]
Pattern   : Conformist
Direction : downstream / upstream
Justification: job graph, triggers, artifact retention and `continue-on-error` semantics are accepted as given; `.github/workflows/ci.yml` already encodes them and the domain gains nothing from abstracting them.
```

```text
[Quality Gate Orchestration] → [bun test]
Pattern   : Conformist
Direction : downstream / upstream
Justification: discovery, the single `bunfig.toml` timeout, and the reporter format are accepted; a custom runner would fork the developer and CI experience for no verification gain.
```

```text
[Quality Gate Orchestration] → [TypeScript compiler]
Pattern   : Anti-Corruption Layer (ACL)
Direction : downstream / upstream
Justification: `bunx tsc` resolves whatever version is reachable — today an unpinned TypeScript 7 that panics on `packages/mcp-server/tsconfig.json`. The compiler invocation must be pinned and wrapped so the typecheck gate is a deterministic obligation, not an ambient accident. [B] no such gate exists for graph-core / mcp-server / client.
```

```text
[Conformance Assessment Execution] → [Playwright]
Pattern   : Separate Ways
Direction : none
Justification: Playwright covers browser DOM/canvas flows in `mcp-web`; EAP conformance is transport-level and headless. Routing EAP assertions through a browser runner would add a 5-minute blocking job to prove nothing about the protocol.
```

```text
[Verification Environment] → [SQLite / JSONL mirror]
Pattern   : Conformist
Direction : downstream / upstream
Justification: the fixture must use the real durability path — including the SQLite-only tables (`eap_sequences`, `capability_executions`) that the JSONL mirror does not carry. Substituting an in-memory double would erase exactly the divergence class that retries #2–#5 kept producing.
```

```text
[Conformance Assessment Execution] → [Claude Code as Agent Client]
Pattern   : Customer-Supplier
Direction : downstream / upstream
Justification: an L0/L1 flavor is the subject of assessment, and ADR-0007 H12 is falsified if passing requires server-side adaptation per flavor. The flavor supplies behaviour; assessment holds the obligation list fixed and may demand nothing of the flavor except that it be exercisable by log.
```

```text
[Conformance Assessment Execution] → [docs/PRD/OpenGraph_Working_Paper_v1_0.md — Apêndice D]
Pattern   : Conformist
Direction : downstream / upstream
Justification: the checklist is the normative obligation set cited by ADR-0007 and ADR-0019. Assessment transcribes and executes it; it may not add, reword, or reinterpret an item. [B] the document is unindexed by docs/.graph.json and the checklist is marked [E → G2], so the transcription must carry the source line reference per item and must not present a skeleton item as graduated.
```

```text
[Scenario Traceability] → [docs/PRD/ (Working Paper, PRD.md)]
Pattern   : Customer-Supplier
Direction : downstream / upstream
Justification: the Working Paper is the normative source for ADR clauses and for Apêndice D, yet neither PRD document appears in docs/.graph.json (two nodes only: adr:adr, feature:cognitive-line). Traceability requires them indexed so a conformance item can be routed from code back to its normative clause; the index is in scope for this domain, the documents' content is not.
```

```text
[Verification Evidence Ledger] → [docs/.graph.json + docs/feature/cognitive_line.md]
Pattern   : Published Language
Direction : upstream / downstream
Justification: the doc-graph block is the repository's machine-readable index; `tested_by` is its slot for verification provenance. [B] it is empty and its `test_files` list is stale, so the index currently asserts something false about the code.
```

---

## 3. Core Domain Highlight

Subdomain classification is inherited from the frozen EAP problem space and adapted for this domain: verification of a Core subdomain is not automatically Core, but **conformance evidence is** — ADR-0007 makes it the certification object of the protocol, and ADR-0021 makes evidence-by-log the project's declared method.

```text
Context   : Conformance Assessment Execution
Reason    : EAP is a protocol claim. A protocol whose obligations are not independently assessable by log is a library with prose attached; ADR-0007 makes the L0–L4 ladder and per-flavor Conformance Pass Rate the competitive differentiator, Apêndice D already enumerates the obligations, and ADR-0021 forbids self-report as its support.
Investment: Model Conformance Profile, Obligation Item, and Verdict as first-class aggregates driven by a versioned manifest transcribed from Apêndice D; every obligation carries a host-observable evidence predicate; assertions are black-box over real transport with zero reach into internal state; deferred ADR items are declared as explicit exclusions, never silently decided.
```

```text
Context   : Scenario Traceability
Reason    : Five adversarial retries produced findings whose only durable record is prose in REWORK-LOG.md. Nothing mechanically prevents deleting the check that closed a HIGH AUTH_BYPASS. Traceability is what converts a passing suite into a defensible claim, and it is the missing half of every `[E]`→`[B]` mark in `004`.
Investment: Rigorous modelling of Scenario Id, Discharge Link, Defect Finding, and Mark Transition, with a machine-checkable invariant that a scenario marked `[B]` names at least one passing check and a resolved defect finding retains a permanently attributed regression anchor.
```

```text
Context   : Stress and Concurrency Proof
Reason    : It is the only context that can close REWORK-LOG's four self-declared open claims and TL.json's three untested points. Until then the concurrency guarantees of `serialTransaction` / `allocateSequence` — the specific defect class that recurred across four consecutive retries — remain structurally argued rather than demonstrated.
Investment: Explicit modelling of Contention Window, Measured Bound, and Falsification Criterion; each load profile pre-registers what result would falsify the claim, per ADR-0021's pre-registered-verdict method.
```

Supporting: **Conformance Corpus**, **Verification Environment**, **Quality Gate Orchestration**. Generic: **Verification Evidence Ledger** (append-only storage and reporting; buy or use platform-native facilities). None of these may absorb Core decisions — in particular, the gate configuration must not become the place where conformance obligations are defined.

---

## 4. Architectural Decisions

```text
Decision    : Accept docs/PRD/OpenGraph_Working_Paper_v1_0.md "Apêndice D" as the designated Published
              Language for conformance, treat packages/graph-core/src/eap/refusals.ts as its currently
              executable subset, and scope this domain's work as MATERIALISATION — graduation plus
              transcription into a machine-readable manifest — not as authoring a missing artefact.
Context     : Apêndice D exists (Working Paper line 1164) and ADR-0007 / ADR-0019 cite it as normative
              source. It is a five-level, explicitly log-verifiable checklist whose own rule is
              "autorrelato não conta, nunca". But it is marked [E → G2] (skeleton), it is prose with no
              item ids or evidence predicates, and its containing document is absent from
              docs/.graph.json. refusals.ts already materialises exactly one of its obligations — the
              closed refusal taxonomy shared by L1 and L2.
Consequences: + The conformance contract has a real, citable owner and this domain does not invent
              obligations. + The closed-vocabulary invariant is already machine-enforceable at the
              boundary, proving the transcription pattern works. − Per-flavor Conformance Pass Rate
              (ADR-0007's own metric, hypothesis H12) remains uncomputable while the checklist is
              unstructured prose at [E → G2] — the blocker is structure and graduation, not absence.
              − Graduation past [E → G2] is a Working Paper decision this domain must request, not
              perform; transcription may not silently resolve items the skeleton leaves open.
```

```text
Decision    : Declare exactly one Shared Kernel — the type surface of test/eap-env.ts and
              test/helpers.ts, co-owned by Conformance Corpus and Verification Environment — and
              forbid all others.
Context     : 97 mcp-server check files depend on that fixture; its restart(), fault injection, and
              observed-sequence anchor already encode domain assumptions. Pretending it is a
              one-way Open Host Service would hide the real coupling, while letting each suite grow
              its own fixture would reintroduce the environment divergence retries #2–#5 exposed.
Consequences: + Coupling is explicit, versioned, and reviewable in one place. + Environment
              determinism is centrally guaranteed. − Any fixture change is a wide-blast-radius change
              requiring both owners' consent. − Load scenarios cannot use it directly and must pay
              for an ACL (§2.2), which is accepted deliberately.
```

```text
Decision    : Keep gate enforcement (Quality Gate Orchestration) strictly separate from evidence
              production (Verification Evidence Ledger), and make the Corpus a Conformist to the gate.
Context     : ADR-0021 requires verification by log, never self-report. If the gate both measured and
              judged, a green result would be its own only evidence — and today the divergence is
              already live: CI runs root `bun test` while root `package.json`'s test script runs only
              packages/mcp-server, so "tests pass" means two different things locally and in CI.
Consequences: + A quality claim always resolves to an append-only record naming run, commit, and
              measured value. + One reproducible local-equals-CI entrypoint becomes an explicit
              obligation. − An extra artefact and its retention policy must be maintained. − Checks
              lose the freedom to demand bespoke runtimes or timeout budgets.
```

```text
Decision    : Own the doc-graph index as domain data of Scenario Traceability, not as documentation
              upkeep.
Context     : docs/feature/cognitive_line.md declares "tested_by": [] and a test_files list missing
              f001-retry6/7/8, f001-transport-delegation and f001-validation-audit-vulns. The index is
              the repository's machine-readable routing surface and it currently asserts something
              false about the code it routes to.
Consequences: + Index staleness becomes a detectable, gateable failure rather than a documentation
              chore. + Every retained EAP check gains a discoverable route from the feature node.
              − Traceability now owns a file outside its natural code boundary and must not overreach
              into docs/specs/cognitive_line/ or docs/harness-history/, which stay read-only.
```

```text
Decision    : Isolate Stress and Concurrency Proof as its own context with its own trigger, ACL, and
              falsification criteria, rather than extending the functional suite.
Context     : The four self-declared-open REWORK-LOG claims and the three TL.json open points are all
              multi-process, multi-connection, hostile-provider, or 100k-scale claims. The existing
              load job is PR-only, continue-on-error, and covers presence only — nothing EAP.
Consequences: + The recurring concurrency defect class finally acquires demonstrative evidence with a
              pre-registered falsification condition. + Functional check runtime stays inside the
              15s bunfig budget. − A second environment model and a separate CI budget must be
              maintained. − Advisory-first results risk being ignored unless promotion to blocking is
              itself gated on a measured, stable baseline.
```

```text
Decision    : Restore a pinned, deterministic typecheck obligation behind an ACL, and treat its
              current absence as an open finding rather than a background nuisance.
Context     : docs/.digest.md routes typecheck through packages/mcp-server/tsconfig.check.json, which
              was deleted in commit 71887e1; `bunx tsc -p packages/mcp-server/tsconfig.json` resolves
              an unpinned TypeScript 7 (tsgo) and panics; `typescript` is absent from the repo root.
              graph-core, mcp-server and client therefore have no type gate at all, while
              REWORK-LOG already reports 24 pre-existing TypeScript errors in mcp-server.
Consequences: + A whole class of regressions returns to being caught before runtime. + docs/.digest.md
              stops documenting a route that cannot execute. − Requires a root devDependency and a
              dependency-install decision that belongs to the user. − Turning the gate on will
              surface a pre-existing error backlog that must be triaged, not suppressed.
```

---

## 5. Handoff to Tactical Design (003)

Unresolved inputs the next phase must not silently decide:

1. Reconcile Ubiquitous Language against `001-problem-space.md` once it exists (§"Input status").
2. **Apêndice D materialisation.** The Conformance Manifest requires (a) graduating Apêndice D past `[E → G2]` in `docs/PRD/OpenGraph_Working_Paper_v1_0.md` and (b) transcribing it into a versioned machine-readable manifest — one row per obligation item, each with a host-log evidence predicate and a source line reference. Request the graduation; do not author or reinterpret conformance obligations in this domain's specs.
3. **Which levels does this repo claim? — human decision, not a spec decision.** Apêndice D's L2 and L3 item lists are the natural spine for the conformance test corpus: `cognitive_line` implements roughly the full L2 band (caller-blind gate, taxonomy refusals, verbatim anchor, β-ownership, drift, canonical cell form, offline verification, audit separated from graph, derivation acyclicity) and part of L3 (declared DAG topology, PromotionProposal rules, three-severity contestation, escalation without implicit promotion, budgets, recall closure over the admitted graph). ADR-0007 already records `L3 — [E], gradua com VS-1`. Phase 3/4 must ask the human which levels the repository claims before scoping the corpus, and must not infer the claim from what happens to be implemented.
4. `docs/PRD/OpenGraph_Working_Paper_v1_0.md` and `docs/PRD/PRD.md` are **absent from `docs/.graph.json`** (which indexes only `adr:adr` and `feature:cognitive-line`). Indexing them is in scope for Scenario Traceability; editing their content is not.
5. The six deferred scenario families in `docs/specs/cognitive_line/004` §4 remain deferred; they are declared **exclusions** of Conformance Assessment Execution, not gaps.
6. Coverage adequacy threshold is undecided; the Ledger must be able to record a coverage figure before any threshold can be argued.
7. Promotion of stress proof from advisory to blocking is out of scope until a stable measured baseline exists.
