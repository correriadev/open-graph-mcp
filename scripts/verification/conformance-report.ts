#!/usr/bin/env bun
/**
 * F002 task 10 — Transcribe Apêndice D into a Conformance Manifest.
 *
 *   bun scripts/verification/conformance-report.ts           -> print the manifest report
 *   bun scripts/verification/conformance-report.ts --check   -> exit non-zero on any violation
 *
 * ── Why this file exists ──────────────────────────────────────────────────────────────────────
 * Apêndice D of the Working Paper is a five-paragraph checklist written as prose: each level is a
 * single sentence of semicolon-separated clauses. Prose is not assessable. This task turns it into
 * one manifest row per clause so that a later task (11) can attribute a *test case* to a *clause*
 * rather than to a paragraph, and so that "we pass L2" stops being a sentence somebody wrote and
 * becomes a set of rows each of which is separately true or false.
 *
 * Two things this file refuses to do, both of which would quietly destroy the point:
 *
 *  1. **It does not reword.** Every item carries the clause VERBATIM in the Working Paper's
 *     Portuguese. Any English is confined to `restatementEn`, clearly marked, and is never what a
 *     later assessment binds to. `validateManifest` re-derives the clause list from the document on
 *     disk and fails if a single item's `clause` is not literally present — a paraphrase that
 *     "means the same thing" is exactly the failure mode of a hand-maintained checklist, so the
 *     check is byte equality and not similarity.
 *
 *  2. **It does not accept self-report.** ADR-0021's governing rule and ADR-0007's option (c)
 *     rejection — *autorrelato não conta, nunca* — mean an evidence predicate has to name something
 *     an assessor can read out of the host's audit trail, request log, or the wire response. A
 *     predicate phrased as "the implementation does X" is rejected by `SELF_REPORT_PHRASES`,
 *     because that sentence is a claim about code, not an observation of a run.
 *
 * ── Versioning ────────────────────────────────────────────────────────────────────────────────
 * `docs/PRD/OpenGraph_Working_Paper_v1_0.md` is a read-only input. The manifest pins the sha256 of
 * the Apêndice D *section* (not the whole document, so unrelated edits do not churn it), following
 * the digest-pinning idiom `derive-status.ts` uses for the frozen spec. An edit to the appendix
 * therefore fails `--check` rather than leaving a transcription that silently no longer matches
 * what it claims to transcribe.
 *
 * ── What this file is NOT ─────────────────────────────────────────────────────────────────────
 * It performs **no assessment**. It loads, validates and reports the manifest. Task 11 runs the
 * checklist against real transport and attributes items to test cases; the seams left for it are
 * `renderReport`'s second parameter and the fact that every exported function here is pure and
 * takes its inputs explicitly. Nothing here writes to `docs/PRD/**`, `docs/adr/**` or
 * `docs/specs/**`.
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { repoRoot } from "./register-scenarios"

export const WORKING_PAPER_PATH = "docs/PRD/OpenGraph_Working_Paper_v1_0.md"
export const MANIFEST_PATH = "docs/verification/conformance-manifest.json"
export const REFUSAL_TAXONOMY_PATH = "packages/graph-core/src/eap/refusals.ts"
export const MANIFEST_SCHEMA_VERSION = 1
export const APPENDIX_HEADING = "## Apêndice D"

/** L4 is absent by construction: federation is `[C]` and does not pretend to graduate (ADR-0007). */
export const EXCLUDED_LEVELS = ["L4"] as const

export const TRANSCRIBED_LEVELS = ["L0", "L1", "L2", "L3"] as const
export const ALL_LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const

export type ConformanceLevel = (typeof ALL_LEVELS)[number]
export type ConformanceRole = "client" | "host"

export const CLAIM_STATES = ["claimed", "not-yet-claimed"] as const
export type ClaimState = (typeof CLAIM_STATES)[number]

/** Where an assessor looks. Every one of these is a record the host produces, never the agent. */
export const EVIDENCE_SURFACES = ["audit-log", "host-request-log", "wire-response", "host-egress-log"] as const
export type EvidenceSurface = (typeof EVIDENCE_SURFACES)[number]

/**
 * Phrasings that turn an evidence predicate back into a self-report. Lowercase; matched as
 * substrings against the lowercased predicate.
 */
export const SELF_REPORT_PHRASES = [
  "the implementation",
  "self-report",
  "claims to",
  "the vendor",
  "asserts that it",
  "documentation states",
] as const

// ── The read-only source ──────────────────────────────────────────────────────────────────────

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

export interface AppendixSection {
  path: string
  /** 1-based line of the `## Apêndice D` heading. */
  startLine: number
  /** 1-based line of the last line belonging to the section. */
  endLine: number
  text: string
  sha256: string
}

/**
 * The appendix, delimited by its own heading and the next `## ` heading (or end of document).
 * Hashing the section rather than the file means an edit *inside* Apêndice D breaks the pin while
 * an edit to §12 does not — the pin has to be sensitive to the thing transcribed and to nothing
 * else, or it gets disabled the first time it cries wolf.
 */
export function extractAppendixD(markdown: string, path: string = WORKING_PAPER_PATH): AppendixSection {
  const lines = markdown.split("\n")
  const start = lines.findIndex((line) => line.startsWith(APPENDIX_HEADING))
  if (start === -1) {
    throw new Error(
      `conformance: no "${APPENDIX_HEADING}" heading was found in ${path}. The manifest transcribes ` +
        "Apêndice D and nothing else; hashing an empty section would pin a document that does not " +
        "contain the checklist.",
    )
  }
  let end = lines.length - 1
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index]!.startsWith("## ")) {
      end = index - 1
      break
    }
  }
  while (end > start && lines[end]!.trim().length === 0) end -= 1

  const text = lines.slice(start, end + 1).join("\n")
  return { path, startLine: start + 1, endLine: end + 1, text, sha256: sha256(text) }
}

export interface ParsedClause {
  level: ConformanceLevel
  /** The level's own heading fragment, e.g. `cliente leitor`. Verbatim Portuguese. */
  levelTitle: string
  /** 1-based line in the source document that the level's sentence is written on. */
  sourceLine: number
  /** 1-based position of this clause within its level's sentence. */
  ordinal: number
  /** The semicolon-delimited clause, VERBATIM. Never translated, never normalised. */
  clause: string
}

const LEVEL_LINE = /^\*\*(L[0-4]) — ([^*]+):\*\*\s*(.+)$/

/**
 * One clause per semicolon. The Working Paper writes each level as a single sentence whose clauses
 * are semicolon-separated, so the split is the document's own structure and not an interpretation
 * imposed on it. Only the trailing full stop of the sentence is dropped — it belongs to the
 * sentence, not to the last clause, and keeping it would make the last clause of every level the
 * only one that cannot be grepped for as written.
 */
export function parseLevelClauses(section: AppendixSection): ParsedClause[] {
  const parsed: ParsedClause[] = []
  const lines = section.text.split("\n")
  for (const [offset, line] of lines.entries()) {
    const match = LEVEL_LINE.exec(line)
    if (!match) continue
    const level = match[1] as ConformanceLevel
    const levelTitle = match[2]!.trim()
    const sentence = match[3]!.trim().replace(/\.$/, "")
    const fragments = sentence.split(";").map((fragment) => fragment.trim()).filter((f) => f.length > 0)
    for (const [index, clause] of fragments.entries()) {
      parsed.push({
        level,
        levelTitle,
        sourceLine: section.startLine + offset,
        ordinal: index + 1,
        clause,
      })
    }
  }
  if (parsed.length === 0) {
    throw new Error(
      "conformance: Apêndice D contains no `**Lx — ...:**` level sentence. The checklist could not " +
        "be transcribed and nothing was reported.",
    )
  }
  return parsed
}

/**
 * ADR-0007, non-negotiable: L0–L1 certify **clients** (agents), L2–L4 certify **hosts**. No agent
 * certifies as a host — which is why the role is derived from the level here and can never be
 * authored per item into disagreeing with it.
 */
export function roleForLevel(level: ConformanceLevel): ConformanceRole {
  return level === "L0" || level === "L1" ? "client" : "host"
}

/**
 * The closed refusal taxonomy, read out of the implementation's own `REFUSAL_CODES` literal. Read
 * as text rather than imported because `scripts/` is outside the workspace's module resolution;
 * parsed from the single source of truth rather than copied, so a code renamed in `graph-core`
 * fails this manifest instead of silently disagreeing with it.
 */
export function loadRefusalTaxonomy(root: string = repoRoot()): string[] {
  const source = readFileSync(join(root, ...REFUSAL_TAXONOMY_PATH.split("/")), "utf8")
  const block = /export const REFUSAL_CODES = \[([\s\S]*?)\] as const/.exec(source)
  if (!block) {
    throw new Error(
      `conformance: could not find \`REFUSAL_CODES\` in ${REFUSAL_TAXONOMY_PATH}. The manifest names ` +
        "refusal codes from the closed taxonomy and will not validate against a guessed copy of it.",
    )
  }
  return [...block[1]!.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]!)
}

// ── The manifest ──────────────────────────────────────────────────────────────────────────────

export interface EvidencePredicate {
  surface: EvidenceSurface
  /** What an assessor reads out of the host's own records. Never a statement about source code. */
  predicate: string
}

export interface ItemClaim {
  state: ClaimState
  rationale: string
  /** `path:line` or `path:line-line` references behind the claim state. */
  evidenceRefs: string[]
}

export interface ConformanceItem {
  itemId: string
  level: ConformanceLevel
  role: ConformanceRole
  sourceLine: number
  ordinal: number
  /** VERBATIM Portuguese from Apêndice D. Never reworded, never reinterpreted. */
  clause: string
  /** English restatement for readers. Explanatory only; nothing binds to it. */
  restatementEn: string
  refusalCodes: string[]
  /** Required when `refusalCodes` is empty: why the clause touches no specific code. */
  refusalCodesNote: string | null
  evidence: EvidencePredicate
  claim: ItemClaim
}

export interface ExcludedLevel {
  level: string
  reason: string
}

export interface ConformanceManifest {
  schemaVersion: number
  generatedBy: string
  policy: string
  source: {
    path: string
    heading: string
    startLine: number
    endLine: number
    sha256: string
  }
  graduation: {
    marker: string
    graduated: boolean
    note: string
  }
  roles: Record<string, ConformanceRole>
  excludedLevels: ExcludedLevel[]
  items: ConformanceItem[]
}

export function loadManifest(raw: string): ConformanceManifest {
  const parsed = JSON.parse(raw) as Partial<ConformanceManifest>
  if (parsed.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `conformance: ${MANIFEST_PATH} declares schemaVersion ${String(parsed.schemaVersion)}, but this ` +
        `build reads version ${MANIFEST_SCHEMA_VERSION}. A manifest of an unknown shape is not ` +
        "silently reinterpreted.",
    )
  }
  if (!Array.isArray(parsed.items)) {
    throw new Error(`conformance: ${MANIFEST_PATH} has no \`items\` array.`)
  }
  if (parsed.source === undefined || parsed.graduation === undefined || !Array.isArray(parsed.excludedLevels)) {
    throw new Error(
      `conformance: ${MANIFEST_PATH} is missing \`source\`, \`graduation\` or \`excludedLevels\`; the ` +
        "digest pin and the graduation record are not optional.",
    )
  }
  return parsed as ConformanceManifest
}

// ── Validation ────────────────────────────────────────────────────────────────────────────────

const ID_SHAPE = /^EAP-(L[0-3])-(\d{3})$/
const EVIDENCE_REF = /^[\w./-]+:\d+(-\d+)?$/

/**
 * Every way this transcription can become a lie, checked against the document on disk. Returns the
 * violations rather than throwing, so `--check` can report all of them in one run instead of
 * revealing them one re-run at a time.
 */
export function validateManifest(
  manifest: ConformanceManifest,
  section: AppendixSection,
  taxonomy: readonly string[],
): string[] {
  const violations: string[] = []
  const add = (message: string): void => void violations.push(message)

  // ── The pin ──
  if (manifest.source.path !== section.path) {
    add(`source.path is \`${manifest.source.path}\`, but the appendix was read from \`${section.path}\`.`)
  }
  if (manifest.source.sha256 !== section.sha256) {
    add(
      `source.sha256 \`${manifest.source.sha256}\` does not match the Apêndice D section on disk ` +
        `(\`${section.sha256}\`). The Working Paper changed under a transcription that still claims ` +
        "to reproduce it; re-transcribe rather than re-hash.",
    )
  }
  if (manifest.source.startLine !== section.startLine || manifest.source.endLine !== section.endLine) {
    add(
      `source lines ${manifest.source.startLine}-${manifest.source.endLine} do not match the section ` +
        `found on disk (${section.startLine}-${section.endLine}).`,
    )
  }
  if (manifest.graduation.marker !== "[E → G2]" || manifest.graduation.graduated !== false) {
    add(
      "graduation must record Apêndice D as still marked `[E → G2]` and not graduated; the checklist " +
        "is a skeleton pending [G2] and the manifest may not promote it by describing it otherwise.",
    )
  }
  if (JSON.stringify(manifest.excludedLevels.map((entry) => entry.level)) !== JSON.stringify([...EXCLUDED_LEVELS])) {
    add(`excludedLevels must be exactly ${JSON.stringify(EXCLUDED_LEVELS)}.`)
  }
  for (const entry of manifest.excludedLevels) {
    if (entry.reason.trim().length === 0) add(`excludedLevels[${entry.level}] carries no reason.`)
  }

  // ── One item per clause, in source order ──
  const expected = parseLevelClauses(section).filter(
    (clause) => !(EXCLUDED_LEVELS as readonly string[]).includes(clause.level),
  )
  if (manifest.items.length !== expected.length) {
    add(
      `the manifest carries ${manifest.items.length} item(s) but Apêndice D L0–L3 has ` +
        `${expected.length} semicolon-delimited clause(s). One item per clause, no more and no fewer.`,
    )
  }

  const seen = new Set<string>()
  const perLevelOrdinal = new Map<string, number>()

  for (const [index, item] of manifest.items.entries()) {
    const where = `${item.itemId || `items[${index}]`}`

    if ((EXCLUDED_LEVELS as readonly string[]).includes(item.level)) {
      add(`${where}: level ${item.level} rows are absent from this manifest by construction.`)
      continue
    }
    if (!(TRANSCRIBED_LEVELS as readonly string[]).includes(item.level)) {
      add(`${where}: unknown level \`${item.level}\`.`)
      continue
    }

    const id = ID_SHAPE.exec(item.itemId)
    if (!id) {
      add(`${where}: item ids must match \`EAP-L<level>-<nnn>\` so later tasks can bind test cases to them.`)
    } else {
      if (id[1] !== item.level) add(`${where}: item id names level ${id[1]} but the row is ${item.level}.`)
      const next = (perLevelOrdinal.get(item.level) ?? 0) + 1
      perLevelOrdinal.set(item.level, next)
      if (Number(id[2]) !== next) {
        add(`${where}: item ids must be contiguous within a level; expected sequence ${next}.`)
      }
    }
    if (seen.has(item.itemId)) add(`${where}: duplicate item id.`)
    seen.add(item.itemId)

    // ── Verbatim, or it is not a transcription ──
    if (!section.text.includes(item.clause)) {
      add(
        `${where}: \`clause\` is not present verbatim in Apêndice D. The clause text is transcribed, ` +
          "never reworded and never translated in place; put any English in `restatementEn`.",
      )
    }
    const source = expected[index]
    if (source !== undefined) {
      if (item.clause !== source.clause) {
        add(`${where}: expected the clause at position ${index + 1} to be \`${source.clause}\`.`)
      }
      if (item.level !== source.level) add(`${where}: level does not match the clause's level in source.`)
      if (item.sourceLine !== source.sourceLine) {
        add(`${where}: sourceLine ${item.sourceLine} does not match the source line ${source.sourceLine}.`)
      }
      if (item.ordinal !== source.ordinal) add(`${where}: ordinal does not match the clause's position.`)
    }
    if (typeof item.restatementEn !== "string" || item.restatementEn.trim().length === 0) {
      add(`${where}: restatementEn is missing.`)
    } else if (item.restatementEn === item.clause) {
      add(`${where}: restatementEn duplicates the verbatim clause instead of restating it.`)
    }

    // ── Role ──
    if (item.role !== roleForLevel(item.level)) {
      add(
        `${where}: role \`${item.role}\` contradicts level ${item.level} — L0–L1 certify clients, ` +
          "L2–L4 certify hosts, and no agent certifies as a host (ADR-0007).",
      )
    }

    // ── Refusal codes ──
    if (!Array.isArray(item.refusalCodes)) {
      add(`${where}: refusalCodes must be an array.`)
    } else {
      for (const code of item.refusalCodes) {
        if (!taxonomy.includes(code)) {
          add(`${where}: refusal code \`${code}\` is not in the closed taxonomy (${REFUSAL_TAXONOMY_PATH}).`)
        }
      }
      if (item.refusalCodes.length === 0 && (item.refusalCodesNote ?? "").trim().length === 0) {
        add(`${where}: names no refusal code and no refusalCodesNote saying why the clause touches none.`)
      }
    }

    // ── Evidence: host log, never self-report (ADR-0021) ──
    if (!(EVIDENCE_SURFACES as readonly string[]).includes(item.evidence?.surface)) {
      add(`${where}: evidence.surface must be one of ${EVIDENCE_SURFACES.join(", ")}.`)
    }
    const predicate = item.evidence?.predicate ?? ""
    if (predicate.trim().length < 40) {
      add(`${where}: evidence.predicate is too thin to be assessable.`)
    }
    for (const phrase of SELF_REPORT_PHRASES) {
      if (predicate.toLowerCase().includes(phrase)) {
        add(
          `${where}: evidence.predicate contains \`${phrase}\` — that is a self-report about code, not ` +
            "an observation in the host log. Verification is by host log, never self-report (ADR-0021).",
        )
      }
    }

    // ── Claim ──
    if (!(CLAIM_STATES as readonly string[]).includes(item.claim?.state)) {
      add(`${where}: claim.state must be one of ${CLAIM_STATES.join(", ")}.`)
      continue
    }
    if ((item.claim.rationale ?? "").trim().length === 0) {
      add(`${where}: claim.state \`${item.claim.state}\` carries no rationale.`)
    }
    if (!Array.isArray(item.claim.evidenceRefs) || item.claim.evidenceRefs.length === 0) {
      add(`${where}: claim carries no evidenceRefs; a claim state with nothing behind it is unfalsifiable.`)
    } else {
      for (const ref of item.claim.evidenceRefs) {
        if (!EVIDENCE_REF.test(ref)) add(`${where}: evidenceRef \`${ref}\` is not a \`path:line\` reference.`)
      }
    }
    if (item.level !== "L3" && item.claim.state !== "claimed") {
      add(
        `${where}: ${item.level} items are claimed in full — L0/L1 client items and every L2 host item. ` +
          "A per-item claim state is an L3 affordance only.",
      )
    }
  }

  return violations
}

// ── Reporting ─────────────────────────────────────────────────────────────────────────────────

export interface ManifestCounts {
  total: number
  byLevel: Record<string, number>
  byClaimState: Record<string, number>
}

export function countManifest(manifest: ConformanceManifest): ManifestCounts {
  const byLevel: Record<string, number> = {}
  const byClaimState: Record<string, number> = {}
  for (const item of manifest.items) {
    byLevel[item.level] = (byLevel[item.level] ?? 0) + 1
    byClaimState[item.claim.state] = (byClaimState[item.claim.state] ?? 0) + 1
  }
  return { total: manifest.items.length, byLevel, byClaimState }
}

/**
 * The report. `violations` is a parameter rather than something computed inside, so task 11 can
 * hand this the outcome of a real assessment run without this function growing a second job.
 */
export function renderReport(manifest: ConformanceManifest, violations: readonly string[]): string {
  const counts = countManifest(manifest)
  const lines: string[] = [
    "EAP Conformance Manifest — Apêndice D (transcription only; no assessment is run here)",
    `  source      ${manifest.source.path} lines ${manifest.source.startLine}-${manifest.source.endLine}`,
    `  sha256      ${manifest.source.sha256}`,
    `  graduation  ${manifest.graduation.marker} — graduated: ${String(manifest.graduation.graduated)}`,
    `  items       ${counts.total}`,
  ]
  for (const level of TRANSCRIBED_LEVELS) {
    lines.push(`    ${level} (${roleForLevel(level)})  ${counts.byLevel[level] ?? 0}`)
  }
  for (const state of CLAIM_STATES) {
    lines.push(`  ${state.padEnd(16)}${counts.byClaimState[state] ?? 0}`)
  }
  for (const entry of manifest.excludedLevels) {
    lines.push(`  excluded    ${entry.level} — ${entry.reason}`)
  }

  const unclaimed = manifest.items.filter((item) => item.claim.state !== "claimed")
  lines.push("", "Not yet claimed:")
  if (unclaimed.length === 0) {
    lines.push("  (none)")
  } else {
    for (const item of unclaimed) lines.push(`  ${item.itemId}  ${item.clause} — ${item.claim.rationale}`)
  }

  lines.push("", violations.length === 0 ? "Violations: none." : `Violations (${violations.length}):`)
  for (const violation of violations) lines.push(`  - ${violation}`)
  return lines.join("\n")
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────────

function main(): number {
  const root = repoRoot()
  const check = process.argv.includes("--check")

  const manifestFile = join(root, ...MANIFEST_PATH.split("/"))
  if (!existsSync(manifestFile)) {
    console.error(`conformance: FAIL — ${MANIFEST_PATH} does not exist.`)
    return 1
  }

  const paper = readFileSync(join(root, ...WORKING_PAPER_PATH.split("/")), "utf8")
  const section = extractAppendixD(paper)
  const manifest = loadManifest(readFileSync(manifestFile, "utf8"))
  const violations = validateManifest(manifest, section, loadRefusalTaxonomy(root))

  console.log(renderReport(manifest, violations))

  if (violations.length > 0) {
    console.error(`conformance: FAIL — ${violations.length} violation(s) in ${MANIFEST_PATH}.`)
    return 1
  }
  if (check) console.log(`conformance: PASS — ${manifest.items.length} item(s) transcribed verbatim.`)
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
