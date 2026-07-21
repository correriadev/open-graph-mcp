# F009 — MCP-SERVER TEST SCENARIOS

## FEATURE: CANONICAL LEVEL ADMISSION

### SCENARIO: SUPPORTED WIRE LEVELS SHARE ONE CANONICAL FORM

**Given** an owned open changeset and each integer `0`–`5` or exact string `P0`–`P5`  
**When** a valid `claim.add` is staged and committed  
**Then** gates receive the equivalent numeric level  
**And** SQLite and claims JSONL contain exact `P<n>`  
**And** claim resources return the corresponding numeric level

### SCENARIO: NONCANONICAL LEVEL IS REJECTED BEFORE SIDE EFFECTS

**Given** a level that is absent, `null`, boolean, float, infinite, signed, padded, lowercase, duplicated-prefix, object, array, or outside `0`–`5`  
**When** `changeset.claim` receives the payload  
**Then** it returns one stable invalid-level reason  
**And** no delta row or JSONL line is written  
**And** no delta aggregation, cache, graph, claim row, or event changes

### SCENARIO: DEFENSE-IN-DEPTH WRITE REJECTS INVALID LEVEL

**Given** an invalid claim payload bypasses ordinary tool admission in a focused test  
**When** commit or `writeClaim` receives it  
**Then** the transaction fails atomically  
**And** no invalid SQLite or JSONL claim becomes visible

## FEATURE: CANONICAL RECOVERY

### SCENARIO: LEGACY NUMERIC LEVEL REPLAYS CANONICALLY

**Given** a legacy claims JSONL row stores level `4` or `"4"`  
**When** tenant state is rebuilt  
**Then** SQLite stores `P4`  
**And** indexed `graph://claims?cell=<domain>:P4` reads the claim

### SCENARIO: INVALID LEGACY LEVEL ABORTS REBUILD

**Given** a claims JSONL row contains an unsupported level  
**When** recovery runs  
**Then** recovery fails deterministically  
**And** the tenant is not left partially rebuilt  
**And** the invalid row is never exposed as a valid claim

## FEATURE: DENY-BY-DEFAULT FILE PROJECTION

### SCENARIO: PROVEN REPOSITORY FILE RETURNS A RELATIVE PATH

**Given** repository root `/srv/work/repo` and file `/srv/work/repo/src/auth/login.ts`  
**When** a claim resource maps the file  
**Then** it returns `src/auth/login.ts`

### SCENARIO: PREFIX-CONFUSED PATH REVEALS ONLY BASENAME

**Given** repository root `/srv/work/repo` and file `/srv/work/repo-secret/config.yml`  
**When** a claim resource maps the file  
**Then** it returns only `config.yml`  
**And** no ancestor segment is exposed

### SCENARIO: CROSS-DIALECT ABSOLUTE PATH REVEALS ONLY BASENAME

**Given** POSIX, drive-absolute, drive-relative, UNC, extended-device, and mixed-separator file inputs outside the proven repository  
**When** each file is projected  
**Then** each output contains at most a sanitized basename  
**And** no drive, host, share, home, repository, or traversal segment remains

### SCENARIO: MALFORMED FILE VALUE IS OMITTED

**Given** a file value is empty, root-only, dot-only, contains NUL or controls, or has no safe final segment  
**When** the claim is projected  
**Then** the file field is omitted  
**And** resource resolution does not throw

### SCENARIO: SAFE RELATIVE FILE REMAINS USEFUL

**Given** a normalized traversal-free relative file such as `src/auth/login.ts`  
**When** the claim is projected  
**Then** the relative path is preserved  
**And** separators are normalized to `/`

## FEATURE: RESOURCE COMPATIBILITY

### SCENARIO: ALL CLAIM READ MODES SHARE SAFE MAPPING

**Given** claims are read by cell page, snapshot page, and exact ID  
**When** their records are compared  
**Then** level and file projection are identical across modes  
**And** cursor behavior and tenant isolation remain unchanged

## COVERAGE MATRIX

| Risk | Covered By |
|---|---|
| Invalid durable level | Admission, write defense, and recovery scenarios |
| Pre-rejection side effect | Noncanonical level scenario |
| Recovery hides claims | Legacy replay scenario |
| POSIX prefix confusion | Prefix-confused path scenario |
| Windows or UNC disclosure | Cross-dialect path scenario |
| Malformed path crash | Omitted malformed value scenario |
| API regression | Supported wire levels and all read modes |

