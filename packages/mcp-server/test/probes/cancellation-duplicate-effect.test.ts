/**
 * F002 task 18 — the discharging half of the cancellation fault injection probe.
 *
 * This file runs the probe against a REAL `CapabilityGateway` over a real on-disk SQLite + JSONL
 * environment, and turns its deterministic observations into blocking assertions. It imports the
 * Discharge Annotation surface, so it IS a member of the EAP Test Corpus and its links appear in the
 * Bidirectional Traceability Map.
 *
 * ── What is being discharged, and the citation ────────────────────────────────────────────────
 * `docs/specs/cognitive_line/TL.json` open point 2, verbatim:
 *
 *   "In `CapabilityGateway.execute`, if an external capability provider action ignores the passed
 *    `AbortSignal` and hangs beyond `timeoutMs`, how will releasing the idempotency key upon timeout
 *    prevent duplicate execution or race conditions for irreversible side-effects when retried by a
 *    client?"
 *
 * The answer this probe establishes is that IT DOES NOT. Releasing the key does not prevent the
 * duplicate; it is the mechanism that ENABLES it. The test case names the open point in its own title
 * so the string "TL.json open point 2" appears in the derived Traceability Map, which is the only
 * artefact a later reader will consult.
 *
 * ── Why the links are `covers-partially` and deliberately NOT `asserts` ───────────────────────
 * EAP-CAPB-002 reads "Should avoid duplicate effects when the Capability Provider receives the same
 * idempotency key". This probe observes that after a timeout the system does NOT avoid them. An
 * `asserts` link would record in a derived, committed artefact that a Scenario the system fails has
 * been proven — the precise class of silent pass this whole feature exists to prevent. So the link is
 * partial: this case exercises the Scenario's territory and reports the effect count per key, and it
 * discharges no guarantee. EAP-CAPB-003's "no successful outcome is fabricated" clause IS observed in
 * full here, but its "the failure is auditable" clause is not, so that link is partial too.
 *
 * ── ADR-0021 — verification by the durable record, never self-report ──────────────────────────
 * The fault provider counts its effects into an append-only JSONL ledger FILE and performs none. The
 * verdict is computed from that file, read back off disk after every call has returned, together with
 * the reservation row read straight out of SQLite. No in-memory counter reaches the analyser.
 */

import { afterAll, describe, expect } from "bun:test"

import { annotatedTest } from "../verification/annotate"

import {
  CHARACTERISED,
  DOUBLE_IGNORE_DEFINITION,
  IN_SUITE_TIMEOUT_MS,
  analyzeCancellation,
  gatewaySourceDigest,
  runCancellationProbe,
  type CancellationObservation,
  type CancellationVerdict,
} from "./cancellation-probe"

// The probe is run ONCE and the two cases below read the same observation. Running it twice would
// double an already-deliberate cost for no additional evidence, and the arms are independent by
// construction (a fresh environment, tenant, key and approval set per arm).
let run: { observation: CancellationObservation; verdict: CancellationVerdict; cleanup: () => void }

const probe = async (): Promise<typeof run> => {
  run ??= await runCancellationProbe({ timeoutMs: IN_SUITE_TIMEOUT_MS })
  return run
}

afterAll(() => {
  run?.cleanup()
})

describe("TL.json open point 2 — cancellation fault injection", () => {
  annotatedTest(
    "TL.json open point 2 — a provider that double-ignores cancellation lets ONE idempotency key produce TWO provider effects",
    // EAP-CAPB-002's territory: the effect count for one idempotency key across a timeout and a
    // retry. Partial, never `asserts` — see the file header; the observation refutes the Scenario's
    // guarantee rather than discharging it. EAP-CAPB-003 partial for its "no successful outcome is
    // fabricated" clause, which is observed here in full across both attempts.
    { coversPartially: ["EAP-CAPB-002", "EAP-CAPB-003"], defects: ["TL-F001-OPEN-2"] },
    async () => {
      const { observation, verdict } = await probe()

      // The fault really was injected: the provider saw a signal, was aborted, and carried on.
      expect(DOUBLE_IGNORE_DEFINITION).toContain("AbortSignal")
      const reversible = observation.arms.find((arm) => arm.arm === "reversible-same-key")!
      expect(reversible.effects.length).toBeGreaterThan(0)
      expect(reversible.effects.every((record) => record.event === "started")).toBe(true)

      // The count, per idempotency key, read from the effect-ledger FILE. This is the finding.
      const counts = new Map(verdict.effectCounts.map((count) => [count.arm, count]))
      expect(counts.get("reversible-same-key")!.key).toBe(reversible.idempotencyKey)
      expect(counts.get("reversible-same-key")!.started).toBe(2)
      expect(counts.get("reversible-same-key")!.settled).toBe(0)
      expect(counts.get("reversible-same-key")!.inFlight).toBe(2)
      expect(counts.get("reversible-same-key")!.duplicate).toBe(true)

      // An operator re-approval after PROVIDER_UNAVAILABLE — the ordinary, sanctioned response to a
      // failed irreversible call — re-arms the SAME idempotency key for a second external effect
      // while the first is still running. This is the irreversible case TL open point 2 asks about.
      expect(counts.get("irreversible-same-key-new-approval")!.started).toBe(2)
      expect(counts.get("irreversible-same-key-new-approval")!.duplicate).toBe(true)

      // The idempotency key IS released on timeout — capability-gateway.ts:212, in the catch arm of
      // the provider race. Observed from the durable reservation row, not read off the source.
      expect(verdict.keyReleasedOnTimeout).toContain("reversible-same-key")
      expect(reversible.keyReservedAfterFirstAttempt).toBe(false)

      // EAP-CAPB-003, in full for this clause: nothing was completed, so nothing was recorded.
      for (const arm of observation.arms) expect(arm.completedAuditRows).toBe(0)
      expect(verdict.fabricatedOutcomes).toEqual([])

      // The probe is pinned to the characterised behaviour in BOTH directions. A change that removes
      // the duplicate fails here just as loudly as one that adds a third effect, because either is a
      // change to a safety-critical property and neither may land unnoticed.
      expect(verdict.characterisationBreaks).toEqual([])
      expect(verdict.ok).toBe(true)

      // The bytes of the gateway this run actually observed. Recorded so that a mutation which does
      // not move this digest can be shown NOT to have reached the code under probe.
      expect(observation.gatewayDigest).toBe(gatewaySourceDigest())
    },
  )

  annotatedTest(
    "single-use operator approval, not the idempotency key, is the only barrier left after a timeout",
    // EAP-CAPB-002 partial: the one arm in which the duplicate IS avoided. It is avoided by a
    // control with a different purpose and a different lifetime, which is why this is partial
    // evidence for the Scenario and not a discharge of it.
    { coversPartially: ["EAP-CAPB-002"], defects: ["TL-F001-OPEN-2"] },
    async () => {
      const { observation, verdict } = await probe()
      const same = observation.arms.find(
        (arm) => arm.arm === "irreversible-same-key-same-approval",
      )!

      // Exactly one provider effect for this key — the retry never reached the provider.
      const count = verdict.effectCounts.find((entry) => entry.arm === same.arm)!
      expect(count.started).toBe(1)
      expect(count.duplicate).toBe(false)

      // And the reason it did not is APPROVAL_ALREADY_USED, never IDEMPOTENCY_CONFLICT. The key was
      // free; the grant was spent. Naming the refusal code is the whole point of this case: it shows
      // which control actually held, so nobody credits the idempotency key with a save it did not make.
      expect(same.attempts[0]!.status).toBe("FAILED")
      expect(same.attempts[0]!.refusalCode).toBe("PROVIDER_UNAVAILABLE")
      expect(same.attempts[1]!.status).toBe("REFUSED")
      expect(same.attempts[1]!.refusalCode).toBe("APPROVAL_ALREADY_USED")
      expect(same.attempts[1]!.refusalCode).not.toBe("IDEMPOTENCY_CONFLICT")

      expect(CHARACTERISED[same.arm].safety).toBe("SAFE")
      expect(CHARACTERISED["irreversible-same-key-new-approval"].safety).toBe("UNSAFE")
      expect(analyzeCancellation(observation).ok).toBe(true)
    },
  )
})
