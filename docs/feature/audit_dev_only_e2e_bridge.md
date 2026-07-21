# DEV-ONLY E2E INSTRUMENTATION BRIDGE

## OVERVIEW

- **Exclude** browser-test globals from standard production artifacts.
- **Enable** deterministic browser controls only in an explicit e2e build profile.
- **Keep** production camera and application behavior independent from instrumentation.

## BUILD CONTRACT

| Build profile | Instrumentation |
|---|---|
| standard production | Replace `__OG_E2E__` with `false` and remove the bridge branch. |
| `e2e` | Replace `__OG_E2E__` with `true` and install browser-test controls. |

- REQUIRED: **Select instrumentation at compile time through the Vite mode**.
- REQUIRED: **Keep the ordinary production build uninstrumented**.
- REQUIRED: **Request `e2e` mode explicitly from the Playwright fixture**.
- PROHIBITED: **Enable instrumentation through URLs, storage, or server responses**.

## BRIDGE CONTRACT

| Operation group | Responsibility |
|---|---|
| presence | Focus a cell and poll visible collaborators. |
| notifications | Push deterministic toast content. |
| viewport | Read, replace, zoom, or center the React Flow viewport. |
| graph presentation | Set test-only responsibility, drift, and authority projections. |

- REQUIRED: **Install one bridge instance for the current camera owner**.
- REQUIRED: **Delete the global only when cleanup owns the installed instance**.
- REQUIRED: **Preserve newer bridge instances during stale cleanup**.
- PROHIBITED: **Make production behavior depend on bridge availability**.

## ARTIFACT CONSTRAINTS

- **Remove** the `__og_e2e` marker and test-only mutation surface from emitted production JavaScript.
- **Keep** the e2e artifact non-deployable and local to browser automation.
- **Use** the same MCP resources and tools in standard and instrumented builds.
- **Avoid** server endpoints or authentication exceptions for test instrumentation.

## FOLDER STRUCTURE

| Path | Responsibility |
|---|---|
| `packages/mcp-web/vite.config.ts` | Define the compile-time e2e eligibility constant. |
| `packages/mcp-web/src/vite-env.d.ts` | Declare the compile-time constant for TypeScript. |
| `packages/mcp-web/src/e2e-bridge.ts` | Define, install, and safely remove the browser bridge. |
| `packages/mcp-web/src/app.tsx` | Supply live camera and application dependencies in eligible builds. |
| `packages/mcp-web/e2e/fixture.ts` | Build the preview artifact with explicit `e2e` mode. |
| `packages/mcp-web/test/e2e-bridge.test.ts` | Verify bridge lifecycle and production artifact exclusion. |

## CROSS-REFERENCES

- **Keep** this feature document self-contained until a human approves a related ADR.
