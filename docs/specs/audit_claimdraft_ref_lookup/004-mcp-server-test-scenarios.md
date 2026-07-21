# F008 — MCP-SERVER TEST SCENARIOS

## FEATURE: CLAIM POINT LOOKUP

### SCENARIO: RESOLVE A CLAIM IN THE CALLER TENANT

**Given** tenant A owns claim `ref:α/1`  
**When** tenant A reads `graph://claims?id=ref%3A%CE%B1%2F1`  
**Then** the envelope contains exactly that full claim  
**And** its level, references, verdict, and file follow existing normalization and redaction

### SCENARIO: UNKNOWN CLAIM IS A NULLABLE MISS

**Given** no tenant claim has ID `missing`  
**When** an authenticated caller reads `graph://claims?id=missing`  
**Then** the response is `{ claim: null }`  
**And** no exception or page scan occurs

### SCENARIO: FOREIGN CLAIM IS INDISTINGUISHABLE FROM A MISS

**Given** tenant A owns claim `private-ref`  
**And** tenant B has no claim with that ID  
**When** tenant B reads `graph://claims?id=private-ref`  
**Then** the response is `{ claim: null }`  
**And** no tenant A metadata is disclosed

## FEATURE: INPUT AND MODE RULES

### SCENARIO: EMPTY POINT IDENTIFIER IS REJECTED

**Given** a claims URI contains the `id` parameter with an empty value  
**When** the resource is resolved  
**Then** resolution fails with a stable invalid-ID error  
**And** it does not fall through to cell lookup

### SCENARIO: AMBIGUOUS CLAIM MODE IS REJECTED

**Given** a claims URI combines `id` with `cell` or `scope=snapshot`  
**When** the resource is resolved  
**Then** resolution fails with a stable ambiguous-mode error  
**And** no query runs

### SCENARIO: RESERVED CHARACTERS ROUND-TRIP

**Given** a tenant claim ID contains spaces, slash, colon, ampersand, and Unicode  
**When** its encoded ID is read  
**Then** the exact claim is returned

## FEATURE: PAGINATION COMPATIBILITY

### SCENARIO: CELL AND SNAPSHOT CURSORS ARE UNCHANGED

**Given** enough claims for multiple pages  
**When** cell and snapshot modes are read with existing `since` and `limit` inputs  
**Then** claim ordering, `nextCursor`, and `hasMore` retain their current semantics  
**And** point lookup introduces no pagination fields into those responses

## COVERAGE MATRIX

| Risk | Covered By |
|---|---|
| Tenant enumeration | Foreign claim miss |
| Unbounded lookup | Exact tenant/ID query scenario |
| URI parsing errors | Reserved-character and empty-ID scenarios |
| Contract ambiguity | Ambiguous mode scenario |
| Pagination regression | Cursor compatibility scenario |

