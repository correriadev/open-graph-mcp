/**
 * stored-state.ts — the one error a governed READ of durable state is allowed to raise.
 *
 * Extracted from `eap-repositories.ts` so that `recall-closure.ts` (which the repositories
 * themselves import, to maintain the closure membership index) can raise it without an import
 * cycle. `eap-repositories.ts` re-exports it, so every existing importer is unchanged.
 */

/**
 * A stored JSON column that does not parse.
 *
 * Every writer stringifies, so this is unreachable from client input — but `rebuildFromJsonl`
 * replays arbitrary on-disk JSONL into exactly these columns, so a truncated or hand-edited mirror
 * turned a governed read into an unhandled `SyntaxError` escaping the repository boundary. The tool
 * adapters map this to a typed Refusal: durable state that cannot be read is a resource that does
 * not resolve, not a crash.
 */
export class StoredStateCorruptionError extends Error {
  constructor(
    readonly table: string,
    readonly column: string,
    readonly rowId: string,
  ) {
    super(`Stored ${table}.${column} for '${rowId}' is not readable JSON; durable state is corrupt`)
    this.name = "StoredStateCorruptionError"
  }
}
