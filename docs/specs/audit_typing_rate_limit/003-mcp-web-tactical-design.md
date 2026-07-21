# F006 — mcp-web Tactical Design

## Section 1 — Components

| Component | Change |
|---|---|
| `src/og.ts` | Replace direct `presence.typing` calls with one connection-scoped 400 ms leading/trailing rate limiter; cancel it on disconnect. |
| `src/turn.tsx` | Continue reporting draft input through `signalTyping` without owning timers. |
| `test/typing-rate-limit.test.ts` | Verify timing, call bounds, cancellation, rejection isolation, and reconnect ownership with fake time. |
| `e2e/typing-indicator.e2e.ts` | Prove visible behavior and bounded tool calls during rapid/continuous input. |

## Section 2 — Value Objects

### TypingRateLimiter

State contains the last-send timestamp, one optional trailing timer, a pending-activity flag, and a connection generation. The rate window is `400` ms.

Operations:

- `signal()`: emit now when the window is open; otherwise mark pending and schedule one boundary callback.
- `fireTrailing()`: emit once if pending and the owning generation is current.
- `cancel()`: clear timer and pending state; increment generation.

## Section 3 — Interaction Flow

Every draft form or raw JSON `onChange` calls the stable `signalTyping` boundary. The boundary delegates to the connection-owned limiter. The actual callback reads the handle captured for that connection, calls `presence.typing`, and contains rejection through logging.

The existing `changeset.claim` path continues touching activity server-side after submission. The browser limiter covers pre-submit editing only and does not duplicate scheduling inside React components.

## Section 4 — Invariants and Edge Cases

- A burst of 100 synchronous changes emits one immediate call and one trailing call at most.
- Continuous activity emits at intervals no greater than 400 ms while input continues.
- An idle gap opens a new window and the next edit emits immediately.
- Multiple fields share one limiter per connection.
- Unmounting DraftPanel alone does not leak timers; connection teardown owns cancellation.
- A callback scheduled by connection A never sends through connection B after reconnect.
- An MCP rejection never rejects the input handler or changes form state.

## Section 5 — Verification Strategy

- Use fake timers for exact boundary assertions at 399/400/800 ms.
- Inject a send spy into a pure limiter helper or exported factory.
- Assert rapid input, continuous input, idle restart, cancellation, and generation rollover.
- In browser coverage, instrument existing development-only call counting or intercept JSON-RPC requests.
- Preserve the current visible quiet-to-typing-to-idle behavior.

## Section 6 — Ordered Development Tasks
```json
[
  {
    "id": "01",
    "title": "Specify the connection-scoped typing rate limiter",
    "description": "Add failing fake-time tests for leading and trailing sends, the 400 ms bound, continuous activity, idle restart, cancellation, reconnect ownership, and rejected tool calls.",
    "dependencies": []
  },
  {
    "id": "02",
    "title": "Implement bounded browser typing signals",
    "description": "Introduce the minimal rate-limiter helper and wire signalTyping plus connection teardown in og.ts while keeping Turn inputs timer-free.",
    "dependencies": ["01"]
  },
  {
    "id": "03",
    "title": "Prove typing UX and network call bounds",
    "description": "Extend browser coverage so rapid and sustained draft edits preserve typing transitions while presence.typing request count remains bounded by 400 ms windows.",
    "dependencies": ["02"]
  }
]
```

