# Tactical Design — mcp-web

**Domain:** ui2_turnos_e2e | **Project:** mcp-web
**Scope:** UI-2 closure — produzir `turn-lifecycle.e2e.ts` + `lock-contention.e2e.ts`, flippar DoDs em `docs/roadmap-web-ui/02-scope-ui-2-turnos.md`, validar CI local. **Produção já existe** (commit cfb24f5: `src/turn.tsx`, `src/og.ts`, `src/store.ts`, `src/cells.ts`, `src/flow/*`). Esta fase NÃO escreve produção — só spec, e2e (Phase B), docs e gate.

---

## Section 1 — Main Structure

Frontend 3-layer architecture (WD2: RF+Zustand+react-markdown). Elementos listados são a superfície que os e2e desta fase tocam e validam.

| Element | Layer / Type | Invariants / Tech Rules | 4-line Snippet |
|---|---|---|---|
| `TurnModal` | Component (UI) | `denied` é estado de 1ª classe — renderiza holder/expires + "tentar de novo" quando `lockGone` | *see below* |
| `DraftPanel` | Component (UI) | re-hidrata de `graph://changeset/{id}`; form {subject, domain, level, refs, anchor}; raw JSON colapsável | *see below* |
| `CellOverlays` | Component (ViewportPortal) | borda âmbar na cell inteira; ghosts tracejados por cell | *see below* |
| `MyTurns` | Component (UI) | lista `changeset.list_mine`; reattach via `reopenTurn` | *see below* |
| `openTurn/claimDraft/commitTurn/abortTurn/extendTurn/listMine/reopenTurn` | Integration (og.ts) | marshalling de cell `auth:P2↔auth:2` aqui (cells.ts); `og.call()` sem api.ts (WD3) | *see below* |
| `useUi` (store) | Integration (zustand) | `activeCs`, `denied`, `refPicking`, `refDraft`, `myTurns`, `draftDeltas`, `ghostDeltasByCell` | *see below* |
| `Harness` (e2e/fixture.ts) | E2E infrastructure | server subprocess + vite preview build real; um BrowserContext por user (QD4) | *see below* |
| `turns(h, token)` (e2e/driver.ts) | E2E driver | changeset.* em nome do dono do token; usado por specs que precisam setar state via API | *see below* |

```
component TurnModal:
  props: open, onClose; reads: denied, locks, roster
  doOpen(): rows×domains → openTurn(cells, intent)
```
```
component DraftPanel:
  activeCs; rehidrata de graph://changeset/{id}
  claimDraft(form|rawJson) → reasons[] no painel
```
```
component CellOverlays:
  ViewportPortal; borda âmbar em locks[cell]
  ghost sub-cards por ghostDeltasByCell[cell]
```
```
component MyTurns:
  myTurns[]; click → reopenTurn(t) → activeCs
```
```
fn openTurn(uiCells, intent): Promise<OpenTurnResult>
  // toServerCell aqui; denied setState se cell_locked
```
```
store useUi: { activeCs, denied, refPicking,
  refDraft, myTurns, draftDeltas, ghostDeltasByCell, locks }
```
```
harness startHarness(): build + spawn server + preview
  openSession(browser, name): {page, context} autenticado
```
```
driver turns(h, token): { open, claim, commit, abort }
  // usado p/ setup fora-da-UI quando o spec precisa
```

---

## Section 2 — Value Objects / Types / Interfaces

| Name | Context / Layer | Validation & Typing Rules | 4-line Snippet |
|---|---|---|---|
| `ActiveCs` | Integration (store) | `csId:string`, `intent:string`, `cells:string[]` (dialeto UI), `expiresAt:string` | *see below* |
| `Denied` | Integration (store) | `cell:string` (UI), `holder:string`, `csId:string`, `expiresAt:string` | *see below* |
| `ClaimForm` | Integration (og.ts) | `id`, `subject`, `domain`, `level:string|number`, `refs:string[]`, `anchor?`, `file?` | *see below* |
| `DraftDelta` | Integration (store) | `kind`, `summary`, `id?`, `at?` | *see below* |
| `MyTurn` | Integration (store) | `csId`, `intent`, `cells:string[]` (UI), `openedAt`, `expiresAt\|null` | *see below* |
| `OpenTurnResult` | Integration (og.ts) | union: `{ok:true}` \| `{ok:false, denied?:true}` | *see below* |
| `Harness` | E2E (fixture) | ver `fixture.ts`; `firstCell`, `openSession`, `callTool`, `readResource`, `control`, `restartServer`, `stop` | *see below* |

```
type ActiveCs = { csId: string; intent: string
  cells: string[]; expiresAt: string }
```
```
type Denied = { cell: string; holder: string
  csId: string; expiresAt: string }
```
```
type ClaimForm = { id: string; subject: string
  domain: string; level: string|number; refs: string[] }
```
```
type DraftDelta = { kind: string; summary: string; id?: string; at?: number }
```
```
type MyTurn = { csId: string; intent: string; cells: string[]
  openedAt: string; expiresAt: string | null }
```
```
type OpenTurnResult = { ok: true } | { ok: false; denied?: true }
```
```
type Harness = { firstCell: string; openSession(b,name):
  Promise<{page,context}>; callTool; readResource; control; stop }
```

---

## Section 3 — Domain Services / Use Cases / Actions

| Operation / Hook | Responsibility | Coordinates / Subscriptions | 4-line Snippet |
|---|---|---|---|
| `openTurn(uiCells, intent)` | Abrir turno; marshalling cell; setar `denied` se `cell_locked` | `og.call('changeset.open')`, store, ghosts, `listMine` | *see below* |
| `claimDraft(form\|rawJson)` | Submeter claim; level numérico; retornar `reasons`/`warnings` | `og.call('changeset.claim')`, `refetchDeltas`, gate server | *see below* |
| `commitTurn` | Commitar turno ativo → `activeCs=null` + `loadSnapshot` indireto | `og.call('changeset.commit')`, store, ghosts, `listMine` | *see below* |
| `abortTurn` | Abortar turno ativo; libera locks via server | `og.call('changeset.abort')`, store, ghosts | *see below* |
| `extendTurn` | Renovar TTL; atualiza `activeCs.expiresAt` | `og.call('changeset.extend')`, store | *see below* |
| `listMine` | Listar `changeset.list_mine` → `myTurns` | `og.call('changeset.list_mine')`, store | *see below* |
| `reopenTurn(t)` | Reabrir draft dum turno meu já aberto (reattach) | store, `refetchDeltas` | *see below* |
| `applyEvent(env)` | Fold de envelopes SSE → projeções zustand | PresenceStore, GhostStore, ToastQueue, store | *see below* |
| `openTurn` (e2e step, `turns(h,t).open`) | Setup: abrir turno fora da UI em nome do dono do token | `h.callTool('changeset.open')` | *see below* |

```
async openTurn(uiCells, intent): Promise<OpenTurnResult>
  // uiCells.map(toServerCell) → changeset.open → denied|active
```
```
async claimDraft(form, rawJson?): Promise<{ok, reasons, warnings}>
  // level: levelNum(form.level) → changeset.claim
```
```
async commitTurn(): Promise<{ok, reasons}>
  // csAction('changeset.commit') → activeCs=null
```
```
async abortTurn(): Promise<{ok, reasons}>
  // csAction('changeset.abort') → activeCs=null
```
```
async extendTurn(): Promise<{ok, reasons}>
  // csAction('changeset.extend') → activeCs.expiresAt
```
```
async listMine(): Promise<void>
  // changeset.list_mine → myTurns (cells toUiCell)
```
```
function reopenTurn(t): void
  // setState activeCs; refetchDeltas(t.csId)
```
```
function applyEvent(env): void
  // ghost/presence/toast fold; loadSnapshot on committed
```
```
turns(h, token).open(cells, intent): Promise<any>
  // h.callTool('changeset.open', {token, cells, intent})
```

---

## Section 4 — Events / Messages / Async Flows

| Event / Action Name | Trigger | Minimum Payload | Consumers |
|---|---|---|---|
| `changeset.opened` | `changeset.open` ok | `{csId, cells, intent, byUser, expiresAt}` | ghost store, `myTurns`, CanvasCellOverlays |
| `lock.acquired` | server atribui lock | `{cell, holder, csId, expiresAt}` | `locks` map, `CellOverlays`, `maybeToast` |
| `lock.released` | holder commita/aborta/TTL | `{cell, holder, csId}` | `locks` map drop, `TurnModal` (habilita `lockGone`) |
| `changeset.delta` | `changeset.claim` ok | `{csId, delta{kind, payload}}` | `refetchDeltas`, `draftDeltas`, `ghostDeltasByCell` |
| `changeset.committed` | `changeset.commit` ok | `{csId, cells, byUser}` | ghost removal, `loadSnapshot`, `maybeToast` |
| `changeset.aborted` | `changeset.abort` ok / TTL | `{csId, reason, cells}` | ghost removal, `activeCs=null`, `maybeToast` |
| `graph.rebuilt` | commit materializou nós | — | `loadSnapshot` (re-fetch snapshot) |
| `gateFailed` (dentro de `changeset.claim` response) | server recusa claim | `{ok:false, reasons:string[]}` | `DraftPanel` reasons list, form preservado |
| `lockDenied` (dentro de `changeset.open` response) | server recusa open por `cell_locked` | `{ok:false, reason:'cell_locked', cell, holder, csId, expiresAt}` | `denied` no store, `TurnModal` |
| `graph.rebuilt` no browser B | SSE broadcast após commit de A | — | `loadSnapshot` em B → novo `.og-card` |

---

## Section 5 — Persistence / Repository / Data Access Interfaces

| Resource / Adapter | Methods / Actions | Return Types / Expected State |
|---|---|---|
| `og.call` (lib `@open-graph-mcp/client`) | `changeset.open`, `changeset.claim`, `changeset.commit`, `changeset.abort`, `changeset.extend`, `changeset.list_mine` | `Promise<any>` — parsed server-side |
| `resourceRead(serverBase, uri, token)` | `graph://snapshot`, `graph://changeset/{id}`, `graph://changesets?status=open` | `Promise<{graph\|deltas\|changesets}>` |
| `Harness.callTool(name, args)` (e2e) | tools/call RPC direto no server | `structuredContent` |
| `Harness.readResource(uri)` (e2e) | resources/read direto | JSON parsed |
| `Harness.openSession(browser, name)` | novo BrowserContext + Page autenticada | `{page, context}` |
| `Harness.control(action)` | `tick`, `sweep`, `sweepPresenceNow`, `tickTypingNow` | `Promise<void>` — knobs deterministicos |
| `webToken(page)` / `webUserId(page)` | lê `og.token`/`og.userId` do localStorage | `Promise<string>` |

```
interface OgCallAPI:
  call(tool: string, args: unknown): Promise<any>
  // changeset.{open,claim,commit,abort,extend,list_mine}
```
```
interface E2eHarnessAPI:
  openSession(b: Browser, name: string): Promise<{page,context}>
  callTool(name, args?): Promise<any>; readResource(uri): Promise<any>
```

---

## Section 6 — Ordered Development Tasks

```json
[
  {
    "id": "01",
    "title": "Specify turn-lifecycle.e2e.ts harness bootstrap and open-turn flow",
    "description": "Produce the turn-lifecycle spec scaffold reusing startHarness() + openSession, drive the open-turn modal via DOM with intent + cell rows, and assert the draft panel becomes visible with the new csId.",
    "project": "mcp-web",
    "files": [
      "e2e/turn-lifecycle.e2e.ts",
      "e2e/fixture.ts",
      "e2e/driver.ts"
    ],
    "acceptance": [
      "Spec file declares test.beforeAll(startHarness)/afterAll(stop) and one openSession as turn opener",
      "Spec drives TurnModal by DOM: fills #intent, adds a row domain:level, clicks open, asserts draft panel is visible with active csId (not denied)",
      "Spec uses real fixture two-domain cell (auth or billing) and docs/roadmap-web-ui WD3 (og.call, no api.ts)"
    ],
    "depends_on": null
  },
  {
    "id": "02",
    "title": "Specify turn-lifecycle three claims including ref-by-click",
    "description": "Extend turn-lifecycle spec to draft three claims in the active turn, where one claim adds its ref via canvas node click in refPicking mode rather than typing.",
    "project": "mcp-web",
    "files": [
      "e2e/turn-lifecycle.e2e.ts"
    ],
    "acceptance": [
      "Spec fills ClaimForm (subject, domain, level) three times and submits via the draft panel",
      "At least one claim toggles refPicking and clicks an existing .og-card on the canvas to append its data-id into the refs field, then submits",
      "After each accepted claim the draft timeline shows the new delta; gate reasons stay empty for the two valid claims"
    ],
    "depends_on": "01"
  },
  {
    "id": "03",
    "title": "Specify turn-lifecycle commit and cross-browser node visibility",
    "description": "Close the turn-lifecycle flow by committing the turn and asserting the newly created node appears in a second BrowserContext (openSession) without page reload, via graph.rebuilt SSE + snapshot refetch.",
    "project": "mcp-web",
    "files": [
      "e2e/turn-lifecycle.e2e.ts"
    ],
    "acceptance": [
      "Spec opens a second openSession observer before commit and asserts it does NOT yet contain the new node id",
      "Spec triggers commitTurn via the draft panel button (DOM) and asserts activeCs clears in the opener",
      "Within deterministic timeout the second BrowserContext renders .og-card[data-id=<newId>] without F5, proving cross-browser multiplayer"
    ],
    "depends_on": "02"
  },
  {
    "id": "04",
    "title": "Specify lock-contention.e2e.ts deny state legibility",
    "description": "Create lock-contention spec where two BrowserContexts dispute the same cell; the second sees lockDenied rendered as #denied showing holder name, which cs holds it, and expires countdown — never a generic error.",
    "project": "mcp-web",
    "files": [
      "e2e/lock-contention.e2e.ts",
      "e2e/fixture.ts",
      "e2e/driver.ts"
    ],
    "acceptance": [
      "Spec opens browser A and acquires the lock on a shared cell via the modal (UI), then opens browser B and attempts to open the same cell",
      "Browser B renders #denied (not a generic error toast) with holder display name, csId, and a non-empty expires countdown string",
      "Spec asserts the denied cell in B matches the cell A locked and that A is still active (abort/commit available)"
    ],
    "depends_on": null
  },
  {
    "id": "05",
    "title": "Specify lock-contention live-retry on lock.released without F5",
    "description": "Extend lock-contention spec: A releases the lock (commit or abort) so B receives lock.released SSE, lockGone becomes true, B clicks 'tentar de novo' and acquires the turn without any page reload.",
    "project": "mcp-web",
    "files": [
      "e2e/lock-contention.e2e.ts"
    ],
    "acceptance": [
      "Spec triggers release from browser A (commitTurn or abortTurn) and asserts #denied disappears in B via the lock.released SSE event (no page.reload)",
      "Spec clicks the 'tentar de novo' button in B and asserts B acquires activeCs on the same cell — proving live retry without F5",
      "Spec asserts no extra /events reconnect request fired by the retry itself (eventsRequests count unchanged across the retry click)"
    ],
    "depends_on": "04"
  },
  {
    "id": "06",
    "title": "Specify lock-contention gate-fail preserves typed claim text",
    "description": "Add a gate-fail scenario to lock-contention: B submits a claim with a non-existent ref; the structured reasons render in the panel and the form text (subject, intent, refs) is preserved after the rejection.",
    "project": "mcp-web",
    "files": [
      "e2e/lock-contention.e2e.ts"
    ],
    "acceptance": [
      "Spec submits a claim whose refs array contains an id not present in the snapshot, triggering a gate failure",
      "Spec asserts .gate-reasons renders a non-empty list of reason strings (format roundtrip <kind> @<id>: <detail>)",
      "Spec re-reads the claim form fields after rejection and asserts subject, intent, and the rejected ref are still rendered in the inputs — text not lost"
    ],
    "depends_on": "05"
  },
  {
    "id": "07",
    "title": "Flip DoDs and header status in 02-scope-ui-2-turnos.md",
    "description": "After both e2e specs are green, edit docs/roadmap-web-ui/02-scope-ui-2-turnos.md to change header status from 'proposto' to 'concluído' and flip all five Definition-of-Done checkboxes from [ ] to [x].",
    "project": "mcp-web",
    "files": [
      "docs/roadmap-web-ui/02-scope-ui-2-turnos.md"
    ],
    "acceptance": [
      "Header line 3 reads Status: concluído (with original date and Índice-pai preserved)",
      "All five DoD checklist items (lines ~41-52) show [x] — Turno ponta a ponta, Contenção legível, Gate-fail legível, e2e da fase, CI verde",
      "No other content of the doc (sections 1-4, decisions, risks) is modified — diff is purely the status + checkbox flips"
    ],
    "depends_on": "06"
  },
  {
    "id": "08",
    "title": "Validate local CI gate: tsc, bun test, build, e2e chromium",
    "description": "Run the four-step local gate against packages/mcp-web after the spec edits and DoD flip to confirm everything is green before closing the phase and handing back to the orchestrator.",
    "project": "mcp-web",
    "files": [
      "packages/mcp-web/package.json",
      "packages/mcp-web/tsconfig.json"
    ],
    "acceptance": [
      "tsc --noEmit on packages/mcp-web exits 0 (no type errors in src or e2e)",
      "bun test passes the full unit suite of mcp-web (PresenceStore/GhostStore/ToastQueue ports and cells marshalling)",
      "vite build of mcp-web succeeds producing dist/, and playwright e2e chromium headless runs all specs in e2e/*.e2e.ts including the two new ones and exits 0"
    ],
    "depends_on": "07"
  }
]
```