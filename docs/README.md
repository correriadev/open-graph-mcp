# Project Documentation

Index of project technical documentation for **OpenGraph MCP**. Use the links below to navigate the available documents and graph map topology.

## Documentation Index

| Document | Description | Reading |
|----------|-------------|---------|
| [**.digest.md**](./.digest.md) | Fast-path machine-readable orientation digest for stack, commands, and constraints. | **Mandatory** |
| [**.graph.json**](./.graph.json) | Macro relation graph index for document topology and 1-hop routing. | **Mandatory** |
| [**ADR.md**](./adr/ADR.md) | Normative architectural decisions derived from the OpenGraph working paper. | **Mandatory** |
| [**ARCHITECTURE.md**](./adr/ARCHITECTURE.md) | Architecture, folder organization, layers, and code patterns. | **Mandatory** |
| [**TESTS.md**](./adr/TESTS.md) | Testing strategies, evidence gates, coverage baseline, and execution commands. | **Mandatory** |
| [**cognitive_line.md**](./feature/cognitive_line.md) | EAP domain implementation and its mapping to source and tests. | Optional |
| [**OpenGraph_Working_Paper_v1_0.md**](./PRD/OpenGraph_Working_Paper_v1_0.md) | Normative OpenGraph v1.0 working paper. | Optional |
| [**PRD.md**](./PRD/PRD.md) | Product requirements derived from the normative working paper. | Optional |

## Recommended Reading Order

1. **.digest.md** — fast orientation for architecture, stack, constraints, and commands.
2. **.graph.json** — macro document topology for 1-hop lookup.
3. **adr/ADR.md** — normative OpenGraph and EAP decisions.
4. **adr/ARCHITECTURE.md** — technical foundation, layers, and integration boundaries.
5. **adr/TESTS.md** — test strategy, coverage ratchet, and CI evidence.
6. **feature/cognitive_line.md** — implementation details when working on the EAP domain.
7. **PRD/OpenGraph_Working_Paper_v1_0.md** — normative product source when requirements context is needed.
8. **PRD/PRD.md** — derived product requirements for implementation planning.
