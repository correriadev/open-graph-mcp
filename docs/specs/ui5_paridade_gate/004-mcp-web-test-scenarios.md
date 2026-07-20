# UI-5 — Paridade e Gate de Retomada: Test Scenarios — mcp-web

## 1. TEST STRATEGY

| Gate | Purpose | Evidence |
|---|---|---|
| Manifest gate | Prove every capability maps to evidence or waiver. | Unit validation of parity manifest. |
| Browser parity gate | Prove user-visible behavior against real server. | Complete Playwright suite. |
| Workspace gate | Catch cross-package/server regressions. | Build and focused/full Bun tests. |
| Session gate | Validate bounded real use. | Dated mini-session report. |
| Human gate | Decide beta resumption. | Owner-signed RESUME or HOLD. |

## 2. PARITY MATRIX SCENARIOS

| ID | Capability | Required Scenario |
|---|---|---|
| P01 | Presence roster | Join/leave updates count and names without reload. |
| P02 | Avatars | Focused cell shows participant avatars and removes departed users. |
| P03 | Typing receive | Remote typing appears and expires. |
| P04 | Typing send | Web input emits typing visible to another session. |
| P05 | Toast rules | Commit, abort/TTL, lock and suppression settings follow each rule. |
| P06 | Activity feed | Events render in seq order with kind and target. |
| P07 | Reconnect/reauth | Disconnect recovers without F5 and resumes SSE. |
| P08 | Turn reattach | Active changeset and draft return after reconnect. |
| P09 | Settings | Invisible and notifications persist and alter behavior. |
| P10 | History | Filters persist in URL and payload detail expands. |
| P11 | Node panel | Card selection opens correct node details. |
| P12 | Multi-cell turn | Open locks all selected cells or denies atomically. |
| P13 | Claim/commit | Draft claim passes gates, commits and broadcasts. |
| P14 | Abort | Explicit abort releases locks and clears ghosts. |
| P15 | Extend | Extend advances expiry and countdown without reopening. |
| P16 | Lock contention | Denied user sees holder/countdown and retries live. |
| P17 | Ghosts | Remote draft appears and disappears on close. |
| P18 | Admin re-bootstrap | Authorized action refreshes graph; unauthorized action is denied. |
| G01 | Query gaps | Unknown term renders gap and refinements. |
| G02 | Claims navigation | Claim detail supports forward/reverse cross-cell navigation. |
| G03 | Web typing | Web-originated typing is observable remotely. |
| G04 | Rich markdown | Node renders sanitized headings, lists and tables. |
| G05 | Semantic zoom | Card, chip, dot and selection pin remain stable. |
| G06 | Cell containers | Lock, TTL, presence, ghosts and turn target live on cell. |

## 3. MANIFEST VALIDATION

### M1 — Every capability is accounted for

**Given** the canonical capability list and parity manifest  
**When** consistency validation runs  
**Then** every ID appears exactly once with at least one existing scenario or signed waiver.

### M2 — Missing spec fails

**Given** a manifest entry references a missing file  
**When** validation runs  
**Then** it fails with the capability and missing path.

### M3 — Empty suite fails

**Given** Playwright discovers zero tests  
**When** the CI gate evaluates the run  
**Then** it fails even if the runner exit code would otherwise be zero.

### M4 — Unexpected skip fails

**Given** a required scenario is skipped without waiver  
**When** the summary is evaluated  
**Then** the gate fails and names the parity item.

## 4. NEW END-TO-END SCENARIOS

### E1 — Outgoing typing and activity feed

1. Open Alice and Bob in distinct browser contexts.
2. Focus a supported web input as Alice and type.
3. Confirm Bob sees Alice typing without direct harness event injection.
4. Perform open/claim/abort actions.
5. Confirm Bob's feed preserves increasing seq, event kind and cell target.

### E2 — Reconnect with turn reattach

1. Alice opens a multi-cell turn and adds a draft claim.
2. Interrupt SSE/server transport without page reload.
3. Restore transport and complete reauthentication.
4. Confirm the same `csId`, cells, draft and remaining expiry return.
5. Commit or abort successfully through the recovered UI.

### E3 — Abort and extend lifecycle

1. Open turn and record initial expiry.
2. Extend TTL and confirm later expiry/countdown.
3. Add ghost-visible draft, then abort.
4. Confirm locks and ghosts disappear for another browser.
5. Confirm aborted turn cannot commit.

### E4 — Authorized admin re-bootstrap

1. Open owner/admin and ordinary participant sessions.
2. Confirm admin control is absent or disabled for participant.
3. Attempt unauthorized operation through the public boundary and confirm denial.
4. Trigger re-bootstrap as admin.
5. Confirm snapshot sequence/content refreshes without full browser restart.
6. Confirm presence and authentication remain coherent.

## 5. COMPLETE SUITE MANIFEST

The required run must include, at minimum:

- `snapshot-render.e2e.ts`
- `presence-bar.e2e.ts`
- `avatar-overlay.e2e.ts`
- `typing-indicator.e2e.ts`
- `toast-notifications.e2e.ts`
- `settings-invisible.e2e.ts`
- `reconnect.e2e.ts`
- `activity-feed.e2e.ts`
- `turn-lifecycle.e2e.ts`
- `turn-recovery.e2e.ts`
- `lock-contention.e2e.ts`
- `query-and-read.e2e.ts`
- `history.e2e.ts`
- `semantic-zoom.e2e.ts`
- `admin-rebootstrap.e2e.ts`
- `rich-canvas-performance.e2e.ts`

## 6. MINI-SESSION SCENARIO

### S1 — 30-minute LAN validation

**Participants:** owner/facilitator, one participant, one Claude Code agent.  
**Scope:** warm-up plus exactly one selected BT-4 mission.  
**Client rule:** participant completes creation and reading through the web UI; agent is optional assistance.

1. Record date, revision, machine, browser and LAN endpoint.
2. Complete warm-up: join, identify presence, navigate, search and open a cell.
3. Start the selected mission timer.
4. Exercise parallel focus, lock contention, claim creation, cross-reference and commit.
5. Recover from one planned disconnect without F5.
6. Read the committed result through query/claims browser.
7. Stop at 30 minutes even if extra ideas remain.
8. Record completion, frictions and participant wording without reinterpretation.

### Severity Rules

| Severity | Definition | Gate Effect |
|---|---|---|
| blocker | Prevents entry, mission completion, recovery or preserves incorrect data | Must fix and recheck. |
| major | Serious friction with a viable workaround | Owner decides backlog or blocker promotion. |
| minor | Local usability issue without task failure | Backlog allowed. |
| note | Observation or idea outside parity | Backlog only; no scope expansion. |

## 7. RECHECK SCENARIOS

1. Reproduce each blocker before correction.
2. Add minimal automated regression coverage where deterministic.
3. Run the affected scenario after correction.
4. Run the complete suite after all blockers pass locally.
5. Record revision, date and result in the session report.
6. Keep blocker open when reproduction or recheck evidence is absent.

## 8. BETA RESUMPTION GATE

### RESUME

Accept only when all conditions hold:

- Every P01–P18 and G01–G06 item is proven or owner-waived.
- Complete suite is green, non-empty and has no unexpected skips.
- Mini-session report exists and covers the bounded protocol.
- Every blocker has a passed recheck.
- Owner signs `RESUME` with date and revision.
- Beta roadmap removes the postponement notice and identifies BT-2/BT-3/BT-4 as resumed.

### HOLD

Use when any condition is missing. Record rationale and next blocker; keep the beta roadmap postponed.

## 9. DEFINITION OF DONE

- Parity manifest validation passes.
- All required specs execute in CI with explicit non-zero count.
- Checklist is 100% resolved with evidence or signed waiver.
- Mini-session completes and has a dated report.
- No blocker remains open.
- Owner-signed gate decision is recorded atomically with beta roadmap state.

