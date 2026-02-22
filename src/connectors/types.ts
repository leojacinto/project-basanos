/**
 * Connector Plugin Interface
 *
 * Every connector must implement this contract. A connector is a bridge
 * between Basanos and an external system. It handles authentication,
 * schema translation, entity mapping, and constraint discovery for its
 * target system. The core engine never touches system-specific APIs directly.
 *
 * MANDATORY - every connector must implement all methods below.
 * If a method is not applicable (e.g., a mock connector has no real connection
 * to test), return a sensible default (e.g., { success: true, message: "Mock" }).
 *
 * To add a new connector:
 *   1. Create src/connectors/yourconnector/index.ts
 *   2. Export a function `createPlugin(): ConnectorPlugin`
 *   3. Register it in src/connectors/registry.ts
 */

import type { Entity } from "../ontology/types.js";
import type { OntologyEngine } from "../ontology/engine.js";
import type {
  ConstraintContext,
  ConstraintResult,
  ConstraintSeverity,
  ConstraintStatus,
} from "../constraints/types.js";

// ── Identity & Configuration ──────────────────────────────────

/**
 * Environment variable specification for connector configuration.
 */
export interface EnvVarSpec {
  /** Variable name (e.g., "SERVICENOW_INSTANCE_URL") */
  name: string;
  /** What it is for */
  description: string;
  /** Whether the connector cannot function without it */
  required: boolean;
  /** Whether the value should be masked in logs/UI */
  secret?: boolean;
}

// ── Operation Results ─────────────────────────────────────────

export interface ConnectionResult {
  success: boolean;
  message: string;
}

export interface SchemaImportResult {
  entityTypes: Array<Record<string, unknown>>;
  tablesImported: number;
  fieldsImported: number;
  referencesFound: number;
}

export interface SyncOptions {
  limit?: number;
  query?: string;
}

export interface SyncResult {
  totalSynced: number;
  totalErrors: number;
  tables: string[];
}

/**
 * A constraint discovered by a plugin's heuristic analysis.
 * Returned as candidates for human review.
 */
export interface DiscoveredConstraint {
  id: string;
  name: string;
  domain: string;
  appliesTo: string[];
  relevantActions: string[];
  severity: string;
  status: string;
  description: string;
  conditions: Array<{ field: string; operator: string; value: unknown }>;
  violationMessage: string;
  satisfiedMessage: string;
  evidence: string;
  /**
   * Optional custom evaluator for constraints that cannot be expressed
   * as declarative YAML conditions (e.g., cross-system lookups).
   * If provided, the constraint engine uses this instead of the rule evaluator.
   */
  evaluate?: (context: ConstraintContext) => Promise<ConstraintResult>;
}

// ── MCP Proxy (optional capability) ───────────────────────────

export interface MCPProxyTool {
  name: string;
  description: string;
  type: string;
  inputs: string[];
}

export interface MCPProxyCapability {
  configure(config: Record<string, string>): Promise<boolean>;
  testConnection(): Promise<ConnectionResult>;
  listTools(): Promise<MCPProxyTool[]>;
  executeTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  enrichContext(entityRef: string, action: string): Promise<Record<string, unknown>>;
  queryEntities?(filter?: string): Promise<Array<Record<string, string>>>;
  isConnected(): boolean;
  getInstanceUrl(): string;
}

// ── The Plugin Contract ───────────────────────────────────────

/**
 * ConnectorPlugin - the mandatory contract every connector must implement.
 *
 * MANDATORY IDENTITY:
 *   id          - unique identifier (e.g., "servicenow", "jira")
 *   label       - human-readable name (e.g., "ServiceNow")
 *   description - one-line summary of what this connector does
 *
 * MANDATORY CONFIGURATION:
 *   getRequiredEnvVars() - declare what environment variables are needed
 *   configureFromEnv()   - attempt to self-configure from process.env
 *
 * MANDATORY PIPELINE (the import/discover flow):
 *   testConnection()       - verify the target system is reachable
 *   getDefaultTables()     - tables/objects to import when none specified
 *   importSchemas()        - read target system structure, return entity types
 *   syncEntities()         - read live data, populate the ontology engine
 *   discoverConstraints()  - analyze data patterns, return rule candidates
 *
 * MANDATORY RUNTIME (called per-request during enforcement):
 *   enrichContext()        - query target system for current state,
 *                            return metadata for rule evaluation
 *
 * OPTIONAL:
 *   mcpProxy               - if target system has its own MCP server
 */
export interface ConnectorPlugin {
  // ── Identity ──────────────────────────────────────────────

  /** Unique connector identifier (e.g., "servicenow", "jira") */
  readonly id: string;

  /** Human-readable name (e.g., "ServiceNow") */
  readonly label: string;

  /** One-line description of what this connector bridges to */
  readonly description: string;

  // ── Configuration ─────────────────────────────────────────

  /**
   * Declare what environment variables this connector needs.
   * The CLI and dashboard use this to prompt for missing config.
   * Mark security-sensitive values with secret: true.
   */
  getRequiredEnvVars(): EnvVarSpec[];

  /**
   * Attempt to configure from process.env.
   * Returns true if all required env vars are present and the
   * connector is ready to use. Returns false if config is missing.
   * Must not throw.
   */
  configureFromEnv(): boolean;

  // ── Pipeline: Connect ─────────────────────────────────────

  /**
   * Test connectivity to the target system.
   * Must return a clear success/failure with a human-readable message.
   * For mock connectors, return success with a note that it is mock.
   */
  testConnection(): Promise<ConnectionResult>;

  // ── Pipeline: Import ──────────────────────────────────────

  /**
   * Default tables/objects to import when the operator does not specify.
   * Example: ServiceNow returns ["incident", "cmdb_ci", "change_request", ...].
   * Example: Jira might return ["issue", "project", "sprint"].
   */
  getDefaultTables(): string[];

  /**
   * Import schemas from the target system and write ontology YAML.
   *
   * The plugin is responsible for:
   *   - Querying the target system's schema/metadata API
   *   - Mapping system-specific types to Basanos types
   *     (e.g., ServiceNow glide_date -> date, Jira option -> enum)
   *   - Detecting relationships between entities
   *   - Writing ontology.yaml and provenance.json to outputDir
   *
   * @param tables - tables/objects to import
   * @param outputDir - directory for generated YAML files
   */
  importSchemas(tables: string[], outputDir: string): Promise<SchemaImportResult>;

  // ── Pipeline: Sync ────────────────────────────────────────

  /**
   * Sync live entities from the target system into the ontology engine.
   *
   * The plugin is responsible for:
   *   - Querying the target system for live records
   *   - Mapping system-specific fields to Basanos entity properties
   *   - Wiring relationships between entities
   *   - Adding entities to the ontology engine via engine.addEntity()
   *
   * @param ontologyEngine - the engine to populate
   * @param options - limit, query filters
   */
  syncEntities(
    ontologyEngine: OntologyEngine,
    options?: SyncOptions
  ): Promise<SyncResult>;

  // ── Pipeline: Discover ────────────────────────────────────

  /**
   * Discover constraint candidates from live data.
   *
   * The plugin is responsible for:
   *   - Running heuristic analysis against the target system
   *   - Returning candidates with evidence (not enforced rules)
   *   - Writing discovered-constraints.yaml to outputPath
   *
   * Every discovered constraint MUST include:
   *   - id: unique, prefixed with domain (e.g., "servicenow-live:discovered:change_freeze")
   *   - appliesTo: entity types this rule checks
   *   - relevantActions: actions that trigger this rule
   *   - severity: block, warn, or info
   *   - evidence: proof from the data that this pattern exists
   *   - violationMessage: what to tell the agent when blocked
   *   - satisfiedMessage: what to tell the agent when clear
   *
   * @param domainName - domain prefix for constraint IDs
   * @param outputPath - file path for generated constraints YAML
   */
  discoverConstraints(
    domainName: string,
    outputPath: string
  ): Promise<DiscoveredConstraint[]>;

  // ── Runtime: Enrich ───────────────────────────────────────

  /**
   * Enrich context for rule evaluation at runtime.
   *
   * Called for every tool call that passes through the Basanos proxy.
   * The plugin queries the target system for current state and returns
   * metadata that the rules engine evaluates constraints against.
   *
   * The returned metadata keys must match the condition fields in your
   * constraints. For example, if a constraint checks metadata.change_freeze_active,
   * this method must return { change_freeze_active: true/false, ... }.
   *
   * @param entityRef - entity identifier (e.g., incident number, issue key)
   * @param action - intended action (e.g., "resolve", "close", "assign")
   */
  enrichContext(
    entityRef: string,
    action: string
  ): Promise<Record<string, unknown>>;

  // ── Optional: MCP Proxy ───────────────────────────────────

  /**
   * MCP proxy capability (optional).
   * Implement this if the target system has its own MCP server
   * that Basanos should proxy tool calls through.
   */
  mcpProxy?: MCPProxyCapability;
}
