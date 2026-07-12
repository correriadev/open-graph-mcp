/**
 * worktree.ts — scratch git worktree for projection admission. Proposed files are
 * applied to a detached throwaway copy; the working tree is NEVER touched (spec:
 * projection is diff + admit only). Always cleaned up, pass or fail.
 */
import { execFileSync } from "node:child_process"
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

export type ProposedFile = { path: string; content: string }

/**
 * Resolves `rel` against `dir` and returns the absolute path ONLY if it stays inside
 * `dir` — otherwise undefined. Agent-supplied relative paths (absolute or ../ escapes)
 * must never reach outside the scratch worktree, whether for reads, writes, or test runs.
 *
 * Lexical containment alone is not enough: `writeFileSync`/`readFileSync` follow symlinks,
 * so a committed symlink inside the worktree pointing outside it (or a symlinked
 * intermediate directory) would let an agent-proposed path lexically "inside" `dir` land
 * on a real inode outside it. To close that, once the lexical check passes we walk the
 * real filesystem: reject if any existing path component (including the leaf itself, since
 * the leaf may already exist as a symlink) is a symlink, and verify the deepest existing
 * ancestor's realpath is still contained within `realpathSync(dir)`. If `dir` itself doesn't
 * exist on disk (e.g. a synthetic path in a unit test), there is nothing to have a symlink
 * in, so the lexical check stands alone.
 */
export function resolveInWorktree(dir: string, rel: string): string | undefined {
  const base = path.resolve(dir)
  const target = path.resolve(dir, rel)
  if (!target.startsWith(base + path.sep)) return undefined

  let realBase: string
  try {
    realBase = realpathSync(base)
  } catch {
    return target
  }

  const parts = path.relative(base, target).split(path.sep).filter(Boolean)
  let walked = base
  let deepestReal = realBase
  for (const part of parts) {
    walked = path.join(walked, part)
    let st
    try {
      st = lstatSync(walked)
    } catch {
      break // this component (and everything under it) doesn't exist yet
    }
    if (st.isSymbolicLink()) return undefined
    deepestReal = realpathSync(walked)
  }

  if (deepestReal !== realBase && !deepestReal.startsWith(realBase + path.sep)) return undefined
  return target
}

/**
 * `baseRef` defaults to `HEAD`, matching prior behavior. Note this cuts the scratch worktree
 * at the last commit, not the (possibly dirty) working tree — an admitted diff can therefore
 * still fail to apply, or interleave badly with uncommitted edits, against the real working
 * tree. Callers that need the cut closer to live state can pass a merge-base ref explicitly;
 * either way, run `checkAppliable` before telling a human to `git apply` the result.
 */
export function withScratchWorktree<T>(
  repoRoot: string,
  files: readonly ProposedFile[],
  fn: (dir: string) => T,
  baseRef = "HEAD",
): T {
  const parent = mkdtempSync(path.join(tmpdir(), "graph-project-"))
  const dir = path.join(parent, "wt")
  try {
    execFileSync("git", ["worktree", "add", "--detach", dir, baseRef], { cwd: repoRoot, stdio: "pipe" })
    for (const f of files) {
      // files are agent-supplied: bound every write to the scratch dir (write-side twin of the read guard)
      const target = resolveInWorktree(dir, f.path)
      if (!target) throw new Error(`proposed file escapes worktree: ${f.path}`)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, f.content)
    }
    return fn(dir)
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: repoRoot, stdio: "pipe" })
    } catch {
      /* add may never have succeeded */
    }
    rmSync(parent, { recursive: true, force: true })
  }
}

export type AppliabilityCheck = { ok: boolean; reasons: string[] }

/**
 * Verifies the worktree's current diff (against `baseRef`, default `HEAD`) would actually
 * `git apply` cleanly onto the real working tree at `repoRoot`. The worktree is cut at a
 * commit, not the dirty working tree (see `withScratchWorktree`), so admission judged solely
 * against the worktree can rubber-stamp a diff that conflicts with uncommitted edits or
 * otherwise fails to apply. This is a dry run only (`git apply --check`) — it never mutates
 * `repoRoot`.
 */
export function checkAppliable(repoRoot: string, dir: string, baseRef = "HEAD"): AppliabilityCheck {
  try {
    execFileSync("git", ["add", "-N", "."], { cwd: dir, stdio: "pipe" })
  } catch (err) {
    return { ok: false, reasons: [`failed to stage worktree diff: ${String((err as Error).message ?? err)}`] }
  }

  let diff: string
  try {
    diff = execFileSync("git", ["diff", baseRef], { cwd: dir, stdio: "pipe" }).toString()
  } catch (err) {
    return { ok: false, reasons: [`failed to produce worktree diff: ${String((err as Error).message ?? err)}`] }
  }

  if (!diff.trim()) return { ok: true, reasons: [] }

  try {
    execFileSync("git", ["apply", "--check"], { cwd: repoRoot, input: diff, stdio: "pipe" })
    return { ok: true, reasons: [] }
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string })?.stderr
    const reason = stderr ? stderr.toString().trim() : String((err as Error).message ?? err)
    return { ok: false, reasons: [reason || "git apply --check failed"] }
  }
}
