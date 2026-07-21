# F008 — MCP-WEB TEST SCENARIOS

## FEATURE: SAFE RAW CLAIM DRAFT

### SCENARIO: MALFORMED JSON RETURNS A STRUCTURED REJECTION

**Given** an active turn and raw draft text with invalid JSON syntax  
**When** `claimDraft` is invoked  
**Then** it resolves with `ok: false`, one user-facing reason, and no warnings  
**And** `changeset.claim` is not called  
**And** the raw input remains unchanged

### SCENARIO: VALID RAW JSON PRESERVES THE MUTATION CONTRACT

**Given** an active turn and syntactically valid raw JSON  
**When** `claimDraft` is invoked  
**Then** the parsed value is sent through the existing `claim.add` delta contract  
**And** server reasons and warnings are returned unchanged

## FEATURE: BOUNDED REFERENCE LOOKUP

### SCENARIO: LOCAL CLAIM NAVIGATES WITHOUT A RESOURCE READ

**Given** the referenced claim is already loaded under its owner cell  
**When** its RefChip is selected  
**Then** the owner cell is selected, the claim opens, and the camera is requested  
**And** no point or snapshot resource is read

### SCENARIO: UNCACHED CLAIM NAVIGATES THROUGH ONE POINT LOOKUP

**Given** the referenced claim is absent from local pages but exists in the tenant  
**When** its RefChip is selected  
**Then** one encoded `graph://claims?id=` read occurs  
**And** the claim merges into its owner cell without replacing existing claims or page metadata  
**And** the owner cell is selected, the claim opens, and the camera is requested  
**And** no snapshot resource is read

### SCENARIO: DUPLICATE CLICKS SHARE ONE REQUEST

**Given** a point lookup for one generation and claim ID is pending  
**When** the same reference is selected repeatedly  
**Then** exactly one resource request runs  
**And** completion produces one idempotent merge and navigation effect

### SCENARIO: MISSING CLAIM USES BOUNDED NEGATIVE KNOWLEDGE

**Given** point lookup returns `{ claim: null }`  
**When** the reference is selected repeatedly inside the negative TTL  
**Then** one request and one missing-reference notification occur  
**And** no snapshot reload occurs  
**When** the TTL expires  
**Then** a later selection may retry the point lookup

### SCENARIO: STALE HIT IS DISCARDED

**Given** a point lookup is pending  
**When** projection invalidation advances the generation before the hit returns  
**Then** the claim is not merged or opened  
**And** selection, camera request, cache, and notifications remain unchanged

### SCENARIO: STALE MISS IS DISCARDED

**Given** a point lookup is pending  
**When** projection invalidation advances the generation before a null response returns  
**Then** no negative entry or missing-reference notification is created

## FEATURE: ERROR CONTAINMENT

### SCENARIO: INVALID POINT RESPONSE DOES NOT CORRUPT PROJECTION

**Given** the claims-by-ID response lacks required claim identity or owner-cell fields  
**When** navigation processes the response  
**Then** existing claim pages and cursors remain unchanged  
**And** the user receives a bounded read failure or missing-reference outcome

## COVERAGE MATRIX

| Risk | Covered By |
|---|---|
| Unhandled JSON rejection | Malformed draft scenario |
| Accidental mutation | Zero-call malformed draft assertion |
| Full snapshot fallback | Uncached hit and miss network assertions |
| Duplicate request fan-out | Single-flight duplicate scenario |
| Cross-generation corruption | Stale hit and stale miss scenarios |
| Cache exhaustion | TTL and bounded-entry behavior |
| Pagination state loss | Non-destructive merge assertion |

