# F006 Rework Log

## RETRY #1

### Tech-lead open points

- Guard every connection-scoped close side effect by generation so a late connection A close cannot mark connection B offline or disarm B's timers.
- Add connectOg lifecycle tests for out-of-order close callbacks and replacement ownership.
- Prove heartbeat-expiry index cleanup and rejected-ownership index immutability.
- Extend browser evidence through sustained multi-window typing and the quiet→typing→idle lifecycle.

### Adversarial edge cases missed

- Reject presence beat/focus registration unless the session ID maps to a live SSE session owned by the authenticated actor; fabricated IDs must not enter Presence or actorSessions.
- After active disconnect, signalTyping must not restart a timer or call a closed connection.
- A late close from connection A must not affect connection B's online state or timers.
- Expiry must remove session membership and empty tenant/user buckets.
- Exercise two real SSE sessions for one actor through the public typing tool and require identical timestamp updates.
- Invalid authentication and malformed session identifiers must not mutate presence/index state.

### Security findings

- HIGH `RESOURCE_EXHAUSTION`: one valid token can fabricate unbounded presence memberships, broadcasts, and per-typing work.
- MEDIUM `STALE_CONNECTION_ACTIVITY`: a cancelled but retained limiter can restart on a closed handle.
- MEDIUM `STALE_CONNECTION_STATE_RACE`: stale close callbacks can disrupt the replacement connection.
