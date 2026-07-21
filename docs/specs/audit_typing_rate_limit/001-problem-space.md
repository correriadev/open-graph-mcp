# F006 — Presence Typing Rate Limit: Problem Space

## Scope

Typing activity must remain responsive without issuing one authenticated MCP call per keystroke or scanning every presence in a tenant for each signal. The web client bounds network frequency, while the server locates only the sessions owned by the authenticated tenant/user pair.

## Domain Events

1. A user edits a draft field.
2. The browser records local typing activity.
3. The browser emits at most one typing signal per rate window, with a trailing signal for activity received during the window.
4. The server authenticates the signal and resolves the actor's live session identifiers from an in-memory index.
5. The server updates `lastDeltaAt` only for those sessions.
6. The existing typing sweep classifies session transitions and broadcasts only state changes.
7. Session close or expiry removes the session from both presence state and the actor index.

## Subdomains

| Subdomain | Classification | Responsibility |
|---|---|---|
| Typing activity | Core | Convert input activity into bounded authenticated signals and state transitions. |
| Presence lifecycle | Core | Keep session state and the tenant/user lookup index consistent. |
| Draft interaction | Supporting | Report typing activity from claim form and raw JSON inputs. |
| Ephemeral delivery | Supporting | Route transition-only `user.typing_state` events to cell observers. |

## Ubiquitous Language

| Term | Meaning |
|---|---|
| Typing signal | Authenticated `presence.typing` tool call representing recent browser input. |
| Rate window | Fixed 400 ms interval that bounds typing signal frequency per web connection. |
| Leading signal | Immediate signal when activity begins outside an active rate window. |
| Trailing signal | One deferred signal representing activity coalesced during an active window. |
| Actor key | Collision-safe `(tenantId, userId)` identity used by the presence index. |
| Actor session index | In-memory mapping from actor key to live session identifiers. |
| Typing transition | Change among `quiet`, `typing`, and `idle`; unchanged classification emits nothing. |

## Business Rules

- The web client sends no more than one immediate signal per 400 ms window and at most one trailing signal for coalesced activity.
- Continuous input still refreshes server activity; trailing-only debounce that waits forever is prohibited.
- Disconnect cancels pending browser timers and prevents a stale signal from using a later connection.
- Authentication and the public `presence.typing` contract remain unchanged.
- One user may own multiple live sessions in the same tenant; all must receive the updated timestamp.
- Users with the same identifier in different tenants never share an index bucket.
- Presence creation, explicit close, heartbeat expiry, and server initialization keep the actor index consistent.
- Typing state remains ephemeral and transition-only.

## Resolved Design Questions

- Use a 400 ms leading-plus-trailing rate limiter, matching the audit's target of approximately one emission per 400 ms while preserving responsiveness.
- Keep the server tool token-only; do not add a browser session identifier to the public contract.
- Index session identifiers rather than `Presence` object references so the canonical presence map remains the source of live session state.
- Encapsulate add/remove/lookup operations in presence lifecycle helpers; remove empty actor buckets.
- Treat an index entry pointing to a missing or mismatched presence as stale: skip it and clean it defensively.

