# project-basanos

> *A living tarot for the agentic age. Semantic ontology and context intelligence over MCP, so your agents finally understand what they're operating on.*

**Basanos** (βάσανος) is the ancient Greek word for a touchstone used to test the purity of gold. In Mike Carey's *Lucifer*, the Basanos is a living tarot deck that gained sentience: it doesn't just contain information, it interprets the structure of reality itself. It reads relationships, predicts consequences, understands deep architecture. It served no master.

This project brings that concept to the agentic age.

## Why not just use Claude Desktop?

If you're a knowledgeable human sitting at a desk asking Claude about your ServiceNow instance, Claude's reasoning is strong enough to figure out most relationships on the fly. For that use case, Basanos is arguably redundant.

Basanos earns its existence the moment there is no human in the loop:

- **Autonomous agents need encoded judgment.** An agent resolving incidents at 3am can't ask you if there's a change freeze. The ontology is the human judgment, encoded.
- **Not every model is Claude.** Smaller, cheaper models need domain understanding handed to them. Basanos levels up weaker models with structured context they can't infer.
- **Multiple agents need shared truth.** Two agents reasoning independently about the same incident will reach different conclusions. Basanos gives them a single source of semantic truth.
- **Constraints are architectural, not conversational.** A system prompt is a suggestion. A `BLOCK` verdict with entity IDs and audit trail is a guarantee.
- **Ontology compounds, conversations don't.** Every Claude session starts from zero. Basanos persists and grows.
- **Testable and auditable.** You can unit test an ontology and audit every constraint verdict. You cannot unit test a conversation.

For the full critical analysis, see [docs/DIFFERENTIATORS.md](docs/DIFFERENTIATORS.md).

## The Problem

Today's AI agents are dumb execution pipes. They can *do* things but have zero semantic understanding of *what* they're operating on or *why*. The "intelligence" is fully outsourced to the LLM's general reasoning, which means every action is contextually naive.

An MCP server that lets you query ServiceNow incidents is table stakes. An MCP server that provides a **typed ontology** of how those incidents relate to CMDB CIs, change requests, business services, SLA contracts, and the humans who own them? That doesn't exist.

## What Basanos Does

Basanos is a **protocol-native semantic context server** that sits between agents and the systems they operate on, providing:

### Domain Ontology as MCP Resources
Not "here's a table you can query" but "here's the relationship graph of this domain, typed and traversable." An agent consuming Basanos doesn't just get incident records. It gets the understanding that this P1 incident affects a business service with an SLA penalty clause, owned by a VP who escalates within 30 minutes.

### Constraint-Aware Guardrails as MCP Tool Metadata
When Basanos exposes a "resolve incident" tool, it also exposes the business constraints: *don't auto-resolve if there's an active change freeze*, *don't reassign if the assigned group has workload limits*. These aren't security guardrails. They're **business logic guardrails** that require domain knowledge to define.

### A2A-Ready Agent Cards
When another agent discovers Basanos via A2A, it sees typed capabilities with preconditions and postconditions, like a proper API contract but for agent reasoning.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  AI Agents                       │
│         (Claude, GPT, DeepSeek, etc.)            │
└──────────────────┬──────────────────────────────┘
                   │ MCP / A2A
┌──────────────────▼──────────────────────────────┐
│              project-basanos                     │
│  ┌───────────┐ ┌────────────┐ ┌──────────────┐  │
│  │ Ontology  │ │ Constraint │ │ Agent Card   │  │
│  │ Engine    │ │ Engine     │ │ Registry     │  │
│  └─────┬─────┘ └─────┬──────┘ └──────┬───────┘  │
│        └──────────────┼───────────────┘          │
│                       │                          │
│              ┌────────▼────────┐                 │
│              │ Domain Schemas  │                 │
│              │ (ITSM, CMDB..) │                 │
│              └─────────────────┘                 │
└──────────────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│           Enterprise Systems                     │
│    (ServiceNow, Salesforce, Jira, etc.)          │
└──────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Clone
git clone https://github.com/leojacinto/project-basanos.git
cd project-basanos

# Install dependencies
npm install

# Build
npm run build

# Run the MCP server
npm start

# Inspect with MCP Inspector
npm run inspect
```

## Project Structure

```
src/
├── index.ts                 # MCP server entry point (6 tools, 2 resources)
├── ontology/
│   ├── engine.ts            # Ontology resolution and traversal
│   ├── types.ts             # Core ontology type system
│   └── schema.ts            # Schema loading and validation
├── constraints/
│   ├── engine.ts            # Constraint evaluation engine with audit trail
│   └── types.ts             # Constraint type definitions
├── domains/
│   └── itsm/
│       ├── ontology.ts      # ITSM entity and relationship definitions
│       └── constraints.ts   # ITSM business logic constraints
├── server/
│   ├── resources.ts         # MCP resource handlers
│   └── tools.ts             # MCP tool handlers with constraint metadata
└── test/
    ├── smoke.ts             # 32-assertion engine test suite
    └── scenario-autonomous.ts  # 3am incident demo (with vs without Basanos)
docs/
└── DIFFERENTIATORS.md       # Critical analysis: why Basanos vs Claude Desktop
```

## Proof Domain: ITSM

The initial implementation models IT Service Management, a domain with rich entity relationships, well-defined business constraints, and clear measurability:

- **Incidents** → affect **Business Services** → governed by **SLA Contracts**
- **Change Requests** → impact **Configuration Items** → owned by **Assignment Groups**
- **Problems** → cause **Incidents** → traced to **Known Errors**

An agent with Basanos makes measurably better decisions: fewer incorrect escalations, proper change freeze awareness, accurate impact assessment.

## Protocols

| Protocol | Role | Status |
|----------|------|--------|
| **MCP** (Model Context Protocol) | Vertical: agent ↔ tools/data | ✅ Primary |
| **A2A** (Agent2Agent) | Horizontal: agent ↔ agent | 🔜 Planned |
| **ACP** (Agent Communication Protocol) | Lightweight REST messaging | 🔜 Planned |

## Philosophy

- **No allegiance.** Platform-agnostic, model-agnostic, vendor-agnostic.
- **Infrastructure over hype.** Durable semantic layer, not another wrapper.
- **Domain depth over breadth.** One domain done right beats ten done shallow.
- **Business logic, not security.** Guardrails for correctness, not threat detection.

## Contributing

project-basanos is open source and welcomes contributors. The "project-" prefix is intentional: this is a living effort, not a finished artifact.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)

---

*"Protocols move data. Semantics make data usable. Without semantics, interoperability becomes structured confusion."*
