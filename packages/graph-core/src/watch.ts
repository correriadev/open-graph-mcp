/**
 * watch.ts — torna o grafo VIVO: detecta quando o chão (código) mudou e propaga a cicatriz.
 * Re-checa a âncora de cada nó contra o source atual; nó cuja âncora sumiu/mudou vira stale/gone.
 * Cascateia aos claims que o referenciam (índice reverso). Emite eventos append-only com proveniência.
 *
 * Determinístico, sem LLM. Idempotente: só registra MUDANÇAS de status (re-rodar sem mudança = 0 eventos).
 * Espelha propagation.py da POC super-assistant: log_event / read_events / events_between / mark_stale.
 */
import { readFileSync, appendFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import { excerptCheck, resolveAnchor } from "./extract"
import { readAllMeta, appendShard, type MetaRecord } from "./meta"
import { readAllClaims, type ClaimRecord } from "./claim-store"
import { demoteGraded, getAuthority, setAuthority, cellKey as authorityCellKey, type DriftGrade } from "./authority"
import { readImportsManifest, verifyImportsManifest, type ImportsDrift } from "./imports-manifest"
import { loadFolded } from "./events-snapshot"
import { dirtyFiles } from "./state-index"
import type { Graph } from "./build"

export type Status = "fresh" | "stale" | "gone"
/** Convenção "só não-fresh entra no mapa", agora no sistema de tipos (spec v2-04). */
export type DriftStatus = Exclude<Status, "fresh">
export type WatchEvent = {
  ts: string
  type: "stale" | "gone" | "recovered" | "demoted" | "suspended"
  kind: "node" | "claim" | "cell"
  id: string
  cause: string
}

/**
 * A persisted heal for a drifted node (specs 02/03). The watch cycle writes a new MetaRecord
 * version (LWW-by-seq via appendShard) with the refreshed identity, converging the node to
 * "fresh" on the next cycle instead of re-detecting the same drift forever.
 * - `reason: "renamed"`: symbol moved to `symbolPath` (from resolveAnchor's fallback scan).
 *   watch() emits a "recovered" event with rename provenance; the alias lives in the event log.
 * - `reason: "lexical"`: format-only drift (tokenHash equal, excerpt moved). watch() writes the
 *   heal but emits NO heal-specific event — diffEvents emits "recovered" naturally on the next
 *   cycle when the refreshed excerpt passes excerptCheck (keeps diffEvents the single source of
 *   status events; stated choice per spec 03).
 */
export type HealRecord = {
  id: string
  symbolPath: string
  tokenHash: string
  anchor: string
  reason: "renamed" | "lexical"
}

const sev = (s: Status) => (s === "gone" ? 2 : s === "stale" ? 1 : 0)

/** Status de um nó: gone se o arquivo sumiu, stale se a âncora não existe mais verbatim, senão fresh. */
export function nodeStatus(node: MetaRecord, readFile: (f: string) => string | undefined): Status {
  const content = readFile(node.file)
  if (content === undefined) return "gone"
  return excerptCheck(content, node.anchor) ? "fresh" : "stale"
}

/** Status corrente de todos os nós (só os não-fresh entram no mapa). */
export function computeNodeStale(
  meta: readonly MetaRecord[],
  readFile: (f: string) => string | undefined,
): Map<string, DriftStatus> {
  const out = new Map<string, DriftStatus>()
  for (const m of meta) {
    const s = nodeStatus(m, readFile)
    if (s !== "fresh") out.set(m.id, s)
  }
  return out
}

// ── graded drift (INV-H1-2) ─────────────────────────────────────────────────
// Separate pipeline from Status above (which stays untouched — it still drives node/claim
// events exactly as before). This one grades HOW a node drifted and feeds ONLY the graded
// cell-demotion route (demoteGraded in authority.ts). Async because resolveAnchor parses
// the file with tree-sitter.

/**
 * Grade a single node's drift. Legacy-mapping decision (DESIGN §2): a MetaRecord with BOTH
 * symbolPath+tokenHash uses the structural gate (resolveAnchor); "match" splits into "fresh"
 * (verbatim excerpt still present) vs "lexical" (hash equal, text moved — format-only,
 * refresh-the-excerpt is a separate concern, not graded here). A MetaRecord missing either
 * field is LEGACY: it keeps today's verbatim excerptCheck semantics for grading purposes —
 * a miss grades "gone" (not "structural"), because "gone" is the ONLY grade that still routes
 * a β cell straight to "source" in demoteGraded, which is exactly what a legacy anchor-miss
 * does today via demoteDrifted. This is the one deliberate choice that keeps every existing
 * watch/authority test passing unchanged while still fitting the new taxonomy.
 *
 * "renamed" (spec 04): the structural gate passes the record's persisted `renameStableHash`
 * (populated by the migration in meta.ts, spec 03) as resolveAnchor's 5th argument. When the
 * symbol's OLD symbolPath no longer resolves but resolveAnchor's fallback scan proves the same
 * body survives under a new name (anchor grade "renamed"), the node grades "renamed" too — a
 * pure rename is real evidence of movement, not loss, so it never demotes a β cell (see
 * authority.ts demoteGraded / gradeSeverity). A record without a stored `renameStableHash`
 * (pre-migration) passes `undefined` through, so resolveAnchor's fallback scan never runs and
 * a rename still grades "gone" exactly as before — the conservative legacy behavior is preserved.
 */
export async function nodeGradeDetailed(
  node: MetaRecord,
  readFile: (f: string) => string | undefined,
): Promise<{ grade: DriftGrade; heal?: HealRecord }> {
  const content = readFile(node.file)
  if (content === undefined) return { grade: "gone" }

  if (node.symbolPath && node.tokenHash) {
    const resolved = await resolveAnchor(content, node.file, node.symbolPath, node.tokenHash, node.renameStableHash)
    if (resolved.grade === "renamed") {
      // spec 02: persist the new identity (newSymbolPath + tokenHash + refreshed anchor) so the
      // rename is absorbed once. Ambiguous rename (2+ matches) → resolveAnchor returns "gone",
      // so we never heal here — fail-closed unchanged.
      const heal =
        resolved.newSymbolPath && resolved.tokenHash && resolved.firstLine
          ? { id: node.id, symbolPath: resolved.newSymbolPath, tokenHash: resolved.tokenHash, anchor: resolved.firstLine, reason: "renamed" as const }
          : undefined
      return { grade: "renamed", heal }
    }
    if (resolved.grade === "gone") return { grade: "gone" }
    if (resolved.grade === "structural") return { grade: "structural" }
    // "match": tokenHash equal — verbatim-present distinguishes fresh (no-op) from lexical (format-only).
    if (excerptCheck(content, node.anchor)) return { grade: "fresh" }
    // spec 03: lexical drift — hash equal but excerpt moved. Heal the excerpt so the legacy
    // verbatim pipeline stops emitting permanent "stale" for formatted files.
    return {
      grade: "lexical",
      heal: resolved.firstLine
        ? { id: node.id, symbolPath: node.symbolPath, tokenHash: node.tokenHash, anchor: resolved.firstLine, reason: "lexical" as const }
        : undefined,
    }
  }

  // legacy path — no structural fields: preserve today's verbatim behavior EXACTLY.
  return { grade: excerptCheck(content, node.anchor) ? "fresh" : "gone" }
}

export async function nodeGrade(node: MetaRecord, readFile: (f: string) => string | undefined): Promise<DriftGrade> {
  return (await nodeGradeDetailed(node, readFile)).grade
}

/** Graded status of all nodes (só os não-fresh entram no mapa, mesma convenção de computeNodeStale). */
export async function computeNodeGrades(
  meta: readonly MetaRecord[],
  readFile: (f: string) => string | undefined,
): Promise<Map<string, DriftGrade>> {
  return (await computeNodeGradesDetailed(meta, readFile)).grades
}

/**
 * Detailed graded status: returns both the grade map (non-fresh only) and the heal records
 * (specs 02/03). Heals are written back by `watch()` via appendShard so the node converges to
 * "fresh" on the next cycle instead of re-detecting the same drift forever.
 */
export async function computeNodeGradesDetailed(
  meta: readonly MetaRecord[],
  readFile: (f: string) => string | undefined,
): Promise<{ grades: Map<string, DriftGrade>; heals: HealRecord[] }> {
  const grades = new Map<string, DriftGrade>()
  const heals: HealRecord[] = []
  for (const m of meta) {
    const { grade, heal } = await nodeGradeDetailed(m, readFile)
    if (grade !== "fresh") grades.set(m.id, grade)
    if (heal) heals.push(heal)
  }
  return { grades, heals }
}

/** Propaga aos claims: claim fica stale/gone = pior status entre seus refs abalados. */
export function propagateToClaims(
  claims: readonly ClaimRecord[],
  nodeStale: Map<string, DriftStatus>,
): Map<string, DriftStatus> {
  const out = new Map<string, DriftStatus>()
  for (const c of claims) {
    let worst: Status = "fresh"
    for (const r of c.refs) {
      const s = nodeStale.get(r)
      if (s && sev(s) > sev(worst)) worst = s
    }
    if (worst !== "fresh") out.set(c.id, worst)
  }
  return out
}

/** Último status conhecido por id, replayando o log (recovered volta a fresh). */
export function lastKnown(events: readonly WatchEvent[]): Map<string, Status> {
  const out = new Map<string, Status>()
  for (const e of events) {
    if (e.type === "recovered") out.set(e.id, "fresh")
    else out.set(e.id, e.type as Status)
  }
  return out
}

/**
 * Diff entre o conhecido (replay do log) e o atual → eventos NOVOS apenas.
 * Vira stale/gone (ou muda de stale→gone) = evento; volta a fresh = recovered.
 */
export function diffEvents(
  prev: Map<string, Status>,
  current: Map<string, DriftStatus>,
  kind: "node" | "claim",
  ts: string,
): WatchEvent[] {
  const events: WatchEvent[] = []
  // novos abalos / agravamentos
  for (const [id, s] of current) {
    const known = prev.get(id) ?? "fresh"
    if (s !== known) {
      events.push({ ts, type: s, kind, id, cause: s === "gone" ? "file or anchor removed" : "anchor changed" })
    }
  }
  // recuperações: estava abalado, sumiu do mapa atual (voltou fresh)
  for (const [id, known] of prev) {
    if (known !== "fresh" && !current.has(id)) {
      events.push({ ts, type: "recovered", kind, id, cause: "anchor verbatim again" })
    }
  }
  return events
}

// ── log I/O ───────────────────────────────────────────────────────────────
function eventsPath(root: string): string {
  return path.join(root, ".graph", "events.jsonl")
}

export function readEvents(root: string): WatchEvent[] {
  const file = eventsPath(root)
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as WatchEvent)
}

export function appendEvents(root: string, events: readonly WatchEvent[]): string {
  const file = eventsPath(root)
  mkdirSync(path.dirname(file), { recursive: true })
  if (events.length) appendFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n")
  return file
}

/** O 'diff' entre dois marcos: eventos no intervalo (ts ISO). */
export function eventsBetween(events: readonly WatchEvent[], since?: string, until?: string): WatchEvent[] {
  return events.filter((e) => (!since || e.ts >= since) && (!until || e.ts <= until))
}

export type WatchResult = {
  newEvents: WatchEvent[]
  nodeStale: Map<string, DriftStatus>
  claimStale: Map<string, DriftStatus>
}

/**
 * Roda o ciclo completo: re-checa, propaga, diffa contra o log, anexa os novos eventos.
 *
 * INV-H1-4: só lê o SOURCE de arquivos que mudaram desde o ciclo anterior. `dirtyFiles`
 * (state-index.ts) decide isso via um cache (mtime, sha256) separado do `file_hash` existente
 * (que fingerprinta META records, não bytes de source). Para nó cujo arquivo é "clean", carrega
 * o último status conhecido (`prior`, já vindo de loadFolded) em vez de reler+recomputar — o
 * EQUIVALENCE safety invariant vale porque status é função pura do conteúdo do arquivo: bytes
 * inalterados ⇒ status inalterado, então "pular" um arquivo clean produz exatamente o mesmo
 * resultado que recomputá-lo teria produzido.
 *
 * `nodeGrades` (pipeline graduada, INV-H1-2) segue a MESMA regra mas de forma mais conservadora:
 * só é recomputada para nós de arquivo dirty; para células já "graph" cujos nós são todos de
 * arquivos clean, `demoteGraded` simplesmente não vê grade nenhuma pra elas nesse ciclo (files
 * fica vazio, "fresh" vence) e não demove nada — o mesmo resultado que um full-scan teria dado,
 * já que full-scan também computaria "fresh" pra todo nó cujo arquivo não mudou. `demoteGraded`
 * nunca reverte uma célula já "suspended"/"source" de volta (só decide sobre células "graph"),
 * então pular grade em nós clean não pode causar uma recuperação espúria.
 */
export async function watch(root: string, readFile?: (f: string) => string | undefined): Promise<WatchResult> {
  const read =
    readFile ??
    ((f: string) => {
      try {
        return readFileSync(path.resolve(root, f), "utf8")
      } catch {
        return undefined
      }
    })

  const meta = readAllMeta(root)
  const claims = readAllClaims(root)

  // prior last-known state = snapshot + tail (bounded replay), identical to folding the full log
  // when no snapshot exists (events-snapshot.ts). Also doubles as the carry-forward baseline for
  // clean files below. Reading it here (before any mutation this cycle) is safe: events.jsonl /
  // graph.json / source_hash are all only written at the END of this function.
  const prior = loadFolded(root)

  const files = [...new Set(meta.map((m) => m.file))]
  const { dirty, commit } = dirtyFiles(root, files, undefined, read)

  // split meta into "needs recompute" (dirty file) vs "carry forward prior status" (clean file)
  const dirtyMeta: MetaRecord[] = []
  const nodeStale = new Map<string, DriftStatus>()
  for (const m of meta) {
    if (dirty.has(m.file)) {
      dirtyMeta.push(m)
      continue
    }
    const p = prior.node.get(m.id)
    if (p && p !== "fresh") nodeStale.set(m.id, p) // only non-fresh entries live in the map (same convention as computeNodeStale)
  }
  for (const [id, s] of computeNodeStale(dirtyMeta, read)) nodeStale.set(id, s)

  const claimStale = propagateToClaims(claims, nodeStale)
  // graded pipeline — recompute ONLY for dirty-file nodes; drives ONLY cell demotion (INV-H1-2)
  const { grades: nodeGrades, heals } = await computeNodeGradesDetailed(dirtyMeta, read)

  const ts = new Date().toISOString()
  const newEvents = [
    ...diffEvents(prior.node, nodeStale, "node", ts),
    ...diffEvents(prior.claim, claimStale, "claim", ts),
  ]
  const demotionEvents = await stampGraph(root, nodeStale, nodeGrades, read)
  newEvents.push(...demotionEvents)
  // spec 02/03: heal write-back — persist the new identity (renamed) or refreshed excerpt (lexical)
  // via appendShard (LWW-by-seq, same non-destructive mechanism migrate.ts uses). Renamed heals
  // emit a "recovered" event with rename provenance; lexical heals emit nothing (diffEvents emits
  // "recovered" naturally on the next cycle when the refreshed excerpt matches).
  const healEvents = applyHeals(root, heals, meta, ts)
  newEvents.push(...healEvents)
  appendEvents(root, newEvents)
  commit() // baseline for next cycle's dirtyFiles — only after log+graph.json are durably written
  return { newEvents, nodeStale, claimStale }
}

/**
 * Cell-dag cellId ("domain::P5") → authority key ("domain:5"), a convenção de authority.ts.
 * Malformado (sem "::" ou nível fora do padrão PN) → null, ignorado (sem adivinhar).
 */
function cellIdToAuthorityKey(cellId: string): string | null {
  const idx = cellId.lastIndexOf("::")
  if (idx < 0) return null
  const domain = cellId.slice(0, idx)
  const m = /^P(\d+)$/.exec(cellId.slice(idx + 2))
  if (!m) return null
  return authorityCellKey(domain, Number(m[1]))
}

/**
 * Imports-manifest check (blindspot 1.2): se `.graph/imports.json` existe, recomputa o drift
 * de símbolos estrangeiros e suspende (via setAuthority) toda célula IMPORTADORA β ("graph")
 * cujo dep estrangeiro driftou — a causa nomeia o(s) símbolo(s). Célula sem drift ou que não
 * está "graph" não é tocada. Sem manifesto → no-op (sem mudança de comportamento).
 */
async function applyImportsManifestSuspension(
  g: Graph,
  root: string,
  readFile: (f: string) => string | undefined,
): Promise<{ graph: Graph; events: WatchEvent[] }> {
  const manifest = readImportsManifest(root)
  if (!manifest) return { graph: g, events: [] }

  const drifts: ImportsDrift[] = await verifyImportsManifest(manifest, g, readFile)
  const ts = new Date().toISOString()
  const events: WatchEvent[] = []
  let out = g
  for (const d of drifts) {
    const authKey = cellIdToAuthorityKey(d.cell)
    if (!authKey) continue
    if (getAuthority(out, authKey) !== "graph") continue // só toca célula importadora β
    out = setAuthority(out, authKey, "suspended")
    events.push({
      ts,
      type: "suspended",
      kind: "cell",
      id: authKey,
      cause: `foreign symbol drift: ${d.driftedSymbols.join(", ")}`,
    })
  }
  return { graph: out, events }
}

/**
 * Carimba o status stale nos nós do graph.json (visível pra consumidores/docs) e demota/suspende
 * cells graph-authoritative cujo nó de código driftou, via a rota graduada (demoteGraded):
 * "gone" reverte pra source (loud); "structural" suspende (bloqueia projeção, guarda proveniência);
 * "lexical"/"fresh" nunca tocam autoridade — formatação sozinha não demote mais nada (INV-H1-2).
 * Adicionalmente (blindspot 1.2): verifica o imports-manifest (se existir) e suspende células
 * importadoras β com drift de símbolo estrangeiro — ver applyImportsManifestSuspension.
 */
async function stampGraph(
  root: string,
  nodeStale: Map<string, DriftStatus>,
  nodeGrades: ReadonlyMap<string, DriftGrade>,
  readFile: (f: string) => string | undefined,
): Promise<WatchEvent[]> {
  const file = path.join(root, ".graph", "graph.json")
  if (!existsSync(file)) return []
  try {
    let g = JSON.parse(readFileSync(file, "utf8"))
    if (!Array.isArray(g.nodes)) return []
    for (const n of g.nodes) {
      const s = nodeStale.get(n.id)
      if (s) n.stale = s
      else delete n.stale
    }
    const { graph: demotedGraph, demoted } = demoteGraded(g as Graph, nodeGrades)
    g = demotedGraph
    const ts = new Date().toISOString()
    const gradedEvents = demoted.map((d) => ({
      ts,
      type: d.grade === "gone" ? ("demoted" as const) : ("suspended" as const),
      kind: "cell" as const,
      id: d.cell,
      cause:
        d.grade === "gone"
          ? `drift in graph-authoritative cell: ${d.files.join(", ")} — reverted to source`
          : `structural drift in graph-authoritative cell: ${d.files.join(", ")} — suspended pending reconcile`,
    }))

    const { graph: withImports, events: importsEvents } = await applyImportsManifestSuspension(g as Graph, root, readFile)
    g = withImports

    writeFileSync(file, JSON.stringify(g, null, 2))
    return [...gradedEvents, ...importsEvents]
  } catch {
    /* graph.json malformado — ignora, eventos já persistidos */
    return []
  }
}

/**
 * Heals drifted nodes by appending refreshed MetaRecord versions (specs 02/03).
 * - Renamed: persists the new symbolPath/tokenHash/anchor; emits a "recovered" event with
 *   "renamed: <old> -> <new>" provenance. The alias lives in the append-only event log.
 * - Lexical: persists the refreshed excerpt (symbolPath/tokenHash unchanged); emits NO event —
 *   diffEvents emits "recovered" naturally on the next cycle when the healed excerpt matches.
 * Both use appendShard (LWW-by-seq, non-destructive — same mechanism as migrate.ts). Record
 * accuracy is independent of authority: an α-cell rename heals too.
 */
function applyHeals(root: string, heals: readonly HealRecord[], meta: readonly MetaRecord[], ts: string): WatchEvent[] {
  if (heals.length === 0) return []
  const metaById = new Map(meta.map((m) => [m.id, m]))
  const healsByModule = new Map<string, MetaRecord[]>()
  const events: WatchEvent[] = []
  for (const h of heals) {
    const orig = metaById.get(h.id)
    if (!orig) continue
    const healed: MetaRecord = { ...orig, symbolPath: h.symbolPath, tokenHash: h.tokenHash, anchor: h.anchor }
    const module = h.id.split("/")[0]!
    const list = healsByModule.get(module) ?? []
    list.push(healed)
    healsByModule.set(module, list)
    if (h.reason === "renamed") {
      events.push({ ts, type: "recovered", kind: "node", id: h.id, cause: `renamed: ${orig.symbolPath ?? "?"} -> ${h.symbolPath}` })
    }
  }
  for (const [module, records] of healsByModule) appendShard(root, module, records)
  return events
}
