#!/usr/bin/env bun
/**
 * F002 task 01 — Pin Toolchain and Restore Typecheck Gate.
 *
 * Runs the compiler resolved from `bun.lock` (never a registry fallback) over graph-core,
 * mcp-server and client, and compares the per-file diagnostic counts against the Frozen Error
 * Set committed at `docs/verification/typecheck-baseline.json`.
 *
 * Decision D1 (docs/specs/cognitive_line_test_automation/003 §Section 1): the pre-existing
 * errors are FROZEN, not fixed, in this domain. The ratchet is one-directional — a count that
 * rises fails the gate, and a count that falls also fails the gate until the reduction is
 * committed into the baseline in the same change. That is what makes the shrink visible in a
 * diff instead of letting the number drift.
 *
 *   bun run typecheck            -> evaluate, exit 1 on any violation
 *   bun run typecheck:update     -> rewrite the baseline from the current measurement
 *   bun run typecheck:strict <p> -> run the pinned compiler over an arbitrary tsconfig with no
 *                                   baseline at all; any diagnostic fails. Used for packages that
 *                                   are already clean (mcp-web) so their check stops resolving
 *                                   `tsc` through bunx's unpinned registry fallback.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

export const BASELINE_PATH = "docs/verification/typecheck-baseline.json"

export interface ProjectSpec {
  readonly name: string
  readonly tsconfig: string
}

/** The three packages acceptance criterion 3 requires the gate to cover. */
export const PROJECTS: readonly ProjectSpec[] = [
  { name: "graph-core", tsconfig: "packages/graph-core/tsconfig.json" },
  { name: "mcp-server", tsconfig: "packages/mcp-server/tsconfig.json" },
  { name: "client", tsconfig: "packages/client/tsconfig.json" },
]

export interface ProjectBaseline {
  tsconfig: string
  /** Repo-relative POSIX path -> diagnostic count. Keys are sorted when written. */
  files: Record<string, number>
  total: number
}

export interface FrozenErrorSet {
  version: number
  compiler: { package: string; version: string; resolvedFrom: string }
  policy: string
  projects: Record<string, ProjectBaseline>
  total: number
}

export type ViolationKind =
  | "count-rose"
  | "new-file"
  | "count-fell"
  | "file-cleared"
  | "project-missing"
  | "project-unbaselined"

export interface GateViolation {
  kind: ViolationKind
  project: string
  file?: string
  baseline: number
  observed: number
  message: string
}

export interface GateVerdict {
  gate: "typecheck"
  outcome: "pass" | "fail"
  violations: GateViolation[]
  evidenceRef: string
}

/** Repo-relative path of every file, keyed per project, as measured in one run. */
export type Observation = Record<string, Record<string, number>>

export function repoRootFrom(startDir: string): string {
  return resolve(startDir, "..", "..")
}

/**
 * Counts one diagnostic per `path(line,col): error TSxxxx` line. tsc indents the elaboration
 * lines that follow a diagnostic, so a leading space is the discriminator; without this the
 * baseline would count explanatory prose as errors.
 */
export function parseTscDiagnostics(stdout: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith(" ") || line.startsWith("\t")) continue
    const match = /^(.+?)\((\d+),(\d+)\): error TS\d+/.exec(line)
    if (!match) continue
    const file = match[1]!.replace(/\\/g, "/")
    counts[file] = (counts[file] ?? 0) + 1
  }
  return counts
}

export interface PinnedCompiler {
  version: string
  tscPath: string
  packageDir: string
}

/**
 * Resolves the compiler through Bun's module resolver, i.e. through what `bun install` wrote
 * from `bun.lock` — never through `bunx`, whose fallback silently downloads whatever the
 * registry currently offers (that fallback is how this repo ended up running an unpinned
 * TypeScript 7 against a 5.8.2 codebase). Refuses to run if the resolved version disagrees
 * with the exact spec pinned in the root package.json: an unpinned resolution is the defect.
 */
export function resolvePinnedCompiler(repoRoot: string): PinnedCompiler {
  const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    devDependencies?: Record<string, string>
  }
  const spec = rootPkg.devDependencies?.typescript
  if (!spec) {
    throw new Error(
      "typecheck gate: root package.json declares no `typescript` devDependency, so the compiler " +
        "would resolve from the registry at run time. Pin it before running the gate.",
    )
  }
  if (!/^\d+\.\d+\.\d+$/.test(spec)) {
    throw new Error(`typecheck gate: root typescript spec "${spec}" is a range, not an exact pin.`)
  }

  let manifestPath: string
  try {
    manifestPath = Bun.resolveSync("typescript/package.json", repoRoot)
  } catch {
    throw new Error(
      "typecheck gate: `typescript` is not installed at the repo root. Run `bun install` — the " +
        "gate deliberately refuses to fall through to a registry download.",
    )
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string }
  if (manifest.version !== spec) {
    throw new Error(
      `typecheck gate: resolved typescript ${manifest.version} but the lockfile pin is ${spec}. ` +
        "Refusing to type-check against an unpinned compiler.",
    )
  }
  const packageDir = dirname(manifestPath)
  return { version: manifest.version, tscPath: join(packageDir, "bin", "tsc"), packageDir }
}

export function runProject(
  repoRoot: string,
  compiler: PinnedCompiler,
  project: ProjectSpec,
): Record<string, number> {
  const result = Bun.spawnSync({
    cmd: ["bun", compiler.tscPath, "--noEmit", "--pretty", "false", "-p", project.tsconfig],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  // A compiler that aborts (the TS7/tsgo Go panic this task exists to prevent) writes nothing
  // parseable to stdout while failing. Silence plus a non-zero exit is not "zero errors".
  if (result.exitCode !== 0 && !/\): error TS\d+/.test(stdout)) {
    throw new Error(
      `typecheck gate: compiler aborted on ${project.name} (exit ${result.exitCode}) without ` +
        `emitting diagnostics.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    )
  }
  return parseTscDiagnostics(stdout)
}

export function loadBaseline(repoRoot: string): FrozenErrorSet {
  const path = join(repoRoot, BASELINE_PATH)
  if (!existsSync(path)) {
    throw new Error(`typecheck gate: no Frozen Error Set at ${BASELINE_PATH}.`)
  }
  return JSON.parse(readFileSync(path, "utf8")) as FrozenErrorSet
}

export function compareToBaseline(baseline: FrozenErrorSet, observed: Observation): GateVerdict {
  const violations: GateViolation[] = []

  for (const [projectName, projectBaseline] of Object.entries(baseline.projects)) {
    const projectObserved = observed[projectName]
    if (projectObserved === undefined) {
      violations.push({
        kind: "project-missing",
        project: projectName,
        baseline: projectBaseline.total,
        observed: 0,
        message:
          `project "${projectName}" is in the Frozen Error Set but produced no measurement; ` +
          "a project that silently stops being checked is a gate failure, not a pass.",
      })
      continue
    }

    for (const [file, baselineCount] of Object.entries(projectBaseline.files)) {
      const observedCount = projectObserved[file] ?? 0
      if (observedCount === baselineCount) continue
      if (observedCount > baselineCount) {
        violations.push({
          kind: "count-rose",
          project: projectName,
          file,
          baseline: baselineCount,
          observed: observedCount,
          message:
            `${file}: baseline ${baselineCount} error(s), observed ${observedCount} in project ` +
            `"${projectName}". The frozen set may not grow — fix the new error rather than ` +
            "editing the baseline upward or suppressing it.",
        })
      } else {
        violations.push({
          kind: observedCount === 0 ? "file-cleared" : "count-fell",
          project: projectName,
          file,
          baseline: baselineCount,
          observed: observedCount,
          message:
            `${file}: baseline ${baselineCount} error(s), observed ${observedCount} in project ` +
            `"${projectName}". Good news — now commit the reduced count down by running ` +
            "`bun run typecheck:update`, so the ratchet only ever shrinks.",
        })
      }
    }

    for (const [file, observedCount] of Object.entries(projectObserved)) {
      if (file in projectBaseline.files) continue
      if (observedCount <= 0) continue
      violations.push({
        kind: "new-file",
        project: projectName,
        file,
        baseline: 0,
        observed: observedCount,
        message:
          `${file}: not in the Frozen Error Set but reported ${observedCount} error(s) in project ` +
          `"${projectName}". A newly erroring file is a growth of the frozen set.`,
      })
    }
  }

  for (const projectName of Object.keys(observed)) {
    if (projectName in baseline.projects) continue
    violations.push({
      kind: "project-unbaselined",
      project: projectName,
      baseline: 0,
      observed: Object.values(observed[projectName]!).reduce((a, b) => a + b, 0),
      message: `project "${projectName}" was measured but has no entry in the Frozen Error Set.`,
    })
  }

  return {
    gate: "typecheck",
    outcome: violations.length === 0 ? "pass" : "fail",
    violations,
    evidenceRef: BASELINE_PATH,
  }
}

export function buildBaseline(
  compiler: PinnedCompiler,
  observed: Observation,
  previous?: FrozenErrorSet,
): FrozenErrorSet {
  const projects: Record<string, ProjectBaseline> = {}
  let total = 0
  for (const project of PROJECTS) {
    const files = observed[project.name] ?? {}
    const sorted: Record<string, number> = {}
    for (const file of Object.keys(files).sort()) {
      if (files[file]! > 0) sorted[file] = files[file]!
    }
    const projectTotal = Object.values(sorted).reduce((a, b) => a + b, 0)
    projects[project.name] = { tsconfig: project.tsconfig, files: sorted, total: projectTotal }
    total += projectTotal
  }
  return {
    version: previous?.version ?? 1,
    compiler: { package: "typescript", version: compiler.version, resolvedFrom: "bun.lock" },
    policy:
      "Frozen ratchet (F002 task 01, decision D1): these errors pre-date the verification domain " +
      "and are deliberately NOT fixed here. Per-file counts may only shrink, and a shrink must be " +
      "committed down in the same change via `bun run typecheck:update`. Counts are per project " +
      "because a file checked by two tsconfigs is checked under different compilerOptions and " +
      "legitimately reports different diagnostics.",
    projects,
    total,
  }
}

async function main(): Promise<number> {
  const repoRoot = repoRootFrom(import.meta.dir)
  const update = process.argv.includes("--update")
  const strictAt = process.argv.indexOf("--strict")
  const compiler = resolvePinnedCompiler(repoRoot)

  console.log(`typecheck gate: typescript ${compiler.version} (resolved from bun.lock)`)

  if (strictAt !== -1) {
    const tsconfig = process.argv[strictAt + 1]
    if (!tsconfig) throw new Error("typecheck gate: --strict requires a tsconfig path")
    const counts = runProject(repoRoot, compiler, { name: tsconfig, tsconfig })
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    if (total === 0) {
      console.log(`  ${tsconfig} -> clean`)
      return 0
    }
    console.error(`\ntypecheck gate: FAIL — ${total} error(s) in ${tsconfig} (no baseline applies):`)
    for (const [file, n] of Object.entries(counts)) console.error(`  ${file}: ${n}`)
    return 1
  }

  const observed: Observation = {}
  for (const project of PROJECTS) {
    observed[project.name] = runProject(repoRoot, compiler, project)
    const n = Object.values(observed[project.name]!).reduce((a, b) => a + b, 0)
    console.log(`  ${project.name.padEnd(11)} ${project.tsconfig} -> ${n} error(s)`)
  }

  if (update) {
    const previous = existsSync(join(repoRoot, BASELINE_PATH)) ? loadBaseline(repoRoot) : undefined
    const next = buildBaseline(compiler, observed, previous)
    writeFileSync(join(repoRoot, BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`, "utf8")
    console.log(`\nWrote ${BASELINE_PATH} — total ${next.total} frozen error(s).`)
    return 0
  }

  const verdict = compareToBaseline(loadBaseline(repoRoot), observed)
  if (verdict.outcome === "pass") {
    console.log(`\ntypecheck gate: PASS — frozen error set unchanged.`)
    return 0
  }
  console.error(`\ntypecheck gate: FAIL — ${verdict.violations.length} violation(s):`)
  for (const v of verdict.violations) console.error(`  [${v.kind}] ${v.message}`)
  return 1
}

if (import.meta.main) {
  process.exit(await main())
}
