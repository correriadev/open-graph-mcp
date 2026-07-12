/**
 * migrate.ts — one-shot backfill of STRUCTURAL anchors onto existing MetaRecords.
 *
 * Horizon 1 shipped `resolveAnchor` (tree-sitter token-stream identity) but the records already
 * on disk carry only the verbatim `anchor` line — so the live gates (nodeGrade in watch.ts,
 * imports-manifest) fall back to the legacy substring path for them. This migrates each record
 * that resolves: it derives the symbol's `symbolPath` from the record id (the name_path minus its
 * module segment), locates that declaration in the parsed file, and records the canonical
 * `tokenHash`. Records that don't resolve (non-TS files, file-level nodes with no declaration,
 * renamed/moved symbols) are surfaced as an explicit worklist — never silently dropped.
 *
 * Deterministic and non-destructive: the append-only shards are never rewritten; migrated records
 * are appended as new versions (fresh seq, LWW-by-seq wins at read time). Re-running is idempotent
 * in effect — an already-migrated record whose tokenHash is unchanged produces an identical value.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { readAllMeta, appendShard, type MetaRecord } from "./meta"
import {
  anchorLangOf,
  declTypesFor,
  findBySymbolPath,
  identTypesFor,
  renameStableHashOf,
  skipLeafTypesFor,
  symbolPathOf,
  tokenHashOf,
} from "./extract"
import { parseLang } from "./treesitter"

export type MigrateEntry = { id: string; reason: string }
export type MigrateResult = {
  total: number
  migrated: number
  alreadyCurrent: number
  worklist: MigrateEntry[]
}

/** symbolPath candidate for a record = its name_path minus the leading module segment. */
export function symbolPathFromId(id: string): string {
  const segs = id.split("/").filter(Boolean)
  return segs.slice(1).join("/")
}

/**
 * Backfills structural anchors. `readFile` and a `write` sink are injectable for testing; by
 * default it reads from `root` and appends migrated records to their module shards.
 */
export async function migrateAnchors(
  root: string,
  opts: {
    readFile?: (file: string) => string | undefined
    write?: (module: string, records: readonly MetaRecord[]) => void
  } = {},
): Promise<MigrateResult> {
  const read =
    opts.readFile ??
    ((f: string) => {
      try {
        return readFileSync(path.resolve(root, f), "utf8")
      } catch {
        return undefined
      }
    })
  const write = opts.write ?? ((module: string, records: readonly MetaRecord[]) => appendShard(root, module, records))

  const meta = readAllMeta(root)
  const worklist: MigrateEntry[] = []
  const migratedByModule = new Map<string, MetaRecord[]>()
  let alreadyCurrent = 0

  // parse each file once, reuse its tree across all records in that file
  const treeCache = new Map<string, Awaited<ReturnType<typeof parseLang>> | null>()

  for (const rec of meta) {
    const lang = anchorLangOf(rec.file)
    if (!lang) {
      worklist.push({ id: rec.id, reason: `unsupported language for ${rec.file}` })
      continue
    }
    const symbolPath = symbolPathFromId(rec.id)
    if (!symbolPath) {
      worklist.push({ id: rec.id, reason: "file-level node (no symbol declaration to anchor)" })
      continue
    }

    let tree = treeCache.get(rec.file)
    if (tree === undefined) {
      const content = read(rec.file)
      tree = content === undefined ? null : await parseLang(lang, content)
      treeCache.set(rec.file, tree)
    }
    if (!tree) {
      worklist.push({ id: rec.id, reason: `file not readable/parseable: ${rec.file}` })
      continue
    }

    // per-language sets (A1 fix): hashing with TS defaults for go/py/rs records produced
    // hashes that disagree with resolveAnchor's per-language ones at watch time → false drift.
    const declTypes = declTypesFor(lang)
    const skipLeafTypes = skipLeafTypesFor(lang)
    const identTypes = identTypesFor(lang)

    const node = findBySymbolPath(tree.rootNode, symbolPath, declTypes)
    if (!node) {
      worklist.push({ id: rec.id, reason: `symbolPath "${symbolPath}" unresolved in ${rec.file}` })
      continue
    }

    const tokenHash = tokenHashOf(node, skipLeafTypes)
    const renameStableHash = renameStableHashOf(node, skipLeafTypes, identTypes)
    const canonicalPath = symbolPathOf(node, declTypes) // may refine nesting; keep the resolved one
    if (rec.symbolPath === canonicalPath && rec.tokenHash === tokenHash && rec.renameStableHash === renameStableHash) {
      alreadyCurrent++
      continue
    }

    const module = rec.id.split("/")[0]!
    const updated: MetaRecord = { ...rec, symbolPath: canonicalPath, tokenHash, renameStableHash }
    const list = migratedByModule.get(module) ?? []
    list.push(updated)
    migratedByModule.set(module, list)
  }

  let migrated = 0
  for (const [module, records] of [...migratedByModule.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    write(module, records)
    migrated += records.length
  }

  return { total: meta.length, migrated, alreadyCurrent, worklist }
}
