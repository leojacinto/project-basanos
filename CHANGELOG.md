# Changelog

All notable changes to project-basanos are documented here.

## 2026-02-22

### Connector plugin architecture
- New `ConnectorPlugin` interface (`src/connectors/types.ts`) defining the mandatory contract for all connectors
- New `ConnectorRegistry` (`src/connectors/registry.ts`) with auto-discovery - scans `src/connectors/*/index.ts` at runtime
- ServiceNow connector wrapped as a plugin (`src/connectors/servicenow/index.ts`)
- Mock Jira connector extracted from dashboard into its own plugin (`src/connectors/jira/index.ts`)
- Cross-system constraint (`cross-system:jira_deploy_active`) now lives in the Jira plugin, not hardcoded in dashboard
- CLI refactored to use registry instead of direct ServiceNow imports
- Dashboard multi-system demo refactored to use Jira plugin for enrichment
- README updated with full plugin architecture documentation, mandatory contract tables, and example connector code
- To add a new connector: create `src/connectors/yourconnector/index.ts`, export `createPlugin()` - no registry edits needed

### File reorganization
- Moved ServiceNow connector files into `src/connectors/servicenow/` subfolder (client.ts, schema-importer.ts, entity-sync.ts, constraint-discovery.ts, mcp-proxy.ts)
- All internal and external imports updated to new paths
- Git history preserved via `git mv`

### Dashboard: Connectors tab
- New "Connectors" tab showing all auto-discovered plugins
- Displays plugin status (configured/not configured), environment variables with presence check, default tables
- Test Connection button per connector with live result feedback
- API endpoints: `GET /api/connectors`, `POST /api/connectors/:id/test`

## 2026-02-21

### Dark theme redesign
- Updated dark mode to warm gold/tarot aesthetic matching the Basanos visual identity
- Background: warm near-black, accents: gold, text: warm cream, borders: dark gold
- Light theme unchanged

### Bug fixes
- ALLOWED verdict pill in Audit Trail now uses green (success) instead of gold (accent)

## 2026-02-18 - 2026-02-19

### README reframing
- Repositioned as a reference implementation and applied study, not a product
- Added "What this is", "The question", "What the code does", "Current scope" sections
- Added "Related Work" section acknowledging Cerbos, SAFE-MCP, TrojAI, Red Hat
- Strengthened Security & Authentication: OAuth recommended setup, scoping guidance
- Replaced "Design Principles" with "Concepts Explored"

### MCP Proxy Gateway
- Basanos now acts as a constraint-enforcing proxy in front of ServiceNow's native MCP Server
- `ServiceNowMCPClient` with OAuth client_credentials, tool discovery, and execution
- Full MCP Server URL parsing (`parseMCPServerUrl`) - single URL config instead of separate instance + server name
- MCP server discovery endpoint for finding available servers on an instance
- Context enrichment: queries incident details, CI, active change requests, SLA breaches before constraint evaluation
- Auto-connects on startup when `SERVICENOW_MCP_SERVER_URL` is configured in `.env`

### Demo tab: Discover, Promote, Enforce
- Three-step demo narrative on the dashboard:
  1. **Discover** - shows constraint candidates discovered from live ServiceNow data
  2. **Promote** - inline promote buttons, human-in-the-loop guardrail lifecycle
  3. **Enforce** - MCP Client Simulator with live constraint enforcement
- Chat-like UI simulating an AI agent calling ServiceNow MCP tools through Basanos
- Pre-built scenarios: blocked (INC on CI with active changes) vs allowed (clean CI)
- Custom incident number input for ad-hoc testing
- Full trace display: metadata gathered, constraints evaluated, verdict, execution result
- Light/dark mode compatible

### ServiceNow MCP tool creation (live instance)
- Created "Resolve incident" write tool on live ServiceNow Quickstart Server via API
- Documented correct approach: scope, table hierarchy, input subclass (`sn_mcp_scripted_rest_input`)
- Tool inputs: incident_number (required), resolution_notes (required), resolution_code (optional)

### Multi-system Demo tab
- Separate tab for cross-system constraint enforcement (ServiceNow + Jira)
- Mock Jira deploy data correlated to real ServiceNow CIs
- `cross-system:jira_deploy_active` constraint with promote/demote lifecycle
- Three scenarios: blocked by both systems, blocked by Jira only (the killer demo), both clear
- Dual enrichment: queries ServiceNow for incident/CI/changes, queries Jira for active deploys
- Chat UI shows source labels per constraint result ([ServiceNow] vs [Jira])

### Bug fixes
- **Relationships showing 0 in Overview**: ServiceNow `sys_dictionary` returns `reference` field as `{value, link}` object, not a plain string. Schema importer now normalizes all fields before processing. Re-run Import & Discover to regenerate ontology with relationships.
- **Multi-system demo data**: Removed cartservice from mock Jira deploys (SN change freeze and Jira deploy on the same CI was logically redundant). Demo now shows both directions: SN catches what Jira missed, and Jira catches what SN missed.

### Dashboard improvements
- MCP proxy Connect tab: single MCP Server URL input, server discovery button
- Environment config API serves `mcpServerUrl` for form pre-population
- Fixed constraint override persistence across restarts

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
