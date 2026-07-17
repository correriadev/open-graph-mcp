#!/usr/bin/env bash
# system-message-drain.sh — UserPromptSubmit hook (INT-3). Drains `system.message` text queued
# server-side for this user (server tool `system.pending`, added alongside this hook — see
# packages/mcp-server/src/system-message.ts) and injects it as additionalContext, so the prioritized
# events named in the roadmap (own changeset aborted, lock.denied, authority.flipped — anything
# system-message.ts's renderSystemMessage() renders) surface even though this hook is a fresh process
# per turn with no access to the `--live` proxy's in-memory SSE stream.
#
# Why UserPromptSubmit and not PreToolUse: PreToolUse fires once per Edit/Write tool call — draining
# there would inject on every file touch (spam risk, roadmap risk #2). UserPromptSubmit fires once per
# human turn: coalesced, low-frequency, matches "drain what happened since I last looked."
#
# Zero-false-alarm rule (same as this plugin's other hooks): any failure — env var/creds missing,
# curl error/timeout, malformed response, isError, empty queue — prints NOTHING and exits 0.

set -u

command -v curl >/dev/null 2>&1 || exit 0
command -v jq   >/dev/null 2>&1 || exit 0

server="${CLAUDE_PLUGIN_OPTION_SERVER:-}"
[ -n "$server" ] || exit 0

creds_file="$HOME/.open-graph-mcp/credentials.json"
[ -r "$creds_file" ] || exit 0
creds_json="$(cat "$creds_file" 2>/dev/null)" || exit 0
[ -n "$creds_json" ] || exit 0
echo "$creds_json" | jq -e . >/dev/null 2>&1 || exit 0

creds_server="$(echo "$creds_json" | jq -r '.server // empty' 2>/dev/null)"
token="$(echo "$creds_json" | jq -r '.token // empty' 2>/dev/null)"
[ -n "$creds_server" ] && [ -n "$token" ] || exit 0
[ "$creds_server" = "$server" ] || exit 0

body="$(jq -nc --arg token "$token" '{jsonrpc:"2.0",id:"og-drain",method:"tools/call",params:{name:"system.pending",arguments:{token:$token}}}')"
resp="$(curl -sm 3 -X POST "$server/mcp" -H 'content-type: application/json' -d "$body" -w '\n%{http_code}' 2>/dev/null)" || exit 0
status="${resp##*$'\n'}"
payload="${resp%$'\n'*}"
[ "$status" = "200" ] && [ -n "$payload" ] || exit 0
echo "$payload" | jq -e '.result and (.result.isError != true)' >/dev/null 2>&1 || exit 0

texts="$(echo "$payload" | jq -r '.result.structuredContent.messages[]?.text' 2>/dev/null)"
[ -n "$texts" ] || exit 0

blurb="$(echo "$texts" | paste -sd '|' - | sed 's/|/ | /g')"
jq -nc --arg ctx "$blurb" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$ctx}}'
exit 0
