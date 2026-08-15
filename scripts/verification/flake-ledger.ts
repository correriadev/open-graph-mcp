#!/usr/bin/env bun
/**
 * F002 task 22 — append-only Flake Ledger.
 *
 * A flake is verdict variance for the same test case at the same commit. Quarantine records debt;
 * it never skips or deletes a test. A closure is another record and requires a named cause.
 *
 *   bun scripts/verification/flake-ledger.ts --check
 *   bun scripts/verification/flake-ledger.ts --observe <observations.json> --owner <name>
 *   bun scripts/verification/flake-ledger.ts --close <flake-id> --cause <named-cause>
 */

import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  canonicalJson,
  fingerprintId,
  sha256,
  type RunnerComponents,
} from "./benchmark-ledger"

export const FLAKE_LEDGER_PATH = "docs/verification/flake-ledger.jsonl"
export const FLAKE_SCHEMA_VERSION = 1
export const FLAKE_POLICY =
  "Append-only credibility debt. A flake is differing runner verdicts for one test case at the same commit. " +
  "Every observation carries a verified RunnerFingerprint and names probe-generated-contention or runner-slowness. " +
  "Quarantine requires a named owner and never skips, deletes, or removes the test. Closure is appended, never rewritten, " +
  "and requires a named cause."

export type TestVerdict = "passed" | "failed"
export type ContentionSource = "probe-generated-contention" | "runner-slowness"

export interface TestObservation {
  commit: string
  runId: string
  testFile: string
  testName: string
  verdict: TestVerdict
  runnerFingerprint: string
  runner: RunnerComponents
  concurrencyProbe: { executed: boolean; contentionObserved: boolean }
}

export interface ClassifiedObservation extends TestObservation {
  contentionSource: ContentionSource
}

export interface FlakeCandidate {
  testFile: string
  testName: string
  commit: string
  verdicts: TestVerdict[]
  runIds: string[]
  observations: ClassifiedObservation[]
}

export interface FlakePolicyRecord {
  kind: "policy"
  schemaVersion: number
  seq: 0
  policy: string
  at: string
}

export interface OpenFlakeRecord extends FlakeCandidate {
  kind: "flake"
  schemaVersion: number
  seq: number
  flakeId: string
  owner: string
  status: "open"
  at: string
}

export interface FlakeClosureRecord {
  kind: "closure"
  schemaVersion: number
  seq: number
  flakeId: string
  cause: string
  at: string
}

export type FlakeLedgerRecord = FlakePolicyRecord | OpenFlakeRecord | FlakeClosureRecord

export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..")
}

export function policyRecord(at = "1970-01-01T00:00:00.000Z"): FlakePolicyRecord {
  return { kind: "policy", schemaVersion: FLAKE_SCHEMA_VERSION, seq: 0, policy: FLAKE_POLICY, at }
}

function nonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be named`)
}

function validateObservation(observation: TestObservation, index: number): void {
  const where = `observation[${index}]`
  nonEmpty(observation.commit, `${where}.commit`)
  nonEmpty(observation.runId, `${where}.runId`)
  nonEmpty(observation.testFile, `${where}.testFile`)
  nonEmpty(observation.testName, `${where}.testName`)
  if (observation.verdict !== "passed" && observation.verdict !== "failed") {
    throw new Error(`${where}.verdict must be passed or failed`)
  }
  const actual = fingerprintId(observation.runner)
  if (observation.runnerFingerprint !== actual) {
    throw new Error(
      `${where}.runnerFingerprint ${observation.runnerFingerprint} does not match runner fingerprint ${actual}`,
    )
  }
  if (
    typeof observation.concurrencyProbe?.executed !== "boolean" ||
    typeof observation.concurrencyProbe?.contentionObserved !== "boolean"
  ) {
    throw new Error(`${where}.concurrencyProbe must name executed and contentionObserved`)
  }
  if (observation.concurrencyProbe.contentionObserved && !observation.concurrencyProbe.executed) {
    throw new Error(`${where} cannot observe probe contention when the concurrency probe did not execute`)
  }
}

/** Returns one candidate only when all observations identify one test at one unchanged commit. */
export function detectFlake(observations: readonly TestObservation[]): FlakeCandidate | null {
  observations.forEach(validateObservation)
  if (observations.length < 2) return null

  const first = observations[0]!
  if (
    observations.some(
      (item) =>
        item.commit !== first.commit || item.testFile !== first.testFile || item.testName !== first.testName,
    )
  ) {
    return null
  }
  const ordered = [...observations].sort((a, b) => a.runId.localeCompare(b.runId))
  if (new Set(ordered.map((item) => item.runId)).size < 2) return null
  if (new Set(ordered.map((item) => item.verdict)).size < 2) return null

  const classified = ordered.map((item): ClassifiedObservation => ({
    ...item,
    contentionSource: item.concurrencyProbe.contentionObserved
      ? "probe-generated-contention"
      : "runner-slowness",
  }))
  return {
    testFile: first.testFile,
    testName: first.testName,
    commit: first.commit,
    verdicts: classified.map((item) => item.verdict),
    runIds: classified.map((item) => item.runId),
    observations: classified,
  }
}

export function detectFlakes(observations: readonly TestObservation[]): FlakeCandidate[] {
  const groups = new Map<string, TestObservation[]>()
  for (const [index, observation] of observations.entries()) {
    validateObservation(observation, index)
    const key = canonicalJson([observation.commit, observation.testFile, observation.testName])
    const group = groups.get(key) ?? []
    group.push(observation)
    groups.set(key, group)
  }
  return [...groups.values()]
    .map(detectFlake)
    .filter((candidate): candidate is FlakeCandidate => candidate !== null)
    .sort((a, b) => `${a.testFile}\0${a.testName}`.localeCompare(`${b.testFile}\0${b.testName}`))
}

function flakeId(candidate: FlakeCandidate): string {
  return `flake-${sha256(canonicalJson([candidate.commit, candidate.testFile, candidate.testName])).slice(0, 16)}`
}

export function openFlakes(records: readonly FlakeLedgerRecord[]): OpenFlakeRecord[] {
  const closed = new Set(
    records.filter((record): record is FlakeClosureRecord => record.kind === "closure").map((record) => record.flakeId),
  )
  return records.filter(
    (record): record is OpenFlakeRecord => record.kind === "flake" && !closed.has(record.flakeId),
  )
}

export function quarantineFlake(
  records: readonly FlakeLedgerRecord[],
  candidate: FlakeCandidate,
  owner: string,
  fileExists: (path: string) => boolean = (path) => existsSync(join(repoRoot(), path)),
  at = new Date().toISOString(),
): FlakeLedgerRecord[] {
  nonEmpty(owner, "owner")
  if (!fileExists(candidate.testFile)) {
    throw new Error(`underlying test file does not exist: ${candidate.testFile}; quarantine may not remove it`)
  }
  const id = flakeId(candidate)
  if (openFlakes(records).some((record) => record.flakeId === id)) {
    throw new Error(`${id} is already open; append observations to evidence, do not duplicate the debt entry`)
  }
  const record: OpenFlakeRecord = {
    kind: "flake",
    schemaVersion: FLAKE_SCHEMA_VERSION,
    seq: records.length,
    flakeId: id,
    owner: owner.trim(),
    status: "open",
    ...candidate,
    at,
  }
  return [...records, record]
}

export function closeFlake(
  records: readonly FlakeLedgerRecord[],
  id: string,
  cause: string,
  at = new Date().toISOString(),
): FlakeLedgerRecord[] {
  nonEmpty(cause, "cause")
  if (!openFlakes(records).some((record) => record.flakeId === id)) {
    throw new Error(`cannot close ${id}: it is absent or already closed`)
  }
  return [
    ...records,
    {
      kind: "closure",
      schemaVersion: FLAKE_SCHEMA_VERSION,
      seq: records.length,
      flakeId: id,
      cause: cause.trim(),
      at,
    },
  ]
}

function validateRecord(record: FlakeLedgerRecord, index: number): void {
  if (record.schemaVersion !== FLAKE_SCHEMA_VERSION) throw new Error(`line ${index + 1}: unsupported schemaVersion`)
  if (record.seq !== index) throw new Error(`line ${index + 1}: expected seq ${index}, got ${record.seq}`)
  nonEmpty(record.at, `line ${index + 1}.at`)
  if (record.kind === "policy") {
    if (index !== 0 || record.policy !== FLAKE_POLICY) throw new Error("flake ledger policy record is invalid")
    return
  }
  if (record.kind === "flake") {
    nonEmpty(record.owner, `line ${index + 1}.owner`)
    nonEmpty(record.flakeId, `line ${index + 1}.flakeId`)
    const candidate = detectFlake(record.observations)
    const recordedCandidate: FlakeCandidate = {
      testFile: record.testFile,
      testName: record.testName,
      commit: record.commit,
      verdicts: record.verdicts,
      runIds: record.runIds,
      observations: record.observations,
    }
    if (!candidate || canonicalJson(recordedCandidate) !== canonicalJson(candidate)) {
      throw new Error(`line ${index + 1}: flake record has no same-commit verdict variance`)
    }
    if (record.flakeId !== flakeId(candidate)) throw new Error(`line ${index + 1}: flakeId does not match its test case`)
    if (record.status !== "open") throw new Error(`line ${index + 1}: flake status must be open`)
    return
  }
  if (record.kind === "closure") {
    nonEmpty(record.flakeId, `line ${index + 1}.flakeId`)
    nonEmpty(record.cause, `line ${index + 1}.cause`)
    return
  }
  throw new Error(`line ${index + 1}: unknown record kind`)
}

export function loadFlakeLedger(raw: string): FlakeLedgerRecord[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length === 0) throw new Error("flake ledger must contain its policy record")
  const records = lines.map((line, index) => {
    try {
      return JSON.parse(line) as FlakeLedgerRecord
    } catch {
      throw new Error(`line ${index + 1}: invalid JSON`)
    }
  })
  records.forEach(validateRecord)
  const active = new Set<string>()
  const seen = new Set<string>()
  for (const record of records) {
    if (record.kind === "flake") {
      if (seen.has(record.flakeId)) throw new Error(`flake ${record.flakeId} is opened more than once`)
      seen.add(record.flakeId)
      active.add(record.flakeId)
    }
    if (record.kind === "closure") {
      if (!active.has(record.flakeId)) throw new Error(`closure names absent or closed flake ${record.flakeId}`)
      active.delete(record.flakeId)
    }
  }
  return records
}

export function serializeFlakeLedger(records: readonly FlakeLedgerRecord[]): string {
  records.forEach(validateRecord)
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
}

export function reconcileAppendOnly(
  prior: string,
  current: string,
): { ok: true } | { ok: false; reason: string } {
  if (!current.startsWith(prior)) return { ok: false, reason: "prior ledger bytes were rewritten or removed" }
  return { ok: true }
}

export interface PriorFlakeLedger {
  raw: string | null
  ref: string | null
  reason: string
}

function git(root: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", [...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch {
    return null
  }
}

/** Reads the branch-point ledger so a committed deletion cannot redefine its own history. */
export function readPriorFlakeLedger(root: string): PriorFlakeLedger {
  const base = process.env.GITHUB_BASE_REF
  const candidates = [
    ...(base === undefined || base.length === 0 ? [] : [`origin/${base}`, base]),
    "origin/main",
    "main",
  ]
  const tried: string[] = []
  for (const candidate of candidates) {
    const mergeBase = git(root, ["merge-base", candidate, "HEAD"])?.trim()
    if (!mergeBase) {
      tried.push(`${candidate} (no merge-base; fetch-depth: 0 is required in CI)`)
      continue
    }
    const raw = git(root, ["show", `${mergeBase}:${FLAKE_LEDGER_PATH}`])
    if (raw !== null) {
      return {
        raw,
        ref: `${candidate}@${mergeBase.slice(0, 12)}`,
        reason: `merge-base with ${candidate}`,
      }
    }
    tried.push(`${candidate}@${mergeBase.slice(0, 12)} (ledger not present)`)
  }

  // Local work commonly has no remote base. HEAD still protects committed bytes against a
  // working-tree rewrite; CI uses the merge-base path above to protect across commits.
  const head = git(root, ["show", `HEAD:${FLAKE_LEDGER_PATH}`])
  if (head !== null) return { raw: head, ref: "HEAD", reason: "committed local ledger" }

  return {
    raw: null,
    ref: null,
    reason: `no prior ledger exists. Tried: ${tried.join("; ") || "no candidate refs"}`,
  }
}

export function checkFlakeLedgerIntegrity(
  root: string,
  currentRaw: string,
  priorRaw: string | null,
  priorRef: string | null,
): { records: FlakeLedgerRecord[]; priorRef: string | null } {
  const records = loadFlakeLedger(currentRaw)
  if (priorRaw !== null) {
    loadFlakeLedger(priorRaw)
    const appendOnly = reconcileAppendOnly(priorRaw, currentRaw)
    if (!appendOnly.ok) {
      throw new Error(`append-only history violated against ${priorRef ?? "prior revision"}: ${appendOnly.reason}`)
    }
  }
  for (const record of openFlakes(records)) {
    if (!existsSync(join(root, record.testFile))) {
      throw new Error(`open flake ${record.flakeId} lost its underlying test file ${record.testFile}`)
    }
  }
  return { records, priorRef }
}

function flag(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

function appendRecords(records: readonly FlakeLedgerRecord[], priorLength: number, root: string): void {
  const added = records.slice(priorLength)
  if (added.length > 0) {
    appendFileSync(join(root, FLAKE_LEDGER_PATH), added.map((record) => `${JSON.stringify(record)}\n`).join(""))
  }
}

function main(): void {
  const root = repoRoot()
  const ledgerPath = join(root, FLAKE_LEDGER_PATH)
  const currentRaw = readFileSync(ledgerPath, "utf8")
  const records = loadFlakeLedger(currentRaw)

  if (process.argv.includes("--check")) {
    const prior = readPriorFlakeLedger(root)
    const checked = checkFlakeLedgerIntegrity(root, currentRaw, prior.raw, prior.ref)
    console.log(
      `Flake Ledger: PASS — ${checked.records.length} record(s), ${openFlakes(checked.records).length} open; ` +
        `history ${prior.raw === null ? `unavailable (${prior.reason})` : `verified against ${prior.ref}`}`,
    )
    return
  }

  const observationPath = flag("--observe")
  if (observationPath) {
    const owner = flag("--owner") ?? ""
    const observations = JSON.parse(readFileSync(resolve(root, observationPath), "utf8")) as TestObservation[]
    let next = records
    for (const candidate of detectFlakes(observations)) next = quarantineFlake(next, candidate, owner)
    appendRecords(next, records.length, root)
    console.log(`Flake Ledger: appended ${next.length - records.length} owned flake record(s)`)
    return
  }

  const closeId = flag("--close")
  if (closeId) {
    const next = closeFlake(records, closeId, flag("--cause") ?? "")
    appendRecords(next, records.length, root)
    console.log(`Flake Ledger: closed ${closeId} by named cause`)
    return
  }

  throw new Error("use --check, --observe <json> --owner <name>, or --close <id> --cause <cause>")
}

if (import.meta.main) main()
