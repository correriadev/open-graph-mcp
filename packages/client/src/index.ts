// Placeholder entry point for the Bun/Node compatibility spike (INT-2 scaffold task).
// Real extraction (EventStream, PresenceStore, envelope parsing, connect()) lands in a later task.

/**
 * Trivial pure function used only to prove the package's module format,
 * build step, and test setup work under both Bun and plain Node.js.
 */
export function ping(): string {
  return "pong"
}
