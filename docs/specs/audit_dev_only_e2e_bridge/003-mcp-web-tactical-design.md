# F007 — MCP-WEB TACTICAL DESIGN

## SECTION 1 — COMPONENTS

| Component | Change |
|---|---|
| `vite.config.ts` | Define a compile-time e2e eligibility constant from an explicit Vite mode. |
| `src/e2e-bridge.ts` | Own the bridge type, installation, command adapters, and identity-safe cleanup. |
| `src/app.tsx` | Supply live camera/runtime dependencies to the bridge only behind the eligibility branch. |
| `e2e/fixture.ts` | Build the preview artifact with the explicit e2e mode. |
| `test/e2e-bridge.test.ts` | Verify installation, cleanup, and standard-build exclusion. |

## SECTION 2 — VALUE OBJECTS

### BuildProfile

`standard` produces deployable output without instrumentation. `e2e` produces a non-deployable Playwright artifact with instrumentation enabled.

### E2EBridge

Preserve the existing operations: `setFocus`, `pushToast`, `pollWho`, `getViewport`, `setViewport`, `zoomTo`, `focusNode`, `setNodeResponsibility`, `setNodeDrift`, and `setCellAuthority`.

### BridgeDependencies

Pass the current React Flow instance and existing runtime functions into the installer. Keep mutable graph/drift helpers private to the bridge module and eligible branch.

## SECTION 3 — LIFECYCLE

1. Vite resolves the explicit build profile and statically replaces the eligibility constant.
2. `CameraDriver` mounts and continues production camera-centering behavior unconditionally.
3. In an eligible build, the bridge installer creates one contract object and assigns it to `window.__og_e2e`.
4. Playwright invokes the unchanged published command names.
5. Cleanup deletes the global only when it still references the instance installed by that owner.
6. In a standard build, dead-code elimination removes the eligibility branch and bridge implementation.

## SECTION 4 — INVARIANTS AND EDGE CASES

- The standard runtime never creates `window.__og_e2e`.
- The standard JavaScript artifact contains neither the global marker nor mutable bridge command names unique to instrumentation.
- A query parameter, local-storage value, or console assignment cannot enable the bridge.
- React Strict Mode mount/cleanup cycles leave the newest bridge intact and remove stale instances safely.
- HMR or remount cleanup does not delete a bridge owned by a newer mount.
- Existing e2e command names and behavior remain stable.
- The production camera-centering effect remains independent from bridge eligibility.
- An accidental ordinary `vite build --mode production` remains uninstrumented.

## SECTION 5 — VERIFICATION STRATEGY

- Unit-test installer creation and identity-safe cleanup with a controlled window target and fake dependencies.
- Build once in standard mode and scan emitted JavaScript for `__og_e2e` and instrumentation-only mutation markers.
- Build in e2e mode and run a smoke scenario that waits for the bridge before invoking it.
- Run all Playwright scenarios that currently call `window.__og_e2e`.
- Run TypeScript, web unit tests, and the standard production build.

## SECTION 6 — ORDERED DEVELOPMENT TASKS

```json
[
  {
    "id": "01",
    "title": "Specify bridge eligibility and artifact isolation",
    "description": "Add failing tests for bridge install and identity-safe cleanup, standard runtime absence, standard artifact marker absence, and explicit e2e eligibility.",
    "dependencies": []
  },
  {
    "id": "02",
    "title": "Extract the development-only e2e bridge",
    "description": "Move the existing test command surface into a typed bridge module and integrate lifecycle-safe installation without changing production camera behavior.",
    "dependencies": ["01"]
  },
  {
    "id": "03",
    "title": "Add explicit instrumented build ownership",
    "description": "Define compile-time standard and e2e profiles, make the Playwright fixture request the e2e profile, and ensure standard builds tree-shake the bridge.",
    "dependencies": ["02"]
  },
  {
    "id": "04",
    "title": "Regress browser observability and production exclusion",
    "description": "Run dependent Playwright scenarios, TypeScript and unit suites, then verify the standard production artifact exposes no e2e global or mutation bridge.",
    "dependencies": ["03"]
  }
]
```

