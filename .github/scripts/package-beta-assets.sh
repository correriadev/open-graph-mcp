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
#   INSTALL.md                      copied from .github/release-assets/INSTALL.md.
#
# Vendoring rule: only src/ + package.json of stdio-proxy and client, with devDependencies
# stripped — stdio-proxy's devDeps reference @open-graph-mcp/mcp-server (workspace:*), which is
# test-only and deliberately NOT in the bundle (would drag graph-core along — scope doc risk #1).
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

mkdir -p "$out_dir"
build_bundle "open-graph-proxy-$tag"
build_bundle "open-graph-plugin-$tag" --with-plugin
tar -czf "$out_dir/open-graph-proxy-$tag.tar.gz" -C "$stage" "open-graph-proxy-$tag"
tar -czf "$out_dir/open-graph-plugin-$tag.tar.gz" -C "$stage" "open-graph-plugin-$tag"
cp "$repo_root/.github/release-assets/INSTALL.md" "$out_dir/INSTALL.md"

echo "beta assets for $tag:"
ls -l "$out_dir"
