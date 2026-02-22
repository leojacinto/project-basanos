# Contributors

## Creator and Maintainer

- **Leo Francia** - Architecture, core engine, connector plugins, dashboard, documentation

## AI Pair Programmer

- **Cascade (Windsurf)** - Code generation, refactoring, plugin architecture implementation

## How to Contribute

1. Fork the repository
2. Create a connector plugin in `src/connectors/yourconnector/index.ts` (see README for the mandatory contract)
3. Or improve the core engine, dashboard, or documentation
4. Submit a pull request

All connector plugins must implement the full `ConnectorPlugin` interface. See `src/connectors/types.ts` for the contract and the README for detailed requirements.
