/**
 * ServiceNow REST API Connector
 *
 * Connects to a live ServiceNow instance via Table API,
 * CMDB API, and Dictionary API. Provides the raw data layer
 * that schema importers, entity sync, and constraint discovery
 * build on top of.
 */

export type AuthMode = "basic" | "oauth_client_credentials" | "oauth_password";

export interface ServiceNowConfig {
  instanceUrl: string;
  authMode: AuthMode;
  // Basic auth
  username?: string;
  password?: string;
  // OAuth
  clientId?: string;
  clientSecret?: string;
}

export interface ServiceNowRecord {
  sys_id: string;
  [key: string]: unknown;
}

export interface ServiceNowResponse {
  result: ServiceNowRecord[];
}

export interface DictionaryEntry {
  name: string;
  element: string;
  column_label: string;
  internal_type: string;
  mandatory: string;
  reference: string;
  choice: string;
  max_length: string;
  comments: string;
}

export class ServiceNowConnector {
  private config: ServiceNowConfig;
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: ServiceNowConfig) {
    this.config = config;
  }

  /**
   * Get the Authorization header value, fetching/refreshing OAuth tokens as needed.
   */
  private async getAuthHeader(): Promise<string> {
    if (this.config.authMode === "basic") {
      return (
        "Basic " +
        Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")
      );
    }

    // OAuth: return cached token if still valid (with 60s buffer)
    if (this.cachedToken && Date.now() < this.tokenExpiry - 60_000) {
      return `Bearer ${this.cachedToken}`;
    }

    // Fetch a new token
    const tokenUrl = new URL("/oauth_token.do", this.config.instanceUrl);
    const body = new URLSearchParams();
    body.set("client_id", this.config.clientId || "");
    body.set("client_secret", this.config.clientSecret || "");

    if (this.config.authMode === "oauth_password") {
      body.set("grant_type", "password");
      body.set("username", this.config.username || "");
      body.set("password", this.config.password || "");
    } else {
      body.set("grant_type", "client_credentials");
    }

    const response = await fetch(tokenUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OAuth token request failed (${response.status}): ${text.substring(0, 200)}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };

    this.cachedToken = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000;

    return `Bearer ${this.cachedToken}`;
  }

  getInstanceUrl(): string {
    return this.config.instanceUrl;
  }

  /**
   * Make an authenticated GET request to the ServiceNow REST API.
   */
  private async get(
    path: string,
    params?: Record<string, string>
  ): Promise<unknown> {
    const url = new URL(path, this.config.instanceUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const authHeader = await this.getAuthHeader();
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `ServiceNow API error ${response.status}: ${text.substring(0, 200)}`
      );
    }

    return response.json();
  }

  /**
   * Test connectivity to the ServiceNow instance.
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.get("/api/now/table/incident", {
        sysparm_limit: "1",
        sysparm_fields: "sys_id",
      });
      return { success: true, message: `Connected to ${this.config.instanceUrl}` };
    } catch (error) {
      return {
        success: false,
        message: `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Query records from a ServiceNow table.
   */
  async queryTable(
    tableName: string,
    options?: {
      query?: string;
      fields?: string[];
      limit?: number;
      offset?: number;
    }
  ): Promise<ServiceNowRecord[]> {
    const params: Record<string, string> = {
      sysparm_limit: String(options?.limit ?? 100),
    };
    if (options?.query) params.sysparm_query = options.query;
    if (options?.fields) params.sysparm_fields = options.fields.join(",");
    if (options?.offset) params.sysparm_offset = String(options.offset);
    params.sysparm_display_value = "all";

    const data = (await this.get(
      `/api/now/table/${tableName}`,
      params
    )) as ServiceNowResponse;
    return data.result || [];
  }

  /**
   * Get the schema (dictionary entries) for a table.
   * This tells us what fields exist, their types, and references.
   */
  async getTableSchema(tableName: string): Promise<DictionaryEntry[]> {
    const data = (await this.get("/api/now/table/sys_dictionary", {
      sysparm_query: `name=${tableName}^elementISNOTEMPTY^active=true`,
      sysparm_fields:
        "name,element,column_label,internal_type,mandatory,reference,choice,max_length,comments",
      sysparm_limit: "500",
      sysparm_display_value: "false",
    })) as { result: Array<Record<string, unknown>> };
    // Normalize: SN may return reference/internal_type as {value, link} objects
    return (data.result || []).map((entry) => {
      const norm: Record<string, string> = {};
      for (const [k, v] of Object.entries(entry)) {
        norm[k] = (v && typeof v === "object" && "value" in (v as Record<string, unknown>))
          ? String((v as Record<string, string>).value || "")
          : String(v ?? "");
      }
      return norm as unknown as DictionaryEntry;
    });
  }

  /**
   * Get all tables that extend a given parent (e.g., 'task' or 'cmdb_ci').
   */
  async getChildTables(
    parentTable: string
  ): Promise<Array<{ name: string; label: string; super_class: string }>> {
    const data = (await this.get("/api/now/table/sys_db_object", {
      sysparm_query: `super_class.name=${parentTable}`,
      sysparm_fields: "name,label,super_class",
      sysparm_limit: "200",
      sysparm_display_value: "true",
    })) as { result: Array<{ name: string; label: string; super_class: string }> };
    return data.result || [];
  }

  /**
   * Get choice list values for a field (enum values).
   */
  async getChoiceValues(
    tableName: string,
    fieldName: string
  ): Promise<Array<{ value: string; label: string }>> {
    const data = (await this.get("/api/now/table/sys_choice", {
      sysparm_query: `name=${tableName}^element=${fieldName}^inactive=false`,
      sysparm_fields: "value,label",
      sysparm_limit: "100",
      sysparm_display_value: "false",
    })) as { result: Array<{ value: string; label: string }> };
    return data.result || [];
  }

  /**
   * Get a single record by sys_id.
   */
  async getRecord(
    tableName: string,
    sysId: string,
    fields?: string[]
  ): Promise<ServiceNowRecord | null> {
    const params: Record<string, string> = {
      sysparm_display_value: "all",
    };
    if (fields) params.sysparm_fields = fields.join(",");

    try {
      const data = (await this.get(
        `/api/now/table/${tableName}/${sysId}`,
        params
      )) as { result: ServiceNowRecord };
      return data.result || null;
    } catch {
      return null;
    }
  }

  /**
   * Get aggregate counts for a table, grouped by a field.
   * Useful for constraint discovery (e.g., tickets per group).
   */
  async getAggregates(
    tableName: string,
    groupBy: string,
    query?: string
  ): Promise<Array<{ groupValue: string; count: number }>> {
    const params: Record<string, string> = {
      sysparm_group_by: groupBy,
      sysparm_count: "true",
    };
    if (query) params.sysparm_query = query;

    const data = (await this.get(
      `/api/now/stats/${tableName}`,
      params
    )) as { result: Array<{ groupby_fields: Array<{ value: string }>; stats: { count: string } }> };

    return (data.result || []).map((r) => ({
      groupValue: r.groupby_fields?.[0]?.value ?? "unknown",
      count: parseInt(r.stats?.count ?? "0", 10),
    }));
  }
}

/**
 * Create a connector from environment variables.
 * Detects auth mode automatically:
 *   - If SERVICENOW_CLIENT_ID is set without username/password: client_credentials
 *   - If SERVICENOW_CLIENT_ID is set with username/password: oauth_password
 *   - Otherwise: basic auth
 */
export function createConnectorFromEnv(): ServiceNowConnector | null {
  const instanceUrl = process.env.SERVICENOW_INSTANCE_URL;
  if (!instanceUrl) return null;

  const username = process.env.SERVICENOW_USERNAME;
  const password = process.env.SERVICENOW_PASSWORD;
  const clientId = process.env.SERVICENOW_CLIENT_ID;
  const clientSecret = process.env.SERVICENOW_CLIENT_SECRET;

  let authMode: AuthMode;

  if (clientId && clientSecret && username && password) {
    authMode = "oauth_password";
  } else if (clientId && clientSecret) {
    authMode = "oauth_client_credentials";
  } else if (username && password) {
    authMode = "basic";
  } else {
    return null;
  }

  console.log(`  Auth mode: ${authMode}`);

  return new ServiceNowConnector({
    instanceUrl,
    authMode,
    username,
    password,
    clientId,
    clientSecret,
  });
}
