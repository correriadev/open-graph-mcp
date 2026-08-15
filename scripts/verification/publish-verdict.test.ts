/** F002 task 23 — compose Quality Gates and publish one host-derived Suite Verdict. */

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  DEFAULT_GATES,
  MANDATORY_GATE_NAMES,
  composeQualityGates,
  executeGate,
  publishSuiteVerdict,
  repoRoot,
  type CapturedGateSignal,
  type GateDefinition,
  type GateRunner,
} from "./publish-verdict"

const ROOT = repoRoot()
const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

const runner = (exitCode: number, stdout = "gate output", stderr = ""): GateRunner => () => ({
  exitCode,
  stdout,
  stderr,
})

const definition = (name: string, blocking = true): GateDefinition => ({
  name,
  blocking,
  command: "bun",
  args: ["run", name],
})

function requiredSignals(runId = "R-1", commit = "abc123"): CapturedGateSignal[] {
  return MANDATORY_GATE_NAMES.map((name) =>
    executeGate(definition(name), { runId, commit }, runner(0, `${name}: PASS`)),
  )
}

describe("EvaluateQualityGate — composition", () => {
  test("cannot downgrade a mandatory gate to advisory through a caller definition", () => {
    const signals = requiredSignals()
    signals[4] = executeGate(
      definition("coverage", false),
      { runId: "R-1", commit: "abc123" },
      runner(1, "", "coverage regression"),
    )

    const verdict = composeQualityGates("R-1", "abc123", signals)
    expect(verdict.gates[4]).toMatchObject({ name: "coverage", blocking: true, outcome: "fail" })
    expect(verdict.outcome).toBe("fail")
  })

  test("names every required gate, outcome, evidence reference, and declared blocking policy", () => {
    const verdict = composeQualityGates("R-1", "abc123", requiredSignals())

    expect(verdict.gates.map((gate) => gate.name)).toEqual([...MANDATORY_GATE_NAMES])
    expect(verdict.gates.every((gate) => gate.outcome === "pass" && gate.blocking)).toBe(true)
    expect(verdict.gates.every((gate) => gate.evidence.reference.endsWith(`${gate.name}.log`))).toBe(true)
    expect(verdict.outcome).toBe("pass")
  })

  test("reports advisory without counting it as pass or in the pass-rate denominator", () => {
    const advisory = executeGate(
      definition("performance-probes", false),
      { runId: "R-1", commit: "abc123" },
      runner(1, "slow observation"),
    )
    const verdict = composeQualityGates("R-1", "abc123", [...requiredSignals(), advisory])

    expect(verdict.gates.at(-1)).toMatchObject({
      name: "performance-probes",
      blocking: false,
      outcome: "advisory",
    })
    expect(verdict.summary).toEqual({ passed: 6, failed: 0, advisory: 1, passRate: 1 })
    expect(verdict.outcome).toBe("pass")
  })

  test("fails the Suite Verdict when a declared blocking gate fails", () => {
    const signals = requiredSignals()
    signals[1] = executeGate(
      definition(MANDATORY_GATE_NAMES[1]!),
      { runId: "R-1", commit: "abc123" },
      runner(1, "", "traceability gap"),
    )
    const verdict = composeQualityGates("R-1", "abc123", signals)

    expect(verdict.gates[1]).toMatchObject({ outcome: "fail", blocking: true })
    expect(verdict.outcome).toBe("fail")
  })

  test("rejects a hand-authored signal even when it has the right shape", () => {
    const fake = {
      ...requiredSignals()[0],
      name: "typecheck",
      outcome: "pass",
    } as CapturedGateSignal
    expect(() => composeQualityGates("R-1", "abc123", [fake, ...requiredSignals().slice(1)])).toThrow(
      /runner output|self-report|authored/i,
    )
  })

  test("requires every mandatory gate exactly once", () => {
    expect(() => composeQualityGates("R-1", "abc123", requiredSignals().slice(1))).toThrow(/typecheck/i)
    expect(() => composeQualityGates("R-1", "abc123", [...requiredSignals(), requiredSignals()[0]!])).toThrow(
      /duplicate/i,
    )
  })
})

describe("PublishSuiteVerdict — append-only sink", () => {
  test("publishes red evidence when a gate runner throws before returning an exit code", () => {
    const root = mkdtempSync(join(tmpdir(), "suite-verdict-"))
    temporary.push(root)
    const signals = requiredSignals("R-crash", "abc123")
    signals[0] = executeGate(
      definition("typecheck"),
      { runId: "R-crash", commit: "abc123" },
      () => {
        throw new Error("spawn failed: EPERM")
      },
    )

    const published = publishSuiteVerdict(root, "R-crash", "abc123", signals)
    expect(published.verdict.outcome).toBe("fail")
    expect(published.verdict.gates[0]).toMatchObject({ name: "typecheck", outcome: "fail" })
    expect(
      readFileSync(join(root, ".verification", "run", "R-crash", "typecheck.log"), "utf8"),
    ).toContain("spawn failed: EPERM")
  })

  test("publishes exactly one immutable runner-derived verdict and never overwrites it", () => {
    const root = mkdtempSync(join(tmpdir(), "suite-verdict-"))
    temporary.push(root)
    const first = publishSuiteVerdict(root, "R-1", "abc123", requiredSignals())
    const before = readFileSync(first.path, "utf8")

    expect(first.path.replaceAll("\\", "/")).toEndWith("/.verification/run/R-1.json")
    expect(first.verdict.source).toBe("runner-output")
    expect(Object.isFrozen(first.verdict)).toBe(true)
    expect(() => publishSuiteVerdict(root, "R-1", "abc123", requiredSignals())).toThrow(
      /already exists|append-only/i,
    )
    expect(readFileSync(first.path, "utf8")).toBe(before)
  })

  test("stores raw runner output beside the verdict and references its digest", () => {
    const root = mkdtempSync(join(tmpdir(), "suite-verdict-"))
    temporary.push(root)
    const published = publishSuiteVerdict(root, "R-2", "def456", requiredSignals("R-2", "def456"))
    const verdict = JSON.parse(readFileSync(published.path, "utf8")) as typeof published.verdict

    for (const gate of verdict.gates) {
      const evidencePath = join(root, ...gate.evidence.reference.split("/"))
      expect(readFileSync(evidencePath, "utf8")).toContain(`${gate.name}: PASS`)
      expect(gate.evidence.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe("Default runner topology and CI retention", () => {
  test("executes the suite plus all six specified gates from declared commands", () => {
    expect(DEFAULT_GATES.map((gate) => gate.name)).toEqual(["suite", ...MANDATORY_GATE_NAMES])
    expect(DEFAULT_GATES.every((gate) => gate.blocking === true)).toBe(true)
  })

  test("publishes and uploads per-run evidence for 30 days even after a red gate", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")
    expect(workflow).toContain("suite-verdict:")
    expect(workflow).toContain("bun scripts/verification/publish-verdict.ts")
    expect(workflow).toContain("if: ${{ always() }}")
    expect(workflow).toContain("retention-days: 30")
    expect(workflow).toContain("suite-verdict-${{ github.run_id }}-${{ github.run_attempt }}")
  })
})
