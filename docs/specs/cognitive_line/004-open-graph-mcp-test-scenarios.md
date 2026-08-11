# Test Scenarios — open-graph-mcp

**Domain:** `cognitive_line`  
**Project:** `open-graph-mcp`  
**Framework:** Bun Test (`bun test`; Playwright is used by the existing web package for browser E2E)  
**Date:** 2026-08-11

## Scope and Status Discipline

These scenarios are specifications derived exclusively from `003-open-graph-mcp-tactical-design.md`. `[B]` marks behavior evidenced in the current repository; `[E]` marks proposed behavior. An `[E]` scenario is an acceptance target, not a claim that the capability exists. The MCP host is deterministic and owns transition, admission, persistence, and audit decisions. An LLM-backed Intermediator or Executor is an external Agent Client that may submit proposals but never receives direct persistence authority.

The tactical design explicitly defers topology changes during in-flight promotion, the destination status of indirect recall dependents, the relationship between `RecallNotice` and invalidating Contestation, closure behavior for unknown `faulty_since_seq`, the migration mapping for `LegacyClaimStatus`, and large-closure batching limits. No scenario below silently resolves those questions.

## 1. Unit Scenarios

### 1.1 Aggregates and Decision Models

#### Epistemic Lifecycle `[E]`

##### Should complete Relative Authority when the full lifecycle succeeds in one Horizon

- **Given** a candidate in `proposed` state within a single Horizon
- **When** `DELIBERATE`, `ADMIT`, `CONCRETIZE`, and `VERIFY` succeed in order with their required evidence
- **Then** the candidate reaches `verified` and receives Relative Authority only within that Horizon

##### Should return a typed Refusal when a lifecycle transition is out of order

- **Given** a candidate in `proposed` state
- **When** `VERIFY` is requested before deliberation, admission, and concretization
- **Then** the state remains `proposed` and the outcome is a typed Refusal with a client obligation

##### Should reject boundary commands when they are presented as lifecycle states

- **Given** an Epistemic Lifecycle in any valid state
- **When** `PROMOTE`, `CONTEST`, or `INITIATE` is presented as its next state
- **Then** the transition is refused and the lifecycle state is unchanged

#### Horizon `[E]`

##### Should create a child Horizon when its identifier, parent, Negotiation Seed, and budget are valid

- **Given** a tenant-scoped non-empty `HorizonId`, an existing parent Horizon, a provenanced Negotiation Seed, and a valid Budget Ledger
- **When** the child Horizon is created
- **Then** it has exactly that declared parent, owns its lifecycle and Budget Ledger, and starts without inherited Relative Authority

##### Should reject a non-root Horizon when it has no declared parent

- **Given** a Horizon that is not the root
- **When** creation is requested without a parent
- **Then** creation is refused and no Horizon state is created

##### Should escalate without promotion when the Horizon budget is exhausted

- **Given** a Horizon whose Budget Ledger has reached a hard limit
- **When** additional governed work is requested
- **Then** `HorizonBudgetExhausted` is recorded, the workflow escalates, and no Promotion is created

##### Should retain horizon-local authority when assignment to another Horizon is attempted

- **Given** a verified candidate with Relative Authority in a child Horizon
- **When** that authority is assigned directly to its parent
- **Then** the assignment is refused and the parent receives no authority

#### Admission Decision `[E]`

##### Should produce one admitted outcome when a candidate satisfies the Admission Gate

- **Given** a candidate with valid evidence and all mechanically verifiable requirements satisfied
- **When** the Admission Gate evaluates it
- **Then** exactly one admitted Admission Decision is produced

##### Should produce one typed-refused outcome when a candidate fails the Admission Gate

- **Given** a candidate that violates a deterministic gate requirement
- **When** the Admission Gate evaluates it
- **Then** exactly one Refusal is produced with a closed `RefusalCode` and explicit client obligation

##### Should return the same verdict when identical candidate evidence is submitted by a hostile identity

- **Given** identical candidate content and evidence submitted once by an ordinary Agent Client and once by a hostile identity
- **When** both submissions are evaluated against the same admitted state
- **Then** both receive the same deterministic verdict

#### Promotion `[E]`

##### Should create a parent proposal when Promotion crosses the immediate parent edge

- **Given** verified distilled knowledge in a child Horizon, its declared immediate parent, and a fresh `basedOnSeq`
- **When** Promotion is requested
- **Then** `PromotionProposed` is created as a proposed candidate in the parent without inherited admission or Relative Authority

##### Should return HORIZON_SKIP when Promotion targets a non-parent Horizon

- **Given** a child Horizon with a declared immediate parent
- **When** Promotion targets any other Horizon
- **Then** it is refused with `HORIZON_SKIP` and no parent proposal is stored

##### Should return the normative stale refusal when Promotion uses a stale Sequence

- **Given** a Promotion whose `basedOnSeq` precedes the current applicable Sequence
- **When** the one-edge boundary validates the Promotion
- **Then** it returns the normative stale Refusal and does not transfer knowledge

#### Recall Case `[E]`

##### Should create a Recall Case when an invalidating Contestation has been admitted

- **Given** an admitted invalidating Contestation with evidence-backed target claims
- **When** recall is initiated
- **Then** a Recall Case is created for deterministic traversal of registered admitted reverse dependencies

##### Should reject Recall when Contestation is not admitted and invalidating

- **Given** a missing, refused, informative, or blocking Contestation
- **When** recall is initiated from it
- **Then** recall is refused and no Recall Case is created

##### Should preserve the same affected set when recall resumes from a checkpoint

- **Given** a Recall Case interrupted after a durable checkpoint
- **When** processing resumes one or more times from that checkpoint
- **Then** the final affected set equals uninterrupted execution and no degradation is applied twice

##### Should preserve the historical scar when Recall completes

- **Given** a Recall Case that has degraded its normatively resolved affected claims and graph-owned cells
- **When** the case completes
- **Then** prior history and recall provenance remain queryable and no admitted record is erased or directly rewritten

### 1.2 Value Objects and Contract Types

##### Should canonicalize CellKey when a supported legacy spelling is supplied `[B]`

- **Given** a non-empty domain and supported level expressed with a recognized legacy spelling
- **When** `CellKey` is constructed
- **Then** it yields the canonical `domain:level` spelling before lookup or persistence

##### Should reject CellKey when the domain is empty or the level is unsupported `[B]`

- **Given** an empty domain or a level outside the supported set
- **When** `CellKey` construction is attempted
- **Then** construction is rejected and no key is available for persistence

##### Should consider CellKey values equal when their canonical spellings match `[B]`

- **Given** two `CellKey` inputs that normalize to the same `domain:level`
- **When** they are compared or used as keys in a Set or Map
- **Then** they behave as one equal value

##### Should keep TruthOwnership independent when claim status changes `[B]`

- **Given** a claim with `TruthOwnership` equal to `source`, `graph`, or `suspended`
- **When** its legacy epistemic status changes
- **Then** ownership is not implicitly rewritten and remains a closed independent coordinate

##### Should reject HorizonId when it is empty `[E]`

- **Given** an empty opaque identifier
- **When** a tenant-scoped `HorizonId` is constructed
- **Then** construction is rejected

##### Should preserve HorizonId opacity when topology changes `[E]`

- **Given** a valid tenant-scoped `HorizonId`
- **When** its Horizon is associated with a declared parent
- **Then** the identifier remains unchanged and encodes no topology

##### Should reject Sequence when it is negative or decreases within its scope `[E]`

- **Given** a tenant and Horizon with a current Sequence
- **When** a negative or lower Sequence is proposed
- **Then** validation rejects it without changing the current Sequence

##### Should prevent admission or Relative Authority when a Negotiation Seed carries them `[E]`

- **Given** a Negotiation Seed containing provenance and claim references
- **When** admission or Relative Authority is attached to the seed
- **Then** validation rejects the seed while leaving its referenced knowledge unadmitted

##### Should reject RefusalCode when no client obligation exists `[E]`

- **Given** a free-text reason or protocol code absent from the closed versioned taxonomy
- **When** a Refusal is constructed
- **Then** construction fails because no explicit client obligation is mapped

##### Should preserve PersistentDelta as an envelope when its candidates are inspected `[E]`

- **Given** a Persistent Delta containing candidates and rollback semantics
- **When** it is prepared for admission
- **Then** each candidate is exposed for the ordinary Admission Gate and the envelope grants no admission itself

##### Should reject Operator Approval when scope, expiry, or Sequence does not match `[E]`

- **Given** an Operator Approval bound to an approver, scope, expiry, provenance, and `basedOnSeq`
- **When** a request is out of scope, expired, or based on a different Sequence
- **Then** authorization is refused and mechanical evidence requirements remain in force

##### Should require authorization when Capability Classification is irreversible `[E]`

- **Given** a capability classified as irreversible
- **When** execution is requested without a matching single-use authorization
- **Then** execution is refused before the external effect occurs

### 1.3 Domain Services

##### Should commit a Changeset atomically when incremental and final gates accept it `[B]`

- **Given** tenant-scoped snapshots, held cell locks, and a Changeset accepted by incremental and final gates
- **When** `CommitChangeset` executes
- **Then** all accepted deltas commit through the existing durable write path and `ChangesetCommitted` is emitted

##### Should leave no durable mutation when a Changeset gate refuses it `[B]`

- **Given** a Changeset whose snapshot violates an incremental or final gate
- **When** `CommitChangeset` executes
- **Then** the Changeset is refused and no partial mutation is committed

##### Should initiate a Horizon when provenance, topology, and budget are valid `[E]`

- **Given** a provenanced Negotiation Seed, declared parent, and valid budget policy
- **When** `InitiateHorizon` executes
- **Then** the Horizon is created and `HorizonInitiated` contains `horizonId`, `parentId`, `seedRef`, and `budgetRef`

##### Should admit all Persistent Delta candidates when every single-gate submission succeeds `[E]`

- **Given** a Persistent Delta whose required candidates each satisfy the existing Admission Gate
- **When** `AdmitPersistentDelta` executes
- **Then** all candidates commit atomically and `PersistentDeltaAdmitted` records their claim identifiers and Sequence

##### Should roll back Persistent Delta when any required candidate is refused `[E]`

- **Given** a Persistent Delta with at least one required candidate refused by the existing Admission Gate
- **When** `AdmitPersistentDelta` executes
- **Then** none of its candidates is durably committed and no second admission path is used

##### Should admit Contestation without directly editing knowledge when evidence is valid `[E]`

- **Given** an evidence-backed Contestation targeting admitted claims with a supported severity
- **When** `ContestKnowledge` executes through the Admission Gate
- **Then** `KnowledgeContested` is recorded and the target claims are not directly edited or deleted

##### Should refuse Contestation when required evidence is missing `[E]`

- **Given** a Contestation with no required evidence
- **When** `ContestKnowledge` executes
- **Then** the terminal evidence Refusal is returned and admitted knowledge is unchanged

##### Should authorize a reversible Capability without irreversible authorization when its Change Contract is valid `[E]`

- **Given** a reversible Capability Classification and a valid Change Contract
- **When** `AuthorizeCapability` evaluates the request
- **Then** the Capability Gateway may execute it with an idempotency key and append-only audit reference

##### Should consume irreversible authorization once when capability execution succeeds `[E]`

- **Given** an irreversible capability with a valid matching single-use authorization and Change Contract
- **When** the Capability Gateway completes the external effect
- **Then** `CapabilityExecuted` is recorded and the authorization cannot be reused

##### Should report conformance without granting authority when observable obligations are assessed `[E]`

- **Given** a published EAP profile, host log, and client transcript
- **When** `AssessConformance` evaluates them
- **Then** independent host and client verdicts are reported and no Relative Authority or Truth Ownership changes

### 1.4 Domain Events

##### Should contain its tactical minimum payload when a governed event is emitted

- **Given** any successful trigger defined for `ChangesetCommitted`, `HorizonInitiated`, `ProposalRefused`, `KnowledgeVerified`, `PromotionProposed`, `PersistentDeltaAdmitted`, `KnowledgeContested`, `RecallProgressed`, `TruthOwnershipSuspended`, `HorizonBudgetExhausted`, or `CapabilityExecuted`
- **When** the corresponding event is emitted
- **Then** it contains every minimum payload field listed for that event in the tactical design

##### Should remain immutable when a consumer handles a governed event

- **Given** an emitted governed event with its Sequence or checkpoint context
- **When** a subscriber, audit projection, or external Agent Client consumes it
- **Then** the original event cannot be mutated and grants no permission to change host state

## 2. Integration Scenarios

### 2.1 Repositories and Persistence

##### Should rebuild identical persistent state when SQLite is derived from durable JSONL `[B]`

- **Given** tenant-scoped append-only claims, authority coordinates, and monotonic Sequences committed to JSONL and SQLite
- **When** SQLite is rebuilt from JSONL
- **Then** claims, ownership, and Sequence equal the state before rebuild

##### Should roll back all durable state when a transaction fails midway `[B]`

- **Given** a durable transaction containing multiple accepted mutations
- **When** persistence fails before the transaction completes
- **Then** neither SQLite nor the authoritative JSONL history exposes a partial committed result

##### Should isolate Claim Snapshot Store results when tenants use the same CellKey `[B]`

- **Given** two tenants with the same canonical `CellKey`
- **When** claims, nodes, and authority are read or written
- **Then** each tenant observes only its own snapshots and mutations

##### Should reject one Horizon transition when concurrent saves use the same expected Sequence `[E]`

- **Given** two concurrent transitions loaded from the same Horizon version
- **When** both call `saveTransition` with the same expected Sequence
- **Then** one persists and the stale save returns a deterministic typed conflict or Refusal

##### Should return no Horizon when HorizonId does not exist `[E]`

- **Given** a tenant-scoped `HorizonId` absent from `HorizonRepository`
- **When** `get` is called
- **Then** an empty result is returned without inventing a root or parent

##### Should return Admission Decisions in Sequence order when historySince matches records `[E]`

- **Given** append-only Admission Decisions before and after a requested Sequence
- **When** `AdmissionLedger.historySince` is queried
- **Then** only later decisions are returned in monotonic Sequence order

##### Should return an empty reverse closure when no registered dependent exists `[E]`

- **Given** admitted target claims with no registered reverse-dependency edges
- **When** `DependencyQuery.reverseClosure` executes
- **Then** it returns an empty affected set without inferring unregistered dependencies

##### Should restore Recall progress when a durable checkpoint is retrieved `[E]`

- **Given** a Recall Case with a saved checkpoint and affected claim identifiers
- **When** `RecallRepository.get` retrieves the case after restart
- **Then** processing can resume from the same checkpoint without losing its preserved scar

##### Should reject reused irreversible authorization when consumption is attempted twice `[E]`

- **Given** an irreversible Operator Approval already consumed by `ApprovalRepository`
- **When** `consumeAuthorization` is called again
- **Then** the second call is refused and no capability execution is authorized

### 2.2 Use Cases and MCP Binding

##### Should expose an admitted MCP outcome when a Cognitive command passes host policy `[E]`

- **Given** an authenticated Agent Client submitting a valid `initiate`, `propose`, `promote`, `contest`, or `recall` request
- **When** the MCP Cognitive Binding delegates to the deterministic host use case
- **Then** it returns the admitted outcome and the transport handler adds no independent epistemic policy

##### Should expose a typed MCP Refusal when a Cognitive command fails host policy `[E]`

- **Given** an Agent Client request that violates a deterministic host rule
- **When** the MCP Cognitive Binding handles it
- **Then** it returns the host's stable `RefusalCode` and client obligation without a partial side effect

##### Should keep Intermediator and Executor outputs as proposals when Claude Code uses the client adapter `[E]`

- **Given** Claude Code has assigned LLM-backed Intermediator and Executor roles to produce a recommendation
- **When** the Cognitive Client Adapter submits their output through MCP
- **Then** the output enters as a proposal and only the deterministic MCP host may admit or persist it

##### Should run MCP host contract flows when no LLM provider is configured `[E]`

- **Given** the MCP server has no LLM provider dependency or credentials
- **When** host contract flows submit deterministic protocol requests
- **Then** initiation, lifecycle, admission, Promotion, Contestation, and Recall semantics remain available to external Agent Clients

##### Should follow the declared obligation when the client adapter receives a typed Refusal `[E]`

- **Given** the host returns a typed Refusal to an Intermediator or Executor proposal
- **When** the Cognitive Client Adapter handles the response
- **Then** it applies the declared client obligation and does not blindly treat refusal as authority to retry or mutate state

### 2.3 External Capability Integration

##### Should record a classified result when Capability Gateway execution succeeds `[E]`

- **Given** an authorized capability request with a valid classification, Change Contract, and stable idempotency key
- **When** the external Capability Provider succeeds
- **Then** the gateway returns the classified outcome and an append-only audit reference

##### Should avoid duplicate effects when the Capability Provider receives the same idempotency key `[E]`

- **Given** a previously completed authorized capability execution
- **When** the same request and idempotency key are submitted again
- **Then** the prior outcome is returned or reconciled without repeating the external effect

##### Should leave epistemic state unchanged when the Capability Provider is unavailable `[E]`

- **Given** an authorized concretization request
- **When** the Capability Provider times out or is unavailable
- **Then** no successful `CapabilityExecuted` outcome or verification transition is fabricated and the failure is auditable

## 3. Functional Scenarios

### 3.1 Happy Paths

##### Should govern knowledge from Horizon initiation through parent proposal when an Agent Client completes the lifecycle `[E]`

- **Given** an authenticated Agent Client, a provenanced Negotiation Seed, an immediate parent Horizon, and sufficient budget
- **When** the client invokes MCP initiation, submits the candidate through the complete lifecycle, and requests Promotion with a fresh Sequence
- **Then** the child gains only horizon-local Relative Authority and the parent receives a new proposed candidate with an auditable `PromotionProposed` event

##### Should admit a Persistent Delta when every candidate passes the single Admission Gate `[E]`

- **Given** an authenticated Agent Client and a Persistent Delta whose required candidates satisfy the existing gate
- **When** the delta is submitted through MCP
- **Then** all candidates commit atomically to persistent knowledge, the monotonic Sequence advances, and `PersistentDeltaAdmitted` is observable

##### Should execute resumable Recall when admitted invalidating evidence contests knowledge `[E]`

- **Given** admitted target claims, registered admitted dependency edges, and an evidence-backed invalidating Contestation admitted through the gate
- **When** Recall is requested and processing is interrupted then resumed
- **Then** the deterministic affected set is processed idempotently, graph-owned affected cells emit `TruthOwnershipSuspended`, and history remains queryable

##### Should execute an irreversible Capability when a valid single-use authorization matches the Change Contract `[E]`

- **Given** a classified irreversible action, matching non-expired Operator Approval, current Sequence, and valid Change Contract
- **When** the Agent Client requests concretization through MCP
- **Then** the Capability Gateway executes once, records `CapabilityExecuted`, and consumes the authorization

### 3.2 Alternative and Error Paths

##### Should refuse direct persistence when an external Agent Client attempts to bypass MCP admission `[E]`

- **Given** an Intermediator, Executor, or other external Agent Client with candidate output
- **When** it attempts to mutate authoritative persistent state without the Admission Gate
- **Then** no mutation occurs and the attempt is returned or recorded as a typed governed refusal

##### Should return a typed validation Refusal when an MCP Cognitive request is malformed `[E]`

- **Given** an authenticated Agent Client request with an empty `HorizonId`, negative Sequence, or unknown `RefusalCode`
- **When** the request reaches the MCP boundary
- **Then** the request is rejected with the applicable typed Refusal and no repository write occurs

##### Should return an absent result when an MCP request addresses an unknown Horizon `[E]`

- **Given** an authenticated Agent Client and a tenant-scoped `HorizonId` that does not exist
- **When** the client requests the Horizon or a command requiring it
- **Then** the host returns the project-standard absent-resource outcome without leaking another tenant's state

##### Should refuse stale or out-of-scope Operator Approval when irreversible execution is requested `[E]`

- **Given** an irreversible capability request with an expired, stale-Sequence, or scope-mismatched Operator Approval
- **When** execution is requested through MCP
- **Then** the host returns the applicable typed Refusal, the provider is not called, and approval does not waive evidence requirements

### 3.3 Security and Authority Boundary

##### Should reject non-canonical or cross-tenant identifiers when they reach a governed boundary

- **Given** an MCP request containing an invalid `CellKey`, empty `HorizonId`, or identifier belonging to another tenant
- **When** the host validates the request
- **Then** it rejects the request before query or persistence and exposes no cross-tenant knowledge

##### Should reject oversized or out-of-range contract values when runtime validation applies `[E]`

- **Given** an MCP request with a negative Sequence, unsupported closed-union value, or string exceeding the contract's configured limit
- **When** contract validation runs
- **Then** the request is refused before any lifecycle, repository, or external capability action

##### Should prevent mutation authority when an event is replayed `[E]`

- **Given** an Agent Client has captured `KnowledgeVerified`, `PromotionProposed`, or `CapabilityExecuted`
- **When** it replays the event as though it were a command
- **Then** the host performs no state transition unless a new valid sequence-aware command independently passes its gate

##### Should keep the deterministic MCP host independent when an LLM response is malicious `[E]`

- **Given** an Intermediator or Executor returns prompt-injected content that requests direct persistence or policy bypass
- **When** the client adapter submits that output
- **Then** the host treats it only as untrusted proposal input, applies the same deterministic gates, and grants no LLM write authority

##### Should exclude approval and evidence details from unauthorized projections when audit output is requested `[E]`

- **Given** audit records containing Operator Approval provenance, evidence references, and capability outcomes
- **When** an Agent Client without projection access requests those records
- **Then** the host denies the projection without changing the append-only audit record

## 4. Deferred Scenario Boundaries

The following scenario families are intentionally excluded until an ADR amendment resolves their expected outcomes:

- Promotion already in flight when the Horizon DAG changes.
- The exact destination status of indirect dependents in a Recall cascade.
- Whether `RecallNotice` and an invalidating Contestation are one admitted object or two.
- Whether unknown `faulty_since_seq` expands the closure or only the audit window.
- Mapping `LegacyClaimStatus` values into the proposed Epistemic Lifecycle.
- Page size, batching limits, and completion bounds for very large reverse-dependency closures.
