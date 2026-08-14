import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

import {
  FINGERPRINTS_PATH,
  TARGET_FILES,
  compareFingerprints,
  fingerprintFile,
  fingerprintSource,
  loadFingerprintStore,
  type AssertionEntry,
  type Fingerprint,
} from "./assertion-fingerprint"

// F002 task 12 — Implement the Assertion Fingerprint Tool.
// Discharges 004 §1.2:
//   "Should compare `AssertionFingerprint` values order-insensitively when a file is reformatted"
//   "Should report a changed hash and the missing assertion when one `expect()` is removed"
//   "Should reject a subset match when fingerprint comparison runs"
// and 004 §1.3 "Should carry no state between executions when a verification service runs twice".
//
// The seven f001-* files are READ-ONLY here. Every mutation below is applied to an in-memory
// copy of their source text; nothing in this suite writes into packages/mcp-server/test.

const repoRoot = join(import.meta.dir, "..", "..")
const read = (relative: string): string => readFileSync(join(repoRoot, relative), "utf8")

// Task 13 renamed this file from `f001-retry5-durability.test.ts`. Only the path moved: the
// baseline record keeps its `id` and its multiset, so every expectation below is unchanged.
const DURABILITY = "packages/mcp-server/test/epistemic-state-durability-and-bounds.test.ts"

/** Reprints a source file through the TypeScript printer: a total, mechanical reformatting. */
const reformat = (source: string): string => {
  const sf = ts.createSourceFile("x.test.ts", source, ts.ScriptTarget.Latest, true)
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true })
  return sf.statements.map((s) => printer.printNode(ts.EmitHint.Unspecified, s, sf)).join("\n\n")
}

/** Reprints a source file with its top-level statements in reverse order. */
const reorder = (source: string): string => {
  const sf = ts.createSourceFile("x.test.ts", source, ts.ScriptTarget.Latest, true)
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
  return [...sf.statements]
    .reverse()
    .map((s) => printer.printNode(ts.EmitHint.Unspecified, s, sf))
    .join("\n\n")
}

/** Deletes the nth `expect(...)` statement from a source, returning the removed line. */
const deleteNthExpect = (source: string, n: number): { mutated: string; removed: string } => {
  const lines = source.split("\n")
  let seen = 0
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*expect\(/.test(lines[i]!)) continue
    if (seen++ !== n) continue
    const removed = lines[i]!
    lines.splice(i, 1)
    return { mutated: lines.join("\n"), removed }
  }
  throw new Error(`fixture: source has fewer than ${n + 1} single-line expect() statements`)
}

const total = (entries: AssertionEntry[]): number => entries.reduce((a, e) => a + e.count, 0)

describe("AssertionFingerprint — order-insensitive multiset of (matcher, normalized-subject)", () => {
  test("the pair is the matcher plus the normalised subject, counted with multiplicity", () => {
    const fp = fingerprintSource(`
      test("a", () => {
        expect(user.name).toBe("ada")
        expect(user.name).toBe("ada")
        expect(user.age).toEqual(36)
      })
    `)
    expect(fp.expectCount).toBe(3)
    expect(fp.assertions).toEqual([
      { matcher: "toBe", subject: 'user.name', count: 2 },
      { matcher: "toEqual", subject: "user.age", count: 1 },
    ])
  })

  test("test reordering inside a file does not change the hash", () => {
    const a = fingerprintSource(`
      test("one", () => { expect(x).toBe(1) })
      test("two", () => { expect(y).toEqual([2]) })
    `)
    const b = fingerprintSource(`
      test("two", () => { expect(y).toEqual([2]) })
      test("one", () => { expect(x).toBe(1) })
    `)
    expect(b.hash).toBe(a.hash)
  })

  test("reformatting — indentation, line breaks, quote style, comments, trailing commas — does not change the hash", () => {
    const a = fingerprintSource(`test("t", () => { expect(callTool(s.url, 'cognitive.recall', { token: t })).toBe(true) })`)
    const b = fingerprintSource(`
      test("t", () => {
        expect(
          // the same call, wrapped and re-quoted
          callTool(
            s.url,
            "cognitive.recall",
            {
              token: t,
            },
          ),
        ).toBe(
          true,
        )
      })
    `)
    expect(b.hash).toBe(a.hash)
  })

  // The TypeScript printer re-emits the trailing comma of any list format that permits one, so a
  // formatter's dangling comma would otherwise survive normalisation and break equality. These are
  // exactly the four expression-position constructs that carry `hasTrailingComma` through the AST.
  test.each([
    ["object literal", "{ a: 1 }", "{ a: 1, }"],
    ["array literal", "[1, 2]", "[1, 2, ]"],
    ["object binding pattern", "xs.map(({ a }) => a)", "xs.map(({ a, }) => a)"],
    ["array binding pattern", "xs.map(([a]) => a)", "xs.map(([a, ]) => a)"],
    ["nested combination", "{ a: [{ b: 1 }] }", "{ a: [{ b: 1, }, ], }"],
  ])("a trailing comma in a %s does not change the hash", (_name, tight, dangling) => {
    const a = fingerprintSource(`test("t", () => { expect(${tight}).toEqual(z) })`)
    const b = fingerprintSource(`test("t", () => { expect(${dangling}).toEqual(z) })`)
    expect(b.assertions).toEqual(a.assertions)
    expect(b.hash).toBe(a.hash)
  })

  test("a different subject is a different pair — normalisation does not collapse distinct calls", () => {
    const a = fingerprintSource(`test("t", () => { expect(foo("a")).toBe(1) })`)
    const b = fingerprintSource(`test("t", () => { expect(foo("b")).toBe(1) })`)
    expect(b.hash).not.toBe(a.hash)
  })

  test("the matcher chain is part of the pair: `.not`, `.resolves` and `.rejects` are distinguished", () => {
    const plain = fingerprintSource(`test("t", () => { expect(p).toThrow() })`)
    const negated = fingerprintSource(`test("t", () => { expect(p).not.toThrow() })`)
    const rejected = fingerprintSource(`test("t", () => { expect(p).rejects.toThrow() })`)
    const resolved = fingerprintSource(`test("t", () => { expect(p).resolves.toThrow() })`)

    expect(plain.assertions[0]!.matcher).toBe("toThrow")
    expect(negated.assertions[0]!.matcher).toBe("not.toThrow")
    expect(rejected.assertions[0]!.matcher).toBe("rejects.toThrow")
    expect(resolved.assertions[0]!.matcher).toBe("resolves.toThrow")
    expect(new Set([plain.hash, negated.hash, rejected.hash, resolved.hash]).size).toBe(4)
  })

  test("an awaited subject is not the same assertion as an unawaited one", () => {
    const a = fingerprintSource(`test("t", () => { expect(await run()).toBe(1) })`)
    const b = fingerprintSource(`test("t", () => { expect(run()).toBe(1) })`)
    expect(b.hash).not.toBe(a.hash)
  })

  // Pinned blind spots. These assertions do not celebrate the limitation — they make it explicit,
  // so it cannot widen silently. The tool proves no assertion was DROPPED, not that none was WEAKENED.
  test("known collisions are pinned: matcher arguments and numeric separators are not distinguished", () => {
    // The subject is the expect() argument list only, so the matcher's own argument is invisible.
    expect(fingerprintSource(`test("t", () => { expect(a).toBe(true) })`).hash).toBe(
      fingerprintSource(`test("t", () => { expect(a).toBe(false) })`).hash,
    )
    // The printer normalises numeric separators, but not radix.
    expect(fingerprintSource(`test("t", () => { expect(1_000).toBe(x) })`).hash).toBe(
      fingerprintSource(`test("t", () => { expect(1000).toBe(x) })`).hash,
    )
    expect(fingerprintSource(`test("t", () => { expect(0x10).toBe(x) })`).hash).not.toBe(
      fingerprintSource(`test("t", () => { expect(16).toBe(x) })`).hash,
    )
  })

  test("running twice over identical input yields an identical result — no state carries over", () => {
    const source = read(DURABILITY)
    const first = fingerprintSource(source)
    const second = fingerprintSource(source)
    expect(second).toEqual(first)
  })
})

describe("AssertionFingerprint — stability against the real f001 corpus", () => {
  // 004: "Given a fingerprinted test file whose tests are reordered and whose formatting changes
  //       without adding or removing any expect() ... the hash is unchanged"
  for (const relative of TARGET_FILES) {
    test(`${relative.split("/").pop()} survives reformatting and statement reordering`, () => {
      const source = read(relative)
      const base = fingerprintSource(source)
      expect(base.expectCount).toBeGreaterThan(0)
      expect(fingerprintSource(reformat(source)).hash).toBe(base.hash)
      expect(fingerprintSource(reorder(source)).hash).toBe(base.hash)
    })
  }

  test("the parser sees every expect() call in the corpus — no construct is invisible to it", () => {
    for (const relative of TARGET_FILES) {
      const source = read(relative)
      // Raw textual count of call-position `expect(`, excluding `expect.arrayContaining` etc.
      const raw = [...source.matchAll(/\bexpect\s*\(/g)].length
      expect({ file: relative, parsed: fingerprintSource(source).expectCount }).toEqual({
        file: relative,
        parsed: raw,
      })
    }
  })

  test("a subject spanning several lines is normalised to one canonical form", () => {
    const source = read("packages/mcp-server/test/read-model-projection-and-freshness.test.ts")
    for (const entry of fingerprintSource(source).assertions) {
      expect(entry.subject).not.toContain("\n")
      expect(entry.subject).not.toMatch(/\s{2}/)
    }
  })
})

describe("Comparison — equality only, a subset is never accepted", () => {
  // 004: "Should report a changed hash and the missing assertion when one expect() is removed"
  test("deleting exactly one expect() changes the hash and names the missing pair", () => {
    const source = read(DURABILITY)
    const before = fingerprintSource(source)
    const { mutated, removed } = deleteNthExpect(source, 0)
    const after = fingerprintSource(mutated)

    expect(after.hash).not.toBe(before.hash)
    expect(after.expectCount).toBe(before.expectCount - 1)

    const result = compareFingerprints(before, after)
    expect(result.equal).toBe(false)
    expect(result.added).toEqual([])
    expect(total(result.missing)).toBe(1)
    // The report names the pair, so a reviewer reads what was dropped, not merely that something was.
    const [missing] = result.missing
    expect(removed).toContain(missing!.matcher.split(".").pop()!)
    expect(removed.replace(/\s+/g, "")).toContain(missing!.subject.replace(/\s+/g, ""))
  })

  test("deleting one of several identical assertions is still detected, by multiplicity", () => {
    const before = fingerprintSource(`
      test("t", () => {
        expect(r.ok).toBe(true)
        expect(r.ok).toBe(true)
      })
    `)
    const after = fingerprintSource(`test("t", () => { expect(r.ok).toBe(true) })`)
    const result = compareFingerprints(before, after)
    expect(result.equal).toBe(false)
    expect(result.missing).toEqual([{ matcher: "toBe", subject: "r.ok", count: 1 }])
  })

  // 004: "Should reject a subset match when fingerprint comparison runs"
  test("a proper subset fails comparison — equality is required", () => {
    const source = read(DURABILITY)
    const before = fingerprintSource(source)
    const after = fingerprintSource(deleteNthExpect(deleteNthExpect(source, 0).mutated, 0).mutated)

    // Every surviving pair is present in the original: `after` really is a proper subset.
    for (const entry of after.assertions) {
      const twin = before.assertions.find(
        (e) => e.matcher === entry.matcher && e.subject === entry.subject,
      )
      expect(twin?.count ?? 0).toBeGreaterThanOrEqual(entry.count)
    }
    const result = compareFingerprints(before, after)
    expect(result.equal).toBe(false)
    expect(result.missing.length).toBeGreaterThan(0)
  })

  test("an added assertion is reported too — a superset is not equal either", () => {
    const before = fingerprintSource(`test("t", () => { expect(a).toBe(1) })`)
    const after = fingerprintSource(`test("t", () => { expect(a).toBe(1); expect(b).toBe(2) })`)
    const result = compareFingerprints(before, after)
    expect(result.equal).toBe(false)
    expect(result.missing).toEqual([])
    expect(result.added).toEqual([{ matcher: "toBe", subject: "b", count: 1 }])
  })

  test("an unchanged multiset compares equal regardless of file path — a pure rename drops nothing", () => {
    const source = read(DURABILITY)
    const before: Fingerprint = fingerprintFile(repoRoot, DURABILITY)
    const after = fingerprintSource(source, "packages/mcp-server/test/recall-durability.test.ts")
    const result = compareFingerprints(before, after)
    expect(result.equal).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.added).toEqual([])
    expect(after.hash).toBe(before.hash)
  })
})

describe("Baseline store — captured for all seven f001-* files before any rename", () => {
  const store = loadFingerprintStore(repoRoot)

  test(`${FINGERPRINTS_PATH} holds exactly the seven f001-* files`, () => {
    expect(store.files.map((f) => f.path).sort()).toEqual([...TARGET_FILES].sort())
  })

  test("every stored fingerprint still matches the file on disk", () => {
    for (const entry of store.files) {
      const measured = fingerprintFile(repoRoot, entry.path)
      const result = compareFingerprints(entry, measured)
      expect({ path: entry.path, missing: result.missing, added: result.added }).toEqual({
        path: entry.path,
        missing: [],
        added: [],
      })
      expect(measured.hash).toBe(entry.hash)
    }
  })

  test("each entry carries a stable id that survives the task 13 rename", () => {
    for (const entry of store.files) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/)
      expect(entry.capturedAt).toBeDefined()
    }
    expect(new Set(store.files.map((f) => f.id)).size).toBe(store.files.length)
  })

  test("the store records the five files task 13 renames and the two that stay", () => {
    // Identity, not path: `id` is the stable key the rename was designed to preserve, so this
    // still selects exactly the five retry-era files after task 13 rekeyed their paths.
    const retry = store.files.filter((f) => f.id.includes("f001-retry"))
    expect(retry).toHaveLength(5)
    expect(store.files).toHaveLength(7)
    // The rename landed and is recorded, rather than the archaeology having merely been dropped:
    // no live path still carries it, and every one of the five names the path it came from.
    expect(store.files.filter((f) => f.path.includes("f001-retry"))).toHaveLength(0)
    for (const entry of retry) {
      expect(entry.previousPaths).toHaveLength(1)
      expect(entry.previousPaths[0]).toContain(entry.id)
    }
  })
})
