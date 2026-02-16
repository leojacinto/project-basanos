#!/usr/bin/env node

/**
 * Basanos Dashboard — web UI for exploring the ontology,
 * constraints, and audit trail with light/dark mode toggle.
 *
 * Run: npm run dashboard
 */

import express from "express";
import { OntologyEngine } from "./ontology/engine.js";
import { ConstraintEngine } from "./constraints/engine.js";
import { validateDomainSchema } from "./ontology/schema.js";
import { itsmDomain } from "./domains/itsm/ontology.js";
import { itsmConstraints } from "./domains/itsm/constraints.js";
import { generateAgentCard } from "./a2a/types.js";

// ── Initialize engines ────────────────────────────────────────

const ontologyEngine = new OntologyEngine();
const constraintEngine = new ConstraintEngine();

const errors = validateDomainSchema(itsmDomain);
if (errors.length > 0) {
  console.error("Schema validation errors:", errors);
  process.exit(1);
}

ontologyEngine.registerDomain(itsmDomain);
for (const c of itsmConstraints) {
  constraintEngine.register(c);
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
    description: c.description,
  })));
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

// ── Serve Dashboard HTML ──────────────────────────────────────

app.get("/", (_req, res) => {
  res.type("html").send(dashboardHtml());
});

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, () => {
  console.log(`Basanos Dashboard running at http://localhost:${PORT}`);
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
  </style>
</head>
<body>
  <header>
    <h1>
      &#x1F0CF; Basanos
      <span class="subtitle">Semantic Ontology Dashboard</span>
    </h1>
    <button class="theme-toggle" onclick="toggleTheme()">
      <span id="theme-icon">&#x2600;&#xFE0F;</span>
      <span id="theme-label">Light</span>
    </button>
  </header>
  <nav>
    <button class="active" onclick="showTab('overview')">Overview</button>
    <button onclick="showTab('entities')">Entity Types</button>
    <button onclick="showTab('constraints')">Constraints</button>
    <button onclick="showTab('agent-card')">Agent Card</button>
    <button onclick="showTab('audit')">Audit Trail</button>
  </nav>
  <main>
    <div id="content">
      <div class="empty-state">Loading...</div>
    </div>
  </main>

<script>
  let domainData = null;
  let constraintData = null;
  let agentCardData = null;
  let currentTab = 'overview';

  async function init() {
    const [domainRes, constraintRes, cardRes] = await Promise.all([
      fetch('/api/domains/itsm'),
      fetch('/api/domains/itsm/constraints'),
      fetch('/api/agent-card'),
    ]);
    domainData = await domainRes.json();
    constraintData = await constraintRes.json();
    agentCardData = await cardRes.json();
    showTab('overview');
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

  function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll('nav button').forEach((b, i) => {
      const tabs = ['overview', 'entities', 'constraints', 'agent-card', 'audit'];
      b.classList.toggle('active', tabs[i] === tab);
    });
    const el = document.getElementById('content');
    switch (tab) {
      case 'overview': renderOverview(el); break;
      case 'entities': renderEntities(el); break;
      case 'constraints': renderConstraints(el); break;
      case 'agent-card': renderAgentCard(el); break;
      case 'audit': renderAudit(el); break;
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
    \`;
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
    const res = await fetch(\`/api/domains/itsm/entities/\${typeName}\`);
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
    el.innerHTML = \`
      <div>
        \${constraintData.map(c => \`
          <div class="card">
            <h2>
              \${c.name}
              <span class="badge \${{block:'badge-block',warn:'badge-warn',info:'badge-info'}[c.severity]}">\${c.severity.toUpperCase()}</span>
            </h2>
            <p>\${c.description}</p>
            <div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
              <span style="font-size:0.8rem;color:var(--text-secondary);">Applies to:</span>
              \${c.appliesTo.map(a => '<span class="badge badge-type">' + a + '</span>').join('')}
              <span style="font-size:0.8rem;color:var(--text-secondary);margin-left:0.5rem;">Actions:</span>
              \${c.relevantActions.map(a => '<span class="badge badge-info">' + a + '</span>').join('')}
            </div>
          </div>
        \`).join('')}
      </div>
    \`;
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

  init();
</script>
</body>
</html>`;
}
