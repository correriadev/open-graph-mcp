#!/usr/bin/env bun
/**
 * F002 task 04 — Record the Seven Quarantined Ambiguity Families.
 *
 * `QuarantineStore` (`003` §Section 5) over `docs/verification/quarantine.json`, plus the seeder
 * that mints one `EAP-QUAR-NNN` Scenario Identifier per family into the Scenario Register at
 * status `declared-untestable`.
 *
 *   bun scripts/verification/quarantine.ts           -> write/refresh quarantine.json + register
 *   bun scripts/verification/quarantine.ts --check   -> fail if either committed file has drifted
 *
 * ── Why this file exists ──────────────────────────────────────────────────────────────────────
 * This project's method is that a deferred architectural question stays explicitly undecided. A
 * *passing* test inside one of those questions is not evidence — it is a silent decision, made by
 * whoever wrote the assertion, recorded nowhere. The seven families below draw that boundary; the
 * gate of task 08 enforces it. `001` §5 binds four rules, all of which are enforced here or by the
 * loader:
 *
 *   1. Every family carries a Scenario Identifier at status Declared Untestable — never `[E]`,
 *      never `[B]`.
 *   2. No Traceability Link may exist for a quarantined Scenario (task 08's gate).
 *   3. QA6 and QA7 admit **measurement without assertion**: a Benchmark Ledger entry recording an
 *      observed cost or timing is evidence; a test asserting a bound or an expected timing outcome
 *      is a decision, and is forbidden.
 *   4. A quarantine lifts only by a *merged* ADR amendment *naming the family*, after which its
 *      members re-enter the register as `proposed`. See `attemptLift`.
 *
 * ── Membership (decided deliberately, see the task's "verify, don't assume") ───────────────────
 * The 71 registered scenarios are the `#####` headings of `docs/specs/cognitive_line/004` §1–§3.
 * That document's §4 states of the six families it lists: *"No scenario below silently resolves
 * those questions"* (line 12), and this domain's `004` Scope repeats it for all seven. Checked
 * against the register heading by heading, **none of the 71 falls inside a family**, and the two
 * near misses are decided behaviour rather than quarantined:
 *
 *   - `EAP-ERRP-003` (unknown Horizon returns the project-standard absent-resource outcome without
 *     leaking another tenant's state) asserts a *normatively specified refusal shape*. QA7 is the
 *     open question of whether the refusal **code, timing, or closure count** is itself a side
 *     channel — a different question. Marking ERRP-003 untestable would freeze behaviour the ADR
 *     already decided.
 *   - `EAP-SEC-005` (audit output excludes approval and evidence detail from unauthorized
 *     projections) is about projection *content*, likewise decided, not about a side channel.
 *
 * So no existing register entry is coerced into a family. Instead each family carries exactly one
 * minted `EAP-QUAR-NNN` member naming the undecided question itself — required by `001` §5 rule 1
 * ("Every QA1–QA7 family carries a Scenario Identifier and the status Declared Untestable") and by
 * the `QUAR` area `003` §Section 2 reserves for precisely these identifiers. A family is therefore
 * never memberless, and no decided scenario is frozen by a spurious membership.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  REGISTER_PATH,
  loadScenarioRegister,
  mintIdentifier,
  repoRoot,
  serializeRegister,
  type ScenarioEntry,
  type ScenarioRegister,
} from "./register-scenarios"

export const QUARANTINE_PATH = "docs/verification/quarantine.json"

/** Closed union of `003` §Section 2 — `QuarantineFamilyId`. Exactly seven, in this order. */
export const FAMILY_IDS = ["QA1", "QA2", "QA3", "QA4", "QA5", "QA6", "QA7"] as const

export type QuarantineFamilyId = (typeof FAMILY_IDS)[number]

export interface QuarantineMeasurementPolicy {
  /** May a probe observe and record inside this family at all? */
  mayMeasure: boolean
  /** Always `false`. An assertion of an expected outcome inside a family *is* the decision. */
  mayAssert: false
  /** Required whenever `mayMeasure` is true: what may be recorded, and what may not be asserted. */
  note: string | null
}

export interface QuarantineFamily {
  id: QuarantineFamilyId
  question: string
  whyAPassingTestWouldDecideIt: string
  /** Where the ambiguity is written down. At least one; each is a citable clause. */
  sourceClauses: string[]
  /** The ADR (appendix entry) an amendment would have to amend. */
  liftingAdr: string
  /** Must name this family's id — an amendment may not lift a family by accident. */
  liftingCondition: string
  measurement: QuarantineMeasurementPolicy
  /** Scenario Identifiers Declared Untestable by this family. Never empty. */
  members: string[]
}

export interface QuarantineDocument {
  version: number
  policy: string
  families: QuarantineFamily[]
}

/** One minted `QUAR` register entry per family. See the membership note in the file header. */
export const QUARANTINE_MEMBERS: readonly {
  id: string
  family: QuarantineFamilyId
  heading: string
}[] = [
  {
    id: mintIdentifier("QUAR", 1),
    family: "QA1",
    heading:
      "Should stay undecided when a Promotion already in flight meets a changed Horizon DAG",
  },
  {
    id: mintIdentifier("QUAR", 2),
    family: "QA2",
    heading:
      "Should stay undecided when a Recall cascade reaches an indirect dependent and a destination status is required",
  },
  {
    id: mintIdentifier("QUAR", 3),
    family: "QA3",
    heading:
      "Should stay undecided when a RecallNotice and an invalidating Contestation cross the Admission Gate",
  },
  {
    id: mintIdentifier("QUAR", 4),
    family: "QA4",
    heading:
      "Should stay undecided when faulty_since_seq is unknown and the closure is computed",
  },
  {
    id: mintIdentifier("QUAR", 5),
    family: "QA5",
    heading:
      "Should stay undecided when a LegacyClaimStatus value is mapped into the Epistemic Lifecycle",
  },
  {
    id: mintIdentifier("QUAR", 6),
    family: "QA6",
    heading:
      "Should stay undecided when a very large closure is paged, batched, or bounded for completion",
  },
  {
    id: mintIdentifier("QUAR", 7),
    family: "QA7",
    heading:
      "Should stay undecided when a refusal code, its timing, or a closure count is observed for leakage",
  },
]

const MEMBER_SECTION = "4.1"

const isFamilyId = (value: string): value is QuarantineFamilyId =>
  (FAMILY_IDS as readonly string[]).includes(value)

/**
 * Validates and returns the Ambiguity Quarantine. Every refusal names the offending family,
 * because a malformed quarantine is not a formatting problem: it is a boundary that no longer says
 * what may not be decided.
 */
export function loadQuarantine(raw: string): QuarantineDocument {
  const parsed = JSON.parse(raw) as QuarantineDocument
  if (!Array.isArray(parsed?.families)) {
    throw new Error("quarantine: document has no `families` array.")
  }

  const ids = parsed.families.map((family) => family?.id)
  for (const id of ids) {
    if (typeof id !== "string" || !isFamilyId(id)) {
      throw new Error(
        `quarantine: family id "${id}" is outside the closed union ${FAMILY_IDS.join(" | ")} of ` +
          "003 §Section 2. Adding or removing a family is an ADR amendment, not an edit.",
      )
    }
  }
  if (ids.length !== FAMILY_IDS.length || ids.some((id, index) => id !== FAMILY_IDS[index])) {
    throw new Error(
      `quarantine: the Ambiguity Quarantine holds exactly seven families ` +
        `${FAMILY_IDS.join(", ")}, in that order; this document holds ${ids.length} ` +
        `(${ids.join(", ") || "none"}).`,
    )
  }

  const seenMembers = new Map<string, QuarantineFamilyId>()
  for (const family of parsed.families) {
    if (!Array.isArray(family.sourceClauses) || family.sourceClauses.length === 0) {
      throw new Error(
        `quarantine: ${family.id} names no source clause. A family whose source cannot be cited ` +
          "cannot be reviewed, and cannot be lifted deliberately.",
      )
    }
    for (const clause of family.sourceClauses) {
      if (typeof clause !== "string" || clause.trim().length === 0) {
        throw new Error(`quarantine: ${family.id} carries an empty source clause.`)
      }
    }
    if (typeof family.liftingAdr !== "string" || family.liftingAdr.trim().length === 0) {
      throw new Error(`quarantine: ${family.id} names no ADR that an amendment would amend.`)
    }
    if (
      typeof family.liftingCondition !== "string" ||
      family.liftingCondition.trim().length === 0 ||
      !family.liftingCondition.includes(family.id)
    ) {
      throw new Error(
        `quarantine: ${family.id} has no lifting condition naming ${family.id}. A quarantine ` +
          "lifts only by a merged ADR amendment that names the family it lifts.",
      )
    }
    if (typeof family.question !== "string" || family.question.trim().length === 0) {
      throw new Error(`quarantine: ${family.id} records no question.`)
    }
    if (
      typeof family.whyAPassingTestWouldDecideIt !== "string" ||
      family.whyAPassingTestWouldDecideIt.trim().length === 0
    ) {
      throw new Error(
        `quarantine: ${family.id} does not record why a passing test would decide it — the whole ` +
          "point of recording the family.",
      )
    }

    const measurement = family.measurement
    if (measurement === null || typeof measurement !== "object") {
      throw new Error(`quarantine: ${family.id} records no measurement policy.`)
    }
    if (measurement.mayAssert !== false) {
      throw new Error(
        `quarantine: ${family.id} grants permission to assert. No quarantined family may ever ` +
          "assert an expected outcome — that assertion is the decision the quarantine defers.",
      )
    }
    if (typeof measurement.mayMeasure !== "boolean") {
      throw new Error(`quarantine: ${family.id} records no \`mayMeasure\` flag.`)
    }
    if (measurement.mayMeasure && (measurement.note ?? "").trim().length === 0) {
      throw new Error(
        `quarantine: ${family.id} admits measurement but records no note stating what may be ` +
          "measured and that no expected outcome may be asserted.",
      )
    }
    if (!measurement.mayMeasure && measurement.note !== null) {
      throw new Error(
        `quarantine: ${family.id} forbids measurement yet carries a measurement note.`,
      )
    }

    if (!Array.isArray(family.members) || family.members.length === 0) {
      throw new Error(
        `quarantine: ${family.id} has no member Scenario. 001 §5 rule 1 requires every family to ` +
          "carry a Scenario Identifier at status declared-untestable.",
      )
    }
    for (const member of family.members) {
      if (typeof member !== "string" || !/^EAP-[A-Z]+-\d{3}$/.test(member)) {
        throw new Error(`quarantine: ${family.id} member "${member}" is not a Scenario Identifier.`)
      }
      const owner = seenMembers.get(member)
      if (owner !== undefined) {
        throw new Error(
          `quarantine: ${member} is claimed by both ${owner} and ${family.id}. A member belongs ` +
            "to exactly one family, or lifting one family would half-lift another.",
        )
      }
      seenMembers.set(member, family.id)
    }
  }

  return parsed
}

export function families(doc: QuarantineDocument): readonly QuarantineFamily[] {
  return doc.families
}

export function membersOf(doc: QuarantineDocument, id: QuarantineFamilyId): readonly string[] {
  const family = doc.families.find((candidate) => candidate.id === id)
  if (family === undefined) throw new Error(`quarantine: no family ${id} in this document.`)
  return family.members
}

/**
 * Cross-checks the quarantine against the Scenario Register: acceptance criterion 2. Throws on the
 * first violation, naming the scenario — a silent pass here would let a member drift back to a
 * testable status without anyone noticing.
 */
export function assertQuarantineConsistentWithRegister(
  doc: QuarantineDocument,
  register: ScenarioRegister,
): void {
  const byId = new Map(register.scenarios.map((entry) => [entry.id, entry]))
  for (const family of doc.families) {
    for (const member of family.members) {
      const entry = byId.get(member)
      if (entry === undefined) {
        throw new Error(
          `quarantine: ${family.id} member ${member} is absent from ${REGISTER_PATH}. A family ` +
            "member must be a registered Scenario or the quarantine gate has nothing to block.",
        )
      }
      if (entry.retired === true) {
        throw new Error(`quarantine: ${family.id} member ${member} is retired in the register.`)
      }
      if (entry.status !== "declared-untestable") {
        throw new Error(
          `quarantine: ${member} (${family.id}) carries status "${entry.status}" but must carry ` +
            "declared-untestable — 001 §5 rule 1.",
        )
      }
      if (/\[[EB]\]/.test(entry.heading)) {
        throw new Error(
          `quarantine: ${member} (${family.id}) carries an [E]/[B] marker in its heading. A ` +
            "Declared Untestable Scenario is neither proposed behaviour nor evidenced behaviour.",
        )
      }
    }
  }
}

export interface AdrAmendment {
  id: string
  merged: boolean
  namesFamilies: string[]
}

export interface LiftDecision {
  lifted: boolean
  reason: string
  /** The document after the attempt. Unchanged on refusal — the family stays. */
  document: QuarantineDocument
  /** Status the family's members hold after the attempt. */
  memberStatus: "declared-untestable" | "proposed"
}

/**
 * `001` §5 rule 4. A quarantine lifts only by a **merged** ADR amendment that **names** the family.
 * Nothing else counts: not an unmerged draft, not an amendment that happens to touch the area, and
 * certainly not the convenience of an implementer who wants the scenario testable today.
 *
 * Pure: the caller's document is never mutated.
 */
export function attemptLift(
  doc: QuarantineDocument,
  id: QuarantineFamilyId,
  amendments: readonly AdrAmendment[],
): LiftDecision {
  const family = doc.families.find((candidate) => candidate.id === id)
  if (family === undefined) {
    return {
      lifted: false,
      reason: `quarantine: no family ${id} is recorded; nothing to lift.`,
      document: doc,
      memberStatus: "declared-untestable",
    }
  }

  const naming = amendments.filter((amendment) => amendment.namesFamilies.includes(id))
  const merged = naming.filter((amendment) => amendment.merged)
  if (merged.length === 0) {
    const reason =
      naming.length === 0
        ? `quarantine: removal of ${id} refused — no merged ADR amendment names ${id}. ` +
          `Its lifting condition is: ${family.liftingCondition}`
        : `quarantine: removal of ${id} refused — ${naming
            .map((amendment) => amendment.id)
            .join(", ")} names ${id} but is not merged. An unmerged amendment is a proposal, ` +
          "not a decision."
    return { lifted: false, reason, document: doc, memberStatus: "declared-untestable" }
  }

  return {
    lifted: true,
    reason:
      `quarantine: ${id} lifted by merged amendment ${merged.map((a) => a.id).join(", ")}. Its ` +
      `members (${family.members.join(", ")}) re-enter the Scenario Register as \`proposed\` and ` +
      "follow the ordinary path.",
    document: { ...doc, families: doc.families.filter((candidate) => candidate.id !== id) },
    memberStatus: "proposed",
  }
}

/**
 * Materialises the QUAR register entries for the quarantine's minted members. Any member that has
 * drifted to another status is put back: `declared-untestable` is derived from family membership,
 * so a hand edit to the register cannot make a quarantined scenario testable.
 */
export function reconcileQuarantineMembers(
  register: ScenarioRegister,
  doc: QuarantineDocument,
): ScenarioRegister {
  const owned = new Map(QUARANTINE_MEMBERS.map((member) => [member.id, member]))
  const declared = new Set(doc.families.flatMap((family) => family.members))

  const kept = register.scenarios.filter((entry) => !owned.has(entry.id))
  const minted: ScenarioEntry[] = QUARANTINE_MEMBERS.filter((member) => declared.has(member.id)).map(
    (member) => ({
      id: member.id,
      area: "QUAR",
      section: MEMBER_SECTION,
      group: member.family,
      heading: member.heading,
      status: "declared-untestable",
    }),
  )

  return { ...register, scenarios: [...kept, ...minted] }
}

/** Fixed key order, two-space indent, trailing newline — so any diff is real drift. */
export function serializeQuarantine(doc: QuarantineDocument): string {
  const shaped = {
    version: doc.version,
    policy: doc.policy,
    families: doc.families.map((family) => ({
      id: family.id,
      question: family.question,
      whyAPassingTestWouldDecideIt: family.whyAPassingTestWouldDecideIt,
      sourceClauses: family.sourceClauses,
      liftingAdr: family.liftingAdr,
      liftingCondition: family.liftingCondition,
      measurement: {
        mayMeasure: family.measurement.mayMeasure,
        mayAssert: family.measurement.mayAssert,
        note: family.measurement.note,
      },
      members: family.members,
    })),
  }
  return `${JSON.stringify(shaped, null, 2)}\n`
}

function main(): number {
  const root = repoRoot()
  const check = process.argv.includes("--check")
  const quarantineFile = join(root, QUARANTINE_PATH)
  const registerFile = join(root, REGISTER_PATH)

  const committedQuarantine = readFileSync(quarantineFile, "utf8")
  const doc = loadQuarantine(committedQuarantine)
  const nextQuarantine = serializeQuarantine(doc)

  const committedRegister = readFileSync(registerFile, "utf8")
  const register = loadScenarioRegister(committedRegister, { writer: "derivation" })
  const nextRegister = serializeRegister(reconcileQuarantineMembers(register, doc))

  assertQuarantineConsistentWithRegister(loadQuarantine(nextQuarantine), loadScenarioRegister(nextRegister))

  if (check) {
    const drifted = [
      committedQuarantine === nextQuarantine ? null : QUARANTINE_PATH,
      committedRegister === nextRegister ? null : REGISTER_PATH,
    ].filter((path): path is string => path !== null)
    if (drifted.length === 0) {
      console.log(
        `ambiguity quarantine: PASS — ${doc.families.length} families, ` +
          `${doc.families.flatMap((f) => f.members).length} declared-untestable member(s).`,
      )
      return 0
    }
    console.error(
      `ambiguity quarantine: FAIL — ${drifted.join(" and ")} drifted. Run ` +
        "`bun scripts/verification/quarantine.ts` and commit.",
    )
    return 1
  }

  writeFileSync(quarantineFile, nextQuarantine, "utf8")
  writeFileSync(registerFile, nextRegister, "utf8")
  console.log(
    `ambiguity quarantine: wrote ${QUARANTINE_PATH} and ${REGISTER_PATH} — ` +
      `${doc.families.length} families, ` +
      `${doc.families.flatMap((f) => f.members).length} member(s) declared-untestable.`,
  )
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
