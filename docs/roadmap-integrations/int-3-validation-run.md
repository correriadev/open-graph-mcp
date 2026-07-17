# INT-3 — End-to-end validation run (DoD item 8)

> Status: **done**. Base commit range: `dd1616b`..`5e4a2be`..(this doc's commit),
> branch `int-3-claude-code-plugin`. Índice-pai: `README.md`, escopo:
> `03-scope-int-3-claude-code-plugin.md`.

Prompt-driven (not scripted) validation per explicit choice: the point was to
retire roadmap Risk #1 ("skill não pega"), which only a real, unprompted
agent session can test — a scripted tool-call sequence would prove wiring
only.

## Setup

- Real `mcp-server` (`bun run src/index.ts`) on `:8787`, `GRAPH_REPO_PATH`
  pointing at a throwaway fixture repo (`packages/mcp-server/test/fixtures/fresh`,
  copied out so edits don't touch the real fixture), auto-bootstrapped.
- Real `mcp-web` dev server (`vite`, `:5175`) as the second/observer user's
  browser client — driven for real via `claude-in-chrome` (typed a name,
  clicked through the actual app), not curl.
- Real `claude --plugin-dir packages/claude-plugin` sessions as "the agent",
  via the validated non-bare recipe from `int-3-validation-harness.md`.
- **Isolation**: `HOME` pointed at a scratch dir with `.claude` **symlinked**
  to the real one (so OAuth still resolves — a fully separate `HOME` hits
  `"Not logged in"`, since `--bare` isn't viable per the harness doc and
  regular auth lives under `~/.claude`) and a fresh, real `.open-graph-mcp/`
  underneath (so the plugin's on-disk credentials never touch
  `~/.open-graph-mcp/credentials.json`). Confirmed real credentials
  byte-identical before/after this run.
- `--dangerously-skip-permissions` for a **nested** `claude`
  invocation is blocked by this orchestrating session's own auto-mode
  classifier — correctly, since granting an unrestricted nested agent isn't
  this session's call to make unilaterally. Worked around it the sanctioned
  way: `--allowedTools` scoped to exactly the open-graph MCP tools + one
  `Edit(src/audit.ts)` rule for the mechanics-of-editing checks, and plain
  default permission mode (Edit auto-denied, but per the harness doc
  "PreToolUse still fires... before the permission gate") for the
  skill-adherence checks.

## Finding 1 (bug, fixed): PreToolUse advisory silently no-oped on `domain: null`

`pre-tool-use-advisory.sh`'s file→cell mapping required
`$c.domain != null` before considering a `graph.query` candidate. On this
fixture — and empirically on **any** freshly-bootstrapped or never-claimed
node, which `assignDomain`'s fallback (`packages/graph-core/src/domains.ts`)
makes the common case, not an edge case — every candidate has `domain: null`.
The filter silently excluded them all, so the hook printed nothing on every
single Edit, even with a real, live lock on the file from another user
(confirmed via `bash -x` trace: `pairs=[]` → `exit 0` before reaching the
lock check at all).

`packages/mcp-web/src/render.ts`'s `cellKey()` — the actual production
client that opens changesets/locks cells — already has an answer:
`` `${n.domain ?? "unassigned"}:${n.level}` ``. `domain: null` isn't "no
mapping," it's the cell `"unassigned:<level>"`. Fixed
`pre-tool-use-advisory.sh` to match: drop the `domain != null` filter,
default to `"unassigned"` when building the pair. Re-verified live against
a real lock on `unassigned:P4` — advisory now fires correctly:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"unassigned:P4 is locked by u_09355625d2ba24a5 (cs_abdb8c8f01d3ba26, expires 2026-07-17T18:32:38.853Z) — consider checking presence.who or opening your own changeset on a different cell first."}}
```

This shipped as part of this validation, not a follow-up — the bug would
have made the advisory hook a no-op on essentially every real repo (nobody
claims a domain on day one).

## Finding 2 (methodology correction, no bug): stream-json doesn't surface `PreToolUse` `hook_started`/`hook_response`

Initially read "zero PreToolUse hook events in the stream" as "PreToolUse
never fires" — wrong conclusion. Isolated with a minimal throwaway plugin
(`hooks.json` with just `PreToolUse` on `Edit|Write`, script that tees its
stdin to a log file) run the exact same way: **the hook fired and the log
file got real stdin** (`hook_event_name":"PreToolUse"`, real `tool_input`),
while the stream-json output still showed **zero** `hook_started`/
`hook_response` events for it — only `SessionStart` ones appeared. So in
this Claude Code version (`2.1.212`), stream-json's hook-event reporting is
incomplete for `PreToolUse` specifically; it is not evidence the hook didn't
run. `int-3-validation-harness.md`'s claim that `PreToolUse` events show up
in the stream should be read as "were observed to" in that spike's specific
conditions, not as a universal guarantee — verify PreToolUse hooks going
forward via a side-effect (a log file, or the advisory text actually
reaching the model's answer), not via stream-json event counts.

## Finding 3 (environmental, not a plugin bug): one `mcp_servers: status: "failed"`

One run (immediately after Finding 1's bug fix, under concurrent load —
two dev servers, a browser session, prior `claude` runs still settling)
showed the plugin's MCP server connection status as `"failed"` in
`system/init`, and the agent correctly reported "tools not exposed" and
proceeded without them rather than guessing. A clean rerun with
`--debug mcp --debug-file` moments later showed a normal connect
(`"Successfully connected (transport: stdio) in 226ms"`). Treat as
transient resource contention on a loaded dev machine, not a reproducible
proxy defect — but flag for a future task if `mcp_servers: "failed"` ever
recurs outside a loaded-machine context, since nothing here proves it can't.

## Finding 4 (positive — Risk #1 substantially retired)

Full task: *"Add a one-line comment above adversarialAudit in
src/audit.ts"* — no mention of open-graph in the prompt. With MCP connected
and the (fixed) advisory hook live:

1. Agent went straight for `Read` → `Edit` (did not proactively query the
   graph first — the skill's step-1 "query before implementing" did **not**
   trigger on its own for this task).
2. `Edit` hit the fixed `PreToolUse` advisory (real lock, real cell,
   real holder/csId/expiry — see Finding 1's payload above).
3. **The agent then invoked `Skill: open-graph:using-open-graph` on its
   own**, unprompted, in direct response to the advisory text.
4. Final answer: *"Cell lock: `src/audit.ts` maps to cell `unassigned:P4`,
   locked by user `u_09355625d2ba24a5` ... Open-graph rule: no hammer on
   locked cell — wait, coordinate with holder, or refocus."* — this is the
   skill's §3 guidance (`changeset.open`/`lock.denied`: "Never spin... pick
   one: wait / negotiate / refocus"), reproduced correctly from having just
   read it, not copied from the prompt.
5. Agent stopped rather than overriding the lock.

**Honest read**: the skill's *proactive* trigger (query before touching
anything) did not fire unprompted here — that half of Risk #1 is still
open. Its *reactive* trigger (recognize the advisory, pull up the skill,
apply its negotiation rules correctly) worked exactly as designed, and is
the half that actually prevents damage (an agent that edits without
querying first is suboptimal; one that edits over a live lock without
checking is the actual hazard the roadmap cares about). One run is not
statistical proof either way — flag proactive-trigger strength as a
follow-up if this matters more precisely later, e.g. by varying the prompt
to more/less obviously "sound like" a coordination-relevant task.

## Finding 5 (positive — confirms the whole live loop)

Screenshots taken from the actual second user's (maria, real browser
session via `claude-in-chrome`, real `changeset.open` call through the
app's own `api.ts`) browser at each step:

- After `agent-alice` connected (a prior run, SessionStart-only): maria's
  presence panel showed `agent-alice (claude-code)` appear live, alongside
  her own `maria (web)` — proof the plugin's `--live` proxy layer makes the
  agent visible to a human watching the web UI in real time, the core
  product claim of INT-3.
- Confirmed via direct `curl` to the running server, independent of the
  `claude` sessions, that `changeset.open`/lock state was real and shared
  (not a mock): the same `cs_...`/`u_...` IDs maria's browser produced are
  exactly what the agent's `PreToolUse` advisory and final answer cited.

## What this run does NOT cover

- `UserPromptSubmit` (the system-message drain hook) wasn't exercised live
  here — no `system.message`-worthy event (changeset abort, authority flip)
  was triggered during this session. It was already validated standalone
  end-to-end in the commit that introduced it (`dd1616b`); not repeated here
  to keep this run's scope to what changed.
- Statusline wasn't re-validated live in a `claude` session (it's a
  standalone script invoked by Claude Code's own statusline mechanism, not
  something a `-p` session exercises) — already validated standalone in
  `d76baef`.
- Multiple concurrent agents coordinating with each other (only one agent
  session + one web user were used). `int-3-validation-harness.md`'s
  "second-identity check" already showed two concurrent `--plugin-dir`
  sessions don't cross-talk; not re-proven here.
