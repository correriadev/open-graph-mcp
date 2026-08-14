#!/usr/bin/env bun
/**
 * F002 task 12 — Implement the Assertion Fingerprint Tool.
 *
 * Captures the `AssertionFingerprint` of a test file: an ORDER-INSENSITIVE MULTISET of
 * `(matcher, normalized-subject)` pairs (003 §2, Snippet H). Its single purpose is to make
 * task 13's rename of the retry-era regression tests mechanically falsifiable — because a suite
 * that still passes after a rename proves only that what remains passes (001 SQ7).
 *
 * Comparison is SUBSET-FREE EQUALITY. A post-change multiset that is a proper subset of the
 * pre-change multiset FAILS, with the missing pairs named.
 *
 *   bun scripts/verification/assertion-fingerprint.ts            capture / refresh the baseline
 *   bun scripts/verification/assertion-fingerprint.ts --check    verify the committed baseline
 *   bun scripts/verification/assertion-fingerprint.ts --rename <old> <new>
 *                                                                prove a rename dropped nothing,
 *                                                                then move the stored path
 *
 * ── Normalisation rule (the load-bearing design decision) ──────────────────────────────────────
 * The subject is the argument list of the `expect(...)` call, re-printed from the TypeScript AST
 * through `ts.createPrinter`, with:
 *   - comments removed,
 *   - redundant parentheses unwrapped,
 *   - string literals re-emitted double-quoted and escaped (so a quote-style reformat is inert),
 *   - trailing commas dropped from object literals, array literals and binding patterns,
 *   - every newline-plus-indentation run collapsed to a single space.
 * Everything else is kept verbatim: `await`, `!`, `as any`, property paths, numeric and template
 * literals, and the full argument text. The matcher is the property chain from the `expect()` call
 * to the invoked method, so `toBe`, `not.toBe`, `rejects.toThrow` and `resolves.toThrow` are four
 * different matchers.
 *
 * What this normalisation CANNOT distinguish — the accepted blind spots, stated so a reviewer knows
 * what the green gate does not cover:
 *   - Two textually identical assertions are one entry with count 2; which test case each belongs to
 *     is not part of the pair (004 defines it as `(matcher, normalized-subject)` only). Deleting
 *     either copy still drops the count 2 -> 1, so a loss is still caught.
 *   - Numeric notation is normalised by the printer's literal handling: `1_000` and `1000` collapse
 *     to the same subject. `0x10` and `16` do NOT collapse.
 *   - The matcher's own ARGUMENTS are not part of the pair — `toBe(true)` and `toBe(false)` share a
 *     pair. A rename cannot change them without changing the file's meaning, but a hand-edit could;
 *     this tool proves no assertion was DROPPED, not that none was WEAKENED.
 *   - Renaming a local variable (`s` -> `server`) changes the subject and so changes the hash. That
 *     is deliberate: identifier canonicalisation is exactly where a real deletion would hide.
 *
 * Where the line is drawn, and why: normalisation erases only what a formatter can change without
 * changing the assertion (layout, comments, quote style, redundant parens). It deliberately does
 * NOT canonicalise identifiers, argument order, or literal values — those are the very things a
 * silently-dropped or weakened assertion differs by, and collapsing them is how a real loss hides
 * behind a collision. The remaining, accepted looseness: two textually identical assertions in
 * different test cases are one multiset entry with count 2, and the test case a pair belongs to is
 * not part of the pair (004 defines the pair as `(matcher, normalized-subject)` only). That is what
 * makes the fingerprint survive test reordering and test renaming — which task 13 also performs —
 * while still detecting a deletion, since deleting either copy drops the count from 2 to 1.
 *
 * The parser is the TypeScript compiler API, never a regex: `expect()` calls appear awaited,
 * chained, nested inside arguments and wrapped over many lines, and a regex over that surface would
 * report a clean fingerprint for constructs it simply cannot see.
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

export const FINGERPRINTS_PATH = "docs/verification/assertion-fingerprints.json"

/**
 * The seven files of acceptance criterion 3, whose fingerprints were captured BEFORE task 13.
 *
 * Five encoded retry archaeology and task 13 renamed them; their paths below are the POST-rename
 * paths, because this list is the bootstrap target set — it is read only when no baseline exists
 * yet, and a list of paths that no longer resolve would make a clean-checkout capture throw. The
 * pre-rename paths are not lost: each record in the baseline keeps its stable `id` and carries the
 * old path in `previousPaths`, which is the whole point of `--rename`. The remaining two `f001-*`
 * files were already named behaviourally and were not renamed.
 */
export const TARGET_FILES: readonly string[] = [
  "packages/mcp-server/test/epistemic-state-durability-and-bounds.test.ts",
  "packages/mcp-server/test/epistemic-write-atomicity-and-authz.test.ts",
  "packages/mcp-server/test/read-model-projection-and-freshness.test.ts",
  "packages/mcp-server/test/recall-closure-gate.test.ts",
  "packages/mcp-server/test/recall-resume-and-closure-index.test.ts",
  "packages/mcp-server/test/f001-transport-delegation.test.ts",
  "packages/mcp-server/test/f001-validation-audit-vulns.test.ts",
]

/** One `(matcher, normalized-subject)` pair with its multiplicity. */
export interface AssertionEntry {
  matcher: string
  subject: string
  count: number
}

export interface Fingerprint {
  hash: string
  expectCount: number
  distinctAssertions: number
  assertions: AssertionEntry[]
}

export interface FingerprintRecord extends Fingerprint {
  /** Stable across the task 13 rename: the path moves, this does not. */
  id: string
  path: string
  previousPaths: string[]
  capturedAt: string
}

export interface FingerprintStore {
  version: number
  generator: string
  policy: string
  normalization: string
  files: FingerprintRecord[]
}

export interface FingerprintComparison {
  equal: boolean
  hashChanged: boolean
  /** Pairs present before and absent (or less frequent) after — an assertion was dropped. */
  missing: AssertionEntry[]
  /** Pairs the change introduced. Reported, but never a failure on its own. */
  added: AssertionEntry[]
}

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true })

/**
 * Erases exactly what a formatter may rewrite without changing the assertion: redundant
 * parentheses, quote style, and dangling trailing commas. Nothing else is touched.
 *
 * The trailing comma matters because the printer is not a pure function of the AST shape: a
 * `NodeArray` carries `hasTrailingComma`, and every list format that permits one re-emits it. Those
 * formats, in expression position, are exactly the four rebuilt below — object and array literals
 * and the two binding patterns. Argument lists, parameter lists and type-argument lists do not
 * permit a trailing comma on emit, so they need no handling (asserted by the test matrix).
 */
const canonicalise: ts.TransformerFactory<ts.Node> = (context) => {
  const { factory } = context
  /** Same elements, no trailing comma — the one bit of list state the printer would echo back. */
  const commaless = <T extends ts.Node>(nodes: ts.NodeArray<T>): ts.NodeArray<T> =>
    nodes.hasTrailingComma ? factory.createNodeArray(nodes, false) : nodes

  const visit = (node: ts.Node): ts.Node => {
    const visited = ts.visitEachChild(node, visit, context)
    if (ts.isParenthesizedExpression(visited)) return visited.expression
    if (ts.isStringLiteral(visited)) return factory.createStringLiteral(visited.text)
    if (ts.isObjectLiteralExpression(visited))
      return factory.updateObjectLiteralExpression(visited, commaless(visited.properties))
    if (ts.isArrayLiteralExpression(visited))
      return factory.updateArrayLiteralExpression(visited, commaless(visited.elements))
    if (ts.isObjectBindingPattern(visited))
      return factory.updateObjectBindingPattern(visited, commaless(visited.elements))
    if (ts.isArrayBindingPattern(visited))
      return factory.updateArrayBindingPattern(visited, commaless(visited.elements))
    return visited
  }
  return (node) => ts.visitNode(node, visit) as ts.Node
}

function normalizeSubject(nodes: readonly ts.Expression[], sourceFile: ts.SourceFile): string {
  const parts = nodes.map((node) => {
    const result = ts.transform(node, [canonicalise])
    const transformed = (result.transformed[0] ?? node) as ts.Node
    const text = printer.printNode(ts.EmitHint.Unspecified, transformed, sourceFile)
    result.dispose()
    // Layout only: a newline plus its indentation becomes one space. Newlines inside string
    // literals are escaped by the printer, so literal content is never touched by this.
    return text.replace(/\r?\n\s*/g, " ").trim()
  })
  return parts.join(", ")
}

/**
 * Walks up from an `expect(...)` call through its property chain to the matcher invocation.
 * `expect(x).not.toBe(1)` yields `not.toBe`; a bare `expect(x)` with no matcher yields `<none>`,
 * which is itself worth fingerprinting — an assertion that asserts nothing is still a pair that
 * must not silently vanish.
 */
function matcherChainOf(expectCall: ts.CallExpression): string {
  const names: string[] = []
  let current: ts.Node = expectCall
  let parent = current.parent
  while (parent && ts.isPropertyAccessExpression(parent) && parent.expression === current) {
    names.push(parent.name.text)
    current = parent
    parent = current.parent
    if (parent && ts.isCallExpression(parent) && parent.expression === current) break
  }
  return names.length === 0 ? "<none>" : names.join(".")
}

export function extractAssertions(
  source: string,
  fileName = "in-memory.test.ts",
): { matcher: string; subject: string }[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const pairs: { matcher: string; subject: string }[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "expect") {
      pairs.push({
        matcher: matcherChainOf(node),
        subject: normalizeSubject(node.arguments, sourceFile),
      })
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)
  return pairs
}

export function toMultiset(pairs: readonly { matcher: string; subject: string }[]): AssertionEntry[] {
  const counts = new Map<string, AssertionEntry>()
  for (const pair of pairs) {
    const key = `${pair.matcher} ${pair.subject}`
    const existing = counts.get(key)
    if (existing) existing.count += 1
    else counts.set(key, { matcher: pair.matcher, subject: pair.subject, count: 1 })
  }
  return [...counts.values()].sort((a, b) =>
    a.matcher === b.matcher
      ? a.subject < b.subject
        ? -1
        : a.subject > b.subject
          ? 1
          : 0
      : a.matcher < b.matcher
        ? -1
        : 1,
  )
}

/** Hashes the multiset alone. Path, test names, ordering and layout are all excluded by design. */
export function hashMultiset(assertions: readonly AssertionEntry[]): string {
  const canonical = assertions
    .map((e) => `${e.count} ${e.matcher} ${e.subject}`)
    .sort()
    .join("\n")
  return createHash("sha256").update(canonical, "utf8").digest("hex")
}

export function fingerprintSource(source: string, fileName = "in-memory.test.ts"): Fingerprint {
  const pairs = extractAssertions(source, fileName)
  const assertions = toMultiset(pairs)
  return {
    hash: hashMultiset(assertions),
    expectCount: pairs.length,
    distinctAssertions: assertions.length,
    assertions,
  }
}

export function fingerprintFile(repoRoot: string, relativePath: string): Fingerprint {
  const absolute = join(repoRoot, relativePath)
  if (!existsSync(absolute)) {
    throw new Error(
      `assertion fingerprint: ${relativePath} does not exist. If it was renamed, run ` +
        `\`bun scripts/verification/assertion-fingerprint.ts --rename <old> <new>\` so the move is ` +
        "proved to have dropped nothing rather than recaptured blind.",
    )
  }
  return fingerprintSource(readFileSync(absolute, "utf8"), relativePath)
}

/**
 * Subset-free equality (003 §2: "comparison is subset-free equality"). A proper subset produces
 * `equal: false` with every dropped pair named — the whole point of the tool.
 */
export function compareFingerprints(
  before: Pick<Fingerprint, "hash" | "assertions">,
  after: Pick<Fingerprint, "hash" | "assertions">,
): FingerprintComparison {
  const index = (entries: readonly AssertionEntry[]): Map<string, AssertionEntry> =>
    new Map(entries.map((e) => [`${e.matcher} ${e.subject}`, e]))

  const beforeIndex = index(before.assertions)
  const afterIndex = index(after.assertions)
  const missing: AssertionEntry[] = []
  const added: AssertionEntry[] = []

  for (const [key, entry] of beforeIndex) {
    const delta = entry.count - (afterIndex.get(key)?.count ?? 0)
    if (delta > 0) missing.push({ matcher: entry.matcher, subject: entry.subject, count: delta })
  }
  for (const [key, entry] of afterIndex) {
    const delta = entry.count - (beforeIndex.get(key)?.count ?? 0)
    if (delta > 0) added.push({ matcher: entry.matcher, subject: entry.subject, count: delta })
  }

  return {
    equal: missing.length === 0 && added.length === 0,
    hashChanged: before.hash !== after.hash,
    missing,
    added,
  }
}

export function idFor(relativePath: string): string {
  return (relativePath.split("/").pop() ?? relativePath).replace(/\.test\.ts$/, "")
}

export function loadFingerprintStore(repoRoot: string): FingerprintStore {
  const path = join(repoRoot, FINGERPRINTS_PATH)
  if (!existsSync(path)) {
    throw new Error(`assertion fingerprint: no baseline at ${FINGERPRINTS_PATH}.`)
  }
  return JSON.parse(readFileSync(path, "utf8")) as FingerprintStore
}

export function writeFingerprintStore(repoRoot: string, store: FingerprintStore): void {
  writeFileSync(join(repoRoot, FINGERPRINTS_PATH), `${JSON.stringify(store, null, 2)}\n`, "utf8")
}

export function buildStore(
  repoRoot: string,
  targets: readonly string[],
  previous?: FingerprintStore,
): FingerprintStore {
  const files = targets.map((path) => {
    const id = idFor(path)
    const prior = previous?.files.find((f) => f.id === id)
    return {
      id,
      path,
      previousPaths: prior?.previousPaths ?? [],
      capturedAt: prior?.capturedAt ?? new Date().toISOString(),
      ...fingerprintFile(repoRoot, path),
    }
  })
  return {
    version: 1,
    generator: "scripts/verification/assertion-fingerprint.ts",
    policy:
      "Baseline captured before task 13 renames the retry-era regression tests. Comparison is " +
      "subset-free equality: a post-rename multiset that is a proper subset FAILS with the missing " +
      "(matcher, normalized-subject) pairs named. A rename updates `path` and keeps `hash`.",
    normalization:
      "matcher = property chain from the expect() call to the invoked matcher (not/resolves/rejects " +
      "preserved). subject = expect() arguments re-printed from the TypeScript AST with comments " +
      "removed, redundant parentheses unwrapped, string literals re-emitted double-quoted, " +
      "trailing commas dropped from object/array literals and binding patterns, and " +
      "newline+indentation runs collapsed to one space. Identifiers, argument order and literal " +
      "values are NOT canonicalised. Order-insensitive; multiplicity is significant.",
    files,
  }
}

function reportComparison(label: string, result: FingerprintComparison): void {
  for (const entry of result.missing) {
    console.error(`  [missing x${entry.count}] ${label}: expect(${entry.subject}).${entry.matcher}(...)`)
  }
  for (const entry of result.added) {
    console.error(`  [added   x${entry.count}] ${label}: expect(${entry.subject}).${entry.matcher}(...)`)
  }
}

function main(): number {
  const repoRoot = join(import.meta.dir, "..", "..")
  const argv = process.argv.slice(2)
  const renameAt = argv.indexOf("--rename")

  if (renameAt !== -1) {
    const oldPath = argv[renameAt + 1]
    const newPath = argv[renameAt + 2]
    if (!oldPath || !newPath) throw new Error("--rename requires <oldPath> <newPath>")
    const store = loadFingerprintStore(repoRoot)
    const record = store.files.find((f) => f.path === oldPath)
    if (!record) throw new Error(`assertion fingerprint: no baseline entry for ${oldPath}`)
    const measured = fingerprintFile(repoRoot, newPath)
    const result = compareFingerprints(record, measured)
    if (!result.equal) {
      console.error(`\nassertion fingerprint: FAIL — AssertionSetReduced for ${oldPath} -> ${newPath}`)
      reportComparison(newPath, result)
      console.error(
        "  The suite passing after this rename proves only that what remains passes. Restore the " +
          "assertions above before the rename is accepted.",
      )
      return 1
    }
    record.previousPaths = [...record.previousPaths, oldPath]
    record.path = newPath
    writeFingerprintStore(repoRoot, store)
    console.log(`assertion fingerprint: RetryArchaeologyRetired — ${oldPath} -> ${newPath}`)
    console.log(`  hash unchanged: ${record.hash}`)
    return 0
  }

  if (argv.includes("--check")) {
    const store = loadFingerprintStore(repoRoot)
    let failures = 0
    for (const record of store.files) {
      const measured = fingerprintFile(repoRoot, record.path)
      const result = compareFingerprints(record, measured)
      if (result.equal && !result.hashChanged) {
        console.log(`  ${record.path} -> ${measured.expectCount} expect(), hash unchanged`)
        continue
      }
      failures += 1
      console.error(`\nassertion fingerprint: FAIL — ${record.path}`)
      reportComparison(record.path, result)
    }
    if (failures > 0) {
      console.error(`\nassertion fingerprint: ${failures} file(s) drifted from the committed baseline.`)
      return 1
    }
    console.log(`\nassertion fingerprint: PASS — ${store.files.length} file(s) match the baseline.`)
    return 0
  }

  const previous = existsSync(join(repoRoot, FINGERPRINTS_PATH))
    ? loadFingerprintStore(repoRoot)
    : undefined
  const targets = previous ? previous.files.map((f) => f.path) : [...TARGET_FILES]
  const store = buildStore(repoRoot, targets, previous)
  writeFingerprintStore(repoRoot, store)
  const totalExpects = store.files.reduce((a, f) => a + f.expectCount, 0)
  console.log(
    `Wrote ${FINGERPRINTS_PATH} — ${store.files.length} file(s), ${totalExpects} expect() call(s).`,
  )
  for (const f of store.files) console.log(`  ${f.path}  ${f.expectCount} expect()  ${f.hash.slice(0, 12)}`)
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
