/**
 * ServiceNow Connector Plugin
 *
 * Bridges Basanos to ServiceNow via REST API. Handles authentication,
 * schema import from sys_dictionary, entity sync, constraint discovery,
 * and MCP proxy to ServiceNow's native MCP Server.
 *
 * This plugin wraps the existing ServiceNow connector code behind
 * the ConnectorPlugin interface.
 */

import type {
  ConnectorPlugin,
  EnvVarSpec,
  ConnectionResult,
  SchemaImportResult,
  SyncOptions,
  SyncResult,
  DiscoveredConstraint,
  MCPProxyCapability,
  MCPProxyTool,
} from "../types.js";
import { ServiceNowConnector, createConnectorFromEnv } from "../servicenow.js";
import { importSchemas } from "../schema-importer.js";
import { syncAllTables } from "../entity-sync.js";
import { discoverConstraints } from "../constraint-discovery.js";
import {
  ServiceNowMCPClient,
  parseMCPServerUrl,
} from "../servicenow-mcp.js";
import type { OntologyEngine } from "../../ontology/engine.js";

const DEFAULT_TABLES = [
  "incident",
  "cmdb_ci",
  "cmdb_ci_service",
  "change_request",
  "problem",
  "sys_user_group",
];

class ServiceNowPlugin implements ConnectorPlugin {
  readonly id = "servicenow";
  readonly label = "ServiceNow";
  readonly description =
    "Connects to a live ServiceNow instance via REST API. Imports table schemas, " +
    "syncs entities, discovers constraints, and proxies MCP tool calls.";

  private connector: ServiceNowConnector | null = null;
  private _mcpProxy: ServiceNowMCPProxy | null = null;

  getRequiredEnvVars(): EnvVarSpec[] {
    return [
      {
        name: "SERVICENOW_INSTANCE_URL",
        description: "ServiceNow instance URL (e.g., https://your-instance.service-now.com)",
        required: true,
      },
      {
        name: "SERVICENOW_USERNAME",
        description: "Username for basic auth or OAuth password grant",
        required: false,
      },
      {
        name: "SERVICENOW_PASSWORD",
        description: "Password for basic auth or OAuth password grant",
        required: false,
        secret: true,
      },
      {
        name: "SERVICENOW_CLIENT_ID",
        description: "OAuth client ID (recommended for production)",
        required: false,
      },
      {
        name: "SERVICENOW_CLIENT_SECRET",
        description: "OAuth client secret",
        required: false,
        secret: true,
      },
      {
        name: "SERVICENOW_MCP_SERVER_URL",
        description: "Full MCP Server URL for proxy mode (e.g., https://instance.service-now.com/sncapps/mcp-server/mcp/sn_mcp_server_default)",
        required: false,
      },
    ];
  }

  configureFromEnv(): boolean {
    this.connector = createConnectorFromEnv();
    if (!this.connector) return false;

    // Set up MCP proxy if configured
    const mcpServerUrl = process.env.SERVICENOW_MCP_SERVER_URL;
    if (mcpServerUrl) {
      const tokenFile = process.env.SERVICENOW_TOKEN_FILE || "servicenow-tokens.json";
      this._mcpProxy = new ServiceNowMCPProxy(
        mcpServerUrl,
        tokenFile,
        process.env.SERVICENOW_CLIENT_ID,
        process.env.SERVICENOW_CLIENT_SECRET
      );
    }

    return true;
  }

  async testConnection(): Promise<ConnectionResult> {
    if (!this.connector) {
      return { success: false, message: "ServiceNow connector not configured" };
    }
    return this.connector.testConnection();
  }

  getDefaultTables(): string[] {
    return (
      process.env.SERVICENOW_IMPORT_TABLES?.split(",").map((t) => t.trim()) ||
      DEFAULT_TABLES
    );
  }

  async importSchemas(
    tables: string[],
    outputDir: string
  ): Promise<SchemaImportResult> {
    if (!this.connector) {
      throw new Error("ServiceNow connector not configured");
    }
    const result = await importSchemas(this.connector, tables, outputDir);
    return {
      entityTypes: result.domain.entityTypes as Array<Record<string, unknown>>,
      tablesImported: result.tablesImported,
      fieldsImported: result.fieldsImported,
      referencesFound: result.referencesFound,
    };
  }

  async syncEntities(
    ontologyEngine: OntologyEngine,
    options?: SyncOptions
  ): Promise<SyncResult> {
    if (!this.connector) {
      throw new Error("ServiceNow connector not configured");
    }
    return syncAllTables(this.connector, ontologyEngine, options);
  }

  async discoverConstraints(
    domainName: string,
    outputPath: string
  ): Promise<DiscoveredConstraint[]> {
    if (!this.connector) {
      throw new Error("ServiceNow connector not configured");
    }
    const discovered = await discoverConstraints(this.connector, outputPath);
    return discovered.map((c) => ({
      ...c,
      status: "candidate",
    }));
  }

  async enrichContext(
    entityRef: string,
    action: string
  ): Promise<Record<string, unknown>> {
    if (this._mcpProxy) {
      return this._mcpProxy.enrichContext(entityRef, action);
    }
    // Fallback: no enrichment without MCP proxy
    return { source: "servicenow", entityRef, action, enriched: false };
  }

  get mcpProxy(): MCPProxyCapability | undefined {
    return this._mcpProxy || undefined;
  }

  /**
   * Get the underlying ServiceNow connector instance.
   * Used by the CLI for operations that need direct connector access.
   */
  getConnector(): ServiceNowConnector | null {
    return this.connector;
  }

  /**
   * Get the instance URL (for determining mock vs live).
   */
  getInstanceUrl(): string {
    return this.connector?.getInstanceUrl() || "";
  }
}

/**
 * MCP proxy wrapper for ServiceNow's native MCP Server.
 */
class ServiceNowMCPProxy implements MCPProxyCapability {
  private client: ServiceNowMCPClient;

  constructor(
    mcpServerUrl: string,
    tokenFile: string,
    clientId?: string,
    clientSecret?: string
  ) {
    this.client = new ServiceNowMCPClient({
      mcpServerUrl,
      tokenFile,
      clientId,
      clientSecret,
    });
  }

  async configure(config: Record<string, string>): Promise<boolean> {
    // Re-create client with new config
    this.client = new ServiceNowMCPClient({
      mcpServerUrl: config.mcpServerUrl,
      tokenFile: config.tokenFile || "servicenow-tokens.json",
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    return true;
  }

  async testConnection(): Promise<ConnectionResult> {
    try {
      const tools = await this.client.fetchTools(true);
      return {
        success: true,
        message: `Connected to ServiceNow MCP Server (${tools.length} tools)`,
      };
    } catch (err) {
      return {
        success: false,
        message: `MCP connection failed: ${String(err)}`,
      };
    }
  }

  async listTools(): Promise<MCPProxyTool[]> {
    const tools = await this.client.fetchTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      type: t.tool_type,
      inputs: Object.keys(t.tool_inputs || {}),
    }));
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    return this.client.executeTool(name, args);
  }

  async enrichContext(
    entityRef: string,
    _action: string
  ): Promise<Record<string, unknown>> {
    return this.client.enrichIncidentContext(entityRef);
  }

  async queryEntities(
    filter?: string
  ): Promise<Array<Record<string, string>>> {
    return this.client.queryIncidents(filter);
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }

  getInstanceUrl(): string {
    return this.client.getInstanceUrl();
  }

  /**
   * Get the underlying MCP client for ServiceNow-specific operations.
   */
  getClient(): ServiceNowMCPClient {
    return this.client;
  }
}

export function createPlugin(): ConnectorPlugin {
  return new ServiceNowPlugin();
}
