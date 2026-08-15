/** F002 task 22 — Flake Ledger and quarantine policy. */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { fingerprintId, type RunnerComponents } from "./benchmark-ledger"
import {
  checkFlakeLedgerIntegrity,
  closeFlake,
  detectFlake,
  loadFlakeLedger,
  openFlakes,
  policyRecord,
  quarantineFlake,
  reconcileAppendOnly,
  repoRoot,
  serializeFlakeLedger,
  type TestObservation,
} from "./flake-ledger"

const ROOT = repoRoot()
const runner: RunnerComponents = {
  os: "linux",
  arch: "x64",
  cpuModel: "fixture-cpu",
  cpuCount: 4,
  memGiB: 8,
  runtime: "bun",
  runtimeVersion: "1.3.14",
  environment: "ci",
  ciImage: "ubuntu24",
}

function observation(
  runId: string,
  verdict: "passed" | "failed",
  over: Partial<TestObservation> = {},
): TestObservation {
  return {
    commit: "abc123",
    runId,
    testFile: "packages/client/test/target-repo.test.ts",
    testName: "reconnects after server restart",
    verdict,
    runner,
    runnerFingerprint: fingerprintId(runner),
    concurrencyProbe: { executed: false, contentionObserved: false },
    ...over,
  }
}

describe("FlakeObserved — same-commit verdict variance", () => {
  test("creates no flake for repeated equal verdicts or for variance across different commits", () => {
    expect(detectFlake([observation("R1", "passed"), observation("R2", "passed")])).toBeNull()
    expect(
      detectFlake([
        observation("R1", "failed"),
        observation("R2", "passed", { commit: "def456" }),
      ]),
    ).toBeNull()
  })

  test("carries test case, verdicts, run ids, and a verified fingerprint on every observation", () => {
    const candidate = detectFlake([
      observation("R1", "failed", {
        concurrencyProbe: { executed: true, contentionObserved: true },
      }),
      observation("R2", "passed"),
    ])!

    expect(candidate).toMatchObject({
      testFile: "packages/client/test/target-repo.test.ts",
      testName: "reconnects after server restart",
      commit: "abc123",
      verdicts: ["failed", "passed"],
      runIds: ["R1", "R2"],
    })
    expect(candidate.observations.map((item) => item.contentionSource)).toEqual([
      "probe-generated-contention",
      "runner-slowness",
    ])
    expect(candidate.observations.every((item) => item.runnerFingerprint === fingerprintId(item.runner))).toBe(true)
  })

  test("rejects an observation whose declared fingerprint does not match its runner", () => {
    expect(() => detectFlake([observation("R1", "failed", { runnerFingerprint: "fp-forged" })])).toThrow(
      /fingerprint/i,
    )
  })
})

describe("QuarantineFlake — owned append-only debt", () => {
  const candidate = () => detectFlake([observation("R1", "failed"), observation("R2", "passed")])!

  test("refuses quarantine without a named owner and does not touch the test file", () => {
    const records = [policyRecord()]
    expect(() => quarantineFlake(records, candidate(), "", () => true)).toThrow(/owner/i)
    expect(records).toEqual([policyRecord()])
  })

  test("refuses quarantine if the underlying test file is absent", () => {
    expect(() => quarantineFlake([policyRecord()], candidate(), "verification-team", () => false)).toThrow(
      /test file.*exist/i,
    )
  })

  test("appends an owned open record while preserving every prior byte", () => {
    const before = serializeFlakeLedger([policyRecord()])
    const afterRecords = quarantineFlake([policyRecord()], candidate(), "verification-team", () => true)
    const after = serializeFlakeLedger(afterRecords)

    expect(after.startsWith(before)).toBe(true)
    expect(reconcileAppendOnly(before, after)).toEqual({ ok: true })
    expect(openFlakes(afterRecords)).toHaveLength(1)
    expect(openFlakes(afterRecords)[0]).toMatchObject({ owner: "verification-team", status: "open" })
  })

  test("refuses closure without a named cause and keeps the entry open", () => {
    const records = quarantineFlake([policyRecord()], candidate(), "verification-team", () => true)
    const id = openFlakes(records)[0]!.flakeId
    expect(() => closeFlake(records, id, "")).toThrow(/cause/i)
    expect(openFlakes(records).map((entry) => entry.flakeId)).toEqual([id])
  })

  test("closes by appending a cause record rather than rewriting the open entry", () => {
    const records = quarantineFlake([policyRecord()], candidate(), "verification-team", () => true)
    const id = openFlakes(records)[0]!.flakeId
    const before = serializeFlakeLedger(records)
    const closed = closeFlake(records, id, "Socket teardown race fixed by awaiting server close")

    expect(serializeFlakeLedger(closed).startsWith(before)).toBe(true)
    expect(openFlakes(closed)).toEqual([])
    expect(closed.at(-1)).toMatchObject({ kind: "closure", flakeId: id })
  })
})

describe("Committed policy and CI", () => {
  test("the production integrity path rejects deletion or rewriting of prior committed records", () => {
    const candidate = detectFlake([observation("R1", "failed"), observation("R2", "passed")])!
    const prior = serializeFlakeLedger(
      quarantineFlake([policyRecord()], candidate, "verification-team", () => true),
    )
    const deleted = serializeFlakeLedger([policyRecord()])

    expect(() => checkFlakeLedgerIntegrity(ROOT, deleted, prior, "fixture@abc123")).toThrow(
      /rewritten|removed|append-only/i,
    )
  })

  test("loads the committed append-only ledger", () => {
    const raw = readFileSync(join(ROOT, "docs/verification/flake-ledger.jsonl"), "utf8")
    expect(serializeFlakeLedger(loadFlakeLedger(raw))).toBe(raw)
  })

  test("runs ledger integrity as an explicit blocking CI step without skipping tests", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")
    expect(workflow).toContain("Flake Ledger Integrity Gate (blocking)")
    expect(workflow).toContain("bun scripts/verification/flake-ledger.ts --check")
    expect(workflow).not.toMatch(/flake[^\n]*(skip|delete|remove)/i)
  })
})
