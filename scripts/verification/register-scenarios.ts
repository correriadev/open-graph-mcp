#!/usr/bin/env bun
/**
 * F002 task 03 — Define Scenario Identifier Scheme and Seed the Scenario Register.
 *
 * Assigns one stable `EAP-<AREA>-<NNN>` Scenario Identifier to every `#####` scenario heading of
 * the frozen `docs/specs/cognitive_line/004-open-graph-mcp-test-scenarios.md` and materialises
 * `docs/verification/scenario-register.json` as committed data.
 *
 * `004` is a READ-ONLY input. This script opens it with `readFileSync` and never writes under
 * `docs/specs/cognitive_line/**`.
 *
 *   bun scripts/verification/register-scenarios.ts           -> write/refresh the register
 *   bun scripts/verification/register-scenarios.ts --check   -> fail if the committed register
 *                                                              is not what the seeder reproduces
 *
 * ── Identifier stability (the hard requirement) ───────────────────────────────────────────────
 * A scheme keyed on heading text alone loses the identifier when a heading is reworded. A scheme
 * keyed on ordinal position alone renumbers everything downstream of an insertion. Neither is
 * acceptable, so identity is not *derived* from the source at all: **the committed register is
 * the identity store**, and each run is a reconciliation against it, in three passes per area:
 *
 *   1. Exact heading match. Survives insertion, deletion, and reordering.
 *   2. Positional pairing of the residue, within the gaps delimited by the longest increasing
 *      run of pass-1 matches, guarded by a word-overlap similarity threshold. A reworded heading
 *      is the lone survivor in its gap and is therefore paired with the lone unmatched register
 *      entry between the same two stable neighbours — so the identifier follows the rename and
 *      the register records the new wording. The similarity guard is what keeps a *replacement*
 *      in the same slot from silently inheriting the identifier of the scenario it replaced;
 *      without it, "delete gamma, add an unrelated scenario" and "rename gamma" are the same
 *      edit as far as position is concerned. See RENAME_SIMILARITY_THRESHOLD for the trade-off.
 *   3. Whatever is still unmatched: a source heading becomes a newly minted identifier, and a
 *      register entry becomes `retired: true`. Retired entries are never deleted and their
 *      numbers are never reissued — the next number in an area is always `max(ever used) + 1`.
 *
 * Reconciliation is scoped to the areas the source actually covers, so entries minted by other
 * tasks in reserved areas (`QUAR` for the QA1–QA7 families of task 04) pass through untouched
 * rather than being retired for absence from `004`.
 *
 * Statuses are never rewritten here. New entries start at `proposed`; a status already recorded
 * by a downstream task (task 04's `declared-untestable`) is carried forward. `evidenced` is
 * writable only by the derivation service (task 09) and `loadScenarioRegister` rejects a
 * hand-authored one.
 */

import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

export const SOURCE_PATH = "docs/specs/cognitive_line/004-open-graph-mcp-test-scenarios.md"
export const REGISTER_PATH = "docs/verification/scenario-register.json"

/**
 * The closed area set of `003` §Section 2. Fourteen areas cover every section of `004`; `CNTS`,
 * `CLNT` and `QUAR` are reserved and carry no `004` scenario today. Adding an area is a change to
 * that table, not an ad-hoc decision by this seeder.
 */
export const AREAS = [
  "LIFE",
  "HRZN",
  "ADMS",
  "PROM",
  "RECL",
  "VOBJ",
  "SVCS",
  "EVNT",
  "PERS",
  "XPRT",
  "CAPB",
  "FUNC",
  "ERRP",
  "SEC",
  "CNTS",
  "CLNT",
  "QUAR",
] as const

export type Area = (typeof AREAS)[number]

export type ScenarioStatus = "declared-untestable" | "proposed" | "evidenced"

const STATUSES: readonly ScenarioStatus[] = ["declared-untestable", "proposed", "evidenced"]

export interface ScenarioEntry {
  id: string
  area: Area
  section: string
  group: string | null
  heading: string
  status: ScenarioStatus
  retired?: true
}

export interface ScenarioRegister {
  version: number
  policy: string
  source: { path: string; sha256: string; headingCount: number }
  scenarios: ScenarioEntry[]
}

export interface ParsedScenario {
  section: string
  group: string | null
  heading: string
  area: Area
}

export function repoRoot(): string {
  return resolve(import.meta.dir, "..", "..")
}

const isArea = (value: string): value is Area => (AREAS as readonly string[]).includes(value)

/**
 * The `004` sections that §1.1 splits into named aggregates. Keyed by the `####` group title so a
 * section renumbering does not silently re-map an aggregate onto the wrong area.
 */
const GROUP_AREAS: Record<string, Area> = {
  "Epistemic Lifecycle": "LIFE",
  Horizon: "HRZN",
  "Admission Decision": "ADMS",
  Promotion: "PROM",
  "Recall Case": "RECL",
}

/** Sections of `004` whose scenarios sit directly under the `###` heading. */
const SECTION_AREAS: Record<string, Area> = {
  "1.2": "VOBJ",
  "1.3": "SVCS",
  "1.4": "EVNT",
  "2.1": "PERS",
  "2.2": "XPRT",
  "2.3": "CAPB",
  "3.1": "FUNC",
  "3.2": "ERRP",
  "3.3": "SEC",
}

/** Strips the trailing `` `[E]` ``/`` `[B]` `` status marker and surrounding whitespace. */
function stripMarker(text: string): string {
  return text.replace(/\s*`\[[EB]\]`\s*$/, "").trim()
}

/**
 * Resolves the covering area for one `004` heading. Refusal names the offending section, because
 * an uncovered section is a gap in the `003` area map — not something the seeder may improvise.
 */
export function areaForSection(section: string, group: string | null): Area {
  if (section === "1.1") {
    const area = group === null ? undefined : GROUP_AREAS[group]
    if (area === undefined) {
      throw new Error(
        `register-scenarios: §${section} group "${group ?? "(none)"}" has no covering area in the ` +
          "closed area map of 003 §Section 2. Extend that table before registering it.",
      )
    }
    return area
  }
  const area = SECTION_AREAS[section]
  if (area === undefined) {
    throw new Error(
      `register-scenarios: §${section} has no covering area in the closed area map of ` +
        "003 §Section 2. Every section of 004 must be covered by exactly one area.",
    )
  }
  return area
}

/** Reads every `#####` scenario heading of `004` in document order, with its covering area. */
export function parseScenarioHeadings(markdown: string): ParsedScenario[] {
  const scenarios: ParsedScenario[] = []
  let section = ""
  let group: string | null = null

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (line.startsWith("###### ")) continue
    if (line.startsWith("##### ")) {
      const heading = stripMarker(line.slice(6))
      scenarios.push({ section, group, heading, area: areaForSection(section, group) })
      continue
    }
    if (line.startsWith("#### ")) {
      group = stripMarker(line.slice(5))
      continue
    }
    if (line.startsWith("### ")) {
      const title = stripMarker(line.slice(4))
      section = /^(\d+(?:\.\d+)*)\s/.exec(title)?.[1] ?? title
      group = null
      continue
    }
    if (line.startsWith("## ")) {
      section = ""
      group = null
    }
  }
  return scenarios
}

/** Mints `EAP-<AREA>-<NNN>`, refusing any area outside the closed set with the area named. */
export function mintIdentifier(area: string, sequence: number): string {
  if (!isArea(area)) {
    throw new Error(
      `register-scenarios: area "${area}" is outside the closed area set of 003 §Section 2 ` +
        `(${AREAS.join(", ")}). No register entry was created.`,
    )
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999) {
    throw new Error(`register-scenarios: sequence ${sequence} is out of range for area "${area}".`)
  }
  return `EAP-${area}-${String(sequence).padStart(3, "0")}`
}

const numberOf = (id: string): number => Number.parseInt(id.slice(-3), 10)

/**
 * Boilerplate shared by essentially every `004` heading. Left in, "Should ... when ..." alone
 * would make two unrelated scenarios look ~50% similar and a rename indistinguishable from a
 * replacement.
 */
const STOPWORDS = new Set([
  "should",
  "when",
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "be",
  "of",
  "to",
  "and",
  "or",
  "in",
  "on",
  "for",
  "with",
  "that",
  "it",
  "its",
  "their",
  "this",
])

function significantTokens(heading: string): Set<string> {
  return new Set(
    heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter((word) => word.length > 0 && !STOPWORDS.has(word)),
  )
}

/**
 * Overlap coefficient `|A∩B| / min(|A|,|B|)` over significant words. Deliberately not Jaccard or
 * Dice: a rename is very often a pure expansion ("Should beta" -> "Should beta, reworded for
 * clarity"), and both of those punish the length change hard enough to score a genuine rename
 * below a replacement. Overlap is asymmetric in exactly the way rename detection needs.
 */
function headingSimilarity(left: string, right: string): number {
  const a = significantTokens(left)
  const b = significantTokens(right)
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared++
  return shared / Math.min(a.size, b.size)
}

/**
 * A residual pair is accepted as a rename only above this. Below it, the source heading is a new
 * scenario and the register entry is retired — the honest reading, because a replacement in place
 * is otherwise textually identical to a rename.
 */
const RENAME_SIMILARITY_THRESHOLD = 0.5

/** Longest strictly-increasing subsequence over the second element; earliest match wins ties. */
function longestIncreasingRun(pairs: readonly [number, number][]): [number, number][] {
  if (pairs.length === 0) return []
  const best = pairs.map(() => 1)
  const from = pairs.map(() => -1)
  let endAt = 0
  for (let i = 0; i < pairs.length; i++) {
    for (let j = 0; j < i; j++) {
      if (pairs[j]![1] < pairs[i]![1] && best[j]! + 1 > best[i]!) {
        best[i] = best[j]! + 1
        from[i] = j
      }
    }
    if (best[i]! > best[endAt]!) endAt = i
  }
  const run: [number, number][] = []
  for (let i = endAt; i !== -1; i = from[i]!) run.unshift(pairs[i]!)
  return run
}

interface AreaResolution {
  /** Source index -> previous entry, for headings whose identity is carried forward. */
  carried: Map<number, ScenarioEntry>
  /** Previous entries with no surviving source heading. */
  orphaned: ScenarioEntry[]
}

function resolveArea(
  sources: readonly ParsedScenario[],
  previous: readonly ScenarioEntry[],
): AreaResolution {
  const live = previous.filter((e) => e.retired !== true)

  // Pass 1 — exact heading text.
  const byText = new Map<string, number[]>()
  live.forEach((entry, index) => {
    const slot = byText.get(entry.heading)
    if (slot) slot.push(index)
    else byText.set(entry.heading, [index])
  })
  const matched = new Map<number, number>()
  sources.forEach((source, index) => {
    const slot = byText.get(source.heading)
    if (slot && slot.length > 0) matched.set(index, slot.shift()!)
  })

  // Pass 2 — positional pairing of the residue inside anchor-delimited gaps.
  const anchors = longestIncreasingRun([...matched.entries()].sort((a, b) => a[0] - b[0]))
  const usedPrev = new Set(matched.values())
  const residueSrc = sources.map((_, i) => i).filter((i) => !matched.has(i))
  const residuePrev = live.map((_, j) => j).filter((j) => !usedPrev.has(j))
  const bounds: [number, number][] = [[-1, -1], ...anchors, [sources.length, live.length]]

  for (let k = 0; k < bounds.length - 1; k++) {
    const [srcLo, prevLo] = bounds[k]!
    const [srcHi, prevHi] = bounds[k + 1]!
    const gapSrc = residueSrc.filter((i) => i > srcLo && i < srcHi)
    const gapPrev = residuePrev.filter((j) => j > prevLo && j < prevHi)
    for (let m = 0; m < Math.min(gapSrc.length, gapPrev.length); m++) {
      const source = sources[gapSrc[m]!]!
      const candidate = live[gapPrev[m]!]!
      if (headingSimilarity(source.heading, candidate.heading) < RENAME_SIMILARITY_THRESHOLD) {
        continue
      }
      matched.set(gapSrc[m]!, gapPrev[m]!)
    }
  }

  const carried = new Map<number, ScenarioEntry>()
  for (const [srcIndex, prevIndex] of matched) carried.set(srcIndex, live[prevIndex]!)
  const claimed = new Set(matched.values())
  const orphaned = live.filter((_, j) => !claimed.has(j))
  return { carried, orphaned }
}

/**
 * Reconciles the parsed `004` headings against the previously committed register. `previous` is
 * `null` only for the initial seed.
 */
export function reconcileRegister(
  previous: ScenarioRegister | null,
  parsed: readonly ParsedScenario[],
  sourceSha256: string,
): ScenarioRegister {
  const priorAll = previous?.scenarios ?? []
  const coveredAreas = new Set(parsed.map((p) => p.area))
  const output: ScenarioEntry[] = []

  for (const area of AREAS) {
    const priorInArea = priorAll.filter((e) => e.area === area)

    // Areas the source does not cover are not reconciled: entries there were minted by another
    // task (QUAR, task 04) and their absence from 004 is not evidence of retirement.
    if (!coveredAreas.has(area)) {
      output.push(...priorInArea)
      continue
    }

    const sources = parsed.filter((p) => p.area === area)
    const { carried, orphaned } = resolveArea(sources, priorInArea)
    // Never reuse a number, retired or live.
    let next = priorInArea.reduce((max, e) => Math.max(max, numberOf(e.id)), 0)
    const entries: ScenarioEntry[] = []

    sources.forEach((source, index) => {
      const prior = carried.get(index)
      const base: ScenarioEntry = prior
        ? { ...prior, section: source.section, group: source.group, heading: source.heading }
        : {
            id: mintIdentifier(area, ++next),
            area,
            section: source.section,
            group: source.group,
            heading: source.heading,
            status: "proposed",
          }
      delete base.retired
      entries.push(base)
    })
    for (const entry of orphaned) entries.push({ ...entry, retired: true })
    // Entries retired by an earlier run are carried through verbatim. Dropping them would free
    // their numbers for reissue, which is exactly what the non-reuse contract forbids.
    for (const entry of priorInArea) if (entry.retired === true) entries.push({ ...entry })

    entries.sort((a, b) => numberOf(a.id) - numberOf(b.id))
    output.push(...entries)
  }

  return {
    version: previous?.version ?? 1,
    policy:
      "Scenario Register (F002 task 03). One EAP-<AREA>-<NNN> identifier per `#####` heading of " +
      `${SOURCE_PATH}, which is a read-only input. Identity lives in this file, not in the ` +
      "source: regeneration reconciles by exact heading text, then by position inside the gaps " +
      "between stable neighbours, so a reworded heading keeps its identifier and an inserted " +
      "scenario only takes the next unused number. Retired entries stay here with `retired: " +
      "true` and their numbers are never reissued. `proposed` is the seed status; " +
      "`declared-untestable` is set by task 04; `evidenced` is written only by the derivation " +
      "service and is rejected when hand-authored.",
    source: { path: SOURCE_PATH, sha256: sourceSha256, headingCount: parsed.length },
    scenarios: output,
  }
}

/** Fixed key order, two-space indent, trailing newline — so any diff is real drift. */
export function serializeRegister(register: ScenarioRegister): string {
  const scenarios = register.scenarios.map((entry) => {
    const ordered: Record<string, unknown> = {
      id: entry.id,
      area: entry.area,
      section: entry.section,
      group: entry.group,
      heading: entry.heading,
      status: entry.status,
    }
    if (entry.retired === true) ordered.retired = true
    return ordered
  })
  const shaped = {
    version: register.version,
    policy: register.policy,
    source: {
      path: register.source.path,
      sha256: register.source.sha256,
      headingCount: register.source.headingCount,
    },
    scenarios,
  }
  return `${JSON.stringify(shaped, null, 2)}\n`
}

export interface LoadOptions {
  /**
   * `author` (default) is any human or seeder write path and may not carry `evidenced`. Only the
   * derivation service of task 09 may load and write that status.
   */
  writer?: "author" | "derivation"
}

export function loadScenarioRegister(raw: string, options: LoadOptions = {}): ScenarioRegister {
  const writer = options.writer ?? "author"
  const parsed = JSON.parse(raw) as ScenarioRegister
  if (!Array.isArray(parsed?.scenarios)) {
    throw new Error("register-scenarios: register has no `scenarios` array.")
  }

  const seen = new Set<string>()
  for (const entry of parsed.scenarios) {
    const match = /^EAP-([A-Z]+)-(\d{3})$/.exec(entry?.id ?? "")
    if (!match) {
      throw new Error(`register-scenarios: "${entry?.id}" is not a valid EAP-<AREA>-<NNN> id.`)
    }
    const idArea = match[1]!
    if (!isArea(idArea)) {
      throw new Error(
        `register-scenarios: ${entry.id} names area "${idArea}", which is outside the closed ` +
          `area set of 003 §Section 2 (${AREAS.join(", ")}).`,
      )
    }
    if (entry.area !== idArea) {
      throw new Error(
        `register-scenarios: ${entry.id} carries area "${entry.area}", disagreeing with its id.`,
      )
    }
    if (seen.has(entry.id)) {
      throw new Error(
        `register-scenarios: duplicate identifier ${entry.id}. An identifier is never reused, ` +
          "including after retirement.",
      )
    }
    seen.add(entry.id)

    if (!STATUSES.includes(entry.status)) {
      throw new Error(
        `register-scenarios: ${entry.id} carries status "${entry.status}", outside the closed ` +
          `union ${STATUSES.join(" | ")}.`,
      )
    }
    if (entry.status === "evidenced" && writer !== "derivation") {
      throw new Error(
        `register-scenarios: ${entry.id} is recorded as "evidenced", but that status is writable ` +
          "only by the derivation service — never by an author. Evidence comes from runner " +
          "output (ADR-0021), so an authored promotion is inadmissible.",
      )
    }
  }
  return parsed
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function main(): number {
  const root = repoRoot()
  const check = process.argv.includes("--check")
  const registerFile = join(root, REGISTER_PATH)

  const source = readFileSync(join(root, SOURCE_PATH), "utf8")
  const parsed = parseScenarioHeadings(source)

  let previous: ScenarioRegister | null = null
  let committed: string | null = null
  try {
    committed = readFileSync(registerFile, "utf8")
    previous = loadScenarioRegister(committed, { writer: "derivation" })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  const reconciled = reconcileRegister(previous, parsed, sha256(source))
  const next = serializeRegister(reconciled)
  const known = new Set((previous?.scenarios ?? []).map((e) => e.id))
  const minted = reconciled.scenarios.filter((e) => !known.has(e.id)).length
  const retired = reconciled.scenarios.filter((e) => e.retired === true).length

  if (check) {
    if (committed === next) {
      console.log(`scenario register: PASS — ${parsed.length} heading(s), byte-identical.`)
      return 0
    }
    console.error(
      `scenario register: FAIL — regenerating from ${SOURCE_PATH} does not reproduce ` +
        `${REGISTER_PATH}. Run \`bun scripts/verification/register-scenarios.ts\` and commit.`,
    )
    return 1
  }

  writeFileSync(registerFile, next, "utf8")
  console.log(
    `scenario register: wrote ${REGISTER_PATH} — ${parsed.length} heading(s) from ${SOURCE_PATH}, ` +
      `${minted} newly minted identifier(s), ${retired} retired, none reassigned.`,
  )
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
