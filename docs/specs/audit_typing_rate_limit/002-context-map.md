# F006 — Context Map

## Bounded Contexts

| Context | Project | Owns |
|---|---|---|
| Browser Activity Aggregation | `mcp-web` | Rate window, leading/trailing scheduling, timer cancellation, and tool invocation. |
| Presence Registry | `mcp-server` | Session lifecycle and the tenant/user-to-session index. |
| Typing Classification | `mcp-server` | Activity timestamps, state classification, and transition-only broadcasts. |

## Context Relationships

```text
Draft inputs
  -> Browser Activity Aggregation
       -> presence.typing tool
            -> Presence Registry
                 -> Typing Classification
                      -> SSE cell observers
```

Browser Activity Aggregation is an upstream customer of the unchanged MCP tool. Presence Registry supplies indexed sessions to Typing Classification.

## Integration Contract

### Tool request

`presence.typing` remains authenticated by the connection wrapper and accepts the existing token-backed request. No user or session identity is trusted from browser arguments.

### Rate-limiter contract

- `signal()` sends immediately when outside a window.
- Activity inside the window schedules exactly one trailing send at the window boundary.
- Repeated activity moves no send beyond the maximum 400 ms interval.
- `cancel()` clears pending work and invalidates callbacks owned by the old connection.

### Actor index contract

- Key includes both tenant and user identity without ambiguous string concatenation.
- Value is a set of session identifiers.
- Registration is idempotent.
- Removal deletes the actor bucket when its final session leaves.
- Lookup touches only indexed sessions and validates each against canonical presence state.

## Invariants

- Network call count is bounded by elapsed rate windows, not keystroke count.
- `touchDelta` work is proportional to the actor's sessions, not total tenant/global presence.
- Multi-tab sessions for one actor receive the same activity time.
- Cross-tenant actors with equal user IDs remain isolated.
- Existing invisible-user and transition routing semantics remain unchanged.

## Failure Translation

| Failure | Behavior |
|---|---|
| Typing tool rejects | Log once per emitted request; do not break draft input. |
| Connection closes with trailing work | Cancel it; send nothing. |
| Actor has no live presence | Return success and perform no timestamp update. |
| Stale actor-index entry | Remove stale session ID and continue. |
| Session ownership mismatch | Do not touch the mismatched presence; repair the bucket. |

