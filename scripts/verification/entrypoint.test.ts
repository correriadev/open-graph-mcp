import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"

// F002 task 02 — Unify Local and CI Verification Entrypoint.
// Discharges 004 §2.2:
//   "Should evaluate the same test set locally and in CI when the unified entrypoint runs"
//   "Should run typecheck and the full suite under one documented command when `verify` is invoked"
//
// These are configuration assertions on committed files, not on a live run: the actual
// count-for-count comparison between `bun run test` and CI's invocation is executed by hand and
// recorded as evidence in TDD-OUTPUT.json. Baking a double full-suite run (~150s) into the suite
// itself would make the gate pay twice for the property it is asserting.

const repoRoot = join(import.meta.dir, "..", "..")

type Pkg = { name?: string; scripts?: Record<string, string> }

const readPkg = (path: string): Pkg => JSON.parse(readFileSync(path, "utf8")) as Pkg

const rootPkg = readPkg(join(repoRoot, "package.json"))
const ci = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8")

const job = (name: string): string => {
  const start = ci.indexOf(`\n  ${name}:`)
  if (start === -1) return ""
  const rest = ci.slice(start + 1)
  const next = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/)
  return next === -1 ? rest : rest.slice(0, next)
}

const runSteps = (jobBody: string): string[] =>
  [...jobBody.matchAll(/^ *- run: (.+)$/gm)].map((m) => m[1].trim())

const packageDirs = readdirSync(join(repoRoot, "packages")).filter((d) =>
  existsSync(join(repoRoot, "packages", d, "package.json")),
)

describe("Unified entrypoint — the same test set locally and in CI", () => {
  // 004: "Given root package.json's `test` script running only packages/mcp-server while CI runs
  //       root `bun test`" — the divergence this task exists to end.
  test("the root `test` script runs the suite from the repo root, not from one package", () => {
    const script = rootPkg.scripts?.test
    expect(script).toBeDefined()
    // `--cwd <pkg>` is exactly the narrowing that made "tests pass" mean two different things.
    expect(script).not.toContain("--cwd")
    expect(script).toBe("bun test")
  })

  test("the CI `test` job invokes the root entrypoint rather than an equivalent-looking command", () => {
    const steps = runSteps(job("test"))
    expect(steps).toContain("bun run test")
    // A bare `bun test` in CI is the failure mode even when it happens to be equivalent today:
    // the two commands then drift independently.
    expect(steps).not.toContain("bun test")
  })

  test("nothing on the gate path delegates into a single package's test script", () => {
    const onGatePath = [rootPkg.scripts?.test ?? "", rootPkg.scripts?.verify ?? "", ...runSteps(job("test"))]
    for (const cmd of onGatePath) {
      expect(cmd).not.toMatch(/--cwd\s+packages\/[a-z-]+\s+test\b/)
    }
  })

  test("no package-level `test` script silently narrows the set — mcp-server delegates to the root", () => {
    const pkg = readPkg(join(repoRoot, "packages", "mcp-server", "package.json"))
    const script = pkg.scripts?.test
    expect(script).toBeDefined()
    // Must not be a package-scoped runner invocation; must reach the root entrypoint.
    expect(script).not.toMatch(/^bun test\b/)
    expect(script).toMatch(/--cwd\s+\.\.\/\.\.\s+test\b/)
  })

  test("every package's `test` script is either absent or resolves to the root entrypoint", () => {
    const narrowing: string[] = []
    for (const dir of packageDirs) {
      const script = readPkg(join(repoRoot, "packages", dir, "package.json")).scripts?.test
      if (script === undefined) continue
      if (!/--cwd\s+\.\.\/\.\.\s+test\b/.test(script)) narrowing.push(`${dir}: ${script}`)
    }
    // Documented, deliberate residue: only mcp-server is inside this task's declared scope.
    // The others are recorded here so the narrowing is visible rather than silent.
    expect(narrowing.sort()).toEqual(
      [
        "client: bun test --timeout 30000",
        "mcp-web: bun test",
        "stdio-proxy: bun test --timeout 30000",
      ].sort(),
    )
  })
})

describe("`verify` — the single documented local entrypoint", () => {
  // 004: "Then it runs the typecheck against the frozen baseline followed by the full suite,
  //       and is the single documented local entrypoint"
  test("a `verify` script exists at the repo root", () => {
    expect(rootPkg.scripts?.verify).toBeDefined()
  })

  test("`verify` composes task 01's typecheck gate instead of reimplementing it", () => {
    const script = rootPkg.scripts?.verify ?? ""
    expect(script).toContain("bun run typecheck")
    // Reimplementing the gate (invoking tsc directly, or re-listing the projects) would let the
    // local command and the CI typecheck job disagree about the frozen baseline.
    expect(script).not.toContain("tsc")
    expect(script).not.toContain("tsconfig")
  })

  test("`verify` runs the typecheck first and then the full suite", () => {
    const script = rootPkg.scripts?.verify ?? ""
    const typecheckAt = script.indexOf("bun run typecheck")
    const testAt = script.indexOf("bun run test")
    expect(typecheckAt).toBeGreaterThanOrEqual(0)
    expect(testAt).toBeGreaterThan(typecheckAt)
    // Sequenced, not backgrounded or `;`-joined: a failing typecheck must stop the run.
    expect(script).toContain("&&")
  })

  test("`verify` is documented in the root README as the local entrypoint", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8")
    expect(readme).toContain("bun run verify")
  })
})
