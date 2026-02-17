#!/usr/bin/env node

/**
 * Basanos CLI — connect to ServiceNow, import schemas,
 * sync entities, and discover constraints.
 *
 * Usage:
 *   npx basanos connect          Test ServiceNow connection
 *   npx basanos import           Import table schemas → ontology.yaml
 *   npx basanos sync             Sync live entities into Basanos
 *   npx basanos discover         Discover constraints from data patterns
 *   npx basanos full             Run all steps in sequence
 */

import "dotenv/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { createConnectorFromEnv } from "./connectors/servicenow.js";
import { importSchemas } from "./connectors/schema-importer.js";
import { syncAllTables } from "./connectors/entity-sync.js";
import { discoverConstraints } from "./connectors/constraint-discovery.js";
import { OntologyEngine } from "./ontology/engine.js";
import { ConstraintEngine } from "./constraints/engine.js";
import { loadDomainFromYaml, loadConstraintsFromYaml } from "./loader.js";
import { validateDomainSchema } from "./ontology/schema.js";
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
    console.log("  connect    Test ServiceNow connection");
    console.log("  import     Import table schemas from ServiceNow");
    console.log("  sync       Sync live entities into Basanos");
    console.log("  discover   Discover constraints from data patterns");
    console.log("  full       Run all steps (connect → import → sync → discover)");
    console.log("\nConfiguration: Set SERVICENOW_* variables in .env");
    return;
  }

  const connector = createConnectorFromEnv();
  if (!connector) {
    console.error("❌ Missing ServiceNow configuration.");
    console.error("   Set SERVICENOW_INSTANCE_URL and either:");
    console.error("     OAuth: SERVICENOW_CLIENT_ID + SERVICENOW_CLIENT_SECRET");
    console.error("     Basic: SERVICENOW_USERNAME + SERVICENOW_PASSWORD");
    process.exit(1);
  }

  // ── Connect ────────────────────────────────────────────────

  if (command === "connect" || command === "full") {
    console.log("Step 1: Testing ServiceNow connection...");
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

  const importTables = (process.env.SERVICENOW_IMPORT_TABLES || "incident,cmdb_ci,cmdb_ci_service,change_request,problem,sys_user_group")
    .split(",")
    .map((t) => t.trim());

  const importOutputDir = resolve(projectRoot, "domains", "servicenow-live");

  if (command === "import" || command === "full") {
    console.log("Step 2: Importing schemas from ServiceNow...");
    const result = await importSchemas(connector, importTables, importOutputDir);
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
      console.log("  Using imported ServiceNow ontology");
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
    const syncResult = await syncAllTables(connector, ontologyEngine, { limit });

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
        console.log(`  ${"  ".repeat(depth)}depth ${depth}: ${entity.type} — ${name}`);
      }
    }

    console.log("");
    if (command === "sync") return;
  }

  // ── Discover ───────────────────────────────────────────────

  if (command === "discover" || command === "full") {
    console.log("Step 4: Discovering constraints from live data...");
    const outputPath = resolve(importOutputDir, "discovered-constraints.yaml");
    const discovered = await discoverConstraints(connector, outputPath);
    console.log(`\n📊 Discovery summary: ${discovered.length} constraints suggested`);
    for (const c of discovered) {
      console.log(`  • ${c.name} [${c.severity}] — ${c.evidence}`);
    }
    console.log("");
  }

  // ── Done ───────────────────────────────────────────────────

  if (command === "full") {
    console.log("═".repeat(50));
    console.log("✅ Full pipeline complete!");
    console.log(`   Schemas: domains/servicenow-live/ontology.yaml`);
    console.log(`   Constraints: domains/servicenow-live/discovered-constraints.yaml`);
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
