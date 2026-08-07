#!/usr/bin/env bash
# package-beta-assets.sh <tag> — builds the BT-1 beta release assets into dist-beta/
# (docs/roadmap-beta-test/01-scope-bt-1-pipeline-artefato.md):
#
#   open-graph-proxy-<tag>.tar.gz   stdio-proxy + client SOURCES + setup.sh (runs `bun install`).
#                                   Tarball+setup.sh is the decided default; `bun build --compile`
#                                   is a future attempt (scope doc §2), not done here.
#   open-graph-plugin-<tag>.tar.gz  the same bundle + claude-plugin/ as a SIBLING of stdio-proxy/,
#                                   so plugin.json's interim `${CLAUDE_PLUGIN_ROOT}/../stdio-proxy/
#                                   src/cli.ts` wiring (see packages/claude-plugin/README.md,
#                                   "Interim wiring note") resolves inside the extracted tarball
#                                   exactly like it does inside the monorepo. plugin.json is copied
#                                   VERBATIM — never edited here, to avoid a silent fork between
#                                   repo and release artifact.
#   open-graph-server-<tag>.tar.gz   mcp-server + graph-core SOURCES + setup.sh (runs `bun install`)
#                                    + START.md — the actual MCP server, for testers who now run it
#                                    themselves, standalone, for days (not the old facilitated-session
#                                    model where the owner ran it). Separate tarball, not folded into
#                                    the proxy/plugin bundles: graph-core drags in tree-sitter's native
#                                    parser bindings (scope doc risk #1, see below) — keeping it out of
#                                    proxy/plugin means anyone who only wants to connect to someone
#                                    else's server never has to build native deps to do so.
#   INSTALL.md                      copied from .github/release-assets/INSTALL.md.
#
# Vendoring rule: only src/ + package.json of each vendored package, with devDependencies stripped
# — stdio-proxy's devDeps reference @open-graph-mcp/mcp-server (workspace:*), which is test-only and
# was, until the server bundle above existed, deliberately excluded (would drag graph-core along —
# scope doc risk #1: graph-core's dependencies include tree-sitter-go/python/rust/typescript and
# web-tree-sitter, which are native-binding packages). That risk is now taken on deliberately for the
# server bundle alone — see the "server bundle" package.json header below for the actual
# `bun install` behavior confirmed for this repo.
#
# Called by .github/workflows/release.yml and runnable locally. Requires bash, tar, jq.
set -euo pipefail

tag="${1:?usage: package-beta-assets.sh <tag> (e.g. beta-v1)}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out_dir="$repo_root/dist-beta"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

# vendor_pkg <pkg> <bundle-root>: copy packages/<pkg>'s src/ + package.json (devDependencies
# stripped) into <bundle-root>/<pkg>. No test/, no tsconfig — bun runs the .ts sources directly
# (client's package.json exports a "bun" condition pointing straight at src/*.ts).
vendor_pkg() {
  local pkg="$1"
  local dest="$2/$pkg"
  mkdir -p "$dest"
  cp -R "$repo_root/packages/$pkg/src" "$dest/src"
  jq 'del(.devDependencies)' "$repo_root/packages/$pkg/package.json" > "$dest/package.json"
}

# build_bundle <dir-name> [--with-plugin]: assemble one extractable bundle under $stage/<dir-name>.
build_bundle() {
  local root="$stage/$1"
  mkdir -p "$root"
  vendor_pkg stdio-proxy "$root"
  vendor_pkg client "$root"

  # Root workspace manifest: stdio-proxy's `"@open-graph-mcp/client": "workspace:*"` only resolves
  # under a workspaces root — same mechanism as the monorepo's own root package.json.
  cat > "$root/package.json" <<'JSON'
{
  "name": "open-graph-beta-bundle",
  "private": true,
  "packageManager": "bun@1.3.14",
  "workspaces": { "packages": ["stdio-proxy", "client"] }
}
JSON

  cat > "$root/setup.sh" <<'SETUP'
#!/usr/bin/env bash
# setup.sh — one-time install for the open-graph beta bundle.
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun not found. Install it first: https://bun.sh" >&2
  echo "  curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi
bun install
echo
echo "Setup complete."
echo
echo "Run the MCP stdio proxy with:"
echo "  bun $PWD/stdio-proxy/src/cli.ts --server <SERVER_URL> --name \"<YOUR NAME>\""
if [ -d claude-plugin ]; then
  echo
  echo "Claude Code users — add the plugin with:"
  echo "  /plugin marketplace add $PWD/claude-plugin"
fi
SETUP
  chmod +x "$root/setup.sh"

  if [ "${2:-}" = "--with-plugin" ]; then
    cp -R "$repo_root/packages/claude-plugin" "$root/claude-plugin"
  fi
}

# build_server_bundle: assemble the standalone server bundle under $stage/<dir-name>. Separate
# function (not a build_bundle mode) because its contents are unrelated to stdio-proxy/client —
# mcp-server + graph-core, its own root workspace manifest, its own setup.sh, plus START.md.
build_server_bundle() {
  local root="$stage/$1"
  mkdir -p "$root"
  vendor_pkg mcp-server "$root"
  vendor_pkg graph-core "$root"

  cat > "$root/package.json" <<'JSON'
{
  "name": "open-graph-server-bundle",
  "private": true,
  "packageManager": "bun@1.3.14",
  "workspaces": { "packages": ["mcp-server", "graph-core"] }
}
JSON

  cat > "$root/setup.sh" <<'SETUP'
#!/usr/bin/env bash
# setup.sh — one-time install for the open-graph server bundle.
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun not found. Install it first: https://bun.sh" >&2
  echo "  curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi
bun install
echo
echo "Setup complete. See START.md for how to run the server."
SETUP
  chmod +x "$root/setup.sh"

  cp "$repo_root/.github/release-assets/START.md" "$root/START.md"
}

mkdir -p "$out_dir"
build_bundle "open-graph-proxy-$tag"
build_bundle "open-graph-plugin-$tag" --with-plugin
build_server_bundle "open-graph-server-$tag"
tar -czf "$out_dir/open-graph-proxy-$tag.tar.gz" -C "$stage" "open-graph-proxy-$tag"
tar -czf "$out_dir/open-graph-plugin-$tag.tar.gz" -C "$stage" "open-graph-plugin-$tag"
tar -czf "$out_dir/open-graph-server-$tag.tar.gz" -C "$stage" "open-graph-server-$tag"
cp "$repo_root/.github/release-assets/INSTALL.md" "$out_dir/INSTALL.md"

echo "beta assets for $tag:"
ls -l "$out_dir"
