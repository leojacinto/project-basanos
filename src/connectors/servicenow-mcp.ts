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
  instanceUrl: string;
  serverName: string;
  tokenFile: string;
  clientId?: string;
  clientSecret?: string;
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
    this.instanceUrl = config.instanceUrl.replace(/\/$/, "");
    this.serverName = config.serverName;
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
