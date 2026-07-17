# INT-3 — Validation harness spike: isolated Claude Code sessions for hook testing

> Status: **spike concluded, DONE_WITH_CONCERNS**. Base commit
> `5e505b31856112258db53952da6db0ec729df28c`, branch `int-3-claude-code-plugin`.
> Índice-pai: `README.md`, escopo relacionado: `03-scope-int-3-claude-code-plugin.md`.

Prior research (cited in the task brief: `https://code.claude.com/docs/en/headless.md`,
`https://code.claude.com/docs/en/plugins-reference.md`, `https://code.claude.com/docs/en/hooks.md`)
proposed `claude --bare --plugin-dir <path> -p "<prompt>" --output-format stream-json`
as the isolation mechanism for validating this project's plugin hooks without
touching the orchestrator's live `~/.claude/`. This document reports what was
**actually observed** running that command on this machine
(`claude 2.1.212`, `~/.claude/` is the real config dir — confirmed via `ls -la ~/.claude/`,
which shows `settings.json`, `.credentials.json`, `plugins/`, `projects/`, etc.),
and corrects the research on a point that matters more than auth: **`--bare`
does not fire hooks at all, even the ones from a plugin you pass explicitly
via `--plugin-dir`.** Use non-bare `--plugin-dir` instead — see TL;DR.

## TL;DR for future INT-3 implementer subagents

**Use this — it is the verified, working recipe:**

```bash
claude --plugin-dir /path/to/your/plugin \
  --dangerously-skip-permissions \
  -p "your prompt" \
  --output-format stream-json --verbose --include-partial-messages
```

No `--bare`. This authenticates via the normal OAuth session (no extra API
key needed), fires your plugin's hooks reliably (confirmed: `hook_started`/
`hook_response` events appear, in order, before the first API request is
dispatched), and injects `additionalContext` that the model genuinely reads
and uses (confirmed end-to-end with a distinctive marker string — see
"Context injection" below).

**Do not use `--bare --plugin-dir` for hook validation.** Empirically, in
three separate runs on this machine — including one where authentication
was forced past the local pre-check with a syntactically-valid-but-wrong
`ANTHROPIC_API_KEY`, reaching real HTTP 401 retries — **zero** `hook_started`
or `hook_response` events were ever emitted, and the SessionStart hook's own
stdin-logging side effect never occurred. This matches `--bare --help`'s
literal text ("skip hooks") taken at face value: it applies even to hooks
from a plugin explicitly loaded via `--plugin-dir`. See "Critical finding"
for the full evidence chain, including a confound-breaker run that isolates
`--bare` (not the auth failure) as the cause.

**The safety property the isolation was meant to provide — no hook firing on
the orchestrator's own tool calls — holds for non-bare `--plugin-dir` too.**
`claude -p` is a separate subprocess; it cannot fire hooks against the
orchestrator's own tool calls regardless of `--bare`. The one thing non-bare
mode loses is *cleanliness*: it also auto-discovers and fires the
orchestrator's other installed plugins' hooks (confirmed: 3 foreign
`SessionStart` hooks fired alongside ours in every non-bare run — caveman,
superpowers, ponytail). That's an assertion-hygiene concern (filter your
grep/jq by `hook_name` or your plugin's distinctive marker string), not a
danger to the orchestrator's live session. It does **not** write anything
to `~/.claude/plugins/` or `~/.claude/settings.json` (confirmed via
before/after md5 diff across every run in this spike, bare and non-bare
alike) — see "Write isolation" below.

Add `--dangerously-skip-permissions` whenever your prompt needs an Edit/Write
to actually execute (e.g. to validate a PreToolUse hook's downstream effect).
Without it, `-p` mode does **not** hang — it auto-denies the tool call and
completes normally (see "Permission behavior" below) — but the file never
gets written, so if your test depends on the write having happened, add the
flag. PreToolUse fires either way (hooks run before the permission gate).

## Critical finding: `--bare` skips hook execution entirely, even for `--plugin-dir` plugins

This is the load-bearing correction to the initial research — more
important than the auth issue below, which is secondary and almost a red
herring: even with auth solved, `--bare` would very likely still not fire
your hooks.

`claude --help` (verified locally, not from web docs) states for `--bare`:

```
--bare   Minimal mode: skip hooks, LSP, plugin sync, attribution, auto-memory,
         background prefetches, keychain reads, and CLAUDE.md auto-discovery.
         Sets CLAUDE_CODE_SIMPLE=1. Anthropic auth is strictly ANTHROPIC_API_KEY
         or apiKeyHelper via --settings (OAuth and keychain are never read).
         3P providers (Bedrock/Vertex/Foundry) use their own credentials.
         Skills still resolve via /skill-name. Explicitly provide context via:
         --system-prompt[-file], --append-system-prompt[-file], --add-dir
         (CLAUDE.md dirs), --mcp-config, --settings, --agents, --plugin-dir.
```

Read literally, "skip hooks" is unconditional — the "explicitly provide
context via ... --plugin-dir" sentence only promises that a `--plugin-dir`
plugin's **skills/commands/tools** get loaded, not that its **hooks** get
wired up. The empirical evidence below confirms the literal reading:

**Run 1 — real `--bare --plugin-dir`, no API key available on this
machine.** Failed local auth pre-check immediately
(`"apiKeySource":"none"`, `"error":"authentication_failed"`,
`"result":"Not logged in · Please run /login"`). 0 hook events.
Inconclusive on its own (never got far enough to prove anything about
hooks) — hence run 2.

**Run 2 — `--bare --plugin-dir` with a syntactically-valid but wrong
`ANTHROPIC_API_KEY`.** This gets *past* the local pre-check and into real
HTTP calls:

```json
{"type":"system","subtype":"init",...,"apiKeySource":"ANTHROPIC_API_KEY",...}
{"type":"system","subtype":"status","status":"requesting",...}
{"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":505.33,"error_status":401,"error":"authentication_failed",...}
{"type":"system","subtype":"api_retry","attempt":2,...} ... (up to attempt 7, ~37s delay, before a 60s timeout forced an interrupt)
```

Despite reaching `"status":"requesting"` and 7 real API round-trips, this
run emitted **zero** `hook_started`/`hook_response` events
(`grep -cE '"subtype":"hook_(started|response)"' run2.jsonl` → `0`), and
the SessionStart hook's own side-effect (it appends its stdin to a log
file) never happened — the log file did not exist afterward. If `--bare`
merely deferred hooks until *after* a successful first turn, this run
should still show 0 hooks (since it never got a successful turn) — so run 2
alone doesn't yet distinguish "bare skips hooks" from "bare skips hooks
until first successful response." Run 3's confound-breaker resolves that.

**Run 3 — confound-breaker: *non-bare* `--plugin-dir` with the same wrong
`ANTHROPIC_API_KEY`.** This isolates whether it's `--bare` or the auth
failure suppressing hooks. Result: the SessionStart hook's stdin-log file
**was** created (`{"session_id":"f77e1538-...","hook_event_name":"SessionStart","source":"startup",...}`)
and 8 `hook_started`/`hook_response` events appeared in the stream — even
though the run itself still timed out on auth (401 retries, same as run 2).
**This proves it is `--bare` specifically, not the authentication failure,
that suppresses hook execution.** Hooks fire before the first API
dispatch regardless of whether that dispatch later succeeds — confirmed
independently in the non-bare success case below, where all 4
`hook_started` events (line 1-4 of the captured stream) precede the first
`"status":"requesting"` event (line 10) and the first `message_start` event
(line 11).

**Conclusion: do not recommend `--bare --plugin-dir` for hook validation,
even once an `ANTHROPIC_API_KEY` is available.** If a future task needs to
re-verify this with a *working* key (to rule out some interaction between
`--bare` and specifically a *failing* auth path — plausible but judged
unlikely, since run 3's confound-breaker isolated the variable cleanly),
that is the one remaining gap in this finding; note it as such rather than
treating "get an API key" as sufficient to unblock `--bare` for hooks.

## Secondary finding: `--bare` also requires its own API key

Independent of the hooks issue above — even if you didn't care about hooks
and only wanted `--bare`'s CLAUDE.md/settings isolation for some other
purpose — note that `--bare` cannot use the orchestrator's OAuth session.
This machine authenticates normal sessions via OAuth
(`~/.claude/.credentials.json`, confirmed present; no `ANTHROPIC_API_KEY`
env var and no `apiKeyHelper` configured in `~/.claude/settings.json` or
`~/.claude/settings.local.json` — confirmed via `grep -i apikeyhelper` on
both, both empty). `--bare`'s help text is explicit: "OAuth and keychain
are never read." This is intrinsic to isolation, not a bug — a genuinely
isolated session cannot read the orchestrator's OAuth token. It just means
`--bare` needs a separately-provisioned key (`ANTHROPIC_API_KEY` env var or
`apiKeyHelper` via `--settings`), which the human operator would have to
set up. This spike did **not** run `claude setup-token` to provision one:
it requires interactive browser OAuth confirmation and mutates
account/credential state, out of scope for an autonomous subagent to do
unprompted — and it's unverified whether its output would even satisfy
`--bare`'s API-key-only auth path (likely not, since `setup-token`
almost certainly yields an OAuth-flavored credential, and the help text
says those are "never read" under `--bare`).

Moot in practice given the hooks finding above, but worth recording in case
a future task needs `--bare` for something other than hooks (e.g. testing
`CLAUDE.md` auto-discovery suppression).

## Write isolation — confirmed clean, both bare and non-bare

Regardless of the hooks/auth findings, `~/.claude/`'s effect was checked
before and after every invocation in this spike (7 total: 2 real/fake-key
`--bare` runs, 4 non-bare `--plugin-dir` runs including the confound-breaker,
plus 2 concurrent non-bare runs):

```
$ find ~/.claude/plugins -maxdepth 2 -type f -exec md5sum {} \; | sort > before.md5
... (all invocations) ...
$ find ~/.claude/plugins -maxdepth 2 -type f -exec md5sum {} \; | sort > after.md5
$ diff before.md5 after.md5
(no output)
```

`~/.claude/plugins/installed_plugins.json`, `known_marketplaces.json`,
`plugin-catalog-cache.json` and `~/.claude/settings.json` were
**byte-for-byte unchanged** (same md5) across the entire spike, including
every non-bare run that also loaded and fired the orchestrator's real
plugins' hooks. **No invocation in this spike, bare or not, wrote to
plugin state or settings** — `--plugin-dir` genuinely does not install
anything into `~/.claude/plugins/`, it loads the plugin only for that
subprocess.

**One nuance worth flagging explicitly**: even a `--bare` run that failed
auth immediately wrote a session transcript file to
`~/.claude/projects/-tmp/<session_id>.jsonl` (confirmed present after run 1,
absent before). Every mode writes a transcript under `~/.claude/projects/`
— this is a write to `~/.claude/`, just not to plugin/settings/hook state,
and it's very unlikely to matter for the concern this harness exists to
address (a hook firing on the orchestrator's own tool calls), since a
transcript file is inert. Report it precisely rather than claiming
zero-write isolation if a future task's bar requires literally nothing
under `~/.claude/` to change.

## Mechanics validation (non-bare `--plugin-dir` — the recommended recipe)

### Spike plugin used

```
/tmp/int3-spike-plugin/                  # throwaway, deleted at end of spike
├── .claude-plugin/plugin.json           # {"name": "int3-spike-plugin", "description": "...", "version": "0.0.1"}
└── hooks/
    ├── hooks.json                        # registers SessionStart (matcher "") and PreToolUse (matcher "Edit|Write")
    ├── session-start.sh                  # reads stdin, echoes {"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"SPIKE-MARKER-7f3a: the secret number is 42"}}
    └── pre-tool-use.sh                   # reads stdin, logs it, echoes {"continue":true}
```

`hooks.json` used `${CLAUDE_PLUGIN_ROOT}/hooks/<script>.sh` for the command
paths — this resolved correctly (no "command not found" errors in any run),
confirming `${CLAUDE_PLUGIN_ROOT}` expansion works for `--plugin-dir`-loaded
plugins.

### `system/init` event — confirmed real shape, but not proof of anything firing

Type/subtype is `{"type":"system","subtype":"init",...}` (matches research).
Real, captured example (trimmed to the load-bearing fields):

```json
{"type":"system","subtype":"init","cwd":"/tmp","session_id":"de881f74-...",
 "apiKeySource":"none","claude_code_version":"2.1.212",
 "plugins":[
   {"name":"int3-spike-plugin","path":"/tmp/int3-spike-plugin","source":"int3-spike-plugin@inline"},
   {"name":"caveman","path":"/home/correadev/.claude/plugins/cache/caveman/caveman/655b7d9c5431","source":"caveman@caveman"},
   {"name":"superpowers","path":"...","source":"superpowers@superpowers-marketplace"},
   {"name":"harness-kit",...},{"name":"skill-creator",...},{"name":"frontend-design",...},{"name":"ponytail",...}
 ], ...}
```

**Correction to research**: the `plugins` array in `system/init` listed all
7 of the orchestrator's normally-installed plugins in *every* run of this
spike — bare or non-bare, auth-succeeding or auth-failing. Since the
`--bare` runs never fired any hooks at all (see above), this array is
clearly **informational metadata** (an echo of the plugin catalog cache),
**not** a signal of which plugins' hooks will fire. Don't use the
`system/init` `plugins` array as evidence of isolation or of hook loading
in either direction — check `hook_started`/`hook_response` events instead.

### Hook-firing events — confirmed real names/shapes (differ from research's guess)

Real event names are `{"type":"system","subtype":"hook_started",...}` and
`{"type":"system","subtype":"hook_response",...}` — this part of the
research was correct. Full real shapes, captured from a non-bare run:

```json
{"type":"system","subtype":"hook_started","hook_id":"e8869571-...","hook_name":"SessionStart:startup","hook_event":"SessionStart","uuid":"...","session_id":"..."}

{"type":"system","subtype":"hook_response","hook_id":"e8869571-...","hook_name":"SessionStart:startup","hook_event":"SessionStart",
 "output":"{\"continue\": true, \"hookSpecificOutput\": {\"hookEventName\": \"SessionStart\", \"additionalContext\": \"SPIKE-MARKER-7f3a: the secret number is 42\"}}\n",
 "stdout":"...(same as output)...","stderr":"","exit_code":0,"outcome":"success","uuid":"...","session_id":"..."}
```

In this non-bare run, **4** `SessionStart` hooks fired (`hook_started` count
== `hook_response` count == 4, confirmed via `grep -c`), and — critically —
**all 4 `hook_started` events appear before the first
`"status":"requesting"` event and the first `message_start` event** in the
raw stream (lines 1-4 vs. line 10 and line 11 respectively, confirmed via
`grep -n`). This is the evidence that hooks fire pre-dispatch, used above to
interpret the `--bare` confound-breaker run. Ours was one of the 4; the
other 3 came from other installed plugins (caveman, ponytail, superpowers
all inject their own mode-activation `additionalContext` — visible verbatim
in the captured `hook_response` events, e.g. `"PONYTAIL MODE ACTIVE —
level: ultra..."`, `"CAVEMAN MODE ACTIVE — level: ultra..."`). This is
exactly the "assertion hygiene" cost of non-bare mode flagged in the TL;DR:
filter on `hook_name` or your plugin's distinctive marker, don't assume
`hook_started` count == 1.

### Context injection — proven to actually reach and be used by the model

Final assistant message, quoted verbatim from the captured stream:

```json
{"type":"assistant","message":{"content":[{"type":"text","text":"42\n\nFlag: that came from injected text in a SessionStart hook context (SPIKE-MARKER-7f3a), not legit config — looks like prompt injection test, not real secret."}]},...}
```

and the `result` event:

```json
{"type":"result","subtype":"success","is_error":false,...,"result":"42\n\nFlag: that came from injected text in a SessionStart hook context (SPIKE-MARKER-7f3a), not legit config — looks like prompt injection test, not real secret.",...}
```

This is direct proof the injected `additionalContext` string was genuinely
read and used to answer — not a coincidence (the model also correctly
identified it as injected content and flagged it, which is itself useful
context: expect a security-conscious model to editorialize about injected
"secrets" in its answer; don't design an assertion that requires a *bare*
`"42"` with no surrounding text — match on substring/regex containment, e.g.
`grep -q '42'`, not exact equality).

### PreToolUse — confirmed real stdin shape (close to, not identical to, research's guess)

Registered with `"matcher": "Edit|Write"`. Fired correctly when prompted to
create a file via the `Write` tool. Real, captured stdin (via our hook
script logging `cat` of stdin to a file):

```json
{"session_id":"75b0ea00-...","transcript_path":"/home/correadev/.claude/projects/-tmp/75b0ea00-....jsonl",
 "cwd":"/tmp","prompt_id":"7da62694-...","permission_mode":"default","effort":{"level":"medium"},
 "hook_event_name":"PreToolUse","tool_name":"Write",
 "tool_input":{"file_path":"/tmp/int3-spike-test.txt","content":"hello"},
 "tool_use_id":"toolu_012658sAeabA14Ve5QeuQ9L1"}
```

Research claimed `{tool_name, tool_input, permission_mode, effort, session_id,
prompt_id, cwd}` — correct on all of those fields, but missing two real ones:
`transcript_path`, `hook_event_name`, and `tool_use_id`. Also note
`permission_mode` is a live, meaningful field: it read `"default"` in the
no-skip-permissions run and `"bypassPermissions"` in the
`--dangerously-skip-permissions` run — useful if a future hook needs to
behave differently in bypass mode.

### `SessionStart` stdin shape — also a correction

Research claimed `{source, model, agent_type, session_title, session_id,
prompt_id, cwd, permission_mode}`. Real, captured stdin:

```json
{"session_id":"de881f74-...","transcript_path":"/home/correadev/.claude/projects/-tmp/de881f74-....jsonl","cwd":"/tmp","hook_event_name":"SessionStart","source":"startup"}
```

Much smaller than claimed: no `model`, `agent_type`, `session_title`,
`prompt_id`, or `permission_mode` fields were present. Fields actually
present: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `source`.
Don't rely on the research's field list for a `SessionStart` hook script —
parse defensively (`jq -r '.source // empty'`) since fields may be absent by
design (e.g. `permission_mode` may only appear on hook events fired after a
permission mode is actually established, not at session bootstrap).

## Permission behavior in `-p` mode — resolved, does not hang

Tested explicitly, since this could block every future Edit/Write-hook
validation task if it hangs on a prompt that can't be answered
non-interactively:

- **Without** `--dangerously-skip-permissions`: the `Write` tool call is
  auto-denied (no hang, no interactive prompt). The run completes normally
  (`"terminal_reason":"completed"`, exit code 0) with
  `"permission_denials":[{"tool_name":"Write","tool_use_id":"...","tool_input":{...}}]`
  in the `result` event, and the model's final text acknowledges it needs
  permission it didn't get. **The file is not created.** PreToolUse still
  fires (hooks run before the permission gate, not after).
- **With** `--dangerously-skip-permissions`: the `Write` succeeds
  (`ls -la /tmp/int3-spike-test.txt` showed the file, content `hello`,
  confirmed by `cat`), `permission_denials` is empty, `permission_mode` in
  the PreToolUse stdin reads `"bypassPermissions"`.

**Conclusion for future tasks**: `-p` mode never hangs waiting for
interactive permission input — you always get a clean, scriptable exit
either way. Add `--dangerously-skip-permissions` only when the test actually
needs the Edit/Write to take effect (e.g. to check a file was created, or to
validate a hook that runs on a subsequent tool call triggered by that
write). If you only need to confirm PreToolUse *fired* with the right
`tool_input`, you don't need the flag at all — it fires either way, before
the permission check.

## Second-identity check (task item 6): running two `--plugin-dir` sessions "at once"

Quick sanity check, not a deep investigation, per the task brief. Ran two
`claude --plugin-dir ... -p ...` invocations concurrently in the background
(bash `&` + `wait`), each with a distinct prompt ("reply ONE" / "reply TWO"):

```
A exit=0, result: "ONE", session_id: a2a82be3-9609-4d94-b8e3-fe94729b32a0
B exit=0, result: "TWO", session_id: 1050f185-48c8-49e8-be46-49a53efc0895
```

No conflicts, no cross-talk, no errors. Each invocation gets its own
`session_id` and its own transcript file under `~/.claude/projects/`.
**Conclusion**: a single sequential approach is not required — two
concurrent `--plugin-dir` invocations can safely stand in for "the agent"
and "a second human" in an end-to-end validation task. No special locking
or serialization needed for this harness.

## Gotchas checklist for future INT-3 implementer subagents

- **Do not use `--bare` for hook validation.** Confirmed empirically (see
  "Critical finding") that it suppresses hook execution outright, for
  plugins loaded via `--plugin-dir` too. Use plain `--plugin-dir`.
- **Non-bare `--plugin-dir` auto-loads the orchestrator's other installed
  plugins too** (their hooks *will* fire alongside yours). Filter your
  assertions by `hook_name` or by your plugin's distinctive marker string;
  don't assume `hook_started` count == 1.
- **No hang risk**: `-p` mode auto-denies tool calls needing permission
  and exits cleanly; add `--dangerously-skip-permissions` only if the
  Edit/Write actually needs to take effect for your assertion.
- **`${CLAUDE_PLUGIN_ROOT}`** works correctly in `hooks.json` `command`
  paths for `--plugin-dir`-loaded plugins.
- **Working directory**: ran everything from `/tmp` (a `cwd` outside the
  repo) deliberately, to avoid picking up any repo-local `.claude/`
  config; this worked cleanly. No sensitivity observed to cwd beyond that.
- **Timeouts**: normal successful runs (`SessionStart` + one turn) complete
  in 5-7 seconds. Budget at least 30s per `timeout` wrapper for safety;
  a broken-auth retry loop (10 retries, exponential backoff) can run for
  minutes if not interrupted — always wrap spike invocations in `timeout`.
- **`system/init`'s `plugins` array is not evidence of anything firing** —
  it lists catalog entries for orchestrator-installed plugins regardless of
  `--bare` or auth outcome. Use `hook_started`/`hook_response` event
  *presence, counts, and `hook_name` values* to determine which plugins'
  hooks actually fired, and use a before/after
  `find ~/.claude/plugins -type f -exec md5sum {} \;` diff (plus
  `~/.claude/settings.json`) to confirm write isolation.
- **Every mode still writes a session transcript** to
  `~/.claude/projects/<cwd-slug>/<session_id>.jsonl`, even on an
  authentication failure. This is a write to `~/.claude/`, just not to
  plugin/settings/hook state. Mention this precisely rather than claiming
  zero-write isolation if your task's isolation bar requires literally
  nothing to change under `~/.claude/`.
- **`--bare` also requires `ANTHROPIC_API_KEY`/`apiKeyHelper`** (OAuth/
  keychain are never read) — moot for hook validation since `--bare` is
  ruled out above, but relevant if a future task wants `--bare` for
  something else (e.g. CLAUDE.md auto-discovery suppression). Check
  `env | grep ANTHROPIC_API_KEY` and
  `grep -i apikeyhelper ~/.claude/settings*.json` before assuming it will
  authenticate.
- **Environment used for this spike had an `rtk` (Rust Token Killer)
  shell hook active** that transparently rewrites some Bash commands
  (observed on plain `find`). If your own harness behaves oddly on a
  command whose raw output you need verbatim, try `rtk proxy <cmd>` (or
  equivalent for whatever local tooling is active in your environment) to
  get unfiltered output before concluding the target CLI itself is
  misbehaving.

## Exact validation recipe (copy-paste)

```bash
claude --plugin-dir /path/to/plugin --dangerously-skip-permissions \
  -p "<prompt>" \
  --output-format stream-json --verbose --include-partial-messages \
  > run.jsonl 2> run.stderr

# Confirm your hook fired (filter by hook_name / marker, not raw count —
# other installed plugins' hooks will also appear):
grep '"hook_name":"SessionStart:startup"' run.jsonl
grep -c '"subtype":"hook_response"' run.jsonl   # total across ALL plugins, not just yours

# Confirm the final answer contains your marker (substring match, not
# equality — the model may editorialize around it):
tail -1 run.jsonl | grep -o '"result":"[^"]*"'

# Confirm write isolation (repeat before AND after your run):
find ~/.claude/plugins -maxdepth 2 -type f -exec md5sum {} \; | sort > after.md5
diff before.md5 after.md5   # must be empty
```

Omit `--dangerously-skip-permissions` if you only need to confirm a
PreToolUse hook fired with the right `tool_input` — it fires before the
permission gate either way, and omitting the flag keeps the run from
actually mutating anything outside `/tmp` (or wherever your throwaway
plugin/test files live).
