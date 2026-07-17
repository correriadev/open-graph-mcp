#!/usr/bin/env bash
# pre-tool-use-advisory.sh — PreToolUse (Edit|Write) hook, advisory-only (INT-3).
#
# Job: if the file being edited/written maps to EXACTLY ONE graph cell, and that
# cell currently has an open-changeset lock held by a DIFFERENT user, print a
# warning via hookSpecificOutput.additionalContext. NEVER block — this hook must
# never set hookSpecificOutput.permissionDecision to "deny"/"ask"; hard blocking
# is explicitly future scope (Fase 4/authz), see
# docs/roadmap-integrations/03-scope-int-3-claude-code-plugin.md's PreToolUse
# bullet: "se o grafo não mapeia, silêncio — zero falso alarme".
#
# Zero-false-alarm rule (strict, applies at every step below): env var/creds
# missing, curl failure/timeout, malformed response, file→cell mapping absent or
# ambiguous (0 or >1 distinct domain:layer pairs), cell not locked, or cell
# locked by the CURRENT user — print NOTHING and exit 0. Only the single
# unambiguous case (exactly one cell maps to this file AND it's locked by
# someone else) prints the one line of JSON.
#
# Design (same reasoning as this plugin's SessionStart hook, packages/claude-
# plugin/hooks/session-start.sh): this is a fresh bash process per tool call —
# it cannot reach the stdio-proxy's in-memory state — so it polls
# `${server}/mcp` directly with the same on-disk credentials the proxy's
# fileTokenStore() already wrote to ~/.open-graph-mcp/credentials.json.
#
# Cell-key format (verified against source, not guessed): packages/mcp-web/
# src/render.ts's cellKey() — the REAL client that opens changesets/locks cells
# in production — builds cell keys as `${domain}:${level}` using GraphNode.level
# VERBATIM (e.g. "graph-core:P2", P-prefix included). graph.query's
# candidate.layer is that same n.level value (packages/graph-core/src/
# indexer.ts). locks.cell stores exactly what changeset.open received in its
# `cells` array (packages/mcp-server/src/tools/changeset.ts), so the lookup in
# graph://cell/{cellKey} (packages/mcp-server/src/resources.ts's cellState,
# `SELECT ... FROM locks WHERE cell = ?`) matches on that verbatim string. Do
# NOT strip the "P" — a separate `cellKey(domain, level: number)` helper in
# authority.ts uses a bare-numeric convention, but that's a different helper for
# a different purpose; it is not what locks.cell / the web UI actually use.

set -u

command -v jq   >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

input="$(cat)"
file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
[ -n "$file_path" ] || exit 0

server="${CLAUDE_PLUGIN_OPTION_SERVER:-}"
[ -n "$server" ] || exit 0

creds_file="$HOME/.open-graph-mcp/credentials.json"
[ -r "$creds_file" ] || exit 0
creds_json="$(cat "$creds_file" 2>/dev/null)" || exit 0
[ -n "$creds_json" ] || exit 0
printf '%s' "$creds_json" | jq -e . >/dev/null 2>&1 || exit 0

creds_server="$(printf '%s' "$creds_json" | jq -r '.server // empty' 2>/dev/null)"
token="$(printf '%s' "$creds_json" | jq -r '.token // empty' 2>/dev/null)"
user_id="$(printf '%s' "$creds_json" | jq -r '.userId // empty' 2>/dev/null)"
[ -n "$creds_server" ] && [ -n "$token" ] && [ -n "$user_id" ] || exit 0
[ "$creds_server" = "$server" ] || exit 0

# POST a JSON-RPC body to ${server}/mcp with a 3s hard timeout. Prints the
# response body on stdout, returns 0 only on a real HTTP 200; any curl
# error/timeout or non-200 is a silent failure the caller must check for.
call_rpc() {
  local body="$1" resp status payload
  resp="$(curl -sm 3 -X POST "$server/mcp" -H 'content-type: application/json' -d "$body" -w '\n%{http_code}' 2>/dev/null)" || return 1
  status="${resp##*$'\n'}"
  payload="${resp%$'\n'*}"
  [ "$status" = "200" ] || return 1
  [ -n "$payload" ] || return 1
  printf '%s' "$payload"
}

# ── Step 1: file → cell mapping via graph.query ─────────────────────────────
# graph.query has no direct "cell by path" lookup — query by terms derived from
# the file path, then filter the returned candidates for ones whose `.file`
# (repo-root-relative, see packages/graph-core/src/descent.ts's path.relative
# usage) matches tool_input.file_path (absolute) by exact or path-suffix match.
basename="$(basename -- "$file_path")"
stem="${basename%.*}"
terms_json="$(jq -n --arg a "$basename" --arg b "$stem" '[$a,$b] | unique')"

query_body="$(jq -nc --argjson terms "$terms_json" --arg token "$token" \
  '{jsonrpc:"2.0",id:"og-pretooluse-query",method:"tools/call",params:{name:"graph.query",arguments:{terms:$terms,token:$token}}}')"

query_resp="$(call_rpc "$query_body")" || exit 0
printf '%s' "$query_resp" | jq -e '.result and (.result.isError != true)' >/dev/null 2>&1 || exit 0

# Exactly one distinct (domain,layer) pair among candidates whose file matches
# → confident mapping. Zero or >1 → ambiguous/absent → silence (accepted per
# roadmap risk #3: "mapeamento arquivo→cell é heurístico... advisory com baixa
# confiança fica calado"). domain: null is NOT ambiguous — it's the common case
# for a node nobody has claimed a domain for yet, and render.ts's cellKey()
# maps it to the literal string "unassigned" (`n.domain ?? "unassigned"`), not
# "no mapping". Found live during INT-3 validation: excluding null-domain
# candidates here made the advisory silently no-op on every fresh/unclaimed
# node — the common case right after graph.bootstrap, before any claims land.
pairs="$(printf '%s' "$query_resp" | jq -c --arg fp "$file_path" '
  (.result.structuredContent.candidates // [])
  | [ .[] as $c
      | select($c.file != null and $c.layer != null)
      | select(($fp == $c.file) or ($fp | endswith("/" + $c.file)))
      | {domain: ($c.domain // "unassigned"), layer: $c.layer}
    ]
  | unique
' 2>/dev/null)"
[ -n "$pairs" ] || exit 0
[ "$(printf '%s' "$pairs" | jq 'length' 2>/dev/null)" = "1" ] || exit 0

domain="$(printf '%s' "$pairs" | jq -r '.[0].domain')"
layer="$(printf '%s' "$pairs" | jq -r '.[0].layer')"
[ -n "$domain" ] && [ -n "$layer" ] || exit 0
cell="${domain}:${layer}"

# ── Step 2: lock check via resources/read graph://cell/{domain:layer} ──────
cell_body="$(jq -nc --arg uri "graph://cell/${cell}" --arg token "$token" \
  '{jsonrpc:"2.0",id:"og-pretooluse-cell",method:"resources/read",params:{uri:$uri,token:$token}}')"

cell_resp="$(call_rpc "$cell_body")" || exit 0
printf '%s' "$cell_resp" | jq -e '.result' >/dev/null 2>&1 || exit 0

cell_text="$(printf '%s' "$cell_resp" | jq -r '.result.contents[0].text // empty' 2>/dev/null)"
[ -n "$cell_text" ] || exit 0
printf '%s' "$cell_text" | jq -e . >/dev/null 2>&1 || exit 0

lock="$(printf '%s' "$cell_text" | jq -c '.lock' 2>/dev/null)"
[ "$lock" != "null" ] && [ -n "$lock" ] || exit 0

holder="$(printf '%s' "$cell_text" | jq -r '.lock.holder // empty' 2>/dev/null)"
[ -n "$holder" ] || exit 0
[ "$holder" != "$user_id" ] || exit 0

cs_id="$(printf '%s' "$cell_text" | jq -r '.lock.csId // "?"' 2>/dev/null)"
expires_at="$(printf '%s' "$cell_text" | jq -r '.lock.expiresAt // "?"' 2>/dev/null)"

# ── Confirmed: exactly one cell maps to this file, locked by someone else. ──
# Warn only — never set permissionDecision (that would block, out of scope).
jq -nc --arg cell "$cell" --arg holder "$holder" --arg cs "$cs_id" --arg exp "$expires_at" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:("\($cell) is locked by \($holder) (\($cs), expires \($exp)) — consider checking presence.who or opening your own changeset on a different cell first.")}}'
exit 0
