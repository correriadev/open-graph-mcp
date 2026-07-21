# F007 — DEV-ONLY E2E INSTRUMENTATION BRIDGE

## SCOPE

Remove mutable `window.__og_e2e` hooks from standard production bundles while preserving deterministic browser-test control in an explicitly instrumented build.

## DOMAIN EVENTS

1. **Web Build Requested** — a caller selects the standard or e2e build profile.
2. **Instrumentation Eligibility Resolved** — the compile-time profile permits or rejects the bridge.
3. **Application Mounted** — the canvas and production services initialize normally.
4. **E2E Bridge Installed** — an eligible build exposes deterministic test operations.
5. **E2E Operation Invoked** — a browser test drives a named operation through the bridge.
6. **Bridge Owner Unmounted** — the installed global is removed.
7. **Production Artifact Verified** — bundle inspection confirms the bridge name and mutation API are absent.

## SUBDOMAINS

| Subdomain | Type | Responsibility |
|---|---|---|
| Production UI | Core | Preserve user-visible graph and collaboration behavior without test globals. |
| Test Instrumentation | Supporting | Expose deterministic browser controls only in an explicit e2e build. |
| Build Profiles | Supporting | Replace eligibility branches at compile time and support dead-code elimination. |
| Artifact Verification | Generic | Prove standard production output contains no instrumentation surface. |

## UBIQUITOUS LANGUAGE

| Term | Meaning |
|---|---|
| Standard Production Build | The deployable `vite build` output with no test bridge. |
| Instrumented E2E Build | A non-deployable build created explicitly for Playwright. |
| E2E Bridge | The development-only browser global used by test drivers. |
| Bridge Owner | The mounted component or module responsible for install and cleanup. |
| Eligibility Flag | A compile-time constant enabled only by the e2e build profile. |
| Production Global Exposure | Any test-only name or callable mutation hook reachable from `window` in a standard production build. |
| Artifact Proof | A check against standard build output showing the bridge surface is absent. |

## BUSINESS RULES

- A standard production build MUST NOT install or ship the `__og_e2e` bridge.
- An instrumented e2e build MAY expose the bridge for deterministic Playwright scenarios.
- Production behavior MUST NOT depend on bridge installation.
- Bridge installation MUST be compile-time removable, not only runtime hidden.
- Bridge teardown MUST remove only the bridge instance owned by the current mount.
- Existing browser scenarios MUST retain their observable behavior through the instrumented build.
- No server contract change is required.

## RISKS AND QUESTIONS

| Question | Autonomous Resolution |
|---|---|
| How can Playwright keep using a production-like preview? | Build with a dedicated `e2e` Vite mode and preview that artifact. |
| Is an `import.meta.env.DEV` guard sufficient? | No. Current Playwright builds before preview, so use a distinct compile-time e2e eligibility flag. |
| Is deleting the global after startup sufficient? | No. Mutation code must be absent from the standard artifact. |
| Should production stores add test setters? | No. Keep test mutation access inside the removable bridge module. |
| Does mcp-server need modification? | No. The issue is confined to mcp-web build and browser instrumentation. |

## ACCEPTANCE BOUNDARY

- Standard build output contains no `__og_e2e` identifier or bridge mutation implementation.
- Standard runtime exposes no `window.__og_e2e` global.
- E2E-mode runtime installs the expected bridge and removes it on owner teardown.
- Existing dependent Playwright scenarios pass against the instrumented build.

