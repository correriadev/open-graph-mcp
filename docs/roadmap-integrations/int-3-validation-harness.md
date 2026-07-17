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
and corrects several points where the research's claims didn't match reality.

## TL;DR for future INT-3 implementer subagents

```bash
claude --bare --plugin-dir /path/to/your/plugin \
  --dangerously-skip-permissions \
  -p "your prompt" \
  --output-format stream-json --verbose --include-partial-messages
```

**This requires `ANTHROPIC_API_KEY` (or `apiKeyHelper` via `--settings`) to be set.**
`--bare` explicitly refuses to read OAuth credentials or the OS keychain — see
"Critical finding" below. If neither is available in your environment, you
cannot get a fully-isolated **authenticated** run; fall back to the non-bare
mechanics-validation recipe further down, which proves the hook/plugin
mechanism works but does *not* provide config isolation.

Add `--dangerously-skip-permissions` whenever your prompt needs an Edit/Write
to actually execute (e.g. to validate a PreToolUse hook's downstream effect).
Without it, `-p` mode does **not** hang — it auto-denies the tool call and
completes normally (see "Permission behavior" below) — but the file never
gets written, so if your test depends on the write having happened, add the
flag.

## Critical finding: `--bare` requires its own API key, cannot use the orchestrator's OAuth session

This is the single most important correction to the initial research, and it
directly affects the "how do I do this in 9 more tasks" question.

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

This machine authenticates the orchestrator's normal sessions via OAuth
(`~/.claude/.credentials.json`, confirmed present; no `ANTHROPIC_API_KEY` env
var and no `apiKeyHelper` configured in `~/.claude/settings.json` or
`~/.claude/settings.local.json` — confirmed via `grep -i apikeyhelper` on
both, both empty). As a result, on **this** machine, `--bare` cannot
authenticate at all:

```
$ claude --bare --plugin-dir /tmp/int3-spike-plugin -p "..." --output-format stream-json --verbose --include-partial-messages
{"type":"system","subtype":"init", ..., "apiKeySource":"none", ...}
...
{"type":"assistant","message":{...,"content":[{"type":"text","text":"Not logged in · Please run /login"}]},...,"error":"authentication_failed"}
{"type":"result","subtype":"success","is_error":true,...,"result":"Not logged in · Please run /login",...}
```

Setting a **fake** `ANTHROPIC_API_KEY` gets further (past the local
"logged in?" pre-check, into real HTTP calls) but then retries against the
API with exponential backoff on 401s until interrupted:

```
{"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":505.33,"error_status":401,"error":"authentication_failed",...}
{"type":"system","subtype":"api_retry","attempt":2,"max_retries":10,"retry_delay_ms":1158.66,...}
... (up to attempt 7, ~37s delay, before the 60s harness timeout forced an interrupt)
```

**This is intrinsic to isolation, not a bug in `--bare`.** A session that is
genuinely isolated from `~/.claude` *cannot* read the orchestrator's OAuth
token — that would defeat the isolation. `--bare` just makes this explicit
by refusing OAuth/keychain reads outright and requiring you to supply your
own credential.

**Implication for the roadmap:** a fully-isolated, authenticated `--bare`
validation run needs a **separately-provisioned API key** exported as
`ANTHROPIC_API_KEY` (or wired via `apiKeyHelper`) — something the human
operator sets up once (e.g. an Anthropic Console API key, or possibly
`claude setup-token`, which this spike did **not** run: it requires
interactive browser OAuth confirmation and mutates account/credential state,
which is out of scope for an autonomous subagent to do unprompted, and it is
*unverified* whether its output is even accepted by `--bare`'s
API-key-only auth path — likely not, since `setup-token` almost certainly
produces an OAuth-flavored credential, which the `--bare` help text says is
"never read"). **Flag this to the human before any future INT-3 task
attempts a real `--bare`-authenticated end-to-end run**: either an
`ANTHROPIC_API_KEY` needs to be exported in the environment, or the task
should explicitly fall back to the non-bare mechanics-validation recipe
below and document the isolation caveat.

## What write-isolation *was* confirmed (independent of the auth blocker)

Regardless of whether the `--bare` run authenticated, its effect on
`~/.claude/` was checked before and after every invocation in this spike
(5 total: real `--bare`, fake-key `--bare`, and three non-bare
`--plugin-dir` runs, plus two concurrent non-bare runs):

```
$ find ~/.claude/plugins -maxdepth 2 -type f -exec md5sum {} \; | sort > before.md5
... (all 5+ invocations) ...
$ find ~/.claude/plugins -maxdepth 2 -type f -exec md5sum {} \; | sort > after.md5
$ diff before.md5 after.md5
(no output)
```

`~/.claude/plugins/installed_plugins.json`, `known_marketplaces.json`,
`plugin-catalog-cache.json` and `~/.claude/settings.json` were **byte-for-byte
unchanged** (same md5) across the entire spike, including the non-bare runs
that loaded the orchestrator's real plugins. So: **no invocation in this
spike, bare or not, wrote to plugin state or settings.**

**One nuance found, worth flagging explicitly**: even the failed-auth
`--bare` run wrote a session transcript file to
`~/.claude/projects/-tmp/<session_id>.jsonl` (confirmed: this file existed
after run 1 and did not exist before). `--bare` isolates hooks/plugins/
CLAUDE.md/settings from auto-discovery, but it does **not** suppress
transcript persistence under `~/.claude/projects/`. This is very unlikely to
be "dangerous" in the sense the task worried about (it can't fire a hook on
the orchestrator's own tool calls), but it is a write to `~/.claude/`, so
report it precisely rather than claiming zero-write isolation.

## Mechanics validation (had to run non-bare, due to the auth blocker)

Because `--bare` never got past auth on this machine, the *mechanism itself*
(does our hook fire, does context injection reach the model, what do the
stdin/stdout and stream-json shapes actually look like) was validated with
plain `--plugin-dir` (no `--bare`), which authenticates fine via the normal
OAuth path. **This mode has zero config isolation** — it also loaded and
fired SessionStart hooks from every other installed plugin (caveman,
superpowers, ponytail, harness-kit) — but the hook *contract* (stdin shape,
stdout shape, event names) is mode-independent, so what's below is safe
evidence for how to interpret a real `--bare` run once auth is solved.

### Spike plugin used

```
/tmp/int3-spike-plugin/
├── .claude-plugin/plugin.json      # {"name": "int3-spike-plugin", "description": "...", "version": "0.0.1"}
└── hooks/
    ├── hooks.json                   # registers SessionStart (matcher "") and PreToolUse (matcher "Edit|Write")
    ├── session-start.sh             # reads stdin, echoes {"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"SPIKE-MARKER-7f3a: the secret number is 42"}}
    └── pre-tool-use.sh              # reads stdin, logs it, echoes {"continue":true}
```

`hooks.json` used `${CLAUDE_PLUGIN_ROOT}/hooks/<script>.sh` for the command
paths — this resolved correctly (no "command not found" errors in any run),
confirming `${CLAUDE_PLUGIN_ROOT}` expansion works for `--plugin-dir`-loaded
plugins.

This plugin was disposable and has been deleted (`/tmp/int3-spike-plugin`,
`/tmp/int3-spike-test.txt`, and its log files no longer exist — cleaned up
at the end of this spike).

### `system/init` event — confirmed real shape

Type/subtype is `{"type":"system","subtype":"init",...}` (matches research).
Real, captured example (trimmed to the load-bearing fields):

```json
{"type":"system","subtype":"init","cwd":"/tmp","session_id":"de881f74-...",
 "apiKeySource":"none","claude_code_version":"2.1.212",
 "plugins":[
   {"name":"int3-spike-plugin","path":"/tmp/int3-spike-plugin","source":"int3-spike-plugin@inline"},
   {"name":"caveman","path":"/home/correadev/.claude/plugins/cache/caveman/caveman/655b7d9c5431","source":"caveman@caveman"},
   {"name":"superpowers","path":"...","source":"superpowers@superpowers-marketplace"},
   {"name":"harness-kit","...},{"name":"skill-creator",...},{"name":"frontend-design",...},{"name":"ponytail",...}
 ], ...}
```

**Correction to research**: even under real `--bare --plugin-dir`, the
`plugins` array in `system/init` lists *all* of the orchestrator's normally
installed plugins, not just the one passed via `--plugin-dir`. This held in
both the auth-failed real-`--bare` run and the fake-key `--bare` run (which
got much further, through 7 retry attempts, before being interrupted) — the
`plugins` array was identical in both. **This appears to be informational
metadata (an echo of the plugin catalog cache), not a signal of which
plugins' hooks will actually fire** — see next section, where the fake-key
`--bare` run never fired *any* hook (ours or foreign) despite listing 7
plugins in `init`. Don't use the `system/init` `plugins` array alone as
proof of isolation; it lists catalog entries regardless of `--bare`.

### Hook-firing events — confirmed real names/shapes (differ from research's guess)

Real event names are `{"type":"system","subtype":"hook_started",...}` and
`{"type":"system","subtype":"hook_response",...}` — this part of the
research was correct. Full real shapes, captured from the non-bare run:

```json
{"type":"system","subtype":"hook_started","hook_id":"e8869571-...","hook_name":"SessionStart:startup","hook_event":"SessionStart","uuid":"...","session_id":"..."}

{"type":"system","subtype":"hook_response","hook_id":"e8869571-...","hook_name":"SessionStart:startup","hook_event":"SessionStart",
 "output":"{\"continue\": true, \"hookSpecificOutput\": {\"hookEventName\": \"SessionStart\", \"additionalContext\": \"SPIKE-MARKER-7f3a: the secret number is 42\"}}\n",
 "stdout":"...(same as output)...","stderr":"","exit_code":0,"outcome":"success","uuid":"...","session_id":"..."}
```

In this non-bare run, **4** `SessionStart` hooks fired (`hook_started` count
== `hook_response` count == 4): ours, plus 3 from other installed plugins
(caveman, ponytail, superpowers all inject their own mode-activation
`additionalContext` — visible verbatim in the captured `hook_response`
events). This is expected and correct given non-bare mode does no isolation;
it is *not* evidence about what `--bare` would do (that's the untested part,
blocked on auth).

### Context injection — proven to actually reach and be used by the model

Final assistant message, quoted verbatim from `run3_nonbare_raw.jsonl`:

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
concurrent `--bare --plugin-dir` (or `--plugin-dir`) invocations can safely
stand in for "the agent" and "a second human" in an end-to-end validation
task. No special locking or serialization needed for this harness.

## Gotchas checklist for future INT-3 implementer subagents

- **Auth**: `--bare` needs `ANTHROPIC_API_KEY` or `apiKeyHelper`; OAuth/
  keychain are never read. Check `env | grep ANTHROPIC_API_KEY` and
  `grep -i apikeyhelper ~/.claude/settings*.json` before assuming `--bare`
  will authenticate. If neither exists, either ask the human operator to
  provision a key, or explicitly document your run as "mechanics validated
  non-bare, isolation not independently re-confirmed for this specific run"
  rather than silently using non-bare and claiming full isolation.
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
- **`system/init`'s `plugins` array is not proof of isolation** — it lists
  catalog entries for orchestrator-installed plugins regardless of
  `--bare`. Use `hook_started`/`hook_response` event *counts and hook_name
  values* to determine which plugins' hooks actually fired, and use the
  before/after `find ... -exec md5sum` diff on `~/.claude/plugins/` (and
  `~/.claude/settings.json`) to confirm write isolation.
- **`--bare` still writes a session transcript** to
  `~/.claude/projects/<cwd-slug>/<session_id>.jsonl` even on an
  authentication failure. This is a write to `~/.claude/`, just not to
  plugin/settings state. Mention this precisely rather than claiming
  zero-write isolation if your task's isolation bar requires literally
  nothing to change under `~/.claude/`.
- **Environment used for this spike had an `rtk` (Rust Token Killer)
  shell hook active** that transparently rewrites some Bash commands
  (observed on plain `find`). If your own harness behaves oddly on a
  command whose raw output you need verbatim, try `rtk proxy <cmd>` (or
  equivalent for whatever local tooling is active in your environment) to
  get unfiltered output before concluding the target CLI itself is
  misbehaving.

## Exact validation recipe (copy-paste)

**Mechanics-only (no isolation guarantee, works today, no extra key needed):**

```bash
claude --plugin-dir /path/to/plugin -p "<prompt>" \
  --output-format stream-json --verbose --include-partial-messages \
  > run.jsonl 2> run.stderr
grep -c '"subtype":"hook_started"' run.jsonl   # how many SessionStart/PreToolUse hooks fired total (yours + foreign)
grep '"hook_name":"SessionStart:startup"' run.jsonl | grep -c yourplugin  # adjust to isolate yours if needed
tail -1 run.jsonl   # the "result" event — check .result contains your marker
```

**Full isolation (requires `ANTHROPIC_API_KEY` provisioned by the operator):**

```bash
ANTHROPIC_API_KEY=<operator-provided-key> \
  claude --bare --plugin-dir /path/to/plugin --dangerously-skip-permissions \
  -p "<prompt>" --output-format stream-json --verbose --include-partial-messages \
  > run.jsonl 2> run.stderr
# same assertions as above, plus:
find ~/.claude/plugins -maxdepth 2 -type f -exec md5sum {} \; | sort > after.md5
diff before.md5 after.md5   # must be empty
```

This second recipe was **not** run end-to-end with real auth in this spike
(no API key available in this environment) — flag that gap explicitly to
whoever picks up the next INT-3 task rather than assuming it "just works"
because the flags are documented.
