# F007 — CONTEXT MAP

## BOUNDED CONTEXTS

| Context | Model | Responsibility |
|---|---|---|
| Application Runtime | React application and Zustand state | Render and mutate user-visible state through production flows. |
| Instrumentation Bridge | E2E bridge contract and installer | Adapt deterministic test commands to existing runtime operations. |
| Build Configuration | Vite mode and compile-time eligibility | Include the bridge only in explicitly instrumented artifacts. |
| Browser Harness | Playwright fixture and scenarios | Request the instrumented build and invoke bridge operations. |
| Artifact Gate | Production bundle inspection | Reject any standard artifact containing the test bridge surface. |

## RELATIONSHIPS

| Upstream | Downstream | Pattern | Contract |
|---|---|---|---|
| Build Configuration | Instrumentation Bridge | Conformist | A compile-time boolean controls inclusion and dead-code elimination. |
| Application Runtime | Instrumentation Bridge | Open Host Service | Existing camera, presence, toast, and store operations back bridge commands. |
| Instrumentation Bridge | Browser Harness | Published Language | `window.__og_e2e` retains the command names used by current scenarios. |
| Build Configuration | Browser Harness | Customer/Supplier | The fixture explicitly requests the e2e build profile before preview. |
| Standard Production Build | Artifact Gate | Conformist | The gate inspects generated JavaScript for prohibited bridge markers. |

## CONTEXT FLOW

1. The browser harness requests an instrumented build.
2. Build configuration replaces the eligibility flag with `true` for that build only.
3. Application runtime mounts without depending on instrumentation.
4. The bridge owner installs the published test contract and cleans it up on unmount.
5. Standard build replaces eligibility with `false`; tree-shaking removes bridge code.
6. The artifact gate verifies absence independently of runtime behavior.

## INTEGRATION CONSTRAINTS

- Keep `window.__og_e2e` as the e2e published language to avoid unrelated scenario rewrites.
- Keep the special e2e profile opt-in and local to the Playwright fixture.
- Do not read runtime query parameters, local storage, or server responses to enable instrumentation.
- Do not add an MCP endpoint or authentication exception for browser tests.
- Do not expose store mutation helpers from the production application API.

## OWNERSHIP

| Artifact | Owner |
|---|---|
| Compile-time flag | `vite.config.ts` |
| Bridge contract and installation | `src/e2e-bridge.ts` |
| Bridge lifecycle integration | `src/app.tsx` |
| Instrumented build selection | `e2e/fixture.ts` |
| Standard artifact regression | `test/e2e-bridge.test.ts` or equivalent build-focused test |

