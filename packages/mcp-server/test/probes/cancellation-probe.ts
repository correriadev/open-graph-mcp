/**
 * F002 task 18 — the cancellation fault injection probe.
 *
 * `docs/specs/cognitive_line/TL.json` open point 2 asks, verbatim:
 *
 *   "In `CapabilityGateway.execute`, if an external capability provider action ignores the passed
 *    `AbortSignal` and hangs beyond `timeoutMs`, how will releasing the idempotency key upon timeout
 *    prevent duplicate execution or race conditions for irreversible side-effects when retried by a
 *    client?"
 *
 * It has been answered structurally up to now, and the structural answer is wrong. `capability-gateway.ts`
 * line 212 releases the reservation in the catch arm of the provider race, with the comment "No outcome
 * was produced, so the key is free again: a failed call must stay retryable." That comment is true of a
 * provider that FAILED. It is false of a provider that HUNG: nothing was produced *to the gateway*, and
 * the provider is still running. Releasing the key there does not prevent duplicate execution — it is
 * the mechanism that permits it. This probe converts that argument into an observation.
 *
 * ── "Double-ignore", defined precisely, and why that is the faithful fault ────────────────────
 * See `DOUBLE_IGNORE_DEFINITION`. Two independent refusals, and both are required:
 *
 *   1. The provider IGNORES THE SIGNAL. It registers no `abort` listener, never reads
 *      `signal.aborted`, and does not stop when the gateway aborts the controller.
 *   2. The provider IGNORES THE DEADLINE. Its promise never settles, so it outlives `timeoutMs`, it
 *      outlives the `execute` call that started it, and it is STILL IN FLIGHT while the retry runs.
 *
 * Either one alone is a different and milder fault. A provider that ignores the signal but settles at
 * the deadline is cancellable in effect — the gateway's `Promise.race` observes an outcome and the
 * external work has finished. A provider that hangs but honours the signal stops its external work the
 * moment `controller.abort()` fires, which is exactly what the gateway's cancel-then-reject ordering
 * was written for. Only both together leave an uncancellable external effect running while a second
 * one is admitted, which is the situation TL open point 2 describes in its own two clauses ("ignores
 * the passed AbortSignal" AND "hangs beyond timeoutMs").
 *
 * ── The effect is COUNTED and never PERFORMED ────────────────────────────────────────────────
 * The fault provider's entire body is one append to its own JSONL ledger. It sends nothing, writes
 * nothing outside the probe's temporary directory, and touches no external system. The duplicate is
 * therefore *observable without being executed* — a dangerous property proven safely. There is no
 * configuration of this probe that performs a real irreversible effect, because there is no code path
 * in it that could.
 *
 * ── ADR-0021 — verification by the durable record, never self-report ─────────────────────────
 * The ledger is a FILE, appended with one `appendFileSync` per record, and it is read back off disk
 * after every `execute` call has returned. `analyzeCancellation` sees only what the file and SQLite
 * hold. An in-process counter would have been simpler and would have been the provider's opinion of
 * itself, which is the thing ADR-0021 forbids as evidence.
 *
 * ── Measurement versus assertion ─────────────────────────────────────────────────────────────
 * Unlike task 17's, THIS probe's output is an assertion. Its observations are counts of discrete
 * events and refusal codes — deterministic, OS-independent, and independent of how long anything took.
 * `CancellationObservation` carries no duration field, so a verdict cannot be a function of a timing
 * even by accident, and NO Benchmark Ledger sample is recorded by this probe at all: there is no
 * timing here worth a sample, and a sample may never discharge a Scenario Identifier. `appendToLedger`
 * is therefore never called from this file, so the serialisation question task 17 had to solve does
 * not arise.
 *
 * ── Pinned in BOTH directions, deliberately ─────────────────────────────────────────────────
 * `CHARACTERISED` records the effect count, the refusal codes and the reservation outcome that
 * production exhibits TODAY, per arm, each labelled SAFE or UNSAFE. `analyzeCancellation` refuses any
 * departure in either direction. A change that adds a third effect fails here; so does a change that
 * removes the duplicate. That is not stubbornness. Whether the gateway should stop releasing the key
 * on timeout is an architectural decision with real costs (a hung provider would make its key
 * permanently unusable), it is not this probe's to take, and it must not be taken silently by a commit
 * that happens to move a number a lenient assertion never looked at.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────────────────────
 *   bun packages/mcp-server/test/probes/cancellation-probe.ts --run [--timeout-ms N]
 *
 * It also RUNS INSIDE `bun test`, via `cancellation-duplicate-effect.test.ts`, once per suite run —
 * the two discharging cases share one run rather than taking one each.
 *
 * The cost is MEASURED, not estimated: 640, 664 and 631 ms over three consecutive runs on the
 * reference machine, against a suite that takes ~81 s clean — about 0.8%. Note where that time goes,
 * because it decides what could be made cheaper: the six `execute` calls contribute at most
 * 6 x 25 ms = 150 ms of deliberate timeout, and the remaining ~490 ms is three `createEapEnv`
 * environments (mkdtemp, openDb, schema creation). Sharing one environment across the arms would
 * recover most of it and is REJECTED: the arms differ in approval state and in what a spent grant
 * means, and an arm that inherited another arm's consumed approvals would be measuring the previous
 * arm. Correctness of the isolation is worth 0.5 s.
 *
 * A separate invocation was rejected for the reason task 17 gave: a probe that runs only when someone
 * remembers proves nothing about the commit that broke the thing, and this probe guards a
 * duplicate-irreversible-effect property.
 */

import { appendFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CapabilityExecutionRequest } from "@open-graph-mcp/graph-core/eap/capabilities"

import { CapabilityGateway } from "../../src/eap/capability-gateway"
import { createEapEnv, type EapEnv } from "../eap-env"
import { removeStateDir } from "./host"

// ── The fault, defined ────────────────────────────────────────────────────────────────────────

export const DOUBLE_IGNORE_DEFINITION =
  "A provider DOUBLE-IGNORES cancellation when it refuses BOTH of the gateway's cancellation " +
  "mechanisms. (1) It ignores the AbortSignal: it adds no 'abort' listener, never reads " +
  "signal.aborted, and does not stop when CapabilityGateway aborts the controller. (2) It ignores " +
  "the timeoutMs deadline: its promise never settles, so it outlives the timeout, outlives the " +
  "execute() call that started it, and is still IN FLIGHT when the client's retry is admitted. " +
  "Either refusal alone is a milder, different fault — ignoring only the signal still lets the race " +
  "observe an outcome once the work finishes, and hanging while honouring the signal still stops the " +
  "external work at abort. Only both together produce an uncancellable external effect running " +
  "concurrently with a second one, which is the fault TL.json open point 2 states in its own two " +
  "clauses."

export const FALSIFICATION_CRITERIA: readonly string[] = [
  "DUPLICATE EFFECT — more than one provider invocation is recorded against a single idempotency " +
    "key across a timeout-then-retry sequence. The idempotency key exists to make a retry safe; two " +
    "effects under one key means it did not.",
  "CONCURRENT DUPLICATE — the second invocation for a key starts while the first has not settled, so " +
    "the two external effects overlap in time. This is strictly worse than a sequential replay: no " +
    "compensating action can be ordered against an effect that has not finished.",
  "FABRICATED OUTCOME — a CapabilityExecuted row exists for a key whose provider never settled. The " +
    "gateway would have invented an outcome, which refutes EAP-CAPB-003 outright.",
  "SILENT RE-CHARACTERISATION — the observed effect count, refusal code or reservation outcome for " +
    "any arm departs from CHARACTERISED in EITHER direction. A safety-critical duplicate-effect " +
    "property must not change without the change being stated.",
  "MISATTRIBUTED SAVE — an arm in which no duplicate occurs is stopped by IDEMPOTENCY_CONFLICT " +
    "rather than by the control the characterisation names. Crediting the idempotency key with a " +
    "save that a single-use approval actually made would leave the real barrier undocumented.",
]

// ── Arms ──────────────────────────────────────────────────────────────────────────────────────

export type ArmId =
  | "reversible-same-key"
  | "irreversible-same-key-same-approval"
  | "irreversible-same-key-new-approval"

export const ARMS: readonly ArmId[] = [
  "reversible-same-key",
  "irreversible-same-key-same-approval",
  "irreversible-same-key-new-approval",
]

export interface AttemptOutcome {
  attempt: number
  status: string
  refusalCode: string | null
}

export interface CharacterisedArm {
  /** Provider invocations expected against the arm's single idempotency key. */
  providerStarts: number
  /** True when the reservation is gone after the first attempt's timeout. */
  keyReleasedOnTimeout: boolean
  attemptStatuses: readonly { status: string; refusalCode: string | null }[]
  approvalIds: readonly string[]
  safety: "SAFE" | "UNSAFE"
  why: string
}

/**
 * What production does TODAY, measured, per arm. Every field is a discrete outcome; none is a timing.
 * `analyzeCancellation` refuses any departure in either direction — see the header.
 */
export const CHARACTERISED: Record<ArmId, CharacterisedArm> = {
  "reversible-same-key": {
    providerStarts: 2,
    keyReleasedOnTimeout: true,
    attemptStatuses: [
      { status: "FAILED", refusalCode: "PROVIDER_UNAVAILABLE" },
      { status: "FAILED", refusalCode: "PROVIDER_UNAVAILABLE" },
    ],
    approvalIds: [],
    safety: "UNSAFE",
    why:
      "A reversible capability needs no operator approval, so after the timeout releases the " +
      "reservation there is NOTHING left standing between the retry and a second provider " +
      "invocation. The idempotency key — the one control whose entire purpose is to make a retry " +
      "safe — provides zero protection here, and the first invocation is still running when the " +
      "second starts.",
  },
  "irreversible-same-key-same-approval": {
    providerStarts: 1,
    keyReleasedOnTimeout: true,
    attemptStatuses: [
      { status: "FAILED", refusalCode: "PROVIDER_UNAVAILABLE" },
      { status: "REFUSED", refusalCode: "APPROVAL_ALREADY_USED" },
    ],
    approvalIds: ["approval-1"],
    safety: "SAFE",
    why:
      "The duplicate is avoided, but NOT by the idempotency key, which was released and freely " +
      "re-reserved. It is avoided because the operator's grant is single-use and was consumed by the " +
      "first attempt. The refusal code says so: APPROVAL_ALREADY_USED, never IDEMPOTENCY_CONFLICT. " +
      "The surviving barrier is an authorization control being asked to do an idempotency control's job.",
  },
  "irreversible-same-key-new-approval": {
    providerStarts: 2,
    keyReleasedOnTimeout: true,
    attemptStatuses: [
      { status: "FAILED", refusalCode: "PROVIDER_UNAVAILABLE" },
      { status: "FAILED", refusalCode: "PROVIDER_UNAVAILABLE" },
    ],
    approvalIds: ["approval-1", "approval-2"],
    safety: "UNSAFE",
    why:
      "The client is told PROVIDER_UNAVAILABLE and its stated obligation is 'Audit failure and retry " +
      "provider when available'; the operator issues a fresh grant, which is the sanctioned response. " +
      "That re-arms the single-use barrier, and the idempotency key does not re-arm with it. A second " +
      "IRREVERSIBLE effect is admitted under the SAME idempotency key while the first is in flight. " +
      "This is the case TL.json open point 2 asks about, and the answer is that nothing stops it.",
  },
}

/** Timeout used for the in-suite run. Long enough to be reached reliably, short enough to be cheap. */
export const IN_SUITE_TIMEOUT_MS = 25

// ── The observation (deterministic — asserted) ────────────────────────────────────────────────

export interface EffectRecord {
  arm: ArmId
  /** The idempotency key the gateway was called with. The count is per THIS value. */
  key: string
  attempt: number
  event: "started" | "settled"
  /** Always false: the provider never looks. Recorded so the fault is visible in the record itself. */
  abortObservedByProvider: boolean
  at: string
  pid: number
}

export interface ArmObservation {
  arm: ArmId
  idempotencyKey: string
  classification: "reversible" | "irreversible"
  approvalIds: readonly string[]
  attempts: readonly AttemptOutcome[]
  /** Read from the effect-ledger FILE after both attempts returned. The evidence. */
  effects: readonly EffectRecord[]
  /** Read from the `capability_executions` row after the first attempt timed out. */
  keyReservedAfterFirstAttempt: boolean
  /** Completed audit rows for this environment. Any value above 0 is a fabricated outcome. */
  completedAuditRows: number
}

/**
 * Everything the verdict may see. Note what is absent: no duration, no timestamp difference, no rate.
 * A timing cannot influence a blocking assertion because a timing cannot be expressed in this type.
 */
export interface CancellationObservation {
  timeoutMs: number
  /** sha256 of the `capability-gateway.ts` on disk for this run. Half of the mutation witness. */
  gatewayDigest: string
  ledgerPath: string
  ledgerLines: number
  arms: readonly ArmObservation[]
}

// ── The analysis ──────────────────────────────────────────────────────────────────────────────

export interface EffectCount {
  arm: ArmId
  key: string
  started: number
  settled: number
  /** Invocations that started and never settled — external effects still running. */
  inFlight: number
  duplicate: boolean
}

export interface CancellationVerdict {
  ok: boolean
  effectCounts: EffectCount[]
  duplicatingArms: ArmId[]
  keyReleasedOnTimeout: ArmId[]
  fabricatedOutcomes: ArmId[]
  characterisationBreaks: string[]
  message: string
}

/**
 * The count that is the point of the probe: provider invocations per idempotency key, per arm.
 *
 * Pure and separately exported so the count can be read and printed without invoking the whole
 * verdict, and so a reader can see that nothing but `effects` feeds it.
 */
export function effectCountsByKey(observation: CancellationObservation): EffectCount[] {
  return observation.arms.map((arm) => {
    const started = arm.effects.filter((record) => record.event === "started").length
    const settled = arm.effects.filter((record) => record.event === "settled").length
    return {
      arm: arm.arm,
      key: arm.idempotencyKey,
      started,
      settled,
      inFlight: started - settled,
      duplicate: started > 1,
    }
  })
}

/**
 * The whole blocking half, as a pure function over the durable record.
 *
 * Pure so the refutation logic is testable without a gateway, and so a broken probe fails in a unit
 * test rather than being mistaken for a broken gateway.
 */
export function analyzeCancellation(observation: CancellationObservation): CancellationVerdict {
  const effectCounts = effectCountsByKey(observation)
  const byArm = new Map(effectCounts.map((count) => [count.arm, count]))
  const breaks: string[] = []
  const fabricatedOutcomes: ArmId[] = []
  const keyReleasedOnTimeout: ArmId[] = []

  for (const arm of observation.arms) {
    const expected = CHARACTERISED[arm.arm]
    if (expected === undefined) {
      breaks.push(`${arm.arm}: no characterisation is declared for this arm.`)
      continue
    }
    const count = byArm.get(arm.arm)!

    if (count.started !== expected.providerStarts) {
      breaks.push(
        `${arm.arm}: ${count.started} provider invocation(s) recorded against idempotency key ` +
          `'${arm.idempotencyKey}', characterised as ${expected.providerStarts}. A safety-critical ` +
          "duplicate-effect property changed; re-characterise it in the open rather than here.",
      )
    }
    if (count.settled !== 0) {
      breaks.push(
        `${arm.arm}: ${count.settled} provider invocation(s) SETTLED. A double-ignoring provider ` +
          "never settles, so the injected fault was not the fault this probe claims to inject.",
      )
    }

    const released = !arm.keyReservedAfterFirstAttempt
    if (released) keyReleasedOnTimeout.push(arm.arm)
    if (released !== expected.keyReleasedOnTimeout) {
      breaks.push(
        `${arm.arm}: the idempotency reservation for '${arm.idempotencyKey}' was ` +
          `${released ? "RELEASED" : "still HELD"} after the timeout, characterised as ` +
          `${expected.keyReleasedOnTimeout ? "RELEASED" : "still HELD"}.`,
      )
    }

    if (arm.attempts.length !== expected.attemptStatuses.length) {
      breaks.push(
        `${arm.arm}: ${arm.attempts.length} attempt(s) observed, characterised as ` +
          `${expected.attemptStatuses.length}.`,
      )
    } else {
      for (const [index, attempt] of arm.attempts.entries()) {
        const want = expected.attemptStatuses[index]!
        if (attempt.status !== want.status || attempt.refusalCode !== want.refusalCode) {
          breaks.push(
            `${arm.arm}: attempt ${index + 1} returned ${attempt.status}/${attempt.refusalCode}, ` +
              `characterised as ${want.status}/${want.refusalCode}. WHICH control stopped a retry ` +
              "is the finding, so a changed refusal code is a changed answer.",
          )
        }
      }
    }

    if (arm.completedAuditRows !== 0) {
      fabricatedOutcomes.push(arm.arm)
      breaks.push(
        `${arm.arm}: ${arm.completedAuditRows} completed CapabilityExecuted row(s) exist although no ` +
          "provider ever settled. The gateway invented an outcome (EAP-CAPB-003 refuted).",
      )
    }
  }

  const duplicatingArms = effectCounts.filter((count) => count.duplicate).map((count) => count.arm)

  return {
    ok: breaks.length === 0,
    effectCounts,
    duplicatingArms,
    keyReleasedOnTimeout,
    fabricatedOutcomes,
    characterisationBreaks: breaks,
    message:
      breaks.length === 0
        ? `Matches the characterisation on all ${observation.arms.length} arm(s). Effects per ` +
          `idempotency key: ${effectCounts
            .map((count) => `${count.arm}='${count.key}' -> ${count.started}`)
            .join(", ")}. DUPLICATE EFFECT IS POSSIBLE on ${duplicatingArms.length} arm(s) ` +
          `(${duplicatingArms.join(", ") || "none"}); this probe pins that property, it does not ` +
          "bless it."
        : `CHARACTERISATION BROKEN — ${breaks.join(" ")}`,
  }
}

// ── The fault provider ────────────────────────────────────────────────────────────────────────

const GATEWAY_SOURCE = join(import.meta.dir, "..", "..", "src", "eap", "capability-gateway.ts")

/**
 * sha256 of the gateway source this run is observing. One of TWO independent witnesses that a
 * mutation reached the code under probe — the other being the behavioural signature the arms
 * themselves produce (`keyReservedAfterFirstAttempt` and the refusal codes). A mutation that moves
 * neither did not reach the code under probe, and this feature's mutation rule says a check staying
 * green under a mutation proves nothing until that is shown.
 */
export function gatewaySourceDigest(): string {
  return new Bun.CryptoHasher("sha256").update(readFileSync(GATEWAY_SOURCE)).digest("hex")
}

/**
 * A provider that DOUBLE-IGNORES cancellation, and that PERFORMS NOTHING.
 *
 * The whole body is one append to the probe's own JSONL ledger, inside the probe's own temporary
 * directory. It contacts no external system and mutates no state outside that file. The returned
 * promise has no `resolve` and no `reject` reachable by anyone, and no listener is attached to the
 * signal, so both halves of `DOUBLE_IGNORE_DEFINITION` hold by construction rather than by intent.
 */
function doubleIgnoringProvider(
  ledgerPath: string,
  arm: ArmId,
  key: string,
  attempt: number,
): (signal?: AbortSignal) => Promise<never> {
  return (_signal?: AbortSignal) => {
    const record: EffectRecord = {
      arm,
      key,
      attempt,
      event: "started",
      // The provider does not look at the signal. Recorded as `false` so the record itself carries
      // the fault, rather than the fault being a claim made in a comment.
      abortObservedByProvider: false,
      at: new Date().toISOString(),
      pid: process.pid,
    }
    appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" })
    // Never settles: no resolve, no reject, no timer. The effect stays in flight past `timeoutMs`,
    // past the `execute` call, and into the retry.
    return new Promise<never>(() => {})
  }
}

/** Reads the effect ledger FILE — the evidence. Never a counter held in this process's memory. */
export function readEffectLedger(ledgerPath: string): EffectRecord[] {
  if (!existsSync(ledgerPath)) return []
  return readFileSync(ledgerPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EffectRecord)
}

// ── The run ───────────────────────────────────────────────────────────────────────────────────

function refusalCodeOf(result: Awaited<ReturnType<CapabilityGateway["execute"]>>): string | null {
  return result.status === "COMPLETED" ? null : result.refusal.code
}

/** True while a `reserved` row for this key exists — read from SQLite, not inferred from the result. */
function reservationHeld(env: EapEnv, key: string): boolean {
  const row = env.db
    .query(
      "SELECT status FROM capability_executions WHERE tenant_id = ? AND idempotency_key = ? AND status = 'reserved'",
    )
    .get(env.tenantId, key) as { status: string } | null
  return row !== null
}

async function runArm(
  arm: ArmId,
  ledgerPath: string,
  timeoutMs: number,
): Promise<{ observation: ArmObservation; cleanup: () => void }> {
  const spec = CHARACTERISED[arm]
  const classification = arm === "reversible-same-key" ? "reversible" : "irreversible"
  const capabilityId = `probe_${classification}_tool`
  const key = `probe-key-${arm}`

  const env = createEapEnv({ tenantId: `probe-${arm}` })
  // A durable governed horizon, so approval freshness is validated against real state rather than a
  // caller-supplied sequence. The gateway overwrites `request.currentSeq` with this.
  env.setObservedSeq(5)

  const gateway = new CapabilityGateway(env.approvals, env.audit, env.sequences)
  gateway.registerClassification(capabilityId, classification)

  for (const id of spec.approvalIds) {
    const registered = env.approvals.registerApproval({
      id,
      approver: "probe-operator",
      scope: "probe-scope",
      expiresAt: Date.now() + 600_000,
      basedOnSeq: 5,
    })
    if (!registered.registered) {
      throw new Error(`cancellation probe: could not register approval '${id}': ${registered.reason}`)
    }
  }

  /**
   * The client's request. Note what the attached approval carries: the right ID and DELIBERATELY
   * WRONG scope, expiry and `basedOnSeq`. The gateway treats a client-supplied approval as an
   * identifier claim only and reads the grant's real terms from durable storage (Retry #5 defect 3),
   * so these values must have no effect whatever. If that ever regressed, this arm would refuse on
   * scope or expiry and `analyzeCancellation` would break the characterisation — so the probe
   * carries a free guard on an authorization property it is not otherwise about.
   */
  const request = (attempt: number, approvalId: string | undefined): CapabilityExecutionRequest => ({
    capabilityId,
    idempotencyKey: key,
    contract: { contractRef: "probe-contract", targetScope: "probe-scope" },
    currentSeq: 5,
    ...(approvalId === undefined
      ? {}
      : {
          approval: {
            id: approvalId,
            approver: "not-the-stored-approver",
            scope: "not-the-stored-scope",
            expiresAt: 0,
            basedOnSeq: -1,
          },
        }),
    providerAction: doubleIgnoringProvider(ledgerPath, arm, key, attempt),
  })

  // Attempt 1 — the first approval if this arm has one.
  const first = await gateway.execute(request(1, spec.approvalIds[0]), { timeoutMs })
  // Read the reservation IMMEDIATELY after the first attempt returns and BEFORE the retry, or the
  // retry's own reservation would be mistaken for the first one never having been released.
  const keyReservedAfterFirstAttempt = reservationHeld(env, key)

  // Attempt 2 — the client's retry, with the SAME idempotency key. The approval it carries is the
  // arm's whole variable: the same spent grant, a fresh one, or none at all.
  const retryApproval = spec.approvalIds.length > 1 ? spec.approvalIds[1] : spec.approvalIds[0]
  const second = await gateway.execute(request(2, retryApproval), { timeoutMs })

  const effects = readEffectLedger(ledgerPath).filter((record) => record.arm === arm)

  return {
    observation: {
      arm,
      idempotencyKey: key,
      classification,
      approvalIds: spec.approvalIds,
      attempts: [
        { attempt: 1, status: first.status, refusalCode: refusalCodeOf(first) },
        { attempt: 2, status: second.status, refusalCode: refusalCodeOf(second) },
      ],
      effects,
      keyReservedAfterFirstAttempt,
      completedAuditRows: env.audit.count(),
    },
    // Deferred: the arms' provider promises are still pending, and this probe's own environments must
    // outlive the assertions that read them. Closing the database under a pending promise is how a
    // Windows sharing violation gets manufactured out of nothing.
    cleanup: () => env.cleanup(),
  }
}

export interface CancellationProbeRun {
  observation: CancellationObservation
  verdict: CancellationVerdict
  cleanup: () => void
}

export async function runCancellationProbe(
  config: { timeoutMs?: number; verbose?: boolean } = {},
): Promise<CancellationProbeRun> {
  const timeoutMs = config.timeoutMs ?? IN_SUITE_TIMEOUT_MS
  const verbose = config.verbose ?? false
  const dir = mkdtempSync(join(tmpdir(), "eap-probe-cancel-"))
  const ledgerPath = join(dir, "effect-ledger.jsonl")

  if (verbose) {
    console.log(DOUBLE_IGNORE_DEFINITION)
    console.log("")
    console.log("Falsification criteria, stated before anything is executed:")
    for (const criterion of FALSIFICATION_CRITERIA) console.log(`  - ${criterion}`)
    console.log("")
  }

  const cleanups: (() => void)[] = []
  const arms: ArmObservation[] = []
  try {
    // Sequential, one arm at a time: each arm owns its own tenant and environment, and running them
    // concurrently would put three sets of pending provider promises on one event loop for no gain.
    for (const arm of ARMS) {
      const result = await runArm(arm, ledgerPath, timeoutMs)
      cleanups.push(result.cleanup)
      arms.push(result.observation)
    }
  } catch (error) {
    for (const cleanup of cleanups) cleanup()
    removeStateDir(dir)
    throw error
  }

  const observation: CancellationObservation = {
    timeoutMs,
    gatewayDigest: gatewaySourceDigest(),
    ledgerPath,
    ledgerLines: readEffectLedger(ledgerPath).length,
    arms,
  }

  return {
    observation,
    verdict: analyzeCancellation(observation),
    cleanup: () => {
      for (const cleanup of cleanups) cleanup()
      removeStateDir(dir)
    },
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────────

function argValue(flag: string): string | undefined {
  const at = process.argv.indexOf(flag)
  return at === -1 ? undefined : process.argv[at + 1]
}

if (import.meta.main) {
  if (process.argv.includes("--run")) {
    const run = await runCancellationProbe({
      timeoutMs: Number(argValue("--timeout-ms") ?? IN_SUITE_TIMEOUT_MS),
      verbose: true,
    })
    console.log(`Gateway observed: sha256 ${run.observation.gatewayDigest}`)
    console.log(`Effect ledger: ${run.observation.ledgerPath} (${run.observation.ledgerLines} record(s))`)
    console.log("")
    console.log("Effects per idempotency key:")
    for (const count of run.verdict.effectCounts) {
      console.log(
        `  ${count.arm}  key='${count.key}'  started=${count.started}  settled=${count.settled}  ` +
          `inFlight=${count.inFlight}  ${count.duplicate ? "DUPLICATE" : "no duplicate"}  ` +
          `[${CHARACTERISED[count.arm].safety}]`,
      )
    }
    console.log("")
    for (const arm of run.observation.arms) {
      console.log(
        `  ${arm.arm}: ` +
          arm.attempts.map((a) => `attempt${a.attempt}=${a.status}/${a.refusalCode ?? "-"}`).join("  ") +
          `  reservationHeldAfterTimeout=${arm.keyReservedAfterFirstAttempt}` +
          `  completedAuditRows=${arm.completedAuditRows}`,
      )
    }
    console.log("")
    console.log(run.verdict.ok ? `Verdict: MATCHES CHARACTERISATION — ${run.verdict.message}` : `Verdict: ${run.verdict.message}`)
    run.cleanup()
    process.exit(run.verdict.ok ? 0 : 1)
  } else {
    console.error(
      "cancellation fault injection probe. Usage:\n" +
        "  --run [--timeout-ms N]   inject the double-ignore fault and report the effect count per key",
    )
    process.exit(2)
  }
}
