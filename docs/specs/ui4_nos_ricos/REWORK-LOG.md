# F003 REWORK-LOG — RETRY #1 (2026-07-20)

Trigger: TL=0.52 and QA=0.58, both below 0.70. No HIGH/CRITICAL vulnerability. Reworks 0→1.

## Required work

- Measure real deterministic React Flow panning, including FPS and slow-frame counts.
- Assert node, floor, and tower regimes sequentially while preserving the same DOM root.
- Keep status and avatars visible in floor mode; remove oversized invisible tower hitboxes.
- Resolve lock holders to display names or neutral fallbacks; never expose raw user IDs.
- Add browser coverage for sanitized rich markdown, overflow, cell turn targeting, lock/presence updates, exceptional states, and minimap navigation.
- Narrow presence subscriptions so roster churn does not rerender every card.
- Represent empty locked cells without inventing graph-node geometry.
- Add component edge tests for duplicate claims/roster entries, propagation, and unknown holders.
- Preserve all existing unit, E2E, build, and performance gates.
