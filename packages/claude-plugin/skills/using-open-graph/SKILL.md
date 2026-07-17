---
name: using-open-graph
description: >
  Teaches the open-graph workflow: query the graph before implementing
  anything, and open a changeset ("turn"/"abrir turno") before editing a
  cell someone else is working in. Invoke this before writing or editing
  code in any repo wired to an open-graph-mcp server — specifically:
  before starting implementation work on a task (query first), before
  Edit/Write on a file that might map to a graph cell, when asked to
  change shared or cross-team code, when `presence.who` or a PreToolUse
  advisory shows another user active on the area you're about to touch,
  and whenever a tool call returns `lock.denied`/`cell_locked` or a
  `graph.query` result has non-empty `gaps`. Also applies when the human
  asks to flip authority on a cell (`authority.flip`) — that call is
  human-decision-only, never agent-initiated.
---

# Using open-graph

The graph is a second source of truth alongside the source code. Before
you build, ask it what it knows. Before you edit code someone else
claimed, open a turn. This skill is the difference between using the
graph and ignoring it.

## 1. Before implementing: query first

Call `graph.query` with terms drawn from the task, before writing any
code:

```
graph.query({ terms: ["rate-limit", "token-bucket"], domain: "api-gateway" })
=> { candidates: [...], gaps: [] }
```

- `candidates` — existing knowledge relevant to the task. Read the ones
  that look relevant (`file`/`anchor` point at where). Don't ignore a
  high-score candidate because you already have an implementation idea —
  reconcile with what's there.
- `gaps` — terms/domain/layer that matched **nothing**. This is not "no
  results, move on." It is a signal the graph has no record of something
  you're about to build on top of. If a gap is relevant to what you're
  about to implement, **stop and ask the human** — don't assume the area
  is untouched or that you're free to invent the design from scratch.
  Example: you query `{ terms: ["retry-policy"], domain: "api-gateway" }`
  and get `gaps: ["retry-policy"]` while about to add retry logic to
  gateway code — that's a prompt to ask "is there an existing
  retry-policy decision I should know about before I write one?", not a
  green light.

Don't try to preload the whole graph into the session "just in case."
Query on demand, scoped to the task at hand.

## 2. Before editing someone else's area: open a turn

A **cell** is `"<domain>:<layer>"`, e.g. `"api-gateway:P2"` — the
lock/authority/changeset granularity. Before editing a file that maps to
a cell, check who's there and open a turn if the area might be
contested.

**Deriving the cell from a file:** the `graph.query` you already ran in
step 1 tells you this — if the file you're about to edit shows up as a
`candidates[].file`, that candidate's `domain:layer` is the cell. If it
didn't show up, query again scoped to the file's area (e.g. terms from
the file/module name) before assuming there's no cell to worry about.

**Worked example — happy path:**

```
# 1. Who's around?
presence.who({ token, cell: "api-gateway:P2" })
=> { users: [{ id: "u_maria", name: "Maria", agentKind: "web",
              focusCell: "api-gateway:P2", openCount: 1, lastSeen: ... }] }

# Someone's focused here. Open a turn before touching it — don't just start editing.
changeset.open({ token, cells: ["api-gateway:P2"],
                  intent: "add retry policy to gateway client" })
=> { ok: true, csId: "cs_4f9a21b0c3d8e17f", expiresAt: ... }

# 2. Do the work. As you touch files, record what you touched:
changeset.claim({ token, csId: "cs_4f9a21b0c3d8e17f",
                   delta: { kind: "claim.add",
                            payload: { /* whatever the claim.add schema
                                          in your MCP tool's input schema
                                          asks for — inspect it, don't
                                          guess field names */ } } })
=> { ok: true, warnings: [] }

# 3. Finished and happy with the result:
changeset.commit({ token, csId: "cs_4f9a21b0c3d8e17f" })
=> { ok: true, admitSeq: 142 }
```

If you change plans mid-turn or abandon the work, don't leave the
changeset dangling:

```
changeset.abort({ token, csId: "cs_4f9a21b0c3d8e17f" })
=> { ok: true }
```

If `presence.who` shows nobody focused on the cell and you're confident
the edit is uncontested, it's reasonable to skip straight to editing
without a changeset — turns exist to coordinate with other agents/humans,
not as ceremony for empty cells. When in doubt (shared code, a cell
you've never touched, anything cross-team), open the turn anyway.

If a session was interrupted and you're not sure whether a turn is still
open from earlier, check before opening a new one:

```
changeset.list_mine({ token })
=> { changesets: [{ csId: "cs_...", intent: "...", cells: [...], openedAt, expiresAt }] }
```

## 3. `lock.denied` / `cell_locked`: negotiate, don't hammer

`changeset.open` can fail synchronously with this exact shape:

```
{ ok: false, reason: "cell_locked", cell: "api-gateway:P2",
  holder: "u_maria", csId: "cs_...", expiresAt: ... }
```

Recognize this shape immediately. Do **not** retry `changeset.open` in a
loop — the lock won't clear from you calling it again. Instead, pick one:

1. **Wait** — if `expiresAt` is close, and the work isn't urgent, hold off
   and retry once after it passes.
2. **Negotiate** — ask the human to coordinate with `holder` (or check
   `presence.who` for their live status), or ask the human how to
   proceed.
3. **Refocus** — work on a different cell/task and come back to this one
   later.

Never spin on `changeset.open` hoping the lock clears on its own.

## 4. `authority.flip`: human decision only

`authority.flip({ token, cell, to: "source" | "graph" })` changes which
side "owns the truth" for a cell — source code or the graph. This is an
irreversible-in-spirit call. **Never call this on your own judgment.**
Only call it when the human has explicitly told you to flip authority for
a specific cell. If a task seems to imply source and graph have drifted
and one should now be authoritative, say so and ask — don't flip it
yourself to "resolve" the conflict.

## What this skill does not do

- It doesn't block your edits. A locked cell only gets a warning (via a
  separate hook) — this skill is what teaches you to check first and act
  on `lock.denied` correctly.
- It doesn't open changesets for you automatically. You decide, based on
  presence and the sensitivity of the area, when a turn is warranted.
- It doesn't sync the whole graph into your context. Query narrowly, per
  task.
