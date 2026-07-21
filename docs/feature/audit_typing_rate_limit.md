# TYPING RATE LIMIT AND ACTOR SESSION INDEX

## OVERVIEW

- **Bound** browser `presence.typing` calls with one connection-owned rate limiter.
- **Resolve** server typing activity through a tenant and user session index.
- **Preserve** multi-session typing transitions and tenant isolation.

## CLIENT BEHAVIOR

| Concern | Rule |
|---|---|
| window | Use a `400` ms leading-and-trailing rate window. |
| ownership | Keep one limiter per active MCP connection. |
| teardown | Cancel pending activity when the owning connection closes. |
| reconnect | Ignore callbacks owned by an obsolete connection generation. |
| failures | Contain rejected `presence.typing` calls outside input handlers. |

- REQUIRED: **Share one limiter across all draft inputs**.
- REQUIRED: **Emit immediately when the rate window is open**.
- REQUIRED: **Emit at most one trailing call for pending activity**.
- PROHIBITED: **Create timers inside React input components**.

## SERVER BEHAVIOR

| Structure | Responsibility |
|---|---|
| `presence` | Keep canonical ephemeral presence by session ID. |
| `actorSessions` | Map tenant to user to live session IDs. |

- REQUIRED: **Register only live SSE sessions owned by the authenticated actor**.
- REQUIRED: **Keep registration idempotent for repeated presence updates**.
- REQUIRED: **Remove indexed sessions on explicit close and heartbeat expiry**.
- REQUIRED: **Prune stale index entries during typing activity**.
- REQUIRED: **Update all live sessions owned by one actor with one timestamp**.
- PROHIBITED: **Scan every presence on each typing signal**.

## INVARIANTS

- **Keep** equal user IDs isolated across tenants.
- **Reject** malformed, unknown, or foreign session capabilities without mutating presence indexes.
- **Treat** the actor-session index as ephemeral and rebuild it through presence registration.
- **Retain** periodic global classification separately from the typing hot path.

## FOLDER STRUCTURE

| Path | Responsibility |
|---|---|
| `packages/mcp-web/src/typing-rate-limit.ts` | Implement leading-and-trailing typing call bounds. |
| `packages/mcp-web/src/og.ts` | Own the limiter for the active connection and expose `signalTyping`. |
| `packages/mcp-web/src/connection-owner.ts` | Guard asynchronous effects by connection generation. |
| `packages/mcp-web/test/typing-rate-limit.test.ts` | Verify timing, cancellation, sustained input, and failure isolation. |
| `packages/mcp-web/test/connection-owner.test.ts` | Verify stale connection effects cannot replace current state. |
| `packages/mcp-web/e2e/typing-indicator.e2e.ts` | Verify visible typing behavior under bounded network calls. |
| `packages/mcp-server/src/state.ts` | Store the ephemeral tenant/user actor-session index. |
| `packages/mcp-server/src/tools/presence.ts` | Maintain index membership across presence lifecycle events. |
| `packages/mcp-server/src/tools/typing.ts` | Touch indexed actor sessions and prune stale entries. |
| `packages/mcp-server/test/typing-network-aggregation.test.ts` | Verify multi-session aggregation, isolation, and bounded lookup. |
| `packages/mcp-server/test/heartbeat-expire.test.ts` | Verify expiry removes actor-session membership. |
| `packages/mcp-server/test/presence-ownership.test.ts` | Verify ownership rejection leaves indexes unchanged. |

## CROSS-REFERENCES

- **Keep** this feature document self-contained until a human approves a related ADR.
