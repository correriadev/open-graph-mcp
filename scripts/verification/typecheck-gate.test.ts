import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  BASELINE_PATH,
  PROJECTS,
  compareToBaseline,
  loadBaseline,
  parseTscDiagnostics,
  resolvePinnedCompiler,
  type FrozenErrorSet,
} from "./typecheck-gate"

// F002 task 01 — Pin Toolchain and Restore Typecheck Gate.
// Discharges 004 §"Toolchain Pin" and the three CI-gate scenarios of 004 §"Quality Gate".
// The 24 pre-existing errors are FROZEN by decision D1: this suite proves the ratchet
// mechanics, never that the errors are gone.

const repoRoot = join(import.meta.dir, "..", "..")

const baselineOf = (files: Record<string, number>): FrozenErrorSet => ({
  version: 1,
  compiler: { package: "typescript", version: "5.8.2", resolvedFrom: "bun.lock" },
  policy: "frozen-ratchet: counts may only shrink; a shrink must be committed down",
  projects: {
    "mcp-server": {
      tsconfig: "packages/mcp-server/tsconfig.json",
      files,
      total: Object.values(files).reduce((a, b) => a + b, 0),
    },
  },
  total: Object.values(files).reduce((a, b) => a + b, 0),
})

const observedOf = (files: Record<string, number>) => ({ "mcp-server": files })

describe("Toolchain Pin — compiler resolves from the lockfile", () => {
  // 004: "Should resolve the compiler from the lockfile when the Toolchain Pin is applied"
  test("root package.json declares typescript at one exact version", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>
      dependencies?: Record<string, string>
    }
    const spec = pkg.devDependencies?.typescript ?? pkg.dependencies?.typescript
    expect(spec).toBeDefined()
    // An unpinned resolution is itself the defect — no range operators allowed.
    expect(spec).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test("bun.lock resolves exactly one typescript version and it matches the root spec", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>
    }
    const spec = pkg.devDependencies?.typescript
    const lock = readFileSync(join(repoRoot, "bun.lock"), "utf8")
    const resolved = new Set([...lock.matchAll(/"typescript@(\d+\.\d+\.\d+)"/g)].map((m) => m[1]))
    expect([...resolved]).toEqual([spec])
  })

  test("the gate resolves the pinned compiler rather than a registry fallback", () => {
    const compiler = resolvePinnedCompiler(repoRoot)
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>
    }
    expect(compiler.version).toBe(pkg.devDependencies!.typescript!)
    expect(compiler.tscPath).toContain("typescript")
  })
})

describe("Toolchain Pin — the frozen baseline ratchets", () => {
  // 004: "Should fail the baseline gate when a per-file error count rises"
  test("fails naming the file, the baseline count and the observed count when a count rises", () => {
    const verdict = compareToBaseline(baselineOf({ "packages/mcp-server/src/doctor.ts": 2 }), observedOf({ "packages/mcp-server/src/doctor.ts": 3 }))
    expect(verdict.outcome).toBe("fail")
    expect(verdict.violations).toHaveLength(1)
    const v = verdict.violations[0]!
    expect(v.kind).toBe("count-rose")
    expect(v.file).toBe("packages/mcp-server/src/doctor.ts")
    expect(v.baseline).toBe(2)
    expect(v.observed).toBe(3)
    expect(v.message).toContain("packages/mcp-server/src/doctor.ts")
    expect(v.message).toContain("2")
    expect(v.message).toContain("3")
  })

  // 004: "Should fail the baseline gate when a file absent from the baseline reports an error"
  test("fails naming the new file when a file absent from the baseline errors", () => {
    const verdict = compareToBaseline(baselineOf({ "packages/mcp-server/src/doctor.ts": 2 }), observedOf({ "packages/mcp-server/src/doctor.ts": 2, "packages/mcp-server/src/brand-new.ts": 1 }))
    expect(verdict.outcome).toBe("fail")
    expect(verdict.violations).toHaveLength(1)
    const v = verdict.violations[0]!
    expect(v.kind).toBe("new-file")
    expect(v.file).toBe("packages/mcp-server/src/brand-new.ts")
    expect(v.baseline).toBe(0)
    expect(v.observed).toBe(1)
  })

  // 004: "Should require the reduced count to be committed down when a file's error count falls"
  test("fails demanding the reduced count be committed down when a count falls", () => {
    const verdict = compareToBaseline(baselineOf({ "packages/mcp-server/src/doctor.ts": 2 }), observedOf({ "packages/mcp-server/src/doctor.ts": 1 }))
    expect(verdict.outcome).toBe("fail")
    const v = verdict.violations[0]!
    expect(v.kind).toBe("count-fell")
    expect(v.baseline).toBe(2)
    expect(v.observed).toBe(1)
    expect(v.message).toMatch(/commit/i)
  })

  test("fails demanding removal when a baselined file stops erroring entirely", () => {
    const verdict = compareToBaseline(baselineOf({ "packages/mcp-server/src/doctor.ts": 2 }), observedOf({}))
    expect(verdict.outcome).toBe("fail")
    const v = verdict.violations[0]!
    expect(v.kind).toBe("file-cleared")
    expect(v.observed).toBe(0)
  })

  test("passes only when every per-file count matches the frozen set exactly", () => {
    const files = { "packages/mcp-server/src/doctor.ts": 2, "packages/graph-core/src/verify.ts": 2 }
    const verdict = compareToBaseline(baselineOf(files), observedOf(files))
    expect(verdict.outcome).toBe("pass")
    expect(verdict.violations).toEqual([])
    expect(verdict.gate).toBe("typecheck")
  })

  test("fails when a baselined project produces no observation at all", () => {
    const verdict = compareToBaseline(baselineOf({ "packages/mcp-server/src/doctor.ts": 2 }), {})
    expect(verdict.outcome).toBe("fail")
    expect(verdict.violations.some((v) => v.kind === "project-missing")).toBe(true)
  })

  test("reports every violating file rather than stopping at the first", () => {
    const verdict = compareToBaseline(
      baselineOf({ "a.ts": 1, "b.ts": 1 }),
      observedOf({ "a.ts": 2, "b.ts": 3, "c.ts": 1 }),
    )
    expect(verdict.outcome).toBe("fail")
    expect(verdict.violations).toHaveLength(3)
  })
})

describe("Toolchain Pin — tsc diagnostics are counted per file", () => {
  test("counts one error per diagnostic line and ignores indented continuation lines", () => {
    const stdout = [
      "packages/graph-core/src/verify.ts(61,31): error TS2339: Property 'map' does not exist.",
      "  Property 'map' does not exist on type 'ReadonlySet<string>'.",
      "packages/graph-core/src/verify.ts(61,36): error TS7006: Parameter 'c' implicitly has an 'any' type.",
      "packages/mcp-server/src/doctor.ts(31,37): error TS2345: Argument of type 'number' ...",
      "",
    ].join("\n")
    expect(parseTscDiagnostics(stdout)).toEqual({
      "packages/graph-core/src/verify.ts": 2,
      "packages/mcp-server/src/doctor.ts": 1,
    })
  })

  test("normalises backslash paths so the baseline is platform independent", () => {
    const stdout = "packages\\mcp-server\\src\\doctor.ts(31,37): error TS2345: nope."
    expect(parseTscDiagnostics(stdout)).toEqual({ "packages/mcp-server/src/doctor.ts": 1 })
  })

  test("returns an empty map for clean output", () => {
    expect(parseTscDiagnostics("")).toEqual({})
  })
})

describe("Frozen Error Set — the committed baseline is well formed", () => {
  test("the committed baseline exists and states its scope, policy and compiler", () => {
    const baseline = loadBaseline(repoRoot)
    expect(baseline.compiler.package).toBe("typescript")
    expect(baseline.compiler.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(baseline.policy).toMatch(/shrink/i)
    expect(BASELINE_PATH).toBe("docs/verification/typecheck-baseline.json")
  })

  test("the baseline covers graph-core, mcp-server and client", () => {
    const baseline = loadBaseline(repoRoot)
    expect(Object.keys(baseline.projects).sort()).toEqual(["client", "graph-core", "mcp-server"])
    for (const p of PROJECTS) expect(baseline.projects[p.name]).toBeDefined()
  })

  test("every project total equals the sum of its per-file counts, and the grand total the sum of projects", () => {
    const baseline = loadBaseline(repoRoot)
    let grand = 0
    for (const project of Object.values(baseline.projects)) {
      const sum = Object.values(project.files).reduce((a, b) => a + b, 0)
      expect(project.total).toBe(sum)
      grand += sum
    }
    expect(baseline.total).toBe(grand)
  })

  test("no baselined file is recorded with a zero or negative count", () => {
    const baseline = loadBaseline(repoRoot)
    for (const project of Object.values(baseline.projects)) {
      for (const [file, count] of Object.entries(project.files)) {
        expect(count, `${file} must carry a positive count`).toBeGreaterThan(0)
      }
    }
  })
})

describe("Quality Gate — the CI typecheck job blocks the merge", () => {
  const ci = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8")
  const typecheckJob = (() => {
    const start = ci.indexOf("\n  typecheck:")
    if (start === -1) return ""
    const rest = ci.slice(start + 1)
    const next = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/)
    return next === -1 ? rest : rest.slice(0, next)
  })()

  // 004: "Should cover graph-core, mcp-server, and client when the typecheck job runs"
  test("a typecheck job exists", () => {
    expect(typecheckJob).not.toBe("")
  })

  test("the job runs the gate over all three packages", () => {
    for (const p of PROJECTS) expect(typecheckJob).toContain(p.name)
  })

  // 004: "Should block the merge when the typecheck baseline grows"
  test("the job is blocking — no continue-on-error and no conditional skip", () => {
    expect(typecheckJob).not.toContain("continue-on-error")
    expect(typecheckJob).not.toMatch(/\n {4}if:/)
  })

  test("the job installs with the frozen lockfile so the compiler cannot float", () => {
    expect(typecheckJob).toContain("--frozen-lockfile")
  })

  test("no executable workflow step resolves tsc through an unpinned bunx fallback", () => {
    // Comment lines are excluded on purpose: the fix's own rationale names the command it removed.
    const executable = ci
      .split(/\r?\n/)
      .filter((l) => !/^\s*#/.test(l))
      .join("\n")
    expect([...executable.matchAll(/bunx\s+tsc\b/g)]).toHaveLength(0)
  })
})
