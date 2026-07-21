# F007 — MCP-WEB TEST SCENARIOS

## FEATURE: STANDARD PRODUCTION EXCLUSION

### SCENARIO: STANDARD RUNTIME HAS NO E2E GLOBAL

**Given** the application is built with the standard production profile  
**When** a browser loads the application and the canvas mounts  
**Then** `window.__og_e2e` is absent  
**And** normal graph navigation and camera centering remain available

### SCENARIO: STANDARD ARTIFACT CONTAINS NO BRIDGE

**Given** a clean standard production build  
**When** every emitted JavaScript asset is inspected  
**Then** no asset contains `__og_e2e`  
**And** no asset contains an instrumentation-only mutation marker  
**And** source maps are excluded from the marker scan or inspected without false positives from source content

### SCENARIO: RUNTIME INPUT CANNOT ENABLE INSTRUMENTATION

**Given** a standard production build  
**When** the URL includes an e2e-like query parameter and storage contains an e2e-like key  
**Then** the bridge remains absent  
**And** no mutable store command becomes globally reachable

## FEATURE: EXPLICIT E2E ELIGIBILITY

### SCENARIO: INSTRUMENTED BUILD INSTALLS THE PUBLISHED CONTRACT

**Given** the Playwright fixture requested the explicit e2e build profile  
**When** `CameraDriver` mounts  
**Then** `window.__og_e2e` exposes every existing command name  
**And** a smoke invocation reads the viewport and focuses a real cell

### SCENARIO: STANDARD COMMAND BEHAVIOR IS PRESERVED

**Given** an instrumented build with a loaded graph  
**When** a scenario invokes focus, viewport, toast, responsibility, drift, and authority commands  
**Then** each command produces the same observable state used by existing scenarios  
**And** production event handlers remain unchanged

## FEATURE: BRIDGE LIFECYCLE OWNERSHIP

### SCENARIO: OWNER CLEANUP REMOVES ITS BRIDGE

**Given** one bridge instance is installed  
**When** its owner unmounts  
**Then** that instance is removed from the target window

### SCENARIO: STALE CLEANUP PRESERVES A REPLACEMENT

**Given** owner A installed bridge A  
**And** owner B subsequently installed bridge B  
**When** owner A cleanup runs  
**Then** bridge B remains installed  
**And** owner B cleanup removes bridge B

## FEATURE: REGRESSION GATE

### SCENARIO: ALL BRIDGE-DEPENDENT E2E SPECS PASS

**Given** the harness previews an instrumented build  
**When** the existing activity, avatar, reconnect, performance, semantic zoom, invisibility, toast, and typing scenarios run  
**Then** none fails because the bridge is unavailable  
**And** no scenario requires a production-global fallback

### SCENARIO: BUILD MODE DOES NOT ALTER SERVER CONTRACTS

**Given** standard and instrumented web builds connect to the same MCP server  
**When** equivalent production actions are performed  
**Then** both use the same MCP resources and tools  
**And** the instrumented build adds no server endpoint or authentication bypass

## COVERAGE MATRIX

| Risk | Scenario Coverage |
|---|---|
| Production global exposure | Standard runtime and artifact exclusion |
| Runtime backdoor enabling | Query and storage non-enablement |
| Tree-shaking regression | Standard artifact marker scan |
| Lost e2e observability | Published contract and dependent suite regression |
| Strict Mode or remount race | Identity-safe stale cleanup |
| Server test bypass | Equivalent server-contract scenario |

