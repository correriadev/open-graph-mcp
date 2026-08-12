---
doc_type: feature
domain: cognitive_line
stack: [TypeScript, Bun, SQLite (bun:sqlite), MCP]
node_id: "feature:cognitive-line"
tags: [eap, horizons, promotion, recall, capability-gateway]
edges:
  - relation: references
    target: "adr:adr"
updated: 2026-08-11
---
# Cognitive Line — EAP Domain Layer

Epistemic Admission Protocol (EAP) surface of the reference host: horizons, boundary operators, contestation, recall, and capability governance.

```graph
{
  "node_id": "feature:cognitive-line",
  "domain": "cognitive_line",
  "implements": ["adr:adr"],
  "tested_by": [],
  "entrypoints": [
    "packages/mcp-server/src/tools/eap.ts",
    "packages/client/src/eap.ts"
  ],
  "registration_files": [
    "packages/mcp-server/src/transport.ts",
    "packages/mcp-server/src/db.ts"
  ],
  "reference_files": [
    "packages/graph-core/src/eap/refusals.ts",
    "packages/mcp-server/src/eap/eap-repositories.ts"
  ],
  "code_files": [
    "packages/graph-core/src/eap/types.ts",
    "packages/graph-core/src/eap/lifecycle.ts",
    "packages/graph-core/src/eap/horizon.ts",
    "packages/graph-core/src/eap/promotion.ts",
    "packages/graph-core/src/eap/contestation.ts",
    "packages/graph-core/src/eap/recall.ts",
    "packages/graph-core/src/eap/capabilities.ts",
    "packages/graph-core/src/eap/budget.ts",
    "packages/mcp-server/src/eap/horizon-store.ts",
    "packages/mcp-server/src/eap/promotion-service.ts",
    "packages/mcp-server/src/eap/contestation-service.ts",
    "packages/mcp-server/src/eap/recall-worker.ts",
    "packages/mcp-server/src/eap/capability-gateway.ts",
    "packages/mcp-server/src/eap/persistent-delta.ts",
    "packages/mcp-server/src/gates.ts"
  ],
  "test_files": [
    "packages/mcp-server/test/eap-env.ts",
    "packages/mcp-server/test/eap-conformance.test.ts",
    "packages/mcp-server/test/eap-refusals.test.ts",
    "packages/mcp-server/test/eap-mcp-contract.test.ts",
    "packages/mcp-server/test/promotion.test.ts",
    "packages/mcp-server/test/contestation.test.ts",
    "packages/mcp-server/test/recall.test.ts",
    "packages/mcp-server/test/capability-governance.test.ts",
    "packages/mcp-server/test/persistent-delta.test.ts",
    "packages/mcp-server/test/horizon-durability.test.ts",
    "packages/mcp-server/test/f001-retry5-durability.test.ts",
    "packages/mcp-server/test/f001-retry5-concurrency-authz.test.ts",
    "packages/client/test/eap-client.test.ts",
    "packages/client/test/eap-conformance.test.ts"
  ]
}
```

## OVERVIEW

The **cognitive_line** domain implements the EAP semantics on top of the existing OpenGraph host: a per-horizon epistemic lifecycle, the boundary operators `PROMOTE` / `CONTEST` / `INITIATE`, `RECALL` over persistent state, and a Capability Gateway for externally-effectful tools. Pure domain rules live in `packages/graph-core/src/eap/`; durable services and the MCP adapters live in `packages/mcp-server/src/eap/` and `packages/mcp-server/src/tools/eap.ts`. Persistence is SQLite (`bun:sqlite`) with a per-tenant append-only JSONL mirror.

## FOLDER STRUCTURE

<folder_structure>
```
packages/graph-core/src/eap/         # Pure domain: no IO, no SQLite
├── types.ts                         # CellKey, lifecycle states, boundary commands, ownership
├── refusals.ts                      # Closed REFUSAL_CODES + CLIENT_OBLIGATIONS map
├── lifecycle.ts / horizon.ts        # EpistemicLifecycle and Horizon aggregates
├── promotion.ts / contestation.ts   # Boundary-operator rules and refusal shapes
├── recall.ts                        # Cascade, checkpoints, scars (pure state machine)
└── capabilities.ts / budget.ts      # Classification, approval validation, budget ledger

packages/mcp-server/src/
├── db.ts                            # Schema, durableTransaction, serialTransaction, allocateSequence
├── gates.ts                         # incrementalGate/finalGate, buildRoundtripIndex
├── transport.ts                     # MCP tool registry and dispatch
├── tools/eap.ts                     # cognitive.* MCP adapters
└── eap/                             # Durable domain services
    ├── eap-repositories.ts          # SQLite repositories for every EAP aggregate
    ├── horizon-store.ts             # HorizonStore, AdmissionLedgerStore
    ├── promotion-service.ts         # Repository-backed PROMOTE
    ├── contestation-service.ts      # Repository-backed CONTEST
    ├── recall-worker.ts             # Resumable RECALL with durable checkpoints
    ├── capability-gateway.ts        # Authorization, timeout, retention-bounded audit
    └── persistent-delta.ts          # admitPersistentDelta, single durable unit

packages/client/src/eap.ts           # ExternalAgentClientAdapter (L0/L1 client obligations)
packages/mcp-server/test/            # Bun tests; eap-env.ts simulates host restart
```
</folder_structure>

## IMPLEMENTATION STATUS

REQUIRED: Read this section before assuming any governance behaviour is active at runtime.

| Surface | Wired into `transport.ts` | Notes |
|---|---|---|
| `cognitive.initiate` | Yes | `eapInitiate` in `tools/eap.ts` |
| `cognitive.propose` | Yes | `eapPropose` in `tools/eap.ts` |
| `cognitive.promote` | Yes | `eapPromote` in `tools/eap.ts` |
| `cognitive.contest` | Yes | `eapContest` in `tools/eap.ts` |
| `cognitive.recall` | Yes | `eapRecall` in `tools/eap.ts` |
| `CapabilityGateway` | **No** | Reachable only from the test suite |
| `PromotionService` | **No** | Reachable only from the test suite |
| `ContestationService` | **No** | Reachable only from the test suite |
| `RecallWorker` | **No** | Reachable only from the test suite |
| `admitPersistentDelta` | **No** | Reachable only from the test suite |

Current facts about the runtime path:

- The five `cognitive.*` adapters in `tools/eap.ts` **reimplement** promotion, contestation and recall against the same SQLite tables instead of delegating to the domain services. The adapter rules are **weaker** than the service rules.
- `eapRecall` writes a `recalls` row with `status: "completed"` and copies the contestation's target claim ids into `affected_claim_ids`. It performs **no** dependency traversal, **no** authority degradation and **no** scar creation. `RecallWorker` is the component that does those, and it is not on this path.
- No capability execution passes through `CapabilityGateway` at runtime; tool classification, operator-approval validation, execution timeout and the audit log are inert outside tests.
- Two horizons of the six-state machine are materialized: the **persistent** horizon (gate, cells, roundtrip) and the horizon records governed by `HorizonStore`. No session, negotiation, transformation or microtask host exists.

## MAIN COMPONENTS

### Domain (`packages/graph-core/src/eap/`)
- **`REFUSAL_CODES` / `CLIENT_OBLIGATIONS`**: closed refusal vocabulary; each code maps to the conforming client's obligation. `getClientObligation` and `reasonToRefusal` bridge legacy free-text gate reasons.
- **`EpistemicLifecycle`**: six-state aggregate with typed transition outcomes (`LifecycleTransitionSuccess | LifecycleTransitionRefusal`).
- **`promoteKnowledge`**: pure `PROMOTE` rule producing `PromotionSuccess | PromotionRefusal` plus a `ParentProposal`.
- **`createRecallCase` / `stepRecall` / `resumeRecallFromCheckpoint`**: resumable cascade over a `DependencyQuery`.
- **`classifyCapability` / `validateOperatorApproval` / `authorizeCapability`**: unclassified capability defaults to `irreversible`.

### Persistence (`packages/mcp-server/src/db.ts`)
- **`durableTransaction`**: re-entrant unit covering SQLite writes plus the JSONL mirror.
- **`serialTransaction`**: `BEGIN IMMEDIATE`, serializing read-decide-write sections between writers.
- **`allocateSequence`**: single `UPSERT ... RETURNING` against `eap_sequences`; replaces every `MAX(seq)+1`.
- **`write`**: SQLite row plus per-tenant append-only JSONL mirror; `rebuildFromJsonl` replays the mirror.

### Services (`packages/mcp-server/src/eap/`)
- **`eap-repositories.ts`**: `SqlitePromotionRepository`, `SqliteContestationRepository`, `SqliteRecallRepository`, `SqliteApprovalRepository`, `SqliteCapabilityAuditRepository`. The services hold no in-memory aggregate state.
- **`CapabilityGateway`**: resolves the approval by id from `operator_approvals` (never trusts a client-supplied approval object), enforces `DEFAULT_CAPABILITY_TIMEOUT_MS` with `AbortSignal`, and returns `getAuditLog` as a tagged `{ projection, entries }` union — full entries only for a principal holding `audit:read`.
- **`admitPersistentDelta`**: gate evaluation, changeset open, `cs_deltas` staging and commit as **one** `durableTransaction`.

## PERSISTENCE TABLES

| Table | Mirrored to JSONL | Purpose |
|---|---|---|
| `horizons`, `admission_decisions` | Yes | Governed horizons and admission ledger |
| `candidates`, `proposals`, `promotion_events` | Yes | Lifecycle candidates and `PROMOTE` output |
| `contestations` | Yes | `CONTEST` events with severity |
| `recalls`, `recall_cases`, `recall_checkpoints`, `recall_scars` | Yes | `RECALL` state and scars |
| `operator_approvals` | Yes | Operator grants with scope, expiry, consumed flag |
| `eap_sequences` | **No** | Monotonic allocator; a mirror rebuild must never reset it |
| `capability_executions` | **No** | Idempotency + audit under a retention bound incompatible with an append-only mirror |

## PARAMETERS / CONFIGURATIONS

| Name | Type | Required | Description | Default |
|------|------|----------|-------------|---------|
| `DEFAULT_CAPABILITY_TIMEOUT_MS` | number | No | Capability execution timeout before `AbortController.abort()` | 5000 |
| `DEFAULT_AUDIT_MAX_ENTRIES` | number | No | Retention bound on `capability_executions`, enforced in the append transaction | 10000 |
| `DEFAULT_MAX_RETAINED_EVENTS` | number | No | Bounded in-process event ring in `RecallWorker` | 500 |

## HOW TO EXTEND THE COGNITIVE SURFACE

### Prerequisites
1. Install workspace dependencies with **bun**.
2. Use `packages/mcp-server/test/eap-env.ts` when a test must survive a host restart — it closes and reopens the database from disk.

### Steps
1. Add or change the pure rule in `packages/graph-core/src/eap/`.
2. Add the durable read/write in `packages/mcp-server/src/eap/eap-repositories.ts`; add any new table to `db.ts` and decide explicitly whether it is JSONL-mirrored.
3. Delegate from the adapter in `packages/mcp-server/src/tools/eap.ts` to the domain service — do **not** reimplement the rule.
4. Register the tool name and dispatch case in `packages/mcp-server/src/transport.ts`.
5. Add the refusal code to `REFUSAL_CODES` and its obligation to `REFUSAL_OBLIGATIONS`.

<code_example>
// CORRECT: allocate the sequence and write it inside one serialized unit
serialTransaction(state.db, () => {
  const seq = allocateSequence(state.db, tenantId, "contestations")
  write(state.db, state.stateDir, tenantId, "contestations", { tenant_id: tenantId, seq, /* ... */ })
})

// WRONG: races between writers and reissues a sequence after row deletion
const seq = db.query("SELECT COALESCE(MAX(seq),0)+1 FROM contestations").get()
</code_example>

## COMMANDS

| Command | Purpose |
|---|---|
| `cd packages/mcp-server && bun test --timeout 30000` | Host suite, including all EAP tests |
| `cd packages/graph-core && bun test --timeout 30000` | Pure domain suite |
| `cd packages/client && bun test --timeout 30000` | Client obligation suite |
| `bunx tsc -p packages/mcp-server/tsconfig.check.json` | Ad-hoc typecheck; `tsconfig.json` is broken upstream (missing `@tsconfig/bun`) |

## BEST PRACTICES

REQUIRED: Allocate sequences through `allocateSequence` — monotonicity must survive row deletion and rebuild.
REQUIRED: Wrap any read-decide-write over EAP tables in `serialTransaction`.
REQUIRED: Resolve operator approvals from `operator_approvals` by id — a client-supplied approval object is untrusted input.
REQUIRED: Emit refusals as codes from `REFUSAL_CODES` with the matching client obligation.
FORBIDDEN: Adding a second implementation of a domain rule inside `tools/eap.ts` — the adapter is a port, not a rule engine.
FORBIDDEN: Mirroring `eap_sequences` or `capability_executions` to JSONL — retention and monotonic allocation are incompatible with an append-only mirror.

## TIPS

<code_tip>
// Build the roundtrip index ONCE per batch; incrementalGate accepts it via IncrementalCtx.existingRoundtrip.
// Omitting it re-projects the entire tenant claim set per candidate.
const existingRoundtrip = buildRoundtripIndex(claims)
</code_tip>

## KNOWN GAPS

- 24 pre-existing TypeScript errors remain in `mcp-server` files outside this domain; `packages/mcp-server/tsconfig.json` is broken upstream.
- No coverage tooling is configured in the repository.
- Concurrency is serialized structurally (`BEGIN IMMEDIATE` + atomic allocator); no multi-process load harness exists.
- Capability cancellation is cooperative; a provider ignoring its `AbortSignal` cannot be killed. No circuit breaker.

## REFERENCES

- [**ADR.md**](../adr/ADR.md): normative decisions ADR-0001 to ADR-0021 that this domain implements, plus Appendix C recording this module's persistence and governance decisions.
