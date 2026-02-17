/**
 * ServiceNow MCP Client - connects to ServiceNow's native MCP Server,
 * fetches available tools, and executes them via the tools API.
 *
 * This is the upstream half of the Basanos proxy pattern:
 *   Agent -> Basanos (constraint check) -> ServiceNow MCP Server
 */

import { readFileSync, writeFileSync, existsSync } from "fs";

export interface SNMCPToolInput {
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  format?: string;
}

export interface SNMCPTool {
  name: string;
  description: string;
  tool_inputs: Record<string, SNMCPToolInput>;
  tool_type: "rest_api" | "ai_skill";
  api_endpoint?: string;
  api_method?: string;
  template?: Record<string, unknown>;
  preprocessing_required?: boolean;
  preprocessing_endpoint?: string;
  config_dict?: Record<string, unknown>;
}

export interface SNMCPConfig {
  /** Full MCP Server URL, e.g. https://instance.service-now.com/sncapps/mcp-server/mcp/sn_mcp_server_default */
  mcpServerUrl?: string;
  /** Instance URL (parsed from mcpServerUrl if not provided) */
  instanceUrl?: string;
  /** Server name (parsed from mcpServerUrl if not provided) */
  serverName?: string;
  tokenFile: string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Parse a full MCP Server URL into instance URL and server name.
 * URL format: https://<instance>.service-now.com/sncapps/mcp-server/mcp/<server-name>
 */
export function parseMCPServerUrl(url: string): { instanceUrl: string; serverName: string } {
  const trimmed = url.replace(/\/$/, "");
  const mcpPath = "/sncapps/mcp-server/mcp/";
  const idx = trimmed.indexOf(mcpPath);
  if (idx >= 0) {
    return {
      instanceUrl: trimmed.substring(0, idx),
      serverName: trimmed.substring(idx + mcpPath.length),
    };
  }
  // Fallback: treat as instance URL with default server
  return { instanceUrl: trimmed, serverName: "sn_mcp_server_default" };
}

export class ServiceNowMCPClient {
  private instanceUrl: string;
  private serverName: string;
  private tokenFile: string;
  private clientId?: string;
  private clientSecret?: string;
  private accessToken: string = "";
  private tokenExpiry: number = 0;
  private toolsCache: SNMCPTool[] | null = null;

  constructor(config: SNMCPConfig) {
    if (config.mcpServerUrl) {
      const parsed = parseMCPServerUrl(config.mcpServerUrl);
      this.instanceUrl = parsed.instanceUrl;
      this.serverName = parsed.serverName;
    } else {
      this.instanceUrl = (config.instanceUrl || "").replace(/\/$/, "");
      this.serverName = config.serverName || "sn_mcp_server_default";
    }
    this.tokenFile = config.tokenFile;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.loadToken();
  }

  private loadToken(): void {
    try {
      if (!existsSync(this.tokenFile)) {
        console.warn(`Token file not found: ${this.tokenFile}`);
        return;
      }
      const data = JSON.parse(readFileSync(this.tokenFile, "utf8"));
      this.accessToken = data.access_token || "";
      // Decode JWT to get expiry
      if (this.accessToken) {
        try {
          const payload = JSON.parse(
            Buffer.from(this.accessToken.split(".")[1], "base64").toString()
          );
          this.tokenExpiry = (payload.exp || 0) * 1000;
        } catch {
          this.tokenExpiry = 0;
        }
      }
    } catch (err) {
      console.warn("Failed to load OAuth token:", String(err));
    }
  }

  async refreshToken(): Promise<boolean> {
    if (!this.clientId || !this.clientSecret) {
      console.error("Cannot refresh token: missing clientId or clientSecret");
      return false;
    }

    try {
      const params = new URLSearchParams();
      params.set("grant_type", "client_credentials");
      params.set("client_id", this.clientId);
      params.set("client_secret", this.clientSecret);
      params.set("scope", "mcp_server");

      const res = await fetch(`${this.instanceUrl}/oauth_token.do`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      const data = (await res.json()) as Record<string, unknown>;
      if (data.error) {
        console.error("Token refresh failed:", (data.error_description || data.error) as string);
        return false;
      }

      this.accessToken = data.access_token as string;
      this.tokenExpiry = Date.now() + ((data.expires_in as number) || 1800) * 1000;

      // Save to token file
      writeFileSync(this.tokenFile, JSON.stringify(data, null, 2));
      console.log("OAuth token refreshed successfully");
      return true;
    } catch (err) {
      console.error("Token refresh error:", String(err));
      return false;
    }
  }

  private async ensureToken(): Promise<string> {
    // Refresh if expired or expiring in 60 seconds
    if (!this.accessToken || Date.now() > this.tokenExpiry - 60000) {
      const refreshed = await this.refreshToken();
      if (!refreshed && !this.accessToken) {
        throw new Error("No valid OAuth token available");
      }
    }
    return this.accessToken;
  }

  private async makeRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<unknown> {
    const token = await this.ensureToken();
    const url = `${this.instanceUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ServiceNow API ${res.status}: ${text.substring(0, 200)}`);
    }

    return res.json();
  }

  /**
   * Fetch available tools from the ServiceNow MCP Server.
   */
  async fetchTools(forceRefresh = false): Promise<SNMCPTool[]> {
    if (this.toolsCache && !forceRefresh) {
      return this.toolsCache;
    }

    const path = `/api/sn_mcp_server/mcp_tools_api/tools/server/${this.serverName}`;
    const response = (await this.makeRequest("GET", path)) as {
      result: { tools: SNMCPTool[] };
    };

    this.toolsCache = response.result.tools || [];
    console.log(`Fetched ${this.toolsCache.length} tools from ServiceNow MCP Server`);
    return this.toolsCache;
  }

  /**
   * Execute a tool on the ServiceNow MCP Server.
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const tools = await this.fetchTools();
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(`Tool not found on ServiceNow MCP Server: ${toolName}`);
    }

    if (tool.tool_type === "rest_api") {
      return this.executeRestApiTool(tool, args);
    } else if (tool.tool_type === "ai_skill") {
      return this.executeAiSkillTool(tool, args);
    } else {
      throw new Error(`Unsupported tool type: ${tool.tool_type}`);
    }
  }

  private async executeRestApiTool(
    tool: SNMCPTool,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const template = tool.template || {};
    const payload: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(template)) {
      if (
        typeof value === "string" &&
        value.startsWith("{{") &&
        value.endsWith("}}")
      ) {
        const argName = value.slice(2, -2);
        payload[key] = args[argName] ?? "";
      } else {
        payload[key] = value;
      }
    }

    const endpoint = tool.api_endpoint || "";
    const method = tool.api_method || "POST";
    return this.makeRequest(method, endpoint, payload);
  }

  private async executeAiSkillTool(
    tool: SNMCPTool,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const preprocessEndpoint = tool.preprocessing_endpoint;
    if (!preprocessEndpoint) {
      throw new Error(`AI skill "${tool.name}" missing preprocessing endpoint`);
    }

    const template = tool.template || {};
    const payload: Record<string, unknown> = { ...template };

    // Merge arguments into payload
    if (payload.payload && typeof payload.payload === "object") {
      const inner = payload.payload as Record<string, unknown>;
      for (const [key, value] of Object.entries(args)) {
        inner[key] = value;
      }
    } else {
      for (const [key, value] of Object.entries(args)) {
        payload[key] = value;
      }
    }

    // Add config_dict if present
    if (tool.config_dict) {
      payload.config_dict = tool.config_dict;
    }

    return this.makeRequest("POST", preprocessEndpoint, payload);
  }

  /**
   * Enrich context for an incident-related action by querying ServiceNow.
   * Returns metadata suitable for constraint evaluation.
   */
  async enrichIncidentContext(incidentNumber: string): Promise<Record<string, unknown>> {
    const metadata: Record<string, unknown> = {};

    // 1. Query the incident record
    const incQuery = `/api/now/table/incident?sysparm_query=number=${encodeURIComponent(incidentNumber)}&sysparm_fields=sys_id,number,short_description,priority,state,cmdb_ci,assigned_to,assignment_group&sysparm_display_value=all&sysparm_limit=1`;
    const incResp = (await this.makeRequest("GET", incQuery)) as {
      result: Array<Record<string, { value: string; display_value: string }>>;
    };
    const incident = incResp.result?.[0];
    if (!incident) {
      return { error: `Incident ${incidentNumber} not found`, incident_exists: false };
    }

    metadata.incident_number = incident.number?.display_value || incidentNumber;
    metadata.incident_description = incident.short_description?.display_value || "";
    metadata.priority = `P${incident.priority?.value || "5"}`;
    metadata.state = incident.state?.display_value || "";
    metadata.assigned_to = incident.assigned_to?.display_value || "";
    metadata.assignment_group = incident.assignment_group?.display_value || "";
    metadata.incident_exists = true;

    const ciSysId = incident.cmdb_ci?.value || "";
    const ciName = incident.cmdb_ci?.display_value || "";
    metadata.ci_name = ciName;
    metadata.ci_sys_id = ciSysId;

    // 2. Check for active change requests on the same CI
    if (ciSysId) {
      try {
        const chgQuery = `/api/now/table/change_request?sysparm_query=cmdb_ci=${ciSysId}^active=true&sysparm_fields=number,short_description,state,type&sysparm_display_value=true&sysparm_limit=5`;
        const chgResp = (await this.makeRequest("GET", chgQuery)) as {
          result: Array<Record<string, string>>;
        };
        const activeChanges = chgResp.result || [];
        metadata.active_changes_on_ci = activeChanges.length;
        metadata.change_freeze_active = activeChanges.length > 0;
        metadata.active_change_numbers = activeChanges.map(c => c.number);
        metadata.active_change_details = activeChanges.map(c => ({
          number: c.number,
          description: c.short_description,
          state: c.state,
          type: c.type,
        }));
      } catch {
        metadata.change_freeze_active = false;
        metadata.active_changes_on_ci = 0;
      }
    } else {
      metadata.change_freeze_active = false;
      metadata.active_changes_on_ci = 0;
    }

    // 3. Check for SLA breaches on this incident
    try {
      const incSysId = incident.sys_id?.value || "";
      if (incSysId) {
        const slaQuery = `/api/now/table/task_sla?sysparm_query=task=${incSysId}^has_breached=true&sysparm_fields=sla,has_breached&sysparm_limit=5`;
        const slaResp = (await this.makeRequest("GET", slaQuery)) as {
          result: Array<Record<string, unknown>>;
        };
        const breachedSLAs = slaResp.result || [];
        metadata.sla_breached = breachedSLAs.length > 0;
        metadata.sla_breach_count = breachedSLAs.length;
        // Assume penalty for demo purposes if breached
        metadata.sla_has_penalty = breachedSLAs.length > 0;
      }
    } catch {
      metadata.sla_breached = false;
      metadata.sla_has_penalty = false;
    }

    return metadata;
  }

  /**
   * Query incidents from ServiceNow.
   */
  async queryIncidents(filter?: string): Promise<Array<Record<string, string>>> {
    const query = filter
      ? `/api/now/table/incident?sysparm_query=${encodeURIComponent(filter)}&sysparm_fields=number,short_description,priority,state,cmdb_ci,assigned_to&sysparm_display_value=all&sysparm_limit=10`
      : `/api/now/table/incident?sysparm_query=active=true&sysparm_fields=number,short_description,priority,state,cmdb_ci,assigned_to&sysparm_display_value=all&sysparm_limit=10`;
    const resp = (await this.makeRequest("GET", query)) as {
      result: Array<Record<string, unknown>>;
    };
    // Flatten display_value objects to plain strings
    return (resp.result || []).map(row => {
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        if (v && typeof v === "object" && "display_value" in (v as Record<string, unknown>)) {
          flat[k] = (v as Record<string, string>).display_value || "";
        } else {
          flat[k] = String(v ?? "");
        }
      }
      return flat;
    });
  }

  /**
   * Get instance URL for display/logging.
   */
  getInstanceUrl(): string {
    return this.instanceUrl;
  }

  /**
   * Get server name.
   */
  getServerName(): string {
    return this.serverName;
  }

  /**
   * Check if connected (has valid token).
   */
  isConnected(): boolean {
    return !!this.accessToken && Date.now() < this.tokenExpiry;
  }
}
