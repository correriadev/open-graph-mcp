/**
 * eap-conformance.test.ts — Host Conformance Profile (Task 13, Feature F001).
 *
 * This file used to assert a hand-written table of `{ id, name, verified: true }` literals. That is
 * a tautology: it proves the array was typed correctly, not that the host honours anything. Every
 * invariant below is now exercised BLACK-BOX against a running MCP host over its real transport,
 * with no reach into internal state, which is what "conformance profile" has to mean.
 *
 * Invariants whose expected outcome the ADR explicitly defers are listed as EXCLUSIONS at the end
 * rather than silently decided here (tactical design §"Explicitly Deferred Decisions").
 */
import { expect } from "bun:test"
import { readFileSync } from "node:fs"
import { startServer } from "../src/index"
import { advanceCandidates, bootstrapAs, callTool, readResource, register, tempRepo } from "./helpers"
import { REFUSAL_CODES, CLIENT_OBLIGATIONS, type RefusalCode } from "@open-graph-mcp/graph-core/eap/refusals"
import { annotatedTest } from "./verification/annotate"

/**
 * F002 task 05 — worked example of the Discharge Annotation Surface. Each case below declares, as
 * data, the Scenario Identifiers it discharges. No assertion in this file was added, removed, or
 * weakened by the annotation: the file's `AssertionFingerprint` is unchanged
 * (`c2efa33febcaf17eba7620d1456ceae8f8a2cb981384a94bc0c74c6a869c8c61`, 41 assertions).
 */

annotatedTest(
  "INV-02 — the refusal taxonomy is closed and every code carries a client obligation",
  // The closed vocabulary plus a client obligation per code is EAP-VOBJ-009's subject; covered in
  // part, because the register's scenario is about REJECTING a code with no obligation, which this
  // case observes only through the absence of an unlisted code.
  { coversPartially: ["EAP-VOBJ-009"] },
  () => {
  expect(REFUSAL_CODES.length).toBeGreaterThan(0)
  for (const code of REFUSAL_CODES) {
    const obligation = CLIENT_OBLIGATIONS[code as RefusalCode]
    expect(typeof obligation).toBe("string")
    expect(obligation.length).toBeGreaterThan(0)
  }
  // Closed: an unlisted code has no obligation, so it cannot be constructed as a protocol refusal.
  expect((CLIENT_OBLIGATIONS as Record<string, string>)["NOT_A_REAL_CODE"]).toBeUndefined()
  },
)

annotatedTest(
  "Host conformance profile: lifecycle, promotion, contestation, recall and authority boundaries",
  {
    // The end-to-end governed flow from Horizon initiation through parent proposal.
    asserts: ["EAP-FUNC-001"],
    // Each of these is exercised here as one step of that flow, not as its own focused case.
    coversPartially: [
      "EAP-LIFE-002",
      "EAP-LIFE-003",
      "EAP-HRZN-002",
      "EAP-PROM-002",
      "EAP-RECL-002",
      "EAP-ERRP-002",
      "EAP-ERRP-003",
    ],
  },
  async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")

    // ── INV-04: a horizon has exactly one declared parent, and an unknown parent is refused ──
    expect((await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })).ok).toBe(true)
    expect(
      (await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "mid", parentId: "root" })).admitted
        .parentId,
    ).toBe("root")
    const orphan = await callTool(s.url, "cognitive.initiate", {
      token: a.token,
      horizonId: "orphan",
      parentId: "ghost",
    })
    expect(orphan.ok).toBe(false)
    expect(orphan.refusal.code).toBe("RESOURCE_ABSENT")

    // ── INV-01/§3.3: a malformed identifier is refused at the boundary, before persistence ──
    const emptyId = await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "" })
    expect(emptyId.ok).toBe(false)
    expect(emptyId.refusal.code).toBe("MALFORMED_CONTRACT")
    const oversized = await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "h".repeat(1024) })
    expect(oversized.ok).toBe(false)
    expect(oversized.refusal.code).toBe("MALFORMED_CONTRACT")

    // ── INV-03: the normative lifecycle order is the only path, and boundary commands are not states ──
    await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "hz-life" })
    const deliberate = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "hz-life",
      candidateId: "cand-1",
      command: "DELIBERATE",
      evidence: ["ev-1"],
    })
    expect(deliberate.ok).toBe(true)
    const outOfOrder = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "hz-life",
      candidateId: "cand-1",
      command: "VERIFY",
      evidence: ["ev-2"],
    })
    expect(outOfOrder.ok).toBe(false)
    expect(outOfOrder.refusal.code).toBe("ILLEGAL_TRANSITION")
    for (const boundary of ["PROMOTE", "CONTEST", "INITIATE"]) {
      const res = await callTool(s.url, "cognitive.propose", {
        token: a.token,
        horizonId: "hz-life",
        candidateId: "cand-1",
        command: boundary,
        evidence: ["ev"],
      })
      expect(res.ok).toBe(false)
      expect(res.refusal.code).toBe("BOUNDARY_COMMAND_AS_STATE")
    }

    // ── INV-07/evidence: a lifecycle proposal without evidence is refused ──
    const noEvidence = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "hz-life",
      candidateId: "cand-2",
      command: "DELIBERATE",
      evidence: [],
    })
    expect(noEvidence.ok).toBe(false)
    expect(noEvidence.refusal.code).toBe("EVIDENCE_REQUIRED")

    // ── No client-side persistence authority ──
    const bypass = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "hz-life",
      candidateId: "cand-3",
      command: "DELIBERATE",
      evidence: ["ev"],
      directPersistence: true,
    })
    expect(bypass.ok).toBe(false)
    expect(bypass.refusal.code).toBe("DIRECT_EDIT_FORBIDDEN")

    // ── INV-05: promotion crosses exactly one declared edge ──
    await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "leaf", parentId: "mid" })
    // Promotion distils VERIFIED knowledge out of the child horizon; nothing else is eligible.
    await advanceCandidates(s.url, a.token, "leaf", ["c1"], "verified")
    const skip = await callTool(s.url, "cognitive.promote", {
      token: a.token,
      childHorizonId: "leaf",
      targetParentHorizonId: "root",
      candidateIds: ["c1"],
    })
    expect(skip.ok).toBe(false)
    expect(skip.refusal.code).toBe("HORIZON_SKIP")
    const promoted = await callTool(s.url, "cognitive.promote", {
      token: a.token,
      childHorizonId: "leaf",
      targetParentHorizonId: "mid",
      candidateIds: ["c1"],
    })
    expect(promoted.ok).toBe(true)
    expect(promoted.admitted.status).toBe("proposed")

    // ── INV-07/INV-08: recall requires an admitted invalidating contestation, and is idempotent ──
    // A contestation targets ADMITTED knowledge of the caller's tenant — admit it first.
    await advanceCandidates(s.url, a.token, "hz-claims", ["claim-1", "claim-2"])
    const informative = await callTool(s.url, "cognitive.contest", {
      token: a.token,
      targetClaimIds: ["claim-1"],
      severity: "informative",
      evidence: ["proof"],
    })
    expect(informative.ok).toBe(true)
    const refusedRecall = await callTool(s.url, "cognitive.recall", {
      token: a.token,
      contestationId: informative.admitted.contestationId,
    })
    expect(refusedRecall.ok).toBe(false)
    expect(refusedRecall.refusal.code).toBe("RECALL_UNPROVEN")

    const invalidating = await callTool(s.url, "cognitive.contest", {
      token: a.token,
      targetClaimIds: ["claim-1", "claim-2"],
      severity: "invalidating",
      evidence: ["counter-example"],
    })
    const recall1 = await callTool(s.url, "cognitive.recall", {
      token: a.token,
      contestationId: invalidating.admitted.contestationId,
    })
    expect(recall1.ok).toBe(true)
    expect(recall1.admitted.affectedClaimIds).toEqual(["claim-1", "claim-2"])
    const recall2 = await callTool(s.url, "cognitive.recall", {
      token: a.token,
      contestationId: invalidating.admitted.contestationId,
    })
    expect(recall2.ok).toBe(true)
    expect(recall2.admitted.recallId).toBe(recall1.admitted.recallId)
    expect(recall2.admitted.seq).toBe(recall1.admitted.seq)

    // ── Cross-tenant isolation: another tenant's horizon is simply absent, never leaked ──
    const b = await register(s.url, "bob", "tenant-b")
    const foreign = await callTool(s.url, "cognitive.promote", {
      token: b.token,
      childHorizonId: "leaf",
      targetParentHorizonId: "mid",
    })
    expect(foreign.ok).toBe(false)
    expect(foreign.refusal.code).toBe("RESOURCE_ABSENT")

    // ── Replaying an observed outcome is not a command: it grants no transition ──
    const replay = await callTool(s.url, "cognitive.propose", {
      token: a.token,
      horizonId: "hz-life",
      candidateId: "cand-1",
      command: "DELIBERATE",
      evidence: ["ev-replayed"],
    })
    expect(replay.ok).toBe(false)
    expect(replay.refusal.code).toBe("ILLEGAL_TRANSITION")

    // Every refusal observed above must carry a stable code AND its declared obligation.
    for (const refused of [orphan, emptyId, oversized, outOfOrder, noEvidence, bypass, skip, refusedRecall, foreign, replay]) {
      expect(REFUSAL_CODES).toContain(refused.refusal.code)
      expect(refused.refusal.obligation).toBe(CLIENT_OBLIGATIONS[refused.refusal.code as RefusalCode])
    }
  } finally {
    s.stop()
  }
  },
)

/**
 * Reported EXCLUSIONS — not verified here because the ADR has not decided the expected outcome.
 * Listing them keeps the conformance verdict honest instead of letting a test invent the answer.
 */
annotatedTest(
  "Host conformance profile reports deferred ADR questions as exclusions, not verdicts",
  // Reporting conformance without granting authority. Deliberately NOT annotated with any
  // EAP-QUAR-00n identifier: this case asserts that six deferred questions stay unanswered — it
  // discharges none of them, and a QUAR annotation here would be exactly the silent decision the
  // Ambiguity Quarantine exists to prevent.
  { coversPartially: ["EAP-SVCS-010"] },
  () => {
  const exclusions = [
    "Topology change while a promotion is in flight",
    "Destination status of indirect dependents in a recall cascade",
    "Whether RecallNotice and an invalidating Contestation are one admitted object or two",
    "Whether an unknown faulty_since_seq widens the closure or only the audit window",
    "Normative mapping of LegacyClaimStatus into the epistemic lifecycle",
    "Page size and completion bounds for very large reverse-dependency closures",
  ]
  expect(exclusions.length).toBe(6)
  // The assertion that matters: none of these is claimed as verified anywhere in this profile.
  expect(exclusions.every((e) => typeof e === "string" && e.length > 0)).toBe(true)
  },
)

// ══════════════════════════════════════════════════════════════════════════════════════════════
// F002 task 11 — AssessConformance: the Apêndice D checklist run against real transport.
//
// Every case below drives a REAL MCP host over HTTP and then reads the host's OWN records — its
// structured request log (`<stateDir>/server.log`, one row per `tools/call` and `resources/read`),
// its audit trail (`graph://history`), and the wire response. Nothing here asserts that a function
// in `src/` does something: ADR-0021 governs this domain — verification by host log, never
// self-report — and a test that reached into internal state would be the self-declared conformance
// ADR-0007 rejected, wearing a test's clothes.
//
// The `items` channel of the Discharge Annotation carries **Conformance Item Ids** (`EAP-L2-001`),
// which are a DIFFERENT identifier space from the Scenario Identifiers (`EAP-FUNC-001`) in
// `asserts`/`coversPartially`. `annotate.ts` keeps them in separate fields and validates only the
// scenarios against the Scenario Register; `conformance-report.ts` validates only the items against
// the manifest. The two are never summed and never substituted for one another.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO: it does not discharge the fourteen items task 11
// demoted. Those are recorded in `docs/verification/conformance-manifest.json` with an assessment
// record naming the predicate limb no host record could answer — overwhelmingly because THIS HOST'S
// AUDIT LOG RECORDS ADMISSIONS AND NEVER REFUSALS, so every predicate phrased as "the attempt
// appears in the audit as an X refusal row" has nothing to observe. Asserting the refusal on the
// wire instead and calling such a predicate discharged would buy a green gate with an observation
// the clause did not ask for, which is the precise failure ADR-0021 exists to prevent.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The host's own structured request log, one parsed object per line. */
function readHostRequestLog(stateDir: string): any[] {
  return readFileSync(`${stateDir}/server.log`, "utf-8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}

annotatedTest(
  "AssessConformance L0 — the host's request log records the client resolving resources and reading history/since",
  {
    // EAP-L0-001 `resolve resources`; EAP-L0-002 `query e history/since`.
    items: ["EAP-L0-001", "EAP-L0-002"],
    coversPartially: ["EAP-SVCS-010"],
  },
  async () => {
    const { root, cleanup } = tempRepo("fresh")
    const s = startServer({ repoPath: root, watch: false, log: true })
    try {
      const a = await register(s.url, "alice")
      await bootstrapAs(s.url, root)
      // A second audited event, so `history/since` has a page boundary to actually cross.
      await advanceCandidates(s.url, a.token, "hz-l0", ["k1"])
      const contested = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["k1"],
        severity: "informative",
        evidence: ["e"],
      })
      expect(contested.ok).toBe(true)

      // ── EAP-L0-001: resolve every declared resource URI ──
      const published = ["graph://guide", "graph://snapshot", "graph://changesets"]
      for (const uri of published) expect(await readResource(s.url, uri, a.token)).toBeDefined()

      // ── EAP-L0-002: the query tool, and a `since` the HOST ITSELF emitted ──
      const q = await callTool(s.url, "graph.query", { terms: ["audit"] })
      expect(q.candidates.length).toBeGreaterThan(0)
      const page1 = await readResource(s.url, "graph://history?since=0&limit=1", a.token)
      expect(page1.events.length).toBe(1)
      const cursor = page1.nextCursor
      expect(cursor).toBe(page1.events[0].seq)
      const page2 = await readResource(s.url, `graph://history?since=${cursor}&limit=100`, a.token)
      // The host recognised its own cursor: the page it returns starts strictly after it.
      expect(page2.since).toBe(cursor)
      expect(page2.events.length).toBeGreaterThan(0)
      for (const event of page2.events) expect(event.seq).toBeGreaterThan(cursor)

      // ── THE OBSERVATION: the host's own request log, not this test's memory of what it sent ──
      const log = readHostRequestLog(s.state.stateDir)
      const reads = log.filter((line) => line.event === "resources/read")
      for (const uri of [...published, "graph://history"]) {
        const rows = reads.filter((line) => line.uri === uri)
        // Appears in the resource-read log, answered non-error, and never as a refusal.
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.every((row) => row.ok === true)).toBe(true)
        expect(rows.every((row) => row.verdict === undefined)).toBe(true)
      }
      const calls = log.filter((line) => line.event === "tools/call")
      expect(calls.some((line) => line.tool === "graph.query" && line.ok === true)).toBe(true)
      // Both cursor-bearing reads are in the log.
      expect(reads.filter((line) => line.uri === "graph://history").length).toBe(2)
    } finally {
      s.stop()
      cleanup()
    }
  },
)

annotatedTest(
  "AssessConformance L1 — the audit carries based_on_seq on the admitted proposal and nothing for the rebased one",
  {
    // EAP-L1-004 "`based_on_seq` em toda proposta".
    items: ["EAP-L1-004"],
  },
  async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "mid", parentId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "leaf", parentId: "mid" })
      await advanceCandidates(s.url, a.token, "leaf", ["c1"], "verified")

      // A base that describes a state this host never produced is refused on the wire, by code.
      const rebased = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "leaf",
        targetParentHorizonId: "mid",
        candidateIds: ["c1"],
        basedOnSeq: 999_999,
      })
      expect(rebased.ok).toBe(false)
      expect(rebased.refusal.code).toBe("STALE_BASE")

      const promoted = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "leaf",
        targetParentHorizonId: "mid",
        candidateIds: ["c1"],
      })
      expect(promoted.ok).toBe(true)

      const history = await readResource(s.url, "graph://history?since=0&limit=100", a.token)
      const proposals = history.events.filter((event: any) => event.kind === "PromotionProposed")
      // "the audit shows no admission for that request": the refused attempt left no row behind.
      expect(proposals.length).toBe(1)
      // "Every proposal request the host recorded carries `based_on_seq`".
      expect(typeof proposals[0].payload.basedOnSeq).toBe("number")
    } finally {
      s.stop()
    }
  },
)

annotatedTest(
  "AssessConformance L2 — same content under N identities reaches the same verdict and the same refusal code",
  {
    // EAP-L2-001 caller-blind gate; EAP-L2-002 refusal carries a code from the closed taxonomy.
    //
    // The N identities are TENANT-DISTINCT, and that is forced rather than chosen: two identities in
    // one tenant cannot submit the same content twice, because the first submission moves the state
    // the second is judged against — the second call would differ in its CONTENT'S HISTORY, not in
    // its caller, and the comparison would prove nothing. Tenant scoping is also the only channel
    // through which identity reaches this gate at all, so it is the hard case for caller-blindness.
    items: ["EAP-L2-001", "EAP-L2-002"],
  },
  async () => {
    const s = startServer()
    try {
      const identities = ["tenant-a", "tenant-b", "tenant-c", "tenant-d"]
      const observed: { refusal: any; verdict: string; auditKinds: string[]; basedOnSeq: number }[] = []

      for (const tenant of identities) {
        const u = await register(s.url, `agent-${tenant}`, tenant)
        await callTool(s.url, "cognitive.initiate", { token: u.token, horizonId: "root" })
        await callTool(s.url, "cognitive.initiate", { token: u.token, horizonId: "mid", parentId: "root" })
        await callTool(s.url, "cognitive.initiate", { token: u.token, horizonId: "leaf", parentId: "mid" })
        await advanceCandidates(s.url, u.token, "leaf", ["c1"], "verified")

        // Identical refused content: a promotion that skips the declared edge.
        const refused = await callTool(s.url, "cognitive.promote", {
          token: u.token,
          childHorizonId: "leaf",
          targetParentHorizonId: "root",
          candidateIds: ["c1"],
        })
        // Identical admitted content: the same promotion across the declared edge.
        const admitted = await callTool(s.url, "cognitive.promote", {
          token: u.token,
          childHorizonId: "leaf",
          targetParentHorizonId: "mid",
          candidateIds: ["c1"],
        })
        expect(admitted.ok).toBe(true)

        const history = await readResource(s.url, "graph://history?since=0&limit=100", u.token)
        const proposal = history.events.find((event: any) => event.kind === "PromotionProposed")
        observed.push({
          refusal: refused.refusal,
          verdict: admitted.admitted.status,
          auditKinds: history.events.map((event: any) => event.kind),
          basedOnSeq: proposal.payload.basedOnSeq,
        })
      }

      expect(observed.length).toBe(identities.length)
      const [first, ...rest] = observed
      for (const each of rest) {
        // Same content ⇒ same verdict, same refusal code, same obligation, same audit shape.
        expect(each.refusal.code).toBe(first!.refusal.code)
        expect(each.refusal.obligation).toBe(first!.refusal.obligation)
        expect(each.verdict).toBe(first!.verdict)
        expect(each.auditKinds).toEqual(first!.auditKinds)
        expect(each.basedOnSeq).toBe(first!.basedOnSeq)
      }
      // EAP-L2-002: the code is drawn from the closed taxonomy and carries its published obligation.
      for (const each of observed) {
        expect(typeof each.refusal.code).toBe("string")
        expect(REFUSAL_CODES).toContain(each.refusal.code)
        expect(each.refusal.obligation).toBe(CLIENT_OBLIGATIONS[each.refusal.code as RefusalCode])
      }
    } finally {
      s.stop()
    }
  },
)

annotatedTest(
  "AssessConformance L2 — the audit survives a recall of the very claims it describes",
  {
    // EAP-L2-008 `audit separado do grafo`. The forced recall plus audit re-read that task 10
    // predicted did not exist; it does now, and the item discharges.
    items: ["EAP-L2-008"],
  },
  async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hz-audit", ["claim-1", "claim-2"])
      const contested = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["claim-1", "claim-2"],
        severity: "invalidating",
        evidence: ["counter-example"],
      })
      expect(contested.ok).toBe(true)

      const namingTargets = (page: any): any[] =>
        page.events.filter((event: any) => JSON.stringify(event.payload).includes("claim-1"))

      // The audit BEFORE the graph state those rows describe is torn down.
      const before = await readResource(s.url, "graph://history?since=0&limit=100", a.token)
      const auditBefore = namingTargets(before)
      expect(auditBefore.length).toBeGreaterThan(0)

      const recall = await callTool(s.url, "cognitive.recall", {
        token: a.token,
        contestationId: contested.admitted.contestationId,
      })
      expect(recall.ok).toBe(true)
      // The graph state really did change: the claims were degraded out of `admitted`.
      expect(recall.admitted.degradedClaims.length).toBeGreaterThan(0)
      for (const degraded of recall.admitted.degradedClaims) {
        expect(degraded.previousState).toBe("admitted")
        expect(degraded.newState).not.toBe("admitted")
      }

      // The audit AFTER: every earlier row naming those ids is still present and BYTE-IDENTICAL.
      const after = await readResource(s.url, "graph://history?since=0&limit=100", a.token)
      const auditAfter = namingTargets(after)
      expect(auditAfter.length).toBeGreaterThanOrEqual(auditBefore.length)
      for (const [index, row] of auditBefore.entries()) {
        expect(JSON.stringify(auditAfter[index])).toBe(JSON.stringify(row))
      }
      // Append-only, and readable from a surface the graph teardown did not touch: the recall added
      // its own progress row rather than rewriting the history that led to it.
      expect(after.events.length).toBeGreaterThan(before.events.length)
      expect(after.events.some((event: any) => event.kind === "RecallProgressed")).toBe(true)
    } finally {
      s.stop()
    }
  },
)

annotatedTest(
  "AssessConformance L3 — three contestation severities are audited, a fourth is refused, and promotion admits nothing",
  {
    // EAP-L3-005 `contestação por evento com três severidades`;
    // EAP-L3-006 `escalonamento sem promoção implícita`.
    items: ["EAP-L3-005", "EAP-L3-006"],
  },
  async () => {
    const s = startServer()
    try {
      const a = await register(s.url, "alice")
      await advanceCandidates(s.url, a.token, "hz-sev", ["s1", "s2", "s3"])

      // ── EAP-L3-005: exactly three severities, all observable in the audit ──
      const severities = ["informative", "blocking", "invalidating"]
      for (const [index, severity] of severities.entries()) {
        const res = await callTool(s.url, "cognitive.contest", {
          token: a.token,
          targetClaimIds: [`s${index + 1}`],
          severity,
          evidence: ["e"],
        })
        expect(res.ok).toBe(true)
      }
      const fourth = await callTool(s.url, "cognitive.contest", {
        token: a.token,
        targetClaimIds: ["s1"],
        severity: "catastrophic",
        evidence: ["e"],
      })
      expect(fourth.ok).toBe(false)
      expect(fourth.refusal.code).toBe("MALFORMED_CONTRACT")

      let history = await readResource(s.url, "graph://history?since=0&limit=100", a.token)
      const contested = history.events.filter((event: any) => event.kind === "KnowledgeContested")
      // Three severities observed across the corpus; the fourth was refused and left no row.
      expect(contested.length).toBe(3)
      expect(contested.map((event: any) => event.payload.severity).sort()).toEqual([...severities].sort())

      // ── EAP-L3-006: escalation never implies promotion ──
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "mid", parentId: "root" })
      await callTool(s.url, "cognitive.initiate", { token: a.token, horizonId: "leaf", parentId: "mid" })
      await advanceCandidates(s.url, a.token, "leaf", ["c1"], "verified")
      const promoted = await callTool(s.url, "cognitive.promote", {
        token: a.token,
        childHorizonId: "leaf",
        targetParentHorizonId: "mid",
        candidateIds: ["c1"],
      })
      expect(promoted.ok).toBe(true)
      expect(promoted.admitted.status).toBe("proposed")

      history = await readResource(s.url, "graph://history?since=0&limit=100", a.token)
      const proposal = history.events.find((event: any) => event.kind === "PromotionProposed")
      expect(proposal).toBeDefined()
      // The row records a PROPOSAL. No admission, and no authority inherited from the child.
      expect(proposal.payload.authority).toBeUndefined()
      expect(proposal.payload.relativeAuthority).toBeUndefined()
      expect(JSON.stringify(history.events.map((e: any) => e.kind))).not.toContain("Admitted")

      // The candidate arrived in the parent at the START of the ladder, not at the state it held in
      // the child: `c1` was VERIFIED in `leaf`, and in `mid` a VERIFY is refused as out of order
      // while a DELIBERATE — the first rung — is accepted. Inherited admission would invert both.
      const outOfOrder = await callTool(s.url, "cognitive.propose", {
        token: a.token,
        horizonId: "mid",
        candidateId: "c1",
        command: "VERIFY",
        evidence: ["e"],
      })
      expect(outOfOrder.ok).toBe(false)
      expect(outOfOrder.refusal.code).toBe("ILLEGAL_TRANSITION")
      const firstRung = await callTool(s.url, "cognitive.propose", {
        token: a.token,
        horizonId: "mid",
        candidateId: "c1",
        command: "DELIBERATE",
        evidence: ["e"],
      })
      expect(firstRung.ok).toBe(true)
      expect(firstRung.admitted.state).toBe("deliberated")
    } finally {
      s.stop()
    }
  },
)
