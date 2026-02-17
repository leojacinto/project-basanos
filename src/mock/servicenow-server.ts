#!/usr/bin/env node

/**
 * Mock ServiceNow REST API Server
 *
 * Simulates a ServiceNow instance with realistic ITSM data
 * for testing Basanos without a live environment.
 *
 * Run: npm run mock-snow
 */

import express from "express";

const app = express();
app.use(express.json());

// ── Mock Data ─────────────────────────────────────────────────

const GROUPS = [
  { sys_id: "grp001", name: "Infrastructure Operations", type: "operations" },
  { sys_id: "grp002", name: "Database Team", type: "engineering" },
  { sys_id: "grp003", name: "Network Operations", type: "operations" },
  { sys_id: "grp004", name: "Application Support", type: "operations" },
  { sys_id: "grp005", name: "Service Desk", type: "operations" },
];

const CIS = [
  { sys_id: "ci001", name: "mail-server-prod-01", sys_class_name: "cmdb_ci_server", environment: "production", operational_status: "1" },
  { sys_id: "ci002", name: "db-cluster-prod-03", sys_class_name: "cmdb_ci_database", environment: "production", operational_status: "6" },
  { sys_id: "ci003", name: "api-gateway-prod", sys_class_name: "cmdb_ci_app_server", environment: "production", operational_status: "1" },
  { sys_id: "ci004", name: "web-frontend-prod", sys_class_name: "cmdb_ci_app_server", environment: "production", operational_status: "1" },
  { sys_id: "ci005", name: "load-balancer-01", sys_class_name: "cmdb_ci_netgear", environment: "production", operational_status: "1" },
];

const SERVICES = [
  { sys_id: "svc001", name: "Corporate Email Service", busines_criticality: "1", operational_status: "4", owned_by: { value: "grp001", display_value: "Infrastructure Operations" } },
  { sys_id: "svc002", name: "Customer Portal", busines_criticality: "1", operational_status: "1", owned_by: { value: "grp004", display_value: "Application Support" } },
  { sys_id: "svc003", name: "ERP Production", busines_criticality: "2", operational_status: "1", owned_by: { value: "grp002", display_value: "Database Team" } },
];

const INCIDENTS = [
  {
    sys_id: "inc001", number: "INC0099001", short_description: "Email service down",
    state: { value: "1", display_value: "New" },
    priority: { value: "1", display_value: "1 - Critical" },
    impact: { value: "1", display_value: "1 - High" },
    urgency: { value: "1", display_value: "1 - High" },
    opened_at: "2026-02-17 03:00:00",
    business_service: { value: "svc001", display_value: "Corporate Email Service" },
    cmdb_ci: { value: "ci001", display_value: "mail-server-prod-01" },
    assignment_group: { value: "grp001", display_value: "Infrastructure Operations" },
    problem_id: "",
    reassignment_count: "0",
  },
  {
    sys_id: "inc002", number: "INC0099002", short_description: "Customer portal slow response",
    state: { value: "2", display_value: "In Progress" },
    priority: { value: "2", display_value: "2 - High" },
    impact: { value: "2", display_value: "2 - Medium" },
    urgency: { value: "1", display_value: "1 - High" },
    opened_at: "2026-02-17 02:15:00",
    business_service: { value: "svc002", display_value: "Customer Portal" },
    cmdb_ci: { value: "ci003", display_value: "api-gateway-prod" },
    assignment_group: { value: "grp004", display_value: "Application Support" },
    problem_id: "",
    reassignment_count: "2",
  },
  {
    sys_id: "inc003", number: "INC0099003", short_description: "Database connection pool exhausted",
    state: { value: "2", display_value: "In Progress" },
    priority: { value: "1", display_value: "1 - Critical" },
    impact: { value: "1", display_value: "1 - High" },
    urgency: { value: "1", display_value: "1 - High" },
    opened_at: "2026-02-17 01:30:00",
    business_service: { value: "svc003", display_value: "ERP Production" },
    cmdb_ci: { value: "ci002", display_value: "db-cluster-prod-03" },
    assignment_group: { value: "grp002", display_value: "Database Team" },
    problem_id: "",
    reassignment_count: "1",
  },
];

const CHANGES = [
  {
    sys_id: "chg001", number: "CHG0005001", type: { value: "normal", display_value: "Normal" },
    state: { value: "-5", display_value: "New" },
    risk: { value: "moderate", display_value: "Moderate" },
    start_date: "2026-02-17 00:00:00", end_date: "2026-02-18 06:00:00",
    assignment_group: { value: "grp001", display_value: "Infrastructure Operations" },
  },
];

const PROBLEMS = [
  {
    sys_id: "prb001", number: "PRB0001001",
    state: { value: "2", display_value: "Root Cause Analysis" },
    known_error: "false",
    cmdb_ci: { value: "ci002", display_value: "db-cluster-prod-03" },
    assignment_group: { value: "grp002", display_value: "Database Team" },
  },
];

const SLA_RECORDS = [
  { sys_id: "sla001", task: { value: "inc001" }, sla: { display_value: "P1 Resolution" }, has_breached: "true", business_percentage: "150" },
  { sys_id: "sla002", task: { value: "inc003" }, sla: { display_value: "P1 Resolution" }, has_breached: "false", business_percentage: "45" },
];

const DICTIONARY: Record<string, Array<Record<string, string>>> = {
  incident: [
    { name: "incident", element: "number", column_label: "Number", internal_type: "string", mandatory: "true", reference: "", choice: "0", max_length: "40", comments: "Unique incident identifier" },
    { name: "incident", element: "short_description", column_label: "Short Description", internal_type: "string", mandatory: "true", reference: "", choice: "0", max_length: "160", comments: "Brief summary" },
    { name: "incident", element: "state", column_label: "State", internal_type: "integer", mandatory: "true", reference: "", choice: "1", max_length: "40", comments: "Incident lifecycle state" },
    { name: "incident", element: "priority", column_label: "Priority", internal_type: "integer", mandatory: "true", reference: "", choice: "1", max_length: "40", comments: "Priority derived from impact and urgency" },
    { name: "incident", element: "impact", column_label: "Impact", internal_type: "integer", mandatory: "true", reference: "", choice: "1", max_length: "40", comments: "Business impact" },
    { name: "incident", element: "urgency", column_label: "Urgency", internal_type: "integer", mandatory: "true", reference: "", choice: "1", max_length: "40", comments: "Resolution urgency" },
    { name: "incident", element: "opened_at", column_label: "Opened", internal_type: "glide_date_time", mandatory: "true", reference: "", choice: "0", max_length: "40", comments: "When the incident was created" },
    { name: "incident", element: "business_service", column_label: "Business Service", internal_type: "reference", mandatory: "false", reference: "cmdb_ci_service", choice: "0", max_length: "32", comments: "Affected business service" },
    { name: "incident", element: "cmdb_ci", column_label: "Configuration Item", internal_type: "reference", mandatory: "false", reference: "cmdb_ci", choice: "0", max_length: "32", comments: "Affected CI" },
    { name: "incident", element: "assignment_group", column_label: "Assignment Group", internal_type: "reference", mandatory: "false", reference: "sys_user_group", choice: "0", max_length: "32", comments: "Assigned team" },
    { name: "incident", element: "problem_id", column_label: "Problem", internal_type: "reference", mandatory: "false", reference: "problem", choice: "0", max_length: "32", comments: "Related problem record" },
  ],
  cmdb_ci: [
    { name: "cmdb_ci", element: "name", column_label: "Name", internal_type: "string", mandatory: "true", reference: "", choice: "0", max_length: "255", comments: "CI name" },
    { name: "cmdb_ci", element: "sys_class_name", column_label: "Class", internal_type: "sys_class_name", mandatory: "false", reference: "", choice: "0", max_length: "80", comments: "CI class" },
    { name: "cmdb_ci", element: "environment", column_label: "Environment", internal_type: "string", mandatory: "false", reference: "", choice: "1", max_length: "40", comments: "Deployment environment" },
    { name: "cmdb_ci", element: "operational_status", column_label: "Operational Status", internal_type: "integer", mandatory: "false", reference: "", choice: "1", max_length: "40", comments: "Current status" },
  ],
  cmdb_ci_service: [
    { name: "cmdb_ci_service", element: "name", column_label: "Name", internal_type: "string", mandatory: "true", reference: "", choice: "0", max_length: "255", comments: "Service name" },
    { name: "cmdb_ci_service", element: "busines_criticality", column_label: "Business Criticality", internal_type: "integer", mandatory: "false", reference: "", choice: "1", max_length: "40", comments: "Criticality level" },
    { name: "cmdb_ci_service", element: "operational_status", column_label: "Operational Status", internal_type: "integer", mandatory: "false", reference: "", choice: "1", max_length: "40", comments: "Current status" },
    { name: "cmdb_ci_service", element: "owned_by", column_label: "Owned By", internal_type: "reference", mandatory: "false", reference: "sys_user_group", choice: "0", max_length: "32", comments: "Owning group" },
  ],
  change_request: [
    { name: "change_request", element: "number", column_label: "Number", internal_type: "string", mandatory: "true", reference: "", choice: "0", max_length: "40", comments: "Change number" },
    { name: "change_request", element: "type", column_label: "Type", internal_type: "string", mandatory: "false", reference: "", choice: "1", max_length: "40", comments: "Change type" },
    { name: "change_request", element: "state", column_label: "State", internal_type: "integer", mandatory: "true", reference: "", choice: "1", max_length: "40", comments: "Change state" },
    { name: "change_request", element: "risk", column_label: "Risk", internal_type: "string", mandatory: "false", reference: "", choice: "1", max_length: "40", comments: "Risk level" },
    { name: "change_request", element: "start_date", column_label: "Planned Start", internal_type: "glide_date_time", mandatory: "false", reference: "", choice: "0", max_length: "40", comments: "Planned start" },
    { name: "change_request", element: "end_date", column_label: "Planned End", internal_type: "glide_date_time", mandatory: "false", reference: "", choice: "0", max_length: "40", comments: "Planned end" },
    { name: "change_request", element: "assignment_group", column_label: "Assignment Group", internal_type: "reference", mandatory: "false", reference: "sys_user_group", choice: "0", max_length: "32", comments: "Requesting group" },
  ],
  problem: [
    { name: "problem", element: "number", column_label: "Number", internal_type: "string", mandatory: "true", reference: "", choice: "0", max_length: "40", comments: "Problem number" },
    { name: "problem", element: "state", column_label: "State", internal_type: "integer", mandatory: "true", reference: "", choice: "1", max_length: "40", comments: "Problem state" },
    { name: "problem", element: "known_error", column_label: "Known Error", internal_type: "boolean", mandatory: "false", reference: "", choice: "0", max_length: "40", comments: "Is known error" },
    { name: "problem", element: "cmdb_ci", column_label: "Configuration Item", internal_type: "reference", mandatory: "false", reference: "cmdb_ci", choice: "0", max_length: "32", comments: "Root cause CI" },
    { name: "problem", element: "assignment_group", column_label: "Assignment Group", internal_type: "reference", mandatory: "false", reference: "sys_user_group", choice: "0", max_length: "32", comments: "Investigating team" },
  ],
  sys_user_group: [
    { name: "sys_user_group", element: "name", column_label: "Name", internal_type: "string", mandatory: "true", reference: "", choice: "0", max_length: "80", comments: "Group name" },
    { name: "sys_user_group", element: "type", column_label: "Type", internal_type: "string", mandatory: "false", reference: "", choice: "1", max_length: "40", comments: "Group type" },
  ],
};

const CHOICES: Record<string, Record<string, Array<{ value: string; label: string }>>> = {
  incident: {
    state: [
      { value: "1", label: "New" }, { value: "2", label: "In Progress" },
      { value: "3", label: "On Hold" }, { value: "6", label: "Resolved" },
      { value: "7", label: "Closed" }, { value: "8", label: "Cancelled" },
    ],
    priority: [
      { value: "1", label: "1 - Critical" }, { value: "2", label: "2 - High" },
      { value: "3", label: "3 - Moderate" }, { value: "4", label: "4 - Low" },
      { value: "5", label: "5 - Planning" },
    ],
    impact: [
      { value: "1", label: "1 - High" }, { value: "2", label: "2 - Medium" },
      { value: "3", label: "3 - Low" },
    ],
    urgency: [
      { value: "1", label: "1 - High" }, { value: "2", label: "2 - Medium" },
      { value: "3", label: "3 - Low" },
    ],
  },
};

const TABLES: Record<string, Array<Record<string, unknown>>> = {
  incident: INCIDENTS,
  cmdb_ci: CIS,
  cmdb_ci_service: SERVICES,
  change_request: CHANGES,
  problem: PROBLEMS,
  sys_user_group: GROUPS,
  task_sla: SLA_RECORDS,
};

// ── Basic Auth Middleware ──────────────────────────────────────

function checkAuth(req: express.Request, res: express.Response): boolean {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) {
    res.status(401).json({ error: { message: "Authentication required" } });
    return false;
  }
  return true;
}

// ── Table API ─────────────────────────────────────────────────

function handleTableQuery(req: express.Request, res: express.Response, sysId?: string) {
  if (!checkAuth(req, res)) return;

  const tableName = req.params.tableName as string;

  // Dictionary query (handle before TABLES check)
  if (tableName === "sys_dictionary") {
    const query = (req.query.sysparm_query as string) || "";
    const nameMatch = query.match(/name=(\w+)/);
    if (nameMatch) {
      const targetTable = nameMatch[1];
      const dict = DICTIONARY[targetTable] || [];
      return res.json({ result: dict });
    }
    return res.json({ result: [] });
  }

  // Choice query
  if (tableName === "sys_choice") {
    const query = (req.query.sysparm_query as string) || "";
    const nameMatch = query.match(/name=(\w+)/);
    const elementMatch = query.match(/element=(\w+)/);
    if (nameMatch && elementMatch) {
      const choices = CHOICES[nameMatch[1]]?.[elementMatch[1]] || [];
      return res.json({ result: choices });
    }
    return res.json({ result: [] });
  }

  // General table query
  const records = TABLES[tableName as keyof typeof TABLES];
  if (!records) {
    return res.status(404).json({ error: { message: `Table ${tableName} not found` } });
  }

  if (sysId) {
    const record = records.find((r: Record<string, unknown>) => r.sys_id === sysId);
    if (!record) return res.status(404).json({ error: { message: "Record not found" } });
    return res.json({ result: record });
  }

  const limit = parseInt((req.query.sysparm_limit as string) || "100", 10);
  const offset = parseInt((req.query.sysparm_offset as string) || "0", 10);
  const sliced = records.slice(offset, offset + limit);

  return res.json({ result: sliced });
}

app.get("/api/now/table/:tableName/:sysId", (req, res) => {
  handleTableQuery(req, res, req.params.sysId);
});

app.get("/api/now/table/:tableName", (req, res) => {
  handleTableQuery(req, res);
});

// ── Properties endpoint (for connection test) ─────────────────

app.get("/api/now/table/sys_properties", (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json({ result: [{ sys_id: "mock_property", name: "mock", value: "true" }] });
});

// ── Root route (browser-friendly status) ──────────────────────

app.get("/", (_req, res) => {
  res.type("html").send(`
    <html><body style="font-family:system-ui;max-width:600px;margin:2rem auto;color:#333;">
      <h1>Mock ServiceNow Server</h1>
      <p style="color:green;font-weight:bold;">&#10003; Running and ready for Basanos</p>
      <p>This server simulates a ServiceNow REST API. It is consumed by the Basanos CLI pipeline, not by a browser.</p>
      <h3>Available tables</h3>
      <ul>${Object.keys(TABLES).map(t => `<li>${t} (${(TABLES[t as keyof typeof TABLES] as unknown[]).length} records)</li>`).join("")}</ul>
      <h3>How to use</h3>
      <pre style="background:#f4f4f4;padding:1rem;border-radius:4px;">npm run demo   # runs mock + pipeline + dashboard together</pre>
    </body></html>
  `);
});

// ── Start ─────────────────────────────────────────────────────

const PORT = parseInt(process.env.MOCK_SNOW_PORT || "8090", 10);
app.listen(PORT, () => {
  console.log(`Mock ServiceNow server running at http://localhost:${PORT}`);
  console.log(`  Auth: any Basic auth accepted`);
  console.log(`  Tables: ${Object.keys(TABLES).join(", ")}`);
  console.log(`  Incidents: ${INCIDENTS.length}, CIs: ${CIS.length}, Services: ${SERVICES.length}`);
});
