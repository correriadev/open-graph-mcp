/**
 * F002 task 18 — the probe's OWN tests: the refutation logic, and the demonstration that this probe
 * can fail.
 *
 * This file imports no Discharge Annotation surface, so it is NOT a member of the EAP Test Corpus
 * (`reconcile-traceability.ts` decides membership by looking for an import of the annotation module
 * in the file's own bytes — which is why this comment must not spell that import path out, or the
 * mention alone would enrol this file in the corpus). It discharges no Scenario Identifier and claims
 * none: these cases test the ANALYSER, and the EAP Scenarios are claims about the protocol, not about
 * a function in a probe.
 *
 * The discharging half — the cases that run the probe against a real `CapabilityGateway` and that do
 * claim Scenario Identifiers — lives in `cancellation-duplicate-effect.test.ts`, which does import the
 * annotation surface and is a corpus member. Task 17 kept its probe entirely out of the corpus because
 * it observed an implementation property (allocator monotonicity) that no Scenario states. Task 18
 * diverges deliberately: TL.json open point 2 is a question about duplicate irreversible effects under
 * one idempotency key, and that is EAP-CAPB-002 almost word for word, so the observation belongs in the
 * Traceability Map. The split of files is what keeps the analyser's fixtures out of it.
 *
 * ── Why these fixture cases exist at all ──────────────────────────────────────────────────────
 * A probe whose analyser has never been seen to say "no" is a probe that has only ever been able to
 * agree. Every case below feeds `analyzeCancellation` an observation that differs from the
 * characterised production behaviour in exactly one way and asserts that the verdict REFUSES it. No
 * production code is mutated to produce them, so the demonstration costs nothing and runs every time.
 */

import { describe, expect, test } from "bun:test"

import {
  ARMS,
  CHARACTERISED,
  DOUBLE_IGNORE_DEFINITION,
  FALSIFICATION_CRITERIA,
  analyzeCancellation,
  effectCountsByKey,
  type ArmId,
  type ArmObservation,
  type CancellationObservation,
  type EffectRecord,
} from "./cancellation-probe"

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────

const effect = (arm: ArmId, key: string, attempt: number, event: EffectRecord["event"]): EffectRecord => ({
  arm,
  key,
  attempt,
  event,
  abortObservedByProvider: false,
  at: "2026-08-14T00:00:00.000Z",
  pid: 1,
})

/** One arm exactly as the characterisation says production behaves. */
function armAsCharacterised(arm: ArmId): ArmObservation {
  const expected = CHARACTERISED[arm]
  const key = `probe-${arm}`
  const effects: EffectRecord[] = []
  for (let attempt = 1; attempt <= expected.providerStarts; attempt++) {
    effects.push(effect(arm, key, attempt, "started"))
  }
  return {
    arm,
    idempotencyKey: key,
    classification: arm === "reversible-same-key" ? "reversible" : "irreversible",
    approvalIds: expected.approvalIds,
    attempts: expected.attemptStatuses.map((status, index) => ({
      attempt: index + 1,
      status: status.status,
      refusalCode: status.refusalCode,
    })),
    effects,
    keyReservedAfterFirstAttempt: !expected.keyReleasedOnTimeout,
    completedAuditRows: 0,
  }
}

function observationAsCharacterised(): CancellationObservation {
  return {
    timeoutMs: 25,
    gatewayDigest: "0".repeat(64),
    ledgerPath: "/probe/effect-ledger.jsonl",
    ledgerLines: ARMS.reduce((total, arm) => total + CHARACTERISED[arm].providerStarts, 0),
    arms: ARMS.map(armAsCharacterised),
  }
}

/** Replaces one arm of an otherwise-characterised observation. */
function withArm(arm: ArmId, mutate: (observed: ArmObservation) => ArmObservation): CancellationObservation {
  const base = observationAsCharacterised()
  return {
    ...base,
    arms: base.arms.map((observed) => (observed.arm === arm ? mutate(observed) : observed)),
  }
}

// ── The falsification criterion, and the definition of the fault ──────────────────────────────

describe("the fault and its refutation are declared in code, not left to prose", () => {
  test("`double-ignore` is defined as TWO separate refusals, because one alone is a different fault", () => {
    const text = DOUBLE_IGNORE_DEFINITION.toLowerCase()
    // A provider that ignores the signal but settles at the deadline is cancellable in effect; a
    // provider that hangs but honours the signal stops its external work. Only both together leave an
    // uncancellable effect in flight while the retry runs, which is the fault TL open point 2 names.
    expect(text).toContain("abortsignal")
    expect(text).toContain("timeoutms")
    expect(text).toContain("in flight")
  })

  test("the probe declares what observation would refute the safety claim", () => {
    expect(FALSIFICATION_CRITERIA.length).toBeGreaterThanOrEqual(3)
    const text = FALSIFICATION_CRITERIA.join(" ").toLowerCase()
    expect(text).toContain("duplicate")
    expect(text).toContain("idempotency key")
  })

  test("every declared arm carries a characterisation, and each is labelled SAFE or UNSAFE", () => {
    expect(ARMS.length).toBe(3)
    for (const arm of ARMS) {
      const entry = CHARACTERISED[arm]
      expect(entry).toBeDefined()
      expect(["SAFE", "UNSAFE"]).toContain(entry.safety)
      expect(entry.why.length).toBeGreaterThan(40)
    }
  })
})

// ── The analyser ──────────────────────────────────────────────────────────────────────────────

describe("effectCountsByKey — the count that is the point of the probe", () => {
  test("counts provider starts per idempotency key and marks more than one a duplicate", () => {
    const counts = effectCountsByKey(observationAsCharacterised())
    const byArm = new Map(counts.map((count) => [count.arm, count]))

    // The reversible arm: ONE key, TWO provider starts, and the second started while the first had
    // not settled. That is the duplicate, observed rather than argued.
    expect(byArm.get("reversible-same-key")!.started).toBe(2)
    expect(byArm.get("reversible-same-key")!.settled).toBe(0)
    expect(byArm.get("reversible-same-key")!.inFlight).toBe(2)
    expect(byArm.get("reversible-same-key")!.duplicate).toBe(true)

    // The same-approval arm: the single-use grant refuses the retry, so ONE start.
    expect(byArm.get("irreversible-same-key-same-approval")!.started).toBe(1)
    expect(byArm.get("irreversible-same-key-same-approval")!.duplicate).toBe(false)

    // The re-approved arm: a fresh grant re-arms the retry and the key does not stop it. TWO.
    expect(byArm.get("irreversible-same-key-new-approval")!.started).toBe(2)
    expect(byArm.get("irreversible-same-key-new-approval")!.duplicate).toBe(true)
  })

  test("each arm's effects all carry that arm's single idempotency key, so a count is per key", () => {
    for (const arm of observationAsCharacterised().arms) {
      expect(new Set(arm.effects.map((record) => record.key)).size).toBe(1)
      expect(arm.effects[0]!.key).toBe(arm.idempotencyKey)
    }
  })
})

describe("analyzeCancellation — the deterministic, blocking half", () => {
  test("an observation matching the characterisation is admitted, and still reports the unsafe arms", () => {
    const verdict = analyzeCancellation(observationAsCharacterised())
    expect(verdict.characterisationBreaks).toEqual([])
    expect(verdict.ok).toBe(true)
    // Admitted is NOT the same as safe. The probe pins a dangerous property; it does not bless it.
    const unsafe: ArmId[] = ["irreversible-same-key-new-approval", "reversible-same-key"]
    expect(verdict.duplicatingArms.sort()).toEqual(unsafe.sort())
    expect(verdict.keyReleasedOnTimeout).toContain("reversible-same-key")
  })

  test("one EXTRA provider start on any arm breaks the characterisation", () => {
    const verdict = analyzeCancellation(
      withArm("irreversible-same-key-same-approval", (arm) => ({
        ...arm,
        effects: [...arm.effects, effect(arm.arm, arm.idempotencyKey, 2, "started")],
      })),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.characterisationBreaks.join(" ")).toContain("irreversible-same-key-same-approval")
    expect(verdict.duplicatingArms).toContain("irreversible-same-key-same-approval")
  })

  test("one FEWER provider start breaks it too — a silent fix must not pass unnoticed", () => {
    // If the gateway is changed so the retry is refused, this probe FAILS. That is deliberate: a
    // change to a safety-critical duplicate-effect property is an architectural decision and must be
    // re-characterised in the open, not absorbed by a test that was only ever checking `<= 2`.
    const verdict = analyzeCancellation(
      withArm("reversible-same-key", (arm) => ({ ...arm, effects: [arm.effects[0]!] })),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.characterisationBreaks.join(" ")).toContain("reversible-same-key")
  })

  test("a key that is NOT released on timeout breaks the characterisation", () => {
    // The exact signature of commenting out `this.audit.release(...)` in capability-gateway.ts.
    const verdict = analyzeCancellation(
      withArm("reversible-same-key", (arm) => ({ ...arm, keyReservedAfterFirstAttempt: true })),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.characterisationBreaks.join(" ")).toContain("reservation")
  })

  test("a fabricated COMPLETED outcome is refused even when the effect counts all match", () => {
    // No provider ever settled, so no `CapabilityExecuted` may exist. An audit row here would mean
    // the gateway invented an outcome for a call that produced none — worse than the duplicate.
    const verdict = analyzeCancellation(
      withArm("reversible-same-key", (arm) => ({ ...arm, completedAuditRows: 1 })),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.fabricatedOutcomes).toContain("reversible-same-key")
  })

  test("a changed refusal code breaks the characterisation, because WHY a retry was stopped matters", () => {
    const verdict = analyzeCancellation(
      withArm("irreversible-same-key-same-approval", (arm) => ({
        ...arm,
        attempts: arm.attempts.map((attempt, index) =>
          index === 1 ? { ...attempt, refusalCode: "IDEMPOTENCY_CONFLICT" } : attempt,
        ),
      })),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.characterisationBreaks.join(" ")).toContain("APPROVAL_ALREADY_USED")
  })

  test("the verdict carries no timing, so no assertion here can ever be a function of one", () => {
    const verdict = analyzeCancellation(observationAsCharacterised())
    // Split camelCase into WORDS rather than substring-matching. A substring check fails on
    // `duplicatingArms` ("arms" contains "ms") and would have to be loosened until it caught
    // nothing — the failure mode this repository keeps finding in checks that never say no.
    const words = Object.keys(verdict).flatMap((key) =>
      key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(" "),
    )
    for (const forbidden of ["ms", "millis", "duration", "elapsed", "wall", "latency", "hold", "at"]) {
      expect(words).not.toContain(forbidden)
    }
    // Every value the verdict exposes is a boolean, a count, an identifier or prose — never a clock
    // reading. The counts below are event tallies from the ledger file, not durations.
    for (const count of verdict.effectCounts) {
      expect(Number.isInteger(count.started)).toBe(true)
      expect(Number.isInteger(count.settled)).toBe(true)
    }
  })
})
