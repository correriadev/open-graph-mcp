#!/usr/bin/env bun
/**
 * F002 task 23 — execute declared gates, compose their host output, and publish one immutable
 * Suite Verdict at `.verification/run/<runId>.json`.
 *
 * There is deliberately no `--from-json` or verdict-input flag. A verdict-shaped object is not
 * evidence: only `executeGate` can mint a signal admitted by `composeQualityGates`.
 */

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const MANDATORY_GATE_NAMES = [
  "typecheck",
  "traceability",
  "quarantine",
  "conformance",
  "coverage",
  "flake",
] as const

export type MandatoryGateName = (typeof MANDATORY_GATE_NAMES)[number]
export type GateOutcome = "pass" | "fail" | "advisory"

export interface GateDefinition {
  name: string
  blocking: boolean
  command: string
  args: string[]
}

export const DEFAULT_GATES: readonly GateDefinition[] = [
  {
    name: "suite",
    blocking: true,
    command: "bun",
    args: ["test", "--reporter=junit", "--reporter-outfile=.verification/junit.xml"],
  },
  { name: "typecheck", blocking: true, command: "bun", args: ["run", "typecheck"] },
  {
    name: "traceability",
    blocking: true,
    command: "bun",
    args: ["scripts/verification/reconcile-traceability.ts", "--check"],
  },
  {
    name: "quarantine",
    blocking: true,
    command: "bun",
    args: ["scripts/verification/quarantine-gate.ts"],
  },
  {
    name: "conformance",
    blocking: true,
    command: "bun",
    args: ["scripts/verification/conformance-report.ts", "--check"],
  },
  {
    name: "coverage",
    blocking: true,
    command: "bun",
    args: ["scripts/verification/coverage-gate.ts"],
  },
  {
    name: "flake",
    blocking: true,
    command: "bun",
    args: ["scripts/verification/flake-ledger.ts", "--check"],
  },
]

export interface GateRunnerResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type GateRunner = (definition: GateDefinition) => GateRunnerResult

export interface CapturedGateSignal {
  readonly name: string
  readonly blocking: boolean
  readonly outcome: GateOutcome
  readonly runId: string
  readonly commit: string
  readonly command: readonly string[]
  readonly exitCode: number
  readonly evidence: {
    readonly reference: string
    readonly sha256: string
  }
  readonly rawOutput: string
}

export interface PublishedGateVerdict {
  name: string
  blocking: boolean
  outcome: GateOutcome
  evidence: {
    reference: string
    sha256: string
    command: string[]
    exitCode: number
  }
}

export interface SuiteVerdict {
  schemaVersion: 1
  runId: string
  commit: string
  source: "runner-output"
  gates: PublishedGateVerdict[]
  summary: { passed: number; failed: number; advisory: number; passRate: number }
  outcome: "pass" | "fail"
}

const admittedSignals = new WeakSet<object>()

function isMandatoryGate(name: string): name is MandatoryGateName {
  return (MANDATORY_GATE_NAMES as readonly string[]).includes(name)
}

export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..")
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex")

function named(value: string, field: string): void {
  if (value.trim().length === 0) throw new Error(`${field} must be named`)
}

function safeSegment(value: string, field: string): void {
  named(value, field)
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`${field} contains an unsafe path character`)
}

function renderRunnerOutput(definition: GateDefinition, result: GateRunnerResult): string {
  return [
    `$ ${[definition.command, ...definition.args].join(" ")}`,
    `exitCode=${result.exitCode}`,
    "--- stdout ---",
    result.stdout,
    "--- stderr ---",
    result.stderr,
    "",
  ].join("\n")
}

/** The only authority boundary that can create an admissible gate signal. */
export function executeGate(
  definition: GateDefinition,
  run: { runId: string; commit: string },
  runner: GateRunner,
): CapturedGateSignal {
  safeSegment(definition.name, "gate name")
  safeSegment(run.runId, "runId")
  named(run.commit, "commit")
  const blocking = isMandatoryGate(definition.name) ? true : definition.blocking
  let result: GateRunnerResult
  try {
    const candidate = runner(definition)
    if (
      !candidate ||
      !Number.isInteger(candidate.exitCode) ||
      candidate.exitCode < 0 ||
      typeof candidate.stdout !== "string" ||
      typeof candidate.stderr !== "string"
    ) {
      throw new Error("runner returned a malformed result")
    }
    result = candidate
  } catch (error) {
    result = {
      exitCode: 255,
      stdout: "",
      stderr: `runner failure: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const rawOutput = renderRunnerOutput(definition, result)
  const signal: CapturedGateSignal = Object.freeze({
    name: definition.name,
    blocking,
    outcome: blocking ? (result.exitCode === 0 ? "pass" : "fail") : "advisory",
    runId: run.runId,
    commit: run.commit,
    command: Object.freeze([definition.command, ...definition.args]),
    exitCode: result.exitCode,
    evidence: Object.freeze({
      reference: `.verification/run/${run.runId}/${definition.name}.log`,
      sha256: sha256(rawOutput),
    }),
    rawOutput,
  })
  admittedSignals.add(signal)
  return signal
}

function freezeVerdict(verdict: SuiteVerdict): SuiteVerdict {
  for (const gate of verdict.gates) {
    Object.freeze(gate.evidence.command)
    Object.freeze(gate.evidence)
    Object.freeze(gate)
  }
  Object.freeze(verdict.gates)
  Object.freeze(verdict.summary)
  return Object.freeze(verdict)
}

export function composeQualityGates(
  runId: string,
  commit: string,
  signals: readonly CapturedGateSignal[],
): SuiteVerdict {
  safeSegment(runId, "runId")
  named(commit, "commit")
  const seen = new Set<string>()
  for (const signal of signals) {
    if (!admittedSignals.has(signal)) {
      throw new Error(
        `gate ${signal.name ?? "unknown"} is hand-authored or self-reported; only parsed runner output is admissible`,
      )
    }
    if (signal.runId !== runId || signal.commit !== commit) {
      throw new Error(`gate ${signal.name} belongs to a different run or commit`)
    }
    if (seen.has(signal.name)) throw new Error(`duplicate gate signal: ${signal.name}`)
    seen.add(signal.name)
  }
  for (const required of MANDATORY_GATE_NAMES) {
    if (!seen.has(required)) throw new Error(`mandatory gate ${required} has no runner signal`)
    const signal = signals.find((candidate) => candidate.name === required)!
    if (!signal.blocking || signal.outcome === "advisory") {
      throw new Error(`mandatory gate ${required} cannot be downgraded from blocking policy`)
    }
  }

  const gates: PublishedGateVerdict[] = signals.map((signal) => ({
    name: signal.name,
    blocking: signal.blocking,
    outcome: signal.outcome,
    evidence: {
      reference: signal.evidence.reference,
      sha256: signal.evidence.sha256,
      command: [...signal.command],
      exitCode: signal.exitCode,
    },
  }))
  const passed = gates.filter((gate) => gate.outcome === "pass").length
  const failed = gates.filter((gate) => gate.outcome === "fail").length
  const advisory = gates.filter((gate) => gate.outcome === "advisory").length
  const blockingDenominator = passed + failed
  return freezeVerdict({
    schemaVersion: 1,
    runId,
    commit,
    source: "runner-output",
    gates,
    summary: {
      passed,
      failed,
      advisory,
      passRate: blockingDenominator === 0 ? 0 : passed / blockingDenominator,
    },
    outcome: failed > 0 ? "fail" : "pass",
  })
}

export function publishSuiteVerdict(
  root: string,
  runId: string,
  commit: string,
  signals: readonly CapturedGateSignal[],
): { path: string; verdict: SuiteVerdict } {
  const verdict = composeQualityGates(runId, commit, signals)
  const outputRoot = join(root, ".verification", "run")
  const verdictPath = join(outputRoot, `${runId}.json`)
  if (existsSync(verdictPath)) {
    throw new Error(`Suite Verdict ${runId} already exists; published evidence is append-only`)
  }

  mkdirSync(outputRoot, { recursive: true })
  const evidenceDir = join(outputRoot, runId)
  mkdirSync(evidenceDir, { recursive: false })
  for (const signal of signals) {
    writeFileSync(join(evidenceDir, `${signal.name}.log`), signal.rawOutput, { encoding: "utf8", flag: "wx" })
  }
  writeFileSync(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
  return { path: verdictPath, verdict }
}

function systemRunner(root: string): GateRunner {
  return (definition) => {
    const result = Bun.spawnSync({
      cmd: [definition.command, ...definition.args],
      cwd: root,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    })
    return {
      exitCode: result.exitCode,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    }
  }
}

function resolveCommit(root: string): string {
  if ((process.env.GITHUB_SHA ?? "").trim().length > 0) return process.env.GITHUB_SHA!
  const result = Bun.spawnSync({ cmd: ["git", "rev-parse", "HEAD"], cwd: root, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error("cannot resolve commit from GITHUB_SHA or git rev-parse HEAD")
  return new TextDecoder().decode(result.stdout).trim()
}

function resolveRunId(): string {
  const ci = process.env.GITHUB_RUN_ID
  if (ci) return `${ci}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`
  return `local-${Date.now()}-${process.pid}`
}

function main(): void {
  const root = repoRoot()
  const runId = resolveRunId()
  const commit = resolveCommit(root)
  const runner = systemRunner(root)
  const signals = DEFAULT_GATES.map((gate) => executeGate(gate, { runId, commit }, runner))
  const publication = publishSuiteVerdict(root, runId, commit, signals)
  console.log(
    `SuiteVerdictPublished ${JSON.stringify({
      runId,
      commit,
      gates: publication.verdict.gates.map((gate) => ({ name: gate.name, outcome: gate.outcome })),
      outcome: publication.verdict.outcome,
      path: publication.path.replaceAll("\\", "/"),
    })}`,
  )
  process.exitCode = publication.verdict.outcome === "pass" ? 0 : 1
}

if (import.meta.main) main()
