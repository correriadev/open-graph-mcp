# F006 — mcp-web Test Scenarios

## Feature: Bounded browser typing signals

### Scenario 1 — Synchronous burst is coalesced

Given an active connection, when 100 draft changes occur synchronously, then one typing tool call occurs immediately, no additional call occurs before 400 ms, and at most one trailing call occurs at the boundary.

### Scenario 2 — Continuous typing remains live and bounded

Given edits continue every 50 ms for two seconds, when time advances, then signals occur no more frequently than once per 400 ms window and no activity remains unreported for longer than one window.

### Scenario 3 — Idle restart emits immediately

Given the previous rate window and trailing work are complete, when the next edit occurs after an idle gap, then a new leading signal is sent immediately.

### Scenario 4 — Multiple fields share one budget

Given edits alternate among subject, refs, anchor, and raw JSON fields within one window, then they produce one shared leading/trailing sequence rather than independent per-field calls.

### Scenario 5 — Disconnect cancels trailing work

Given activity scheduled a trailing send, when the connection closes before the boundary, then the timer is cleared and no later tool call occurs.

### Scenario 6 — Reconnect does not inherit stale callbacks

Given connection A has pending work and connection B replaces it, when A's old boundary passes, then no request is sent through B; B's first local edit starts its own window.

### Scenario 7 — Tool rejection does not affect draft state

Given `presence.typing` rejects, when the user edits a field, then the field retains its new value, no unhandled rejection occurs, and later edits remain eligible for bounded signals.

### Scenario 8 — Visible typing lifecycle remains correct

Given another user observes the focused cell, when rapid draft edits occur, then the observer sees one transition into typing followed by the existing idle/quiet transitions, without transition spam.

## Performance Acceptance

- For `N` edits within one 400 ms window, tool calls are at most two: one leading and one trailing.
- During sustained activity, call count is bounded by elapsed windows plus one trailing call.
- Draft React components allocate no per-field debounce timers.

