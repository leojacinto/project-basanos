#!/usr/bin/env node

/**
 * Basanos CLI - connect to a system, import schemas,
 * sync entities, and discover constraints.
 *
 * Uses the connector plugin registry to find configured connectors.
 *
 * Usage:
 *   npx basanos connect          Test connection
 *   npx basanos import           Import table schemas -> ontology.yaml
 *   npx basanos sync             Sync live entities into Basanos
 *   npx basanos discover         Discover constraints from data patterns
 *   npx basanos full             Run all steps in sequence
 */

import "dotenv/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { ConnectorRegistry } from "./connectors/registry.js";
import { OntologyEngine } from "./ontology/engine.js";
import { loadDomainFromYaml } from "./loader.js";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const command = process.argv[2] || "help";

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║          Basanos CLI v0.1.0              ║");
  console.log("╚══════════════════════════════════════════╝\n");

  if (command === "help") {
    console.log("Commands:");
    console.log("  connect    Test connection to configured system");
    console.log("  import     Import table schemas");
    console.log("  sync       Sync live entities into Basanos");
    console.log("  discover   Discover constraints from data patterns");
    console.log("  full       Run all steps (connect -> import -> sync -> discover)");
    console.log("\nConfiguration: Set connector env vars in .env (see README)");
    return;
  }

  console.log("Loading connector plugins...");
  const registry = await ConnectorRegistry.create();
  const connector = registry.getPrimary();

  if (!connector) {
    console.error("❌ No configured connector found.");
    console.error("   Available connectors:");
    for (const p of registry.getAll()) {
      console.error(`     ${p.id}: ${p.label}`);
      for (const v of p.getRequiredEnvVars().filter((e) => e.required)) {
        console.error(`       Required: ${v.name} - ${v.description}`);
      }
    }
    process.exit(1);
  }

  console.log(`Using connector: ${connector.label} [${connector.id}]\n`);

  // ── Connect ────────────────────────────────────────────────

  if (command === "connect" || command === "full") {
    console.log("Step 1: Testing connection...");
    const result = await connector.testConnection();
    if (result.success) {
      console.log(`✅ ${result.message}\n`);
    } else {
      console.error(`❌ ${result.message}`);
      process.exit(1);
    }
    if (command === "connect") return;
  }

  // ── Import ─────────────────────────────────────────────────

  const importTables = connector.getDefaultTables();

  // Determine output folder based on connector
  const connWithUrl = connector as { getInstanceUrl?: () => string };
  const connInstanceUrl = (typeof connWithUrl.getInstanceUrl === "function")
    ? connWithUrl.getInstanceUrl()
    : "";
  const isMock = !connInstanceUrl || connInstanceUrl.includes("localhost") || connInstanceUrl.includes("127.0.0.1");
  const domainFolder = isMock ? `${connector.id}-demo` : `${connector.id}-live`;
  const importOutputDir = resolve(projectRoot, "domains", domainFolder);
  console.log(`  Output: domains/${domainFolder}/ ${isMock ? "(mock, committed)" : "(live, gitignored)"}\n`);

  if (command === "import" || command === "full") {
    console.log("Step 2: Importing schemas...");
    const result = await connector.importSchemas(importTables, importOutputDir);
    console.log(`\n📊 Import summary: ${result.tablesImported} tables, ${result.fieldsImported} fields, ${result.referencesFound} relationships\n`);
    if (command === "import") return;
  }

  // ── Sync ───────────────────────────────────────────────────

  if (command === "sync" || command === "full") {
    console.log("Step 3: Syncing live entities...");

    const ontologyEngine = new OntologyEngine();

    // Load from YAML if available (either imported or hand-crafted)
    const itsmYaml = resolve(projectRoot, "domains", "itsm", "ontology.yaml");
    const liveYaml = resolve(importOutputDir, "ontology.yaml");

    if (existsSync(liveYaml)) {
      console.log("  Using imported ontology");
      const domain = loadDomainFromYaml(liveYaml);
      ontologyEngine.registerDomain(domain);
    } else if (existsSync(itsmYaml)) {
      console.log("  Using ITSM YAML ontology");
      const domain = loadDomainFromYaml(itsmYaml);
      ontologyEngine.registerDomain(domain);
    } else {
      console.error("  ❌ No ontology YAML found. Run 'import' first.");
      process.exit(1);
    }

    const limit = parseInt(process.env.SERVICENOW_SYNC_LIMIT || "100", 10);
    const syncResult = await connector.syncEntities(ontologyEngine, { limit });

    // Show a traversal example if we synced incidents
    const allEntities = ontologyEngine.getAllEntities();
    console.log(`\n📊 Entity store: ${allEntities.length} entities total`);

    const sampleIncident = allEntities.find((e) => e.type === "incident");
    if (sampleIncident) {
      console.log(`\n🔍 Sample traversal from ${sampleIncident.id}:`);
      const graph = ontologyEngine.traverse(sampleIncident.id, 2);
      for (const [id, { entity, depth }] of graph) {
        const name = String(
          entity.properties["name"] || entity.properties["number"] || id
        );
        console.log(`  ${"  ".repeat(depth)}depth ${depth}: ${entity.type} - ${name}`);
      }
    }

    console.log("");
    if (command === "sync") return;
  }

  // ── Discover ───────────────────────────────────────────────

  if (command === "discover" || command === "full") {
    console.log("Step 4: Discovering constraints from live data...");
    const domainName = domainFolder;
    const outputPath = resolve(importOutputDir, "discovered-constraints.yaml");
    const discovered = await connector.discoverConstraints(domainName, outputPath);
    console.log(`\n📊 Discovery summary: ${discovered.length} constraints suggested`);
    for (const c of discovered) {
      console.log(`  - ${c.name} [${c.severity}] - ${c.evidence}`);
    }
    console.log("");
  }

  // ── Done ───────────────────────────────────────────────────

  if (command === "full") {
    console.log("═".repeat(50));
    console.log("✅ Full pipeline complete!");
    console.log(`   Schemas: domains/${domainFolder}/ontology.yaml`);
    console.log(`   Constraints: domains/${domainFolder}/discovered-constraints.yaml`);
    console.log(`\nNext steps:`);
    console.log(`  1. Review generated YAML files and add business context`);
    console.log(`  2. Run 'npm run dashboard' to explore the ontology visually`);
    console.log(`  3. Start the MCP server with 'npm start' to serve to agents`);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
