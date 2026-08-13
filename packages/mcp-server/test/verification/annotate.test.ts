/**
 * F002 task 05 — Discharge Annotation Surface.
 *
 * RED-phase specification for `annotate.ts`. Every case below is one `#####` scenario of
 * `docs/specs/cognitive_line_test_automation/004-open-graph-mcp-test-scenarios.md`, or one clause
 * of the task's acceptance criteria; the mapping is named in each test title.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import {
  ANNOTATION_SINK_PATH,
  annotationsFile,
  buildRecord,
  callerFileFromStack,
  collectAnnotations,
  defaultAnnotationsFile,
  emitAnnotation,
  repoRootDir,
  type AnnotationRecord,
} from "./annotate"
import {
  loadScenarioRegister,
  type ScenarioRegister,
} from "../../../../scripts/verification/register-scenarios"

const ROOT = repoRootDir()
const MODULE_URL = pathToFileURL(join(ROOT, "packages/mcp-server/test/verification/annotate.ts")).href

const scratch = mkdtempSync(join(tmpdir(), "f002-annotate-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** A sink under the scratch dir, so no test in this file writes into the real per-run sink. */
function scratchSink(name: string): string {
  const file = join(scratch, `${name}.jsonl`)
  rmSync(file, { force: true })
  return file
}

function withSink<T>(file: string, body: () => T): T {
  const previous = process.env.VERIFICATION_ANNOTATIONS_FILE
  process.env.VERIFICATION_ANNOTATIONS_FILE = file
  try {
    return body()
  } finally {
    if (previous === undefined) delete process.env.VERIFICATION_ANNOTATIONS_FILE
    else process.env.VERIFICATION_ANNOTATIONS_FILE = previous
  }
}

const committedRegister: ScenarioRegister = loadScenarioRegister(
  readFileSync(join(ROOT, "docs/verification/scenario-register.json"), "utf8"),
  { writer: "derivation" },
)

/** A tiny hand-built register, so the pure cases do not depend on the committed corpus. */
const fixtureRegister: ScenarioRegister = {
  version: 1,
  policy: "fixture",
  source: { path: "fixture", sha256: "0", headingCount: 0 },
  scenarios: [
    { id: "EAP-FUNC-001", area: "FUNC", section: "3.1", group: null, heading: "h", status: "proposed" },
    { id: "EAP-FUNC-002", area: "FUNC", section: "3.1", group: null, heading: "h", status: "proposed" },
    { id: "EAP-SEC-001", area: "SEC", section: "3.3", group: null, heading: "h", status: "proposed" },
    {
      id: "EAP-SEC-002",
      area: "SEC",
      section: "3.3",
      group: null,
      heading: "h",
      status: "proposed",
      retired: true,
    },
    {
      id: "EAP-QUAR-001",
      area: "QUAR",
      section: "4.1",
      group: "QA1",
      heading: "h",
      status: "declared-untestable",
    },
  ],
}

describe("record construction — the annotation is data, never a parsed title", () => {
  test("records file, test name and identifiers for a well-formed annotation [acceptance 1]", () => {
    const record = buildRecord(
      "packages/mcp-server/test/eap-conformance.test.ts",
      "INV-02 — the refusal taxonomy is closed",
      { asserts: ["EAP-FUNC-001"], coversPartially: ["EAP-SEC-001"], items: ["L1-03"], defects: ["D-7"] },
      fixtureRegister,
    )
    expect(record.file).toBe("packages/mcp-server/test/eap-conformance.test.ts")
    expect(record.test).toBe("INV-02 — the refusal taxonomy is closed")
    expect(record.scenarios).toEqual([
      { id: "EAP-FUNC-001", kind: "asserts" },
      { id: "EAP-SEC-001", kind: "covers-partially" },
    ])
    expect(record.items).toEqual(["L1-03"])
    expect(record.defects).toEqual(["D-7"])
  })

  test("distinguishes an `asserts` link from a `covers-partially` link, never summing them [004 §3.2]", () => {
    const record = buildRecord("a/b.test.ts", "t", {
      asserts: ["EAP-FUNC-001"],
      coversPartially: ["EAP-FUNC-002"],
    }, fixtureRegister)
    expect(record.scenarios.filter((s) => s.kind === "asserts").map((s) => s.id)).toEqual(["EAP-FUNC-001"])
    expect(record.scenarios.filter((s) => s.kind === "covers-partially").map((s) => s.id)).toEqual([
      "EAP-FUNC-002",
    ])
  })

  test("rejects an identifier absent from the register, naming id, file and test name [acceptance 2 / 004 §3.2]", () => {
    expect(() =>
      buildRecord("packages/client/test/x.test.ts", "some case", { asserts: ["EAP-FUNC-404"] }, fixtureRegister),
    ).toThrow(/EAP-FUNC-404.*packages\/client\/test\/x\.test\.ts.*some case/s)
  })

  test("rejects a retired register entry, because a retired Scenario can discharge nothing", () => {
    expect(() => buildRecord("a/b.test.ts", "t", { asserts: ["EAP-SEC-002"] }, fixtureRegister)).toThrow(
      /EAP-SEC-002.*retired/s,
    )
  })

  test("rejects a malformed identifier before it ever reaches the register", () => {
    expect(() => buildRecord("a/b.test.ts", "t", { asserts: ["FUNC-1"] }, fixtureRegister)).toThrow(/FUNC-1/)
  })

  test("rejects an annotation naming no identifier at all", () => {
    expect(() => buildRecord("a/b.test.ts", "t", {}, fixtureRegister)).toThrow(/no identifier/i)
  })

  test("rejects the same identifier declared twice, so one execution never doubles a link", () => {
    expect(() =>
      buildRecord("a/b.test.ts", "t", { asserts: ["EAP-FUNC-001"], coversPartially: ["EAP-FUNC-001"] }, fixtureRegister),
    ).toThrow(/EAP-FUNC-001/)
  })

  test("rejects an empty test name, because a link identifying only a file is inadmissible [004 §1.5]", () => {
    expect(() => buildRecord("a/b.test.ts", "  ", { asserts: ["EAP-FUNC-001"] }, fixtureRegister)).toThrow(
      /test name/i,
    )
  })

  test("flags a declared-untestable identifier instead of passing it silently, and does not block [task 08 owns the gate]", () => {
    const record = buildRecord("a/b.test.ts", "t", { asserts: ["EAP-QUAR-001"] }, fixtureRegister)
    expect(record.declaredUntestable).toEqual(["EAP-QUAR-001"])
    expect(record.scenarios).toEqual([{ id: "EAP-QUAR-001", kind: "asserts" }])
  })

  test("leaves declaredUntestable empty for an ordinary proposed identifier", () => {
    const record = buildRecord("a/b.test.ts", "t", { asserts: ["EAP-FUNC-001"] }, fixtureRegister)
    expect(record.declaredUntestable).toEqual([])
  })

  test("never derives an identifier from the test title [004 §3.2]", () => {
    const record = buildRecord("a/b.test.ts", "EAP-SEC-001 in the title", { asserts: ["EAP-FUNC-001"] }, fixtureRegister)
    expect(record.scenarios.map((s) => s.id)).toEqual(["EAP-FUNC-001"])
  })
})

describe("sink emission", () => {
  test("emits exactly one record per execution [acceptance 1]", () => {
    const sink = scratchSink("one-per-execution")
    withSink(sink, () => {
      emitAnnotation("packages/mcp-server/test/x.test.ts", "case one", { asserts: ["EAP-FUNC-001"] })
      emitAnnotation("packages/mcp-server/test/x.test.ts", "case one", { asserts: ["EAP-FUNC-001"] })
    })
    const records = collectAnnotations(readFileSync(sink, "utf8"))
    expect(records.length).toBe(2)
    expect(records.every((r) => r.file === "packages/mcp-server/test/x.test.ts" && r.test === "case one")).toBe(true)
  })

  test("writes no record at all when the annotation is rejected [acceptance 2]", () => {
    const sink = scratchSink("rejected-writes-nothing")
    withSink(sink, () => {
      expect(() => emitAnnotation("a/b.test.ts", "t", { asserts: ["EAP-NOPE-001"] })).toThrow(/EAP-NOPE-001/)
    })
    expect(existsSync(sink)).toBe(false)
  })

  test("records a test that emits nothing as no record at all [004 §3.2 — titles are never parsed]", () => {
    const sink = scratchSink("silent-test")
    withSink(sink, () => {
      // A test case whose title resembles an identifier but which emits nothing.
      const title = "EAP-FUNC-001 looks like an annotation but is only prose"
      expect(title).toContain("EAP-FUNC-001")
    })
    expect(existsSync(sink)).toBe(false)
  })

  test("resolves the default sink to the repo root, independent of cwd [acceptance 3]", () => {
    expect(ANNOTATION_SINK_PATH).toBe(".verification/annotations.jsonl")
    expect(defaultAnnotationsFile()).toBe(join(ROOT, ".verification", "annotations.jsonl"))
    const sink = scratchSink("override")
    expect(withSink(sink, () => annotationsFile())).toBe(sink)
  })
})

describe("the committed register is the authority at run time", () => {
  test("accepts a registered identifier and flags a quarantined one, against the real register", () => {
    const sink = scratchSink("committed-register")
    const records = withSink(sink, () => [
      emitAnnotation("packages/mcp-server/test/x.test.ts", "real id", { asserts: ["EAP-FUNC-001"] }),
      emitAnnotation("packages/mcp-server/test/x.test.ts", "quarantined id", { asserts: ["EAP-QUAR-001"] }),
    ])
    expect(records[0]!.declaredUntestable).toEqual([])
    expect(records[1]!.declaredUntestable).toEqual(["EAP-QUAR-001"])
    expect(committedRegister.scenarios.some((entry) => entry.id === "EAP-FUNC-001")).toBe(true)
  })
})

describe("concurrency — parallel test processes share one append-only sink", () => {
  test("loses no record when several processes append at once [acceptance 1/3]", async () => {
    const sink = scratchSink("concurrent")
    const writers = 6
    const perWriter = 40
    const child = join(scratch, "writer.ts")
    writeFileSync(
      child,
      `const { emitAnnotation } = await import(${JSON.stringify(MODULE_URL)})\n` +
        `const tag = process.argv[2]\n` +
        `for (let i = 0; i < ${perWriter}; i++) {\n` +
        `  emitAnnotation("packages/mcp-server/test/w.test.ts", tag + ":" + i, { asserts: ["EAP-FUNC-001"] })\n` +
        `}\n`,
      "utf8",
    )

    const procs = Array.from({ length: writers }, (_, index) =>
      Bun.spawn(["bun", child, `w${index}`], {
        cwd: ROOT,
        env: { ...process.env, VERIFICATION_ANNOTATIONS_FILE: sink },
        stdout: "pipe",
        stderr: "pipe",
      }),
    )
    const statuses = await Promise.all(procs.map((proc) => proc.exited))
    expect(statuses.every((status) => status === 0)).toBe(true)

    const records = collectAnnotations(readFileSync(sink, "utf8"))
    expect(records.length).toBe(writers * perWriter)
    expect(new Set(records.map((r) => r.test)).size).toBe(writers * perWriter)
  }, 60000)
})

describe("caller-file resolution — the record must never say `unknown`", () => {
  test("reads the caller frame of a module-top-level call, which carries no column [regression]", () => {
    // Verbatim Bun stack for `annotatedTest(...)` called at the top level of a statically-imported
    // test file: the caller frame is `at <file>:<line>` with NO column and no parentheses.
    const stack = [
      "Error",
      "    at callerFile (C:\\repo\\packages\\mcp-server\\test\\verification\\annotate.ts:1:38)",
      "    at annotatedTest (C:\\repo\\packages\\mcp-server\\test\\verification\\annotate.ts:9:20)",
      "    at C:\\repo\\packages\\mcp-server\\test\\eap-conformance.test.ts:24",
    ].join("\n")
    expect(callerFileFromStack(stack)).toBe("C:\\repo\\packages\\mcp-server\\test\\eap-conformance.test.ts")
  })

  test("reads the caller frame of a call inside a function, which carries line and column", () => {
    const stack = [
      "Error",
      "    at callerFile (C:\\repo\\packages\\mcp-server\\test\\verification\\annotate.ts:1:38)",
      "    at <anonymous> (C:\\repo\\packages\\client\\test\\eap-conformance.test.ts:12:3)",
    ].join("\n")
    expect(callerFileFromStack(stack)).toBe("C:\\repo\\packages\\client\\test\\eap-conformance.test.ts")
  })

  test("reads a posix frame too", () => {
    const stack = ["Error", "    at /repo/packages/graph-core/test/a.test.ts:4"].join("\n")
    expect(callerFileFromStack(stack)).toBe("/repo/packages/graph-core/test/a.test.ts")
  })

  test("the annotated conformance corpus records a real file, never `unknown` [acceptance 1]", () => {
    const sink = scratchSink("no-unknown")
    const record = withSink(sink, () =>
      emitAnnotation(join(ROOT, "packages/mcp-server/test/eap-conformance.test.ts"), "t", {
        asserts: ["EAP-FUNC-001"],
      }),
    )
    expect(record.file).toBe("packages/mcp-server/test/eap-conformance.test.ts")
  })
})

describe("annotatedTest — the title and the link name cannot drift apart", () => {
  test("registers a test under the given name and emits exactly one record per execution", async () => {
    const sink = scratchSink("annotated-test")
    const fixture = join(scratch, "annotated.test.ts")
    writeFileSync(
      fixture,
      `import { expect } from "bun:test"\n` +
        `const mod = await import(${JSON.stringify(MODULE_URL)})\n` +
        `mod.annotatedTest("a governed case", { asserts: ["EAP-FUNC-001"] }, () => {\n` +
        `  expect(1).toBe(1)\n` +
        `})\n` +
        `mod.annotatedTest("another governed case", { coversPartially: ["EAP-SEC-001"] }, () => {\n` +
        `  expect(2).toBe(2)\n` +
        `})\n`,
      "utf8",
    )
    const run = async (args: readonly string[]): Promise<{ code: number; output: string }> => {
      const proc = Bun.spawn(["bun", "test", fixture, ...args], {
        cwd: ROOT,
        env: { ...process.env, VERIFICATION_ANNOTATIONS_FILE: sink },
        stdout: "pipe",
        stderr: "pipe",
      })
      const output = await new Response(proc.stderr).text()
      const code = await proc.exited
      if (code !== 0) console.error(output)
      return { code, output }
    }

    const all = await run([])
    expect(all.code).toBe(0)
    expect(all.output).toContain("2 pass")

    const records = collectAnnotations(readFileSync(sink, "utf8"))
    expect(records.map((r) => r.test)).toEqual(["a governed case", "another governed case"])
    expect(records.map((r) => r.scenarios)).toEqual([
      [{ id: "EAP-FUNC-001", kind: "asserts" }],
      [{ id: "EAP-SEC-001", kind: "covers-partially" }],
    ])
    // The file is captured from the caller, not from cwd or from the title.
    expect(records.every((r) => r.file.endsWith("annotated.test.ts"))).toBe(true)

    // The name reaching the runner IS the name recorded: filtering the runner by the recorded
    // name selects exactly that case, which a drifted title could not do.
    const filtered = await run(["-t", "another governed case"])
    expect(filtered.code).toBe(0)
    expect(filtered.output).toContain("1 pass")
    const afterFilter = collectAnnotations(readFileSync(sink, "utf8"))
    expect(afterFilter.length).toBe(3)
    expect(afterFilter[2]!.test).toBe("another governed case")
  }, 60000)
})

describe("collectable sink across packages [acceptance 3]", () => {
  test("the helper is importable from graph-core, mcp-server and client test dirs", () => {
    for (const pkg of ["graph-core", "mcp-server", "client"]) {
      const specifier = resolve(ROOT, "packages", pkg, "test", "../../mcp-server/test/verification/annotate.ts")
      expect(existsSync(specifier)).toBe(true)
      expect(specifier).toBe(join(ROOT, "packages", "mcp-server", "test", "verification", "annotate.ts"))
    }
  })

  test("annotations from graph-core, mcp-server and client suites land in one sink", async () => {
    const sink = scratchSink("cross-package")
    const fixture = join(scratch, "cross-package.test.ts")
    writeFileSync(
      fixture,
      `import { expect, test } from "bun:test"\n` +
        `const mod = await import(${JSON.stringify(MODULE_URL)})\n` +
        `const pkg = process.env.F002_PKG\n` +
        `test("cross-package emission from " + pkg, () => {\n` +
        `  // The default sink is the repo root one, whatever package cwd the suite runs from.\n` +
        `  expect(mod.defaultAnnotationsFile()).toBe(${JSON.stringify(join(ROOT, ".verification", "annotations.jsonl"))})\n` +
        `  mod.emitAnnotation("packages/" + pkg + "/test/cross-package.test.ts", "cross-package emission from " + pkg, {\n` +
        `    asserts: ["EAP-FUNC-001"],\n` +
        `  })\n` +
        `})\n`,
      "utf8",
    )

    const packages = ["graph-core", "mcp-server", "client"]
    const statuses = await Promise.all(
      packages.map(async (pkg) => {
        const proc = Bun.spawn(["bun", "test", fixture], {
          cwd: join(ROOT, "packages", pkg),
          env: { ...process.env, F002_PKG: pkg, VERIFICATION_ANNOTATIONS_FILE: sink },
          stdout: "pipe",
          stderr: "pipe",
        })
        const code = await proc.exited
        if (code !== 0) console.error(await new Response(proc.stderr).text())
        return code
      }),
    )
    expect(statuses).toEqual([0, 0, 0])

    const records: AnnotationRecord[] = collectAnnotations(readFileSync(sink, "utf8"))
    expect(records.length).toBe(3)
    expect(records.map((r) => r.file).sort()).toEqual([
      "packages/client/test/cross-package.test.ts",
      "packages/graph-core/test/cross-package.test.ts",
      "packages/mcp-server/test/cross-package.test.ts",
    ])
    expect(records.every((r) => r.scenarios.length === 1)).toBe(true)
  }, 60000)
})

describe("ignore rules for verification state [acceptance 3]", () => {
  const checkIgnore = (path: string): boolean =>
    Bun.spawnSync(["git", "check-ignore", "-q", path], { cwd: ROOT }).exitCode === 0

  beforeEach(() => {
    mkdirSync(join(ROOT, ".verification"), { recursive: true })
  })

  test("`.verification/` is ignored and `docs/verification/` is not", () => {
    expect(checkIgnore(".verification/annotations.jsonl")).toBe(true)
    expect(checkIgnore("docs/verification/scenario-register.json")).toBe(false)
    expect(checkIgnore("docs/verification/quarantine.json")).toBe(false)
  })
})

describe("collection", () => {
  test("skips blank lines and fails loudly on a corrupt line", () => {
    expect(collectAnnotations("\n\n")).toEqual([])
    expect(() => collectAnnotations("{not json}\n")).toThrow(/line 1/)
  })
})
