/**
 * ServiceNow REST API Connector
 *
 * Connects to a live ServiceNow instance via Table API,
 * CMDB API, and Dictionary API. Provides the raw data layer
 * that schema importers, entity sync, and constraint discovery
 * build on top of.
 */

export interface ServiceNowConfig {
  instanceUrl: string;
  username: string;
  password: string;
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
  private authHeader: string;

  constructor(config: ServiceNowConfig) {
    this.config = config;
    this.authHeader =
      "Basic " +
      Buffer.from(`${config.username}:${config.password}`).toString("base64");
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

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: this.authHeader,
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
    })) as { result: DictionaryEntry[] };
    return data.result || [];
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
 */
export function createConnectorFromEnv(): ServiceNowConnector | null {
  const instanceUrl = process.env.SERVICENOW_INSTANCE_URL;
  const username = process.env.SERVICENOW_USERNAME;
  const password = process.env.SERVICENOW_PASSWORD;

  if (!instanceUrl || !username || !password) {
    return null;
  }

  return new ServiceNowConnector({ instanceUrl, username, password });
}
