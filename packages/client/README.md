# @open-graph-mcp/client

Zero-runtime-dependency TypeScript client library for the live layer of
open-graph-mcp (SSE event streaming, presence tracking). Must run under both
Bun and Node.js >=20. Consumed by `packages/mcp-web` today; `connect()` and a
Node-friendly token store land in later INT-2 tasks.

## Module / build approach

- Source (`src/`) is authored TypeScript, ESM (`"type": "module"`), zero runtime deps.
- `package.json#exports` serves three audiences differently:
  - `"bun"` -> `./src/index.ts` (Bun consumers in this workspace run TS source directly, no build).
  - `"import"` / `"types"` -> `./dist/index.js` / `./dist/index.d.ts` (plain-Node and any
    non-Bun bundler consumer get the compiled, plain-JS output).
- `dist/` is produced by `bun run build` (`tsc -p tsconfig.build.json`) and is git-ignored
  (repo root `.gitignore` already ignores `dist/`). **It must be rebuilt after every source
  change** — nothing rebuilds it automatically. Any cross-package import of
  `@open-graph-mcp/client` from a non-Bun-native consumer (e.g. `packages/stdio-proxy`'s
  `node-store` usage) needs `bun run build` to have run first; CI's `client-node` job does
  this itself before running Node-based tests.
- `tsconfig.json` is self-contained (does not `extend` `@tsconfig/bun`, unlike
  `mcp-server`/`stdio-proxy` — that package isn't in the lockfile/node_modules here, so `tsc`
  can't resolve it). `tsconfig.build.json` extends it, restricting `include` to `src` and
  emitting to `dist` with declarations.
- `moduleResolution`/`module` are `nodenext` (not `bundler`, unlike `mcp-web`) because this
  package's `tsc` invocation actually emits Node-runnable files — `bundler` resolution leaves
  extensionless relative imports in the output, which Node's ESM loader rejects at runtime.
  `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` (TS 5.7+) let source import
  siblings as `./foo.ts` (so Bun/Node's native TS runner can resolve them unmodified) while
  `tsc` rewrites those to `./foo.js` in the emitted `dist/` output.
- **A green `bun test` is not evidence the `dist` build is healthy.** Bun's runtime resolver
  silently accepts things `tsc` rejects (e.g. an extensionless relative import like
  `./foo` instead of `./foo.ts`) — `bun test` will stay green while `bun run build` fails.
  The `client-node` CI job (`.github/workflows/ci.yml`) now runs `bun run build` on every
  push/PR, but still run it locally after any source change rather than relying on CI to
  catch it first.

## Verified Node version floor

Two distinct floors, depending on how the code is consumed — verified empirically on this
machine (`node --version` v22.21.1, plus Node v20.20.2 installed via `nvm install 20`
specifically to test the floor):

- **Consuming the built `dist/` output (the real floor, and what `package.json#exports`
  resolves to for non-Bun consumers): Node >=20.** Plain compiled JS, no TypeScript or
  type-stripping involved. Confirmed green on Node v20.20.2.
- **Running `.ts` source directly with no build step (dev convenience only, not what
  `exports` resolves to): Node >=22.6 with `--experimental-strip-types`, or Node >=22.18
  unflagged.** Confirmed: Node v20.20.2 has no `--experimental-strip-types` flag at all and
  fails with `SyntaxError: Unexpected identifier` on bare `interface`/type syntax; Node
  v22.21.1 strips types with zero flags (has `--no-experimental-strip-types` to *disable* it,
  proving it defaults on).

## Running tests

```bash
# Bun (source, no build needed) — what root `bun test` / CI already runs:
bun test --cwd packages/client
# or, from repo root, as part of the whole workspace:
bun test

# Node, source, no build (dev convenience; needs Node >=22.18, or >=22.6 with the flag):
node --test packages/client/test/index.test.ts
# node --experimental-strip-types --test packages/client/test/index.test.ts   # Node 22.6-22.17

# Node, built dist (the real >=20 floor proof — requires a build first):
bun run --cwd packages/client build
node --test packages/client/test/dist-smoke.mjs
```

`test/index.test.ts` uses `node:test` + `node:assert/strict` (not `bun:test`) on purpose:
Bun implements the `node:test` module, so this one file runs unmodified under both `bun test`
and `node --test` — no duplicated test logic. `test/dist-smoke.mjs` is deliberately named
without `.test.` in the name so Bun's default test-discovery glob never picks it up; it's run
explicitly, after a build, to prove the shipped floor rather than the source-execution floor.

`bun run test:node` (`node --test test/*.test.ts`) runs every `*.test.ts` file directly under
plain Node in one shot — this proves the source-execution floor (Node >=22.18 unflagged, or
>=22.6 with `--experimental-strip-types`), not the shipped `dist` floor; it deliberately does
NOT pick up `dist-smoke.mjs` (see above). CI's `client-node` job runs this AND `dist-smoke.mjs`
separately, so both floors get regression coverage.
