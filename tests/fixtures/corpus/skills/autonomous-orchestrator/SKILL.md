# Autonomous Orchestrator Skill

Governs orchestration across agents and workflows.

## Workflow Coupling
See workflow guide at docs/workflows/autonomous-orchestration.md for execution rules.

## Delegation
Delegates execution to agents/orchestrator-agent.md when distributed subtasks run.

## Controls and Exclusions
Generic mention of autonomous orchestrator pattern without concrete link.

```typescript
import { orchestrate } from './orchestrator-sample';
```

Non-allowlisted JSON payload: {"unindexed": true}

## Horizon Evidence Markers
INITIATE: negotiation-to-transformation proposal seed
INITIATE: microtask-to-transformation work order result
PROMOTE: transformation-to-persistent delta
PROMOTE: microtask-to-persistent direct request
CONTEST: persistent state mismatch for orchestrator topology
RECALL: base sequence update required
