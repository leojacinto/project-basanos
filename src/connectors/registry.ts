/**
 * Connector Registry
 *
 * Central registry for all connector plugins. Auto-discovers connectors
 * by scanning for subdirectories of src/connectors/ that contain an
 * index.ts (compiled to index.js) exporting a createPlugin() function.
 *
 * To add a new connector:
 *   1. Create src/connectors/yourconnector/index.ts
 *   2. Export: function createPlugin(): ConnectorPlugin
 *   That is it. No edits to this file needed.
 */

import { readdirSync, existsSync } from "fs";
import { dirname, resolve, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { ConnectorPlugin } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Directories to skip when scanning for plugins.
 * These contain shared code, not plugins.
 */
const SKIP_DIRS = new Set(["node_modules", "__tests__", "test"]);

export class ConnectorRegistry {
  private plugins: Map<string, ConnectorPlugin> = new Map();
  private configured: Map<string, ConnectorPlugin> = new Map();

  /**
   * Create and initialize a registry by scanning for plugins.
   * This is the primary way to create a registry.
   */
  static async create(): Promise<ConnectorRegistry> {
    const registry = new ConnectorRegistry();
    await registry.discoverPlugins();
    return registry;
  }

  /**
   * Scan the connectors directory for subdirectories containing index.js.
   * Each valid plugin module must export a createPlugin() function.
   */
  private async discoverPlugins(): Promise<void> {
    const entries = readdirSync(__dirname, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const indexPath = resolve(__dirname, entry.name, "index.js");
      if (!existsSync(indexPath)) continue;

      try {
        const moduleUrl = pathToFileURL(indexPath).href;
        const mod = await import(moduleUrl);

        if (typeof mod.createPlugin !== "function") {
          console.warn(`  Connector [${entry.name}]: skipped (no createPlugin export)`);
          continue;
        }

        const plugin: ConnectorPlugin = mod.createPlugin();
        this.registerPlugin(plugin);
      } catch (err) {
        console.warn(`  Connector [${entry.name}]: failed to load - ${String(err)}`);
      }
    }
  }

  /**
   * Register a plugin instance and check if it is configured.
   */
  private registerPlugin(plugin: ConnectorPlugin): void {
    this.plugins.set(plugin.id, plugin);

    if (plugin.configureFromEnv()) {
      this.configured.set(plugin.id, plugin);
      console.log(`  Connector [${plugin.id}]: configured`);
    } else {
      console.log(`  Connector [${plugin.id}]: available (not configured)`);
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
