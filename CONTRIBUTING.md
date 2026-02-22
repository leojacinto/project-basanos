# Contributing to Basanos

## Getting Started

1. Fork the repository
2. Clone your fork and install dependencies: `npm install`
3. Copy `.env.example` to `.env` and configure your connector credentials
4. Build: `npm run build`
5. Run the dashboard: `npm run dashboard`

## Adding a Connector Plugin

This is the most common contribution. Two steps:

1. Create `src/connectors/yourconnector/index.ts`
2. Export a `createPlugin()` function that returns a `ConnectorPlugin`

The registry auto-discovers plugins at startup. No other files need to change.

Your plugin **must** implement the full `ConnectorPlugin` interface defined in `src/connectors/types.ts`:

- **Identity**: `id`, `label`, `description`
- **Configuration**: `getRequiredEnvVars()`, `configureFromEnv()`
- **Pipeline**: `testConnection()`, `getDefaultTables()`, `importSchemas()`, `syncEntities()`, `discoverConstraints()`
- **Runtime**: `enrichContext()`
- **Optional**: `mcpProxy` for systems with their own MCP server

See the README for detailed tables on what each method does and what discovered constraints must include.

## Project Structure

- `src/connectors/` - Connector plugins (one subfolder per connector)
- `src/ontology/` - Entity engine, types, schema validation
- `src/constraints/` - Rules engine, evaluation, audit trail
- `src/server/` - MCP server (stdio transport)
- `src/a2a/` - Agent-to-Agent protocol types
- `domains/` - YAML domain definitions (ontology, constraints, discovered constraints)

## Code Style

- TypeScript strict mode
- ES modules (`import`/`export`, `.js` extensions in imports)
- No default exports - use named exports
- Keep connector-specific code inside its plugin folder
- Core engine code should never import from a specific connector

## Testing Changes

```bash
npm run build              # Must compile clean
npm run dashboard          # Verify dashboard loads, check Connectors tab
npx basanos connect        # Test CLI connector pipeline
npx basanos full           # Run full import/sync/discover pipeline
```

## Pull Requests

- One feature or fix per PR
- Include a clear description of what changed and why
- Update CHANGELOG.md with your changes
- Make sure `npm run build` passes with no errors
