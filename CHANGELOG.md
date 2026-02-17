# Changelog

All notable changes to project-basanos are documented here.

## 2026-02-17

### Constraint lifecycle and persistence
- Constraints now have a lifecycle: `candidate` -> `promoted` -> `disabled`
- Only promoted constraints are enforced by agents
- Dashboard shows promote/demote buttons and severity dropdown per constraint
- Promotions persist across restarts via `constraint-overrides.json`
- Discovered constraints get domain-scoped IDs to avoid collisions

### Discovery Rules tab
- New rightmost dashboard tab showing how Basanos discovers constraints
- Rules moved from hardcoded TypeScript to `discovery-rules.yaml`
- Each rule tagged with `connector: servicenow` for multi-platform clarity
- Dashboard loads rules from YAML via API, groups by connector

### Demo/live separation
- `domains/servicenow-demo/` (committed) - generated from mock server
- `domains/servicenow-live/` (gitignored) - generated from real instances
- Pipeline auto-detects mock (localhost) vs real and writes to correct folder
- Domain names and labels reflect the source

### Design principles added to README
- Constraint lifecycle documentation
- "Don't build a rule engine" principle
- 80/20 controls philosophy

### Dashboard improvements
- Active domain provenance shown on top, accordion for all others
- Connect tab pre-populates from `.env` values
- Error handling so dashboard never hangs on "Loading..."

## 2026-02-16

### ServiceNow connector pipeline
- Full pipeline: connect -> import -> sync -> discover
- Schema importer reads `sys_dictionary` and `sys_choice` tables
- Entity sync queries live ITSM tables
- Constraint discovery analyzes data patterns (change freezes, P1 reassignment, group capacity, SLA breaches)
- OAuth support (client_credentials, password grant, basic auth)

### Multi-domain dashboard
- Web UI with domain selector, entity types, constraints, agent card, audit trail
- Light/dark mode with persistence
- Auto port scanner to avoid conflicts
- Provenance tracking with data lineage

### Declarative YAML schemas
- Domain ontologies defined in YAML, not TypeScript
- Declarative rule evaluator for YAML-defined constraints
- "dbt for agent ontology" pattern

### Core engine
- Ontology engine with typed entity graph and traversal
- Constraint engine with evaluation, audit trail, and structured verdicts
- A2A agent card generation
- MCP server with 6 tools and dynamic resources

### Testing
- 32-assertion smoke test suite
- 23-assertion YAML loader tests
- Autonomous agent scenario (3am incident demo)

## 2026-02-15

### Initial release
- Project scaffolding and MCP server entry point
- Hand-crafted ITSM ontology (incidents, CMDB CIs, services, SLAs, groups, change requests, problems)
- Hand-crafted ITSM constraints (change freeze, P1 reassignment, group capacity, SLA breach)
- README with philosophy, architecture, and differentiators
