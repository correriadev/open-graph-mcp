/** F002 task 20 — structural proof that CI's blocking/advisory topology is an authored decision. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..", "..")
const workflow = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8")
const packageJson = JSON.parse(
  readFileSync(resolve(ROOT, "packages/mcp-server/package.json"), "utf8"),
) as { scripts?: Record<string, string> }

function jobBlocks(source: string): Map<string, string> {
  const starts = [...source.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)]
  return new Map(
    starts.map((match, index) => [
      match[1]!,
      source.slice(match.index!, starts[index + 1]?.index ?? source.length),
    ]),
  )
}

const jobs = jobBlocks(workflow.slice(workflow.indexOf("jobs:\n") + "jobs:\n".length))

describe("eap-probes is advisory and has an explicit, opt-in trigger", () => {
  test("manual dispatch exposes a dedicated boolean input and no scheduled cadence is invented", () => {
    expect(workflow).toContain("workflow_dispatch:")
    expect(workflow).toContain("run_eap_probes:")
    expect(workflow).not.toMatch(/^\s*schedule:/m)
  })

  test("the probe job is selected only by that input and cannot gate the workflow", () => {
    const job = jobs.get("eap-probes") ?? ""
    expect(job).toContain("github.event_name == 'workflow_dispatch'")
    expect(job).toContain("inputs.run_eap_probes")
    expect(job).toContain("continue-on-error: true")
    expect(job).toContain("# ADVISORY SIGNAL:")
    for (const [name, block] of jobs) {
      if (name !== "eap-probes" && name !== "typecheck") {
        expect(block).toContain("github.event_name != 'workflow_dispatch'")
      }
    }
    // Task 01's typecheck gate is deliberately stronger: it remains unconditional even during a
    // manual probe dispatch, so no event can turn the blocking type-safety invariant off.
    expect(jobs.get("typecheck") ?? "").not.toMatch(/\n {4}if:/)
  })
})

describe("all three probes run serially and publish the Benchmark Ledger delta", () => {
  test("package scripts expose one explicit command per probe", () => {
    expect(packageJson.scripts?.["probe:concurrency"]).toContain("concurrency-probe.ts --run")
    expect(packageJson.scripts?.["probe:cancellation"]).toContain("cancellation-probe.ts --run")
    expect(packageJson.scripts?.["probe:scale"]).toContain("scale-probe.ts --run")
  })

  test("CI records each probe in order and still attempts later probes after an earlier failure", () => {
    const job = jobs.get("eap-probes") ?? ""
    const concurrency = job.indexOf("bun run probe:concurrency")
    const cancellation = job.indexOf("bun run probe:cancellation")
    const scale = job.indexOf("bun run probe:scale")
    expect(job).toContain('EAP_BENCHMARK_RECORD: "1"')
    expect(concurrency).toBeGreaterThan(-1)
    expect(cancellation).toBeGreaterThan(concurrency)
    expect(scale).toBeGreaterThan(cancellation)
    expect((job.match(/if: \$\{\{ always\(\) \}\}/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  test("the append-only delta and resulting ledger are uploaded even when a probe fails", () => {
    const job = jobs.get("eap-probes") ?? ""
    expect(job).toContain("git diff --binary -- docs/verification/benchmark-ledger.jsonl")
    expect(job).toContain(".verification/run/benchmark-ledger.delta.patch")
    expect(job).toContain("actions/upload-artifact@v4")
    expect(job).toContain("path: .verification/run/")
  })
})

describe("deterministic correctness remains on the blocking path", () => {
  test("the root suite remains in the blocking test job and includes the four probe test files", () => {
    const job = jobs.get("test") ?? ""
    expect(job).toContain("bun run test")
    expect(job).toContain("# BLOCKING SIGNAL:")
    expect(packageJson.scripts?.["test:probes:deterministic"]).toContain("concurrency-probe.test.ts")
    expect(packageJson.scripts?.["test:probes:deterministic"]).toContain("cancellation-probe.test.ts")
    expect(packageJson.scripts?.["test:probes:deterministic"]).toContain("cancellation-duplicate-effect.test.ts")
    expect(packageJson.scripts?.["test:probes:deterministic"]).toContain("scale-probe.test.ts")
  })
})

describe("every CI job declares whether it blocks and on which signal", () => {
  test("all current jobs carry exactly one governed signal comment", () => {
    expect([...jobs.keys()].sort()).toEqual(
      ["client-node", "coverage", "e2e", "eap-probes", "load", "suite-verdict", "test", "typecheck"].sort(),
    )
    for (const [name, block] of jobs) {
      const declarations = block.match(/# (?:BLOCKING|ADVISORY) SIGNAL:/g) ?? []
      expect(declarations, `${name} must declare one signal`).toHaveLength(1)
    }
  })
})
