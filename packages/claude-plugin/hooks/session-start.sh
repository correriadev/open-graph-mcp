#!/usr/bin/env bash
# session-start.sh — SessionStart hook (INT-3, matcher ""). Injects a short "graph connected, N
# cells, you are <name>, M users present" blurb + any changesets the user forgot open, so the agent
# (and a human skimming the transcript) knows graph state without querying it manually.
#
# Design (see docs/roadmap-integrations/03-scope-int-3-claude-code-plugin.md's SessionStart bullet):
# this is a fresh bash process each session start — it CANNOT reach into the long-lived MCP server
# subprocess (the stdio proxy's `--live` connection) for in-memory state. Instead it polls the SAME
# `${server}/mcp` JSON-RPC endpoint the proxy talks to, directly, using the SAME on-disk credentials
# the proxy's fileTokenStore() already wrote to ~/.open-graph-mcp/credentials.json. Deliberately
# polling-only — matches this project's ID2 decision that the live layer is never a hard requirement.
#
# Zero-false-alarm rule (strict): at ANY failure point below — env var unset, creds file
# missing/unreadable/malformed, .server mismatch, curl timeout/error, non-200, malformed JSON
# response, .result.isError == true — exit 0 printing NOTHING. Never warn, never block session
# start. Silence is correct for "graph not reachable yet" (e.g. SessionStart racing the proxy's
# first session.register). The one deliberate exception is the "N cells" count (via graph://snapshot):
# that piece degrades gracefully on its own — if it fails, just omit it from the blurb rather than
# aborting the whole hook, since it's a nice-to-have, not the core ask.

set -u

command -v curl >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0

server="${CLAUDE_PLUGIN_OPTION_SERVER:-}"
name="${CLAUDE_PLUGIN_OPTION_NAME:-}"
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

# POST a JSON-RPC body to ${server}/mcp with a 3s timeout. Prints the response body on stdout and
# returns 0 only on a real HTTP 200 with a network-level success; any curl error/timeout or non-200
# is a silent failure (caller checks the return code).
call_rpc() {
  local body="$1" resp status payload
  resp="$(curl -sm 3 -X POST "$server/mcp" -H 'content-type: application/json' -d "$body" -w '\n%{http_code}' 2>/dev/null)" || return 1
  status="${resp##*$'\n'}"
  payload="${resp%$'\n'*}"
  [ "$status" = "200" ] || return 1
  [ -n "$payload" ] || return 1
  printf '%s' "$payload"
}

# presence.who {token} — required. users.length is the "M users present" count.
presence_body="$(jq -nc --arg token "$token" '{jsonrpc:"2.0",id:"session-start-presence",method:"tools/call",params:{name:"presence.who",arguments:{token:$token}}}')"
presence_resp="$(call_rpc "$presence_body")" || exit 0
echo "$presence_resp" | jq -e '.result and (.result.isError != true)' >/dev/null 2>&1 || exit 0
users_count="$(echo "$presence_resp" | jq -r '.result.structuredContent.users | length' 2>/dev/null)"
case "$users_count" in ''|*[!0-9]*) exit 0 ;; esac

# changeset.list_mine {token} — required. Non-empty means the user has an open turn they may have
# forgotten to close/commit.
cs_body="$(jq -nc --arg token "$token" '{jsonrpc:"2.0",id:"session-start-cs",method:"tools/call",params:{name:"changeset.list_mine",arguments:{token:$token}}}')"
cs_resp="$(call_rpc "$cs_body")" || exit 0
echo "$cs_resp" | jq -e '.result and (.result.isError != true)' >/dev/null 2>&1 || exit 0
changesets_json="$(echo "$cs_resp" | jq -c '.result.structuredContent.changesets' 2>/dev/null)"
echo "$changesets_json" | jq -e 'type == "array"' >/dev/null 2>&1 || exit 0

# graph://snapshot — optional/best-effort "N cells" count. A cell is a domain:level pair (see
# resources.ts's cellState/domain resource). Not gated behind the required-calls failure path above:
# if the graph isn't bootstrapped yet (isError/resources/read throws → top-level .error, not
# .result), or the call otherwise fails, we just drop this number from the blurb.
cells_count=""
snap_body="$(jq -nc --arg token "$token" '{jsonrpc:"2.0",id:"session-start-snapshot",method:"resources/read",params:{uri:"graph://snapshot",token:$token}}')"
if snap_resp="$(call_rpc "$snap_body")"; then
  cells_count="$(echo "$snap_resp" | jq -r '
    .result.contents[0].text
    | fromjson
    | (.graph.nodes // [])
    | map("\(.domain):\(.level)")
    | unique
    | length
  ' 2>/dev/null)"
  case "$cells_count" in ''|*[!0-9]*) cells_count="" ;; esac
fi

# Build the blurb.
blurb="graph connected"
[ -n "$cells_count" ] && blurb="$blurb, $cells_count cells"
if [ -n "$name" ]; then
  blurb="$blurb, you are $name, $users_count users present"
else
  blurb="$blurb, $users_count users present"
fi

if [ "$changesets_json" != "[]" ] && [ "$changesets_json" != "null" ]; then
  cs_lines="$(echo "$changesets_json" | jq -r '.[] | "\(.csId): \(.intent) (opened \(.openedAt))"' 2>/dev/null)"
  if [ -n "$cs_lines" ]; then
    cs_summary="$(echo "$cs_lines" | paste -sd ';' - | sed 's/;/; /g')"
    blurb="$blurb. You have open changesets: $cs_summary"
  fi
fi

jq -nc --arg ctx "$blurb" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$ctx}}'
exit 0
