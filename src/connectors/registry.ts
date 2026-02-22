/**
 * Connector Registry
 *
 * Central registry for all connector plugins. Discovers which connectors
 * are configured (have env vars set) and makes them available to the
 * CLI, dashboard, and MCP server.
 *
 * To register a new connector:
 *   1. Import its createPlugin function
 *   2. Add it to the AVAILABLE_PLUGINS array below
 */

import type { ConnectorPlugin } from "./types.js";
import { createPlugin as createServiceNowPlugin } from "./servicenow/index.js";
import { createPlugin as createJiraPlugin } from "./jira/index.js";

/**
 * All available connector plugins.
 * Add new connectors here.
 */
const AVAILABLE_PLUGINS: Array<() => ConnectorPlugin> = [
  createServiceNowPlugin,
  createJiraPlugin,
];

export class ConnectorRegistry {
  private plugins: Map<string, ConnectorPlugin> = new Map();
  private configured: Map<string, ConnectorPlugin> = new Map();

  constructor() {
    this.loadPlugins();
  }

  /**
   * Load all available plugins and check which ones are configured.
   */
  private loadPlugins(): void {
    for (const factory of AVAILABLE_PLUGINS) {
      try {
        const plugin = factory();
        this.plugins.set(plugin.id, plugin);

        if (plugin.configureFromEnv()) {
          this.configured.set(plugin.id, plugin);
          console.log(`  Connector [${plugin.id}]: configured`);
        } else {
          console.log(`  Connector [${plugin.id}]: available (not configured)`);
        }
      } catch (err) {
        console.warn(`  Connector plugin failed to load: ${String(err)}`);
      }
    }
  }

  /**
   * Get all registered plugins (configured or not).
   */
  getAll(): ConnectorPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get only configured (ready-to-use) plugins.
   */
  getConfigured(): ConnectorPlugin[] {
    return Array.from(this.configured.values());
  }

  /**
   * Get a specific plugin by ID.
   */
  get(id: string): ConnectorPlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Get a configured plugin by ID. Returns undefined if the plugin
   * exists but is not configured.
   */
  getConfiguredById(id: string): ConnectorPlugin | undefined {
    return this.configured.get(id);
  }

  /**
   * Check if a specific plugin is configured and ready.
   */
  isConfigured(id: string): boolean {
    return this.configured.has(id);
  }

  /**
   * Get the primary connector (first configured one).
   * Used by the CLI when no specific connector is specified.
   */
  getPrimary(): ConnectorPlugin | undefined {
    // Prefer ServiceNow if configured, otherwise first available
    return this.configured.get("servicenow") || this.getConfigured()[0];
  }
}
