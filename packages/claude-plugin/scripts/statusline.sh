#!/usr/bin/env bash
# statusline.sh — optional open-graph statusline (INT-3 DoD: "Statusline (opcional ligável)").
#
# Empirical correction to the roadmap: a plugin CANNOT auto-install a main statusLine — Claude Code's
# plugin settings.json only supports the `agent` and `subagentStatusLine` keys (verified against
# plugins-reference.md: "Only the agent and subagentStatusLine keys are currently supported"). This
# script ships in the plugin but the user must opt in by pointing their OWN ~/.claude/settings.json
# (or project settings.json) statusLine.command at it — see this plugin's README. That's what "opcional
# ligável" (optional, switch it on) means in practice, not a toggle this plugin can flip for you.
#
# Same stateless-curl-plus-on-disk-credentials pattern as this plugin's other hooks (session-start.sh,
# pre-tool-use-advisory.sh, system-message-drain.sh): a statusline script is also a fresh process per
# invocation, no access to the --live proxy's in-memory state.
#
# Zero-false-alarm rule: any failure — env var/creds missing, curl error/timeout, malformed response,
# isError — prints NOTHING (empty statusline line) and exits 0. Never errors the user's prompt bar.

set -u

command -v curl >/dev/null 2>&1 || exit 0
command -v jq   >/dev/null 2>&1 || exit 0

# Read (and discard) stdin — Claude Code feeds session JSON on stdin; this script doesn't need any of
# it, but must still drain it per statusline contract.
cat >/dev/null

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

call_rpc() {
  local body="$1" resp status payload
  resp="$(curl -sm 2 -X POST "$server/mcp" -H 'content-type: application/json' -d "$body" -w '\n%{http_code}' 2>/dev/null)" || return 1
  status="${resp##*$'\n'}"
  payload="${resp%$'\n'*}"
  [ "$status" = "200" ] || return 1
  [ -n "$payload" ] || return 1
  printf '%s' "$payload"
}

presence_body="$(jq -nc --arg token "$token" '{jsonrpc:"2.0",id:"og-statusline-presence",method:"tools/call",params:{name:"presence.who",arguments:{token:$token}}}')"
presence_resp="$(call_rpc "$presence_body")" || exit 0
echo "$presence_resp" | jq -e '.result and (.result.isError != true)' >/dev/null 2>&1 || exit 0
users_count="$(echo "$presence_resp" | jq -r '.result.structuredContent.users | length' 2>/dev/null)"
case "$users_count" in ''|*[!0-9]*) exit 0 ;; esac

line="og: $users_count online"

cs_body="$(jq -nc --arg token "$token" '{jsonrpc:"2.0",id:"og-statusline-cs",method:"tools/call",params:{name:"changeset.list_mine",arguments:{token:$token}}}')"
if cs_resp="$(call_rpc "$cs_body")" && echo "$cs_resp" | jq -e '.result and (.result.isError != true)' >/dev/null 2>&1; then
  first_cs="$(echo "$cs_resp" | jq -r '.result.structuredContent.changesets[0] // empty' 2>/dev/null)"
  if [ -n "$first_cs" ] && [ "$first_cs" != "null" ]; then
    cs_id="$(echo "$first_cs" | jq -r '.csId // empty')"
    cells="$(echo "$first_cs" | jq -r '(.cells // []) | join(",")' 2>/dev/null)"
    [ -n "$cs_id" ] && line="$line · turno $cs_id ($cells)"
  fi
fi

printf '%s' "$line"
exit 0
