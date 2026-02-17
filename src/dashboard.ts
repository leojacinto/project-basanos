#!/usr/bin/env node

/**
 * Basanos Dashboard — web UI for exploring the ontology,
 * constraints, and audit trail with light/dark mode toggle.
 *
 * Run: npm run dashboard
 */

import "dotenv/config";
import express from "express";
import net from "net";
import { execSync } from "child_process";
import readline from "readline";
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { OntologyEngine } from "./ontology/engine.js";
import { ConstraintEngine } from "./constraints/engine.js";
import { validateDomainSchema } from "./ontology/schema.js";
import { loadDomainFromYaml, loadConstraintsFromYaml } from "./loader.js";
import { generateAgentCard } from "./a2a/types.js";
import { load as yamlLoad } from "js-yaml";

// ── Initialize engines (load all YAML domains) ───────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const domainsDir = resolve(__dirname, "..", "domains");

const ontologyEngine = new OntologyEngine();
const constraintEngine = new ConstraintEngine();

if (existsSync(domainsDir)) {
  for (const entry of readdirSync(domainsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const domainDir = resolve(domainsDir, entry.name);
    const ontologyYaml = resolve(domainDir, "ontology.yaml");
    const constraintsYaml = resolve(domainDir, "constraints.yaml");
    const discoveredYaml = resolve(domainDir, "discovered-constraints.yaml");

    if (existsSync(ontologyYaml)) {
      console.log(`Loading domain: ${entry.name}`);
      const domain = loadDomainFromYaml(ontologyYaml);
      const errors = validateDomainSchema(domain);
      if (errors.length > 0) {
        console.warn(`  Validation warnings for ${entry.name}:`, errors);
      }
      ontologyEngine.registerDomain(domain);
    }

    if (existsSync(constraintsYaml)) {
      console.log(`  Loading constraints: ${constraintsYaml}`);
      for (const c of loadConstraintsFromYaml(constraintsYaml)) {
        constraintEngine.register(c);
      }
    }

    if (existsSync(discoveredYaml)) {
      console.log(`  Loading discovered constraints: ${discoveredYaml}`);
      for (const c of loadConstraintsFromYaml(discoveredYaml)) {
        constraintEngine.register(c);
      }
    }
  }
}

const allConstraints = constraintEngine.getAllConstraints();
const promotedCount = allConstraints.filter(c => c.status === "promoted").length;
const candidateCount = allConstraints.filter(c => c.status === "candidate").length;
console.log(`Loaded ${ontologyEngine.getDomains().length} domain(s), ${allConstraints.length} constraint(s) (${promotedCount} promoted, ${candidateCount} candidates)`);

// ── Load discovery rules YAML ─────────────────────────────────

const discoveryRulesPath = resolve(__dirname, "..", "discovery-rules.yaml");
let discoveryRules: unknown[] = [];
if (existsSync(discoveryRulesPath)) {
  const raw = yamlLoad(readFileSync(discoveryRulesPath, "utf-8")) as { rules: unknown[] };
  discoveryRules = raw.rules || [];
  console.log(`Loaded ${discoveryRules.length} discovery rule(s) from discovery-rules.yaml`);
}

// ── Express API ───────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get("/api/domains", (_req, res) => {
  const domains = ontologyEngine.getDomains().map((d) => ({
    name: d.name,
    label: d.label,
    version: d.version,
    description: d.description,
    entityTypeCount: d.entityTypes.length,
  }));
  res.json(domains);
});

app.get("/api/domains/:domain", (req, res) => {
  const domain = ontologyEngine.getDomain(req.params.domain);
  if (!domain) return res.status(404).json({ error: "Domain not found" });
  res.json(domain);
});

app.get("/api/domains/:domain/entities/:type", (req, res) => {
  const entityType = ontologyEngine.getEntityType(req.params.domain, req.params.type);
  if (!entityType) return res.status(404).json({ error: "Entity type not found" });
  const relationships = ontologyEngine.getRelationshipsFor(req.params.domain, req.params.type);
  res.json({ ...entityType, allRelationships: relationships });
});

app.get("/api/domains/:domain/constraints", (req, res) => {
  const constraints = constraintEngine.getConstraints(req.params.domain);
  res.json(constraints.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    appliesTo: c.appliesTo,
    relevantActions: c.relevantActions,
    severity: c.severity,
    status: c.status,
    description: c.description,
  })));
});

app.post("/api/constraints/:id/status", express.json(), (req, res) => {
  const { status } = req.body;
  const validStatuses = ["candidate", "promoted", "disabled"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status. Use: candidate, promoted, disabled" });
  }
  const statusMap: Record<string, import("./constraints/types.js").ConstraintStatus> = {
    candidate: "candidate" as import("./constraints/types.js").ConstraintStatus,
    promoted: "promoted" as import("./constraints/types.js").ConstraintStatus,
    disabled: "disabled" as import("./constraints/types.js").ConstraintStatus,
  };
  const ok = constraintEngine.updateConstraintStatus(req.params.id, statusMap[status]);
  if (!ok) return res.status(404).json({ error: "Constraint not found" });
  res.json({ success: true, id: req.params.id, status });
});

app.post("/api/constraints/:id/severity", express.json(), (req, res) => {
  const { severity } = req.body;
  const validSeverities = ["block", "warn", "info"];
  if (!validSeverities.includes(severity)) {
    return res.status(400).json({ error: "Invalid severity. Use: block, warn, info" });
  }
  const severityMap: Record<string, import("./constraints/types.js").ConstraintSeverity> = {
    block: "block" as import("./constraints/types.js").ConstraintSeverity,
    warn: "warn" as import("./constraints/types.js").ConstraintSeverity,
    info: "info" as import("./constraints/types.js").ConstraintSeverity,
  };
  const ok = constraintEngine.updateConstraintSeverity(req.params.id, severityMap[severity]);
  if (!ok) return res.status(404).json({ error: "Constraint not found" });
  res.json({ success: true, id: req.params.id, severity });
});

app.get("/api/discovery-rules", (_req, res) => {
  res.json(discoveryRules);
});

app.get("/api/env-config", (_req, res) => {
  res.json({
    instanceUrl: process.env.SERVICENOW_INSTANCE_URL || "",
    username: process.env.SERVICENOW_USERNAME || "",
    hasPassword: !!process.env.SERVICENOW_PASSWORD,
    clientId: process.env.SERVICENOW_CLIENT_ID || "",
    hasClientSecret: !!process.env.SERVICENOW_CLIENT_SECRET,
  });
});

app.get("/api/agent-card", (_req, res) => {
  const card = generateAgentCard({
    url: "stdio://basanos",
    domains: ontologyEngine.getDomains().map((d) => d.name),
  });
  res.json(card);
});

app.get("/api/audit", (_req, res) => {
  const log = constraintEngine.getAuditLog();
  const summary = constraintEngine.getAuditSummary();
  res.json({ summary, entries: log });
});

app.get("/api/provenance", (_req, res) => {
  const results: Record<string, unknown>[] = [];
  if (existsSync(domainsDir)) {
    for (const entry of readdirSync(domainsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const provPath = resolve(domainsDir, entry.name, "provenance.json");
      if (existsSync(provPath)) {
        const data = JSON.parse(readFileSync(provPath, "utf-8"));
        results.push({ domainDir: entry.name, ...data });
      } else {
        results.push({
          domainDir: entry.name,
          source: "hand-crafted",
          importedAt: null,
          note: "Manually authored YAML, not imported from a live system",
        });
      }
    }
  }
  res.json(results);
});

app.post("/api/connect", async (req, res) => {
  const instanceUrl = req.body.instanceUrl || process.env.SERVICENOW_INSTANCE_URL;
  const username = req.body.username || process.env.SERVICENOW_USERNAME;
  const password = req.body.password || process.env.SERVICENOW_PASSWORD;
  const clientId = req.body.clientId || process.env.SERVICENOW_CLIENT_ID;
  const clientSecret = req.body.clientSecret || process.env.SERVICENOW_CLIENT_SECRET;
  if (!instanceUrl) {
    return res.status(400).json({ error: "Missing instanceUrl" });
  }
  try {
    const { ServiceNowConnector } = await import("./connectors/servicenow.js");
    type AuthMode = "basic" | "oauth_client_credentials" | "oauth_password";
    let authMode: AuthMode = "basic";
    if (clientId && clientSecret && username && password) authMode = "oauth_password";
    else if (clientId && clientSecret) authMode = "oauth_client_credentials";
    const connector = new ServiceNowConnector({ instanceUrl, authMode, username, password, clientId, clientSecret });
    const result = await connector.testConnection();
    res.json({ ...result, authMode });
  } catch (err) {
    res.json({ success: false, message: String(err) });
  }
});

app.post("/api/import", async (req, res) => {
  const instanceUrl = req.body.instanceUrl || process.env.SERVICENOW_INSTANCE_URL;
  const username = req.body.username || process.env.SERVICENOW_USERNAME;
  const password = req.body.password || process.env.SERVICENOW_PASSWORD;
  const clientId = req.body.clientId || process.env.SERVICENOW_CLIENT_ID;
  const clientSecret = req.body.clientSecret || process.env.SERVICENOW_CLIENT_SECRET;
  const tables = req.body.tables;
  if (!instanceUrl) {
    return res.status(400).json({ error: "Missing instanceUrl" });
  }
  try {
    const { ServiceNowConnector } = await import("./connectors/servicenow.js");
    const { importSchemas } = await import("./connectors/schema-importer.js");
    const { syncAllTables } = await import("./connectors/entity-sync.js");
    const { discoverConstraints } = await import("./connectors/constraint-discovery.js");

    type AuthMode = "basic" | "oauth_client_credentials" | "oauth_password";
    let authMode: AuthMode = "basic";
    if (clientId && clientSecret && username && password) authMode = "oauth_password";
    else if (clientId && clientSecret) authMode = "oauth_client_credentials";
    const connector = new ServiceNowConnector({ instanceUrl, authMode, username, password, clientId, clientSecret });
    const importTables = tables || ["incident", "cmdb_ci", "cmdb_ci_service", "change_request", "problem", "sys_user_group"];
    const isMock = instanceUrl.includes("localhost") || instanceUrl.includes("127.0.0.1");
    const outputDir = resolve(domainsDir, isMock ? "servicenow-demo" : "servicenow-live");

    const importResult = await importSchemas(connector, importTables, outputDir);

    const syncResult = await syncAllTables(connector, ontologyEngine, { limit: 100 });

    const discovered = await discoverConstraints(connector, resolve(outputDir, "discovered-constraints.yaml"));

    // Reload domains
    const { loadDomainFromYaml: reload, loadConstraintsFromYaml: reloadC } = await import("./loader.js");
    const liveYaml = resolve(outputDir, "ontology.yaml");
    if (existsSync(liveYaml)) {
      const domain = reload(liveYaml);
      ontologyEngine.registerDomain(domain);
      const cYaml = resolve(outputDir, "constraints.yaml");
      const dYaml = resolve(outputDir, "discovered-constraints.yaml");
      if (existsSync(cYaml)) for (const c of reloadC(cYaml)) constraintEngine.register(c);
      if (existsSync(dYaml)) for (const c of reloadC(dYaml)) constraintEngine.register(c);
    }

    res.json({
      success: true,
      import: { tables: importResult.tablesImported, fields: importResult.fieldsImported, relationships: importResult.referencesFound },
      sync: { entities: syncResult.totalSynced, errors: syncResult.totalErrors },
      discovery: { constraints: discovered.length, evidence: discovered.map((c) => ({ name: c.name, severity: c.severity, evidence: c.evidence })) },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── Serve Dashboard HTML ──────────────────────────────────────

app.get("/", (_req, res) => {
  res.type("html").send(dashboardHtml());
});

function findOpenPort(startPort: number, maxAttempts = 20): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    function tryPort(port: number) {
      const probe = net.createServer();
      probe.once("error", () => {
        attempt++;
        if (attempt >= maxAttempts) {
          reject(new Error(`No open port found in range ${startPort}-${startPort + maxAttempts}`));
        } else {
          tryPort(port + 1);
        }
      });
      probe.once("listening", () => {
        probe.close(() => resolve(port));
      });
      probe.listen(port);
    }
    tryPort(startPort);
  });
}

/**
 * Check for existing Basanos dashboard processes and prompt to kill them.
 * Follows the same pattern as project-virgil's start.sh.
 */
function findProcessesOnPort(port: number): { pid: string; command: string }[] {
  try {
    const output = execSync(`lsof -ti:${port} 2>/dev/null`, { encoding: "utf-8" }).trim();
    if (!output) return [];
    return output.split("\n").filter(Boolean).map((pid) => {
      let command = "unknown";
      try {
        command = execSync(`ps -p ${pid} -o command= 2>/dev/null`, { encoding: "utf-8" }).trim();
      } catch { /* ignore */ }
      return { pid, command };
    });
  } catch {
    return [];
  }
}

function askUser(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith("y"));
    });
  });
}

async function killExistingIfNeeded(port: number): Promise<void> {
  const procs = findProcessesOnPort(port);
  if (procs.length === 0) return;

  const isBasanos = procs.some((p) => p.command.includes("dashboard") || p.command.includes("basanos"));
  if (!isBasanos) return;

  console.log(`\n\u26A0\uFE0F  Found existing Basanos dashboard on port ${port}:`);
  for (const p of procs) {
    console.log(`   PID ${p.pid}: ${p.command.substring(0, 80)}`);
  }

  const shouldKill = await askUser("   Kill and restart? (y/n) ");
  if (shouldKill) {
    for (const p of procs) {
      try { process.kill(parseInt(p.pid, 10), "SIGTERM"); } catch { /* already gone */ }
    }
    console.log("   Stopped existing process(es). Restarting...\n");
    await new Promise((r) => setTimeout(r, 1000));
  } else {
    console.log("   Keeping existing dashboard. Exiting.");
    process.exit(0);
  }
}

const preferredPort = parseInt(process.env.BASANOS_PORT || "3001", 10);

(async () => {
  await killExistingIfNeeded(preferredPort);

  const port = await findOpenPort(preferredPort);
  app.listen(port, () => {
    if (port !== preferredPort) {
      console.log(`Port ${preferredPort} in use, found open port ${port}`);
    }
    console.log(`Basanos Dashboard running at http://localhost:${port}`);
  });
})().catch((err) => {
  console.error("Could not start dashboard:", err);
  process.exit(1);
});

// ── Dashboard HTML ────────────────────────────────────────────

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Basanos Dashboard</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🃏</text></svg>">
  <style>
    :root {
      --bg: #ffffff;
      --bg-secondary: #f8f9fa;
      --bg-card: #ffffff;
      --text: #1a1a2e;
      --text-secondary: #6c757d;
      --border: #e2e8f0;
      --accent: #6366f1;
      --accent-light: #eef2ff;
      --success: #22c55e;
      --warn: #f59e0b;
      --danger: #ef4444;
      --shadow: 0 1px 3px rgba(0,0,0,0.08);
    }

    [data-theme="dark"] {
      --bg: #0f172a;
      --bg-secondary: #1e293b;
      --bg-card: #1e293b;
      --text: #e2e8f0;
      --text-secondary: #94a3b8;
      --border: #334155;
      --accent: #818cf8;
      --accent-light: #1e1b4b;
      --success: #4ade80;
      --warn: #fbbf24;
      --danger: #f87171;
      --shadow: 0 1px 3px rgba(0,0,0,0.3);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      transition: background 0.3s, color 0.3s;
    }

    header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    header h1 {
      font-size: 1.5rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    header h1 span.subtitle {
      font-size: 0.85rem;
      font-weight: 400;
      color: var(--text-secondary);
    }

    .theme-toggle {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 9999px;
      padding: 0.4rem 1rem;
      cursor: pointer;
      color: var(--text);
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      transition: all 0.2s;
    }

    .theme-toggle:hover { border-color: var(--accent); }

    nav {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 0 2rem;
      display: flex;
      gap: 0;
    }

    nav button {
      background: none;
      border: none;
      padding: 0.75rem 1.25rem;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 0.9rem;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }

    nav button:hover { color: var(--text); }
    nav button.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
      font-weight: 600;
    }

    main { padding: 2rem; max-width: 1200px; margin: 0 auto; }

    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.5rem;
      margin-bottom: 1rem;
      box-shadow: var(--shadow);
    }

    .card h2 {
      font-size: 1.15rem;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .card h3 {
      font-size: 0.95rem;
      margin: 1rem 0 0.5rem;
      color: var(--accent);
    }

    .card p { color: var(--text-secondary); font-size: 0.9rem; }

    .badge {
      display: inline-block;
      padding: 0.15rem 0.6rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .badge-block { background: var(--danger); color: white; }
    .badge-warn { background: var(--warn); color: #1a1a2e; }
    .badge-info { background: var(--accent); color: white; }
    .badge-type { background: var(--accent-light); color: var(--accent); border: 1px solid var(--accent); }

    .prop-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 0.5rem;
      font-size: 0.85rem;
    }

    .prop-table th {
      text-align: left;
      padding: 0.5rem;
      border-bottom: 2px solid var(--border);
      color: var(--text-secondary);
      font-weight: 600;
    }

    .prop-table td {
      padding: 0.5rem;
      border-bottom: 1px solid var(--border);
    }

    .rel-arrow {
      color: var(--accent);
      font-weight: 600;
      margin: 0 0.25rem;
    }

    .entity-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 1rem;
    }

    .entity-card { cursor: pointer; transition: border-color 0.2s; }
    .entity-card:hover { border-color: var(--accent); }

    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .stat-card {
      text-align: center;
      padding: 1.25rem;
    }

    .stat-card .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--accent);
    }

    .stat-card .stat-label {
      font-size: 0.8rem;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .detail-panel {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.5rem;
      margin-top: 1rem;
    }

    .skill-card {
      border-left: 3px solid var(--accent);
      padding-left: 1rem;
      margin: 0.75rem 0;
    }

    .empty-state {
      text-align: center;
      padding: 3rem;
      color: var(--text-secondary);
    }

    #content { min-height: 60vh; }

    .back-btn {
      background: none;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 0.4rem 0.8rem;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 0.85rem;
      margin-bottom: 1rem;
      transition: all 0.2s;
    }

    .back-btn:hover { border-color: var(--accent); color: var(--accent); }

    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.25rem; }
    .form-group input {
      width: 100%; padding: 0.5rem 0.75rem; border: 1px solid var(--border);
      border-radius: 0.5rem; background: var(--bg); color: var(--text); font-size: 0.9rem;
    }
    .btn-primary {
      background: var(--accent); color: white; border: none; border-radius: 0.5rem;
      padding: 0.6rem 1.5rem; cursor: pointer; font-size: 0.9rem; font-weight: 600;
    }
    .btn-primary:hover { opacity: 0.9; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 0.4rem; }
    .status-connected { background: var(--success); }
    .status-disconnected { background: var(--danger); }
    .provenance-card { border-left: 3px solid var(--accent); padding-left: 1rem; }
    .log-output {
      background: var(--bg); border: 1px solid var(--border); border-radius: 0.5rem;
      padding: 1rem; font-family: monospace; font-size: 0.8rem; max-height: 300px;
      overflow-y: auto; white-space: pre-wrap; margin-top: 1rem;
    }
  </style>
</head>
<body>
  <header>
    <h1>
      &#x1F0CF; Basanos
      <span class="subtitle">Semantic Ontology Dashboard</span>
    </h1>
    <div style="display:flex;gap:0.75rem;align-items:center;">
      <select id="domain-select" onchange="switchDomain(this.value)" style="
        background:var(--bg-card);border:1px solid var(--border);border-radius:0.5rem;
        padding:0.4rem 0.75rem;color:var(--text);font-size:0.9rem;cursor:pointer;
      "></select>
      <button class="theme-toggle" onclick="toggleTheme()">
        <span id="theme-icon">&#x2600;&#xFE0F;</span>
        <span id="theme-label">Light</span>
      </button>
    </div>
  </header>
  <nav>
    <button class="active" onclick="showTab('overview')">Overview</button>
    <button onclick="showTab('entities')">Entity Types</button>
    <button onclick="showTab('constraints')">Constraints</button>
    <button onclick="showTab('agent-card')">Agent Card</button>
    <button onclick="showTab('audit')">Audit Trail</button>
    <button onclick="showTab('connect')">Connect</button>
    <button onclick="showTab('discovery-rules')" style="margin-left:auto;">Discovery Rules</button>
  </nav>
  <main>
    <div id="content">
      <div class="empty-state">Loading...</div>
    </div>
  </main>

<script>
  let allDomains = [];
  let domainData = null;
  let constraintData = null;
  let agentCardData = null;
  let provenanceData = [];
  let currentTab = 'overview';
  let currentDomain = '';

  async function init() {
    try {
      const listRes = await fetch('/api/domains');
      if (!listRes.ok) throw new Error('API returned ' + listRes.status);
      allDomains = await listRes.json();
      const select = document.getElementById('domain-select');
      select.innerHTML = allDomains.map(d =>
        \`<option value="\${d.name}">\${d.label} (\${d.entityTypeCount} types)</option>\`
      ).join('');
      if (allDomains.length > 0) {
        currentDomain = allDomains[0].name;
        await loadDomain(currentDomain);
      } else {
        document.getElementById('content').innerHTML =
          '<div style="text-align:center;padding:3rem;color:var(--text-secondary);">' +
          '<h2>No domains loaded</h2>' +
          '<p>Run the pipeline first: <code>npm run demo</code> or <code>npm run cli -- full</code></p>' +
          '<p>Then refresh this page.</p></div>';
      }
    } catch (err) {
      document.getElementById('content').innerHTML =
        '<div style="text-align:center;padding:3rem;color:#c0392b;">' +
        '<h2>Failed to load dashboard</h2>' +
        '<p>' + err + '</p>' +
        '<p style="color:var(--text-secondary);">Is the Basanos dashboard server running? Try: <code>npm run demo</code></p></div>';
    }
  }

  async function switchDomain(name) {
    currentDomain = name;
    await loadDomain(name);
  }

  async function loadDomain(name) {
    const [domainRes, constraintRes, cardRes, provRes] = await Promise.all([
      fetch(\`/api/domains/\${name}\`),
      fetch(\`/api/domains/\${name}/constraints\`),
      fetch('/api/agent-card'),
      fetch('/api/provenance'),
    ]);
    domainData = await domainRes.json();
    constraintData = await constraintRes.json();
    agentCardData = await cardRes.json();
    provenanceData = await provRes.json();
    showTab(currentTab);
  }

  function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    document.getElementById('theme-icon').textContent = next === 'dark' ? '\\u{1F319}' : '\\u{2600}\\u{FE0F}';
    document.getElementById('theme-label').textContent = next === 'dark' ? 'Dark' : 'Light';
    localStorage.setItem('basanos-theme', next);
  }

  // Restore saved theme
  const saved = localStorage.getItem('basanos-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('theme-icon').textContent = saved === 'dark' ? '\\u{1F319}' : '\\u{2600}\\u{FE0F}';
    document.getElementById('theme-label').textContent = saved === 'dark' ? 'Dark' : 'Light';
  }

  async function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll('nav button').forEach((b, i) => {
      const tabs = ['overview', 'entities', 'constraints', 'agent-card', 'audit', 'connect', 'discovery-rules'];
      b.classList.toggle('active', tabs[i] === tab);
    });
    const el = document.getElementById('content');
    switch (tab) {
      case 'overview': renderOverview(el); break;
      case 'entities': renderEntities(el); break;
      case 'constraints': renderConstraints(el); break;
      case 'agent-card': renderAgentCard(el); break;
      case 'audit': renderAudit(el); break;
      case 'connect': await renderConnect(el); break;
      case 'discovery-rules': await renderDiscoveryRules(el); break;
    }
  }

  function renderOverview(el) {
    if (!domainData) return;
    const d = domainData;
    const totalRels = d.entityTypes.reduce((sum, et) => sum + et.relationships.length, 0);
    const totalProps = d.entityTypes.reduce((sum, et) => sum + et.properties.length, 0);
    el.innerHTML = \`
      <div class="stat-grid">
        <div class="card stat-card">
          <div class="stat-value">\${d.entityTypes.length}</div>
          <div class="stat-label">Entity Types</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value">\${totalRels}</div>
          <div class="stat-label">Relationships</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value">\${totalProps}</div>
          <div class="stat-label">Properties</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value">\${constraintData ? constraintData.length : 0}</div>
          <div class="stat-label">Constraints</div>
        </div>
      </div>
      <div class="card">
        <h2>\${d.label} Domain <span class="badge badge-type">v\${d.version}</span></h2>
        <p>\${d.description}</p>
        <h3>Entity Relationship Map</h3>
        <div style="margin-top:0.5rem;">
          \${d.entityTypes.map(et =>
            et.relationships.map(r =>
              \`<div style="padding:0.3rem 0;font-size:0.9rem;">
                <span class="badge badge-type">\${et.label}</span>
                <span class="rel-arrow">&rarr;</span>
                <strong>\${r.label}</strong>
                <span class="rel-arrow">&rarr;</span>
                <span class="badge badge-type">\${r.targetType}</span>
                <span style="color:var(--text-secondary);font-size:0.8rem;margin-left:0.5rem;">\${r.cardinality}</span>
              </div>\`
            ).join('')
          ).join('')}
        </div>
      </div>
      \${renderProvenanceSection()}
    \`;
  }

  function renderProvenanceSection() {
    const prov = provenanceData.find(p => p.domainDir === currentDomain || p.source === currentDomain)
      || provenanceData.find(p => currentDomain.includes(p.domainDir));
    if (!prov) {
      const handCrafted = provenanceData.find(p => p.source === 'hand-crafted');
      if (handCrafted) {
        return \`<div class="card provenance-card" style="margin-top:1rem;">
          <h2>Data Source</h2>
          <p><span class="status-dot status-disconnected"></span> <strong>Hand-crafted YAML</strong></p>
          <p style="margin-top:0.5rem;color:var(--text-secondary);">
            This domain was manually authored. It is not connected to a live system.
            Use the <strong>Connect</strong> tab to import from a ServiceNow instance.
          </p>
        </div>\`;
      }
      return '';
    }
    if (prov.source === 'hand-crafted') {
      return \`<div class="card provenance-card" style="margin-top:1rem;">
        <h2>Data Source</h2>
        <p><span class="status-dot status-disconnected"></span> <strong>Hand-crafted YAML</strong></p>
        <p style="margin-top:0.5rem;color:var(--text-secondary);">
          This domain was manually authored. Not connected to a live system.
          Use the <strong>Connect</strong> tab to import from ServiceNow.
        </p>
      </div>\`;
    }
    return \`<div class="card provenance-card" style="margin-top:1rem;">
      <h2>Data Source <span class="badge badge-info">Live Import</span></h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-top:0.75rem;">
        <div>
          <p><strong>Instance:</strong> <span class="status-dot status-connected"></span>\${prov.source || 'Unknown'}</p>
          <p><strong>Imported:</strong> \${prov.importedAt ? new Date(prov.importedAt).toLocaleString() : 'Unknown'}</p>
          <p><strong>Pipeline:</strong> \${prov.pipeline || 'basanos cli'}</p>
        </div>
        <div>
          <p><strong>Tables:</strong> \${prov.tablesImported || '?'} imported</p>
          <p><strong>Fields:</strong> \${prov.fieldsImported || '?'} mapped</p>
          <p><strong>Relationships:</strong> \${prov.referencesFound || '?'} discovered</p>
        </div>
      </div>
      \${prov.discoveryEvidence ? \`
        <h3 style="margin-top:1rem;">Constraint Discovery Evidence</h3>
        <div style="margin-top:0.5rem;">
          \${prov.discoveryEvidence.map(e =>
            \`<div style="padding:0.3rem 0;font-size:0.85rem;">
              <span class="badge \${{block:'badge-block',warn:'badge-warn',info:'badge-info'}[e.severity]}">\${e.severity}</span>
              <strong>\${e.name}</strong>
              <span style="color:var(--text-secondary);margin-left:0.5rem;">\${e.evidence}</span>
            </div>\`
          ).join('')}
        </div>
      \` : ''}
    </div>\`;
  }

  function renderEntities(el) {
    if (!domainData) return;
    el.innerHTML = \`
      <div class="entity-grid">
        \${domainData.entityTypes.map(et => \`
          <div class="card entity-card" onclick="showEntityDetail('\${et.name}')">
            <h2>\${et.label} <span class="badge badge-type">\${et.name}</span></h2>
            <p>\${et.description.substring(0, 120)}...</p>
            <div style="margin-top:0.75rem;display:flex;gap:0.5rem;">
              <span class="badge badge-info">\${et.properties.length} properties</span>
              <span class="badge badge-info">\${et.relationships.length} relationships</span>
            </div>
          </div>
        \`).join('')}
      </div>
      <div id="entity-detail"></div>
    \`;
  }

  async function showEntityDetail(typeName) {
    const res = await fetch(\`/api/domains/\${currentDomain}/entities/\${typeName}\`);
    const data = await res.json();
    const detail = document.getElementById('entity-detail');
    detail.innerHTML = \`
      <div class="detail-panel">
        <button class="back-btn" onclick="document.getElementById('entity-detail').innerHTML=''">&larr; Close</button>
        <h2>\${data.label} <span class="badge badge-type">\${data.name}</span></h2>
        <p>\${data.description}</p>
        <h3>Properties</h3>
        <table class="prop-table">
          <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
          <tbody>
            \${data.properties.map(p => \`
              <tr>
                <td><strong>\${p.label}</strong></td>
                <td><span class="badge badge-type">\${p.type}\${p.enumValues ? ' [' + p.enumValues.length + ']' : ''}</span></td>
                <td>\${p.required ? '\\u2705' : ''}</td>
                <td style="color:var(--text-secondary)">\${p.description}</td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
        <h3>All Relationships (direct + inverse)</h3>
        <table class="prop-table">
          <thead><tr><th>Name</th><th>Source</th><th></th><th>Target</th><th>Cardinality</th><th>Description</th></tr></thead>
          <tbody>
            \${data.allRelationships.map(r => \`
              <tr>
                <td><strong>\${r.label}</strong></td>
                <td><span class="badge badge-type">\${r.sourceType}</span></td>
                <td class="rel-arrow">&rarr;</td>
                <td><span class="badge badge-type">\${r.targetType}</span></td>
                <td>\${r.cardinality}</td>
                <td style="color:var(--text-secondary)">\${r.description}</td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      </div>
    \`;
    detail.scrollIntoView({ behavior: 'smooth' });
  }

  function renderConstraints(el) {
    if (!constraintData) return;
    const promoted = constraintData.filter(c => c.status === 'promoted');
    const candidates = constraintData.filter(c => c.status === 'candidate');
    const disabled = constraintData.filter(c => c.status === 'disabled');

    function constraintCard(c) {
      const statusColors = { promoted: 'var(--success)', candidate: 'var(--accent)', disabled: 'var(--text-secondary)' };
      const statusLabels = { promoted: 'ENFORCED', candidate: 'CANDIDATE', disabled: 'DISABLED' };
      return '<div class="card" style="' + (c.status === 'disabled' ? 'opacity:0.6;' : '') + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;">' +
          '<h2 style="margin:0;">' + c.name +
            ' <span class="badge ' + {block:'badge-block',warn:'badge-warn',info:'badge-info'}[c.severity] + '">' + c.severity.toUpperCase() + '</span>' +
            ' <span style="font-size:0.7rem;padding:2px 8px;border-radius:4px;color:white;background:' + (statusColors[c.status] || 'gray') + ';">' + (statusLabels[c.status] || c.status) + '</span>' +
          '</h2>' +
          '<div style="display:flex;gap:0.5rem;align-items:center;">' +
            '<select onchange="updateSeverity(\\'' + c.id + '\\', this.value)" style="padding:4px 8px;border-radius:4px;border:1px solid var(--border);background:var(--card-bg);color:var(--text-primary);font-size:0.8rem;">' +
              '<option value="block"' + (c.severity === 'block' ? ' selected' : '') + '>Block</option>' +
              '<option value="warn"' + (c.severity === 'warn' ? ' selected' : '') + '>Warn</option>' +
              '<option value="info"' + (c.severity === 'info' ? ' selected' : '') + '>Info</option>' +
            '</select>' +
            (c.status === 'candidate' ? '<button class="btn-primary" style="font-size:0.8rem;padding:4px 12px;" onclick="updateStatus(\\'' + c.id + '\\', \\'promoted\\')">Promote</button>' : '') +
            (c.status === 'promoted' ? '<button style="font-size:0.8rem;padding:4px 12px;border:1px solid var(--border);border-radius:4px;background:var(--card-bg);color:var(--text-secondary);cursor:pointer;" onclick="updateStatus(\\'' + c.id + '\\', \\'disabled\\')">Disable</button>' : '') +
            (c.status === 'disabled' ? '<button style="font-size:0.8rem;padding:4px 12px;border:1px solid var(--border);border-radius:4px;background:var(--card-bg);color:var(--accent);cursor:pointer;" onclick="updateStatus(\\'' + c.id + '\\', \\'promoted\\')">Re-enable</button>' +
              ' <button style="font-size:0.8rem;padding:4px 12px;border:1px solid var(--border);border-radius:4px;background:var(--card-bg);color:var(--text-secondary);cursor:pointer;" onclick="updateStatus(\\'' + c.id + '\\', \\'candidate\\')">To Candidate</button>' : '') +
          '</div>' +
        '</div>' +
        '<p style="margin-top:0.5rem;">' + c.description + '</p>' +
        '<div style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap;">' +
          '<span style="font-size:0.8rem;color:var(--text-secondary);">Applies to:</span>' +
          c.appliesTo.map(function(a) { return '<span class="badge badge-type">' + a + '</span>'; }).join('') +
          '<span style="font-size:0.8rem;color:var(--text-secondary);margin-left:0.5rem;">Actions:</span>' +
          c.relevantActions.map(function(a) { return '<span class="badge badge-info">' + a + '</span>'; }).join('') +
        '</div>' +
      '</div>';
    }

    el.innerHTML =
      '<div class="stat-grid">' +
        '<div class="card stat-card"><div class="stat-value" style="color:var(--success)">' + promoted.length + '</div><div class="stat-label">Enforced</div></div>' +
        '<div class="card stat-card"><div class="stat-value" style="color:var(--accent)">' + candidates.length + '</div><div class="stat-label">Candidates</div></div>' +
        '<div class="card stat-card"><div class="stat-value" style="color:var(--text-secondary)">' + disabled.length + '</div><div class="stat-label">Disabled</div></div>' +
      '</div>' +
      (promoted.length > 0 ? '<h3 style="margin:1rem 0 0.5rem;color:var(--success);">Enforced (' + promoted.length + ')</h3>' + promoted.map(constraintCard).join('') : '') +
      (candidates.length > 0 ? '<h3 style="margin:1rem 0 0.5rem;color:var(--accent);">Candidates (' + candidates.length + ')</h3>' + candidates.map(constraintCard).join('') : '') +
      (disabled.length > 0 ? '<details style="margin-top:1rem;"><summary style="cursor:pointer;color:var(--text-secondary);font-weight:600;">Disabled (' + disabled.length + ')</summary>' + disabled.map(constraintCard).join('') + '</details>' : '');
  }

  function renderAgentCard(el) {
    if (!agentCardData) return;
    const c = agentCardData;
    el.innerHTML = \`
      <div class="card">
        <h2>\${c.name} <span class="badge badge-type">v\${c.version}</span></h2>
        <p>\${c.description}</p>
        <div style="margin-top:0.75rem;">
          <span style="font-size:0.8rem;color:var(--text-secondary);">Domains:</span>
          \${c.domains.map(d => '<span class="badge badge-type">' + d + '</span>').join(' ')}
          <span style="font-size:0.8rem;color:var(--text-secondary);margin-left:1rem;">Protocols:</span>
          \${c.protocolVersions.map(p => '<span class="badge badge-info">' + p + '</span>').join(' ')}
        </div>
      </div>
      <h3 style="margin:1rem 0 0.5rem;font-size:1rem;">Skills (\${c.skills.length})</h3>
      \${c.skills.map(s => \`
        <div class="card">
          <div class="skill-card">
            <h2>\${s.name} <span class="badge badge-type">\${s.id}</span></h2>
            <p>\${s.description}</p>
            <div style="margin-top:0.5rem;display:flex;gap:1rem;flex-wrap:wrap;font-size:0.8rem;">
              <div><strong>Input:</strong> \${s.inputModes.join(', ')}</div>
              <div><strong>Output:</strong> \${s.outputModes.join(', ')}</div>
            </div>
            \${s.preconditions.length ? '<h3>Preconditions</h3>' + s.preconditions.map(p =>
              '<div style="padding:0.2rem 0;font-size:0.85rem;color:var(--text-secondary);">' + p.description + '</div>'
            ).join('') : ''}
            \${s.postconditions.length ? '<h3>Postconditions</h3>' + s.postconditions.map(p =>
              '<div style="padding:0.2rem 0;font-size:0.85rem;color:var(--text-secondary);">' + p.description + '</div>'
            ).join('') : ''}
          </div>
        </div>
      \`).join('')}
    \`;
  }

  async function renderAudit(el) {
    const res = await fetch('/api/audit');
    const data = await res.json();
    el.innerHTML = \`
      <div class="stat-grid">
        <div class="card stat-card">
          <div class="stat-value">\${data.summary.total}</div>
          <div class="stat-label">Total Evaluations</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value" style="color:var(--success)">\${data.summary.allowed}</div>
          <div class="stat-label">Allowed</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value" style="color:var(--danger)">\${data.summary.blocked}</div>
          <div class="stat-label">Blocked</div>
        </div>
      </div>
      \${data.entries.length === 0
        ? '<div class="empty-state">No constraint evaluations yet. Use the MCP tools to generate audit entries.</div>'
        : data.entries.map(e => \`
          <div class="card">
            <h2>
              #\${e.id}
              <span class="badge \${e.verdict.allowed ? 'badge-info' : 'badge-block'}">\${e.verdict.allowed ? 'ALLOWED' : 'BLOCKED'}</span>
            </h2>
            <p><strong>Action:</strong> \${e.verdict.context.intendedAction} on <span class="badge badge-type">\${e.verdict.context.targetEntity}</span></p>
            <p><strong>Time:</strong> \${e.timestamp}</p>
            <p style="margin-top:0.5rem;">\${e.verdict.summary}</p>
          </div>
        \`).join('')
      }
    \`;
  }

  async function renderDiscoveryRules(el) {
    el.innerHTML = '<div class="empty-state">Loading discovery rules...</div>';
    let rules = [];
    try {
      const res = await fetch('/api/discovery-rules');
      rules = await res.json();
    } catch (e) {
      el.innerHTML = '<div class="empty-state">Failed to load discovery rules</div>';
      return;
    }

    // Group by connector
    var connectors = {};
    rules.forEach(function(r) {
      var c = r.connector || 'unknown';
      if (!connectors[c]) connectors[c] = [];
      connectors[c].push(r);
    });

    el.innerHTML =
      '<div class="card">' +
        '<h2>How Basanos Discovers Constraints</h2>' +
        '<p style="color:var(--text-secondary);margin-bottom:1rem;">' +
          'Basanos uses coded heuristics, not LLMs, to analyze live data from your system of record. ' +
          'Each analyzer queries a specific table, applies a threshold, and emits a candidate constraint with evidence. ' +
          'No embeddings, no vectors, no inference. The intelligence is in knowing <em>what to look for</em>.' +
        '</p>' +
        '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">' +
          '<span class="badge badge-type">Deterministic</span>' +
          '<span class="badge badge-type">Auditable</span>' +
          '<span class="badge badge-type">No LLM required</span>' +
          '<span class="badge badge-type">YAML-defined</span>' +
        '</div>' +
      '</div>' +
      Object.keys(connectors).map(function(connector) {
        var cRules = connectors[connector];
        return '<h3 style="margin:1rem 0 0.5rem;text-transform:capitalize;">' +
          '<span class="badge badge-type" style="font-size:0.8rem;">' + connector + '</span> ' +
          'Analyzers (' + cRules.length + ')</h3>' +
          cRules.map(function(r) {
            var sevClass = {block:'badge-block',warn:'badge-warn',info:'badge-info'}[r.severity] || 'badge-info';
            var outputText = r.output
              ? (r.severity === 'block' ? 'Blocks ' : 'Warns on ') +
                (r.output.relevantActions || []).join(', ') + ' actions for ' +
                (r.output.appliesTo || []).join(', ')
              : '';
            return '<div class="card">' +
              '<h2>' + r.name +
                ' <span class="badge ' + sevClass + '">' + r.severity.toUpperCase() + '</span>' +
                ' <span class="badge badge-type" style="font-size:0.65rem;">' + connector + '</span>' +
              '</h2>' +
              '<p style="margin:0.5rem 0;">' + (r.logic || '') + '</p>' +
              '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;margin-top:0.75rem;">' +
                '<tr style="border-bottom:1px solid var(--border);">' +
                  '<td style="padding:0.4rem 0.75rem;font-weight:600;color:var(--text-secondary);width:120px;">Connector</td>' +
                  '<td style="padding:0.4rem 0.75rem;"><code>' + connector + '</code></td>' +
                '</tr>' +
                '<tr style="border-bottom:1px solid var(--border);">' +
                  '<td style="padding:0.4rem 0.75rem;font-weight:600;color:var(--text-secondary);">Table</td>' +
                  '<td style="padding:0.4rem 0.75rem;"><code>' + r.table + '</code></td>' +
                '</tr>' +
                '<tr style="border-bottom:1px solid var(--border);">' +
                  '<td style="padding:0.4rem 0.75rem;font-weight:600;color:var(--text-secondary);">Query</td>' +
                  '<td style="padding:0.4rem 0.75rem;"><code>' + r.query + '</code></td>' +
                '</tr>' +
                '<tr style="border-bottom:1px solid var(--border);">' +
                  '<td style="padding:0.4rem 0.75rem;font-weight:600;color:var(--text-secondary);">Threshold</td>' +
                  '<td style="padding:0.4rem 0.75rem;"><code>' + r.threshold + '</code></td>' +
                '</tr>' +
                (outputText ? '<tr>' +
                  '<td style="padding:0.4rem 0.75rem;font-weight:600;color:var(--text-secondary);">Output</td>' +
                  '<td style="padding:0.4rem 0.75rem;">' + outputText + '</td>' +
                '</tr>' : '') +
              '</table>' +
            '</div>';
          }).join('');
      }).join('') +
      '<div class="card" style="margin-top:0.75rem;border-left:3px solid var(--accent);">' +
        '<p style="font-size:0.9rem;color:var(--text-secondary);">' +
          '<strong>Source:</strong> <code>discovery-rules.yaml</code> at the project root. ' +
          'Add new analyzers by adding entries to this YAML file, tagged with the appropriate connector. ' +
          'No code changes needed for new rules.' +
        '</p>' +
      '</div>';
  }

  async function renderConnect(el) {
    // Pre-populate from server-side .env
    let envConfig = { instanceUrl: '', username: '', hasPassword: false, clientId: '', hasClientSecret: false };
    try {
      const cfgRes = await fetch('/api/env-config');
      envConfig = await cfgRes.json();
    } catch(e) { /* ignore */ }

    el.innerHTML = \`
      <div class="card">
        <h2>Connect to ServiceNow</h2>
        <p style="color:var(--text-secondary);margin-bottom:1rem;">
          Enter your ServiceNow instance credentials to import schemas, sync entities,
          and discover constraints from live data. This proves the ontology is real, not static YAML.
          \${envConfig.instanceUrl ? '<br><strong style="color:var(--success);">Values loaded from .env</strong>' : ''}
        </p>
        <div class="form-group">
          <label>Instance URL</label>
          <input id="snow-url" type="text" placeholder="https://your-instance.service-now.com" value="\${envConfig.instanceUrl}" />
        </div>
        <details style="margin-bottom:0.75rem;">
          <summary style="cursor:pointer;color:var(--accent);font-weight:600;">OAuth (recommended for production)</summary>
          <div style="margin-top:0.5rem;">
            <div class="form-group">
              <label>Client ID</label>
              <input id="snow-client-id" type="text" placeholder="OAuth Client ID" value="\${envConfig.clientId}" />
            </div>
            <div class="form-group">
              <label>Client Secret</label>
              <input id="snow-client-secret" type="password" placeholder="\${envConfig.hasClientSecret ? 'Set in .env' : 'OAuth Client Secret'}" />
            </div>
            <p style="font-size:0.8rem;color:var(--text-secondary);">Set up in ServiceNow: System OAuth &gt; Application Registry. If provided without username/password, uses client_credentials grant.</p>
          </div>
        </details>
        <div class="form-group">
          <label>Username <span style="font-size:0.8rem;color:var(--text-secondary);">(required for basic auth or OAuth password grant)</span></label>
          <input id="snow-user" type="text" placeholder="admin" value="\${envConfig.username}" />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input id="snow-pass" type="password" placeholder="\${envConfig.hasPassword ? 'Set in .env' : 'Password'}" />
        </div>
        <div style="display:flex;gap:0.75rem;">
          <button class="btn-primary" onclick="testConnection()">Test Connection</button>
          <button class="btn-primary" id="btn-import" onclick="runImport()" disabled>Import &amp; Discover</button>
        </div>
        <div id="connect-status" style="margin-top:1rem;"></div>
        <div id="connect-log" class="log-output" style="display:none;"></div>
      </div>
      \${(function() {
        if (provenanceData.length === 0) return '<div class="card" style="margin-top:1rem;"><p class="empty-state">No domains loaded</p></div>';
        const active = provenanceData.find(p => p.domainDir === currentDomain) || provenanceData[0];
        const others = provenanceData.filter(p => p !== active);

        function renderProv(p) {
          if (p.source === 'hand-crafted') {
            return '<p><span class="status-dot status-disconnected"></span> Hand-crafted YAML (not from a live system)</p>';
          }
          return '<p><span class="status-dot status-connected"></span> <strong>' + p.source + '</strong></p>' +
            '<p>Imported: ' + (p.importedAt ? new Date(p.importedAt).toLocaleString() : 'Unknown') + '</p>' +
            '<p>Tables: ' + (p.tablesImported || '?') + ' | Fields: ' + (p.fieldsImported || '?') + ' | Relationships: ' + (p.referencesFound || '?') + '</p>' +
            (p.constraintsDiscovered ? '<p>Constraints discovered: ' + p.constraintsDiscovered + '</p>' : '') +
            (p.discoveryEvidence ? p.discoveryEvidence.map(function(e) {
              return '<div style="font-size:0.85rem;padding:0.2rem 0;"><span class="badge ' +
                ({block:'badge-block',warn:'badge-warn',info:'badge-info'}[e.severity] || 'badge-info') +
                '">' + e.severity + '</span> ' + e.name + ' <span style="color:var(--text-secondary)">' + e.evidence + '</span></div>';
            }).join('') : '');
        }

        return '<div class="card" style="margin-top:1rem;">' +
          '<h2>Active Domain: ' + active.domainDir + '</h2>' +
          renderProv(active) +
          '</div>' +
          (others.length > 0
            ? '<details style="margin-top:0.75rem;"><summary style="cursor:pointer;color:var(--accent);font-weight:600;padding:0.5rem 0;">All domains (' + provenanceData.length + ')</summary>' +
              others.map(function(p) {
                return '<div class="card provenance-card" style="margin:0.75rem 0;"><h3>' + p.domainDir + '</h3>' + renderProv(p) + '</div>';
              }).join('') +
              '</details>'
            : '');
      })()}
    \`;
  }

  function getCredentials() {
    return {
      instanceUrl: document.getElementById('snow-url').value,
      username: document.getElementById('snow-user').value || undefined,
      password: document.getElementById('snow-pass').value || undefined,
      clientId: document.getElementById('snow-client-id').value || undefined,
      clientSecret: document.getElementById('snow-client-secret').value || undefined,
    };
  }

  async function updateStatus(constraintId, newStatus) {
    try {
      const res = await fetch('/api/constraints/' + encodeURIComponent(constraintId) + '/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        await loadDomain(currentDomain);
        showTab('constraints');
      }
    } catch (err) { console.error('Failed to update status:', err); }
  }

  async function updateSeverity(constraintId, newSeverity) {
    try {
      const res = await fetch('/api/constraints/' + encodeURIComponent(constraintId) + '/severity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ severity: newSeverity }),
      });
      if (res.ok) {
        await loadDomain(currentDomain);
        showTab('constraints');
      }
    } catch (err) { console.error('Failed to update severity:', err); }
  }

  async function testConnection() {
    const creds = getCredentials();
    const status = document.getElementById('connect-status');
    status.innerHTML = '<p style="color:var(--text-secondary);">Testing connection...</p>';

    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
      });
      const data = await res.json();
      if (data.success) {
        status.innerHTML = '<p><span class="status-dot status-connected"></span> <strong>Connected</strong> (' + data.authMode + '): ' + data.message + '</p>';
        document.getElementById('btn-import').disabled = false;
      } else {
        status.innerHTML = '<p><span class="status-dot status-disconnected"></span> <strong>Failed:</strong> ' + data.message + '</p>';
      }
    } catch (err) {
      status.innerHTML = '<p><span class="status-dot status-disconnected"></span> <strong>Error:</strong> ' + err + '</p>';
    }
  }

  async function runImport() {
    const creds = getCredentials();
    const status = document.getElementById('connect-status');
    const log = document.getElementById('connect-log');
    const btn = document.getElementById('btn-import');

    btn.disabled = true;
    btn.textContent = 'Running pipeline...';
    log.style.display = 'block';
    log.textContent = 'Starting full pipeline: import > sync > discover...\\n';
    status.innerHTML = '<p style="color:var(--text-secondary);">Running pipeline (this may take 30-60 seconds)...</p>';

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
      });
      const data = await res.json();
      if (data.success) {
        log.textContent += '\\nSchema Import:\\n';
        log.textContent += '   Tables: ' + data.import.tables + '\\n';
        log.textContent += '   Fields: ' + data.import.fields + '\\n';
        log.textContent += '   Relationships: ' + data.import.relationships + '\\n';
        log.textContent += '\\nEntity Sync:\\n';
        log.textContent += '   Entities synced: ' + data.sync.entities + '\\n';
        log.textContent += '   Errors: ' + data.sync.errors + '\\n';
        log.textContent += '\\nConstraint Discovery:\\n';
        log.textContent += '   Constraints found: ' + data.discovery.constraints + '\\n';
        data.discovery.evidence.forEach(e => {
          log.textContent += '   [' + e.severity + '] ' + e.name + ' - ' + e.evidence + '\\n';
        });
        log.textContent += '\\nPipeline complete. Switch domains in the dropdown to explore.';
        status.innerHTML = '<p><span class="status-dot status-connected"></span> <strong>Pipeline complete!</strong> Imported ' + data.import.tables + ' tables, synced ' + data.sync.entities + ' entities, discovered ' + data.discovery.constraints + ' constraints.</p>';

        // Refresh domain list
        const listRes = await fetch('/api/domains');
        allDomains = await listRes.json();
        const select = document.getElementById('domain-select');
        select.innerHTML = allDomains.map(d =>
          '<option value="' + d.name + '"' + (d.name === 'servicenow' ? ' selected' : '') + '>' + d.label + ' (' + d.entityTypeCount + ' types)</option>'
        ).join('');
        if (allDomains.find(d => d.name === 'servicenow')) {
          await switchDomain('servicenow');
        }
      } else {
        log.textContent += '\\n❌ Error: ' + data.error;
        status.innerHTML = '<p><span class="status-dot status-disconnected"></span> <strong>Pipeline failed:</strong> ' + data.error + '</p>';
      }
    } catch (err) {
      log.textContent += '\\n❌ Error: ' + err;
      status.innerHTML = '<p><span class="status-dot status-disconnected"></span> <strong>Error:</strong> ' + err + '</p>';
    }
    btn.disabled = false;
    btn.textContent = 'Import & Discover';
  }

  init();
</script>
</body>
</html>`;
}
