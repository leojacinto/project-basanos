/**
 * Autonomous Agent Scenario: 3am Incident Resolution
 *
 * Demonstrates the difference between an agent operating
 * with Basanos vs without. This is the core value proposition.
 *
 * Run: npm run build && node dist/test/scenario-autonomous.js
 */

import { OntologyEngine } from "../ontology/engine.js";
import { ConstraintEngine } from "../constraints/engine.js";
import { itsmDomain } from "../domains/itsm/ontology.js";
import { itsmConstraints } from "../domains/itsm/constraints.js";

// ── Setup ─────────────────────────────────────────────────────

const ontology = new OntologyEngine();
const constraints = new ConstraintEngine();

ontology.registerDomain(itsmDomain);
for (const c of itsmConstraints) {
  constraints.register(c);
}

// Populate a realistic entity graph
ontology.addEntity({
  id: "itsm:incident:INC0099001",
  type: "incident",
  domain: "itsm",
  properties: {
    number: "INC0099001",
    short_description: "Email service down",
    state: "new",
    priority: "P1",
    impact: "high",
    urgency: "high",
    opened_at: new Date("2026-02-17T03:00:00Z"),
  },
  relationships: {
    affects_service: ["itsm:business_service:SVC-EMAIL"],
    affects_ci: ["itsm:configuration_item:CI-MAIL-01"],
    assigned_to_group: ["itsm:assignment_group:GRP-INFRA"],
  },
});

ontology.addEntity({
  id: "itsm:business_service:SVC-EMAIL",
  type: "business_service",
  domain: "itsm",
  properties: {
    name: "Corporate Email Service",
    criticality: "critical",
    operational_status: "outage",
  },
  relationships: {
    governed_by_sla: ["itsm:sla_contract:SLA-EMAIL-P1"],
    depends_on: ["itsm:configuration_item:CI-MAIL-01"],
    owned_by: ["itsm:assignment_group:GRP-MESSAGING"],
  },
});

ontology.addEntity({
  id: "itsm:configuration_item:CI-MAIL-01",
  type: "configuration_item",
  domain: "itsm",
  properties: {
    name: "mail-server-prod-01",
    ci_class: "application",
    environment: "production",
    operational_status: "non_operational",
  },
  relationships: {
    depends_on: ["itsm:configuration_item:CI-DB-CLUSTER"],
  },
});

ontology.addEntity({
  id: "itsm:configuration_item:CI-DB-CLUSTER",
  type: "configuration_item",
  domain: "itsm",
  properties: {
    name: "db-cluster-prod-03",
    ci_class: "cluster",
    environment: "production",
    operational_status: "under_maintenance",
  },
  relationships: {},
});

ontology.addEntity({
  id: "itsm:sla_contract:SLA-EMAIL-P1",
  type: "sla_contract",
  domain: "itsm",
  properties: {
    name: "Email P1 SLA",
    response_time_minutes: 15,
    resolution_time_minutes: 60,
    applies_to_priority: "P1",
    has_penalty: true,
  },
  relationships: {},
});

ontology.addEntity({
  id: "itsm:assignment_group:GRP-INFRA",
  type: "assignment_group",
  domain: "itsm",
  properties: {
    name: "Infrastructure Operations",
    type: "operations",
    active_member_count: 3,
  },
  relationships: {},
});

// ── Scenario: Agent WITHOUT Basanos ───────────────────────────

console.log("═".repeat(60));
console.log("SCENARIO: 3am P1 Incident — Email Service Down");
console.log("═".repeat(60));

console.log("\n--- Agent WITHOUT Basanos ---\n");
console.log("Agent receives: INC0099001 - P1 - 'Email service down'");
console.log("Agent queries ServiceNow MCP: gets flat incident record");
console.log("Agent sees: P1, state=new, short_description='Email service down'");
console.log("Agent reasons: 'This is P1, I should resolve it quickly'");
console.log("Agent action: Attempts to restart email service");
console.log("");
console.log("Problems the agent didn't know about:");
console.log("  ❌ Change freeze started at midnight (not in incident record)");
console.log("  ❌ Email SLA has a $50K/hour penalty clause");
console.log("  ❌ Mail server depends on db-cluster-prod-03");
console.log("  ❌ db-cluster-prod-03 is UNDER MAINTENANCE");
console.log("  ❌ Infrastructure Ops has only 3 people on a 3am shift");
console.log("");
console.log("Result: Restart fails (DB under maintenance). SLA breach");
console.log("        undocumented. Change freeze violated. No audit trail.");

// ── Scenario: Agent WITH Basanos ──────────────────────────────

console.log("\n--- Agent WITH Basanos ---\n");

// Step 1: Agent understands the domain
console.log("Step 1: Agent reads the ITSM ontology");
const domainDesc = ontology.describeDomain("itsm");
console.log(`  → Received ${domainDesc.split("\n").length} lines of semantic context`);
console.log("  → Knows entity types, relationships, and their meanings\n");

// Step 2: Agent traverses the entity graph
console.log("Step 2: Agent traverses the incident's relationship graph");
const graph = ontology.traverse("itsm:incident:INC0099001", 3);
console.log(`  → Discovered ${graph.size} connected entities:`);
for (const [id, { entity, depth }] of graph) {
  const name =
    (entity.properties["name"] as string) ||
    (entity.properties["number"] as string) ||
    id;
  console.log(`    depth ${depth}: ${entity.type} — ${name}`);
}

// Step 3: Agent discovers the dependency chain
console.log("\nStep 3: Agent reads the dependency chain");
const mailServer = ontology.getEntity("itsm:configuration_item:CI-MAIL-01");
const dbCluster = ontology.getEntity("itsm:configuration_item:CI-DB-CLUSTER");
console.log(`  → ${mailServer!.properties["name"]} depends on ${dbCluster!.properties["name"]}`);
console.log(`  → ${dbCluster!.properties["name"]} status: ${dbCluster!.properties["operational_status"]}`);
console.log("  → Resolution via restart will FAIL (upstream dependency under maintenance)");

// Step 4: Agent checks constraints before acting
console.log("\nStep 4: Agent checks constraints before resolving");
const verdict = await constraints.evaluate({
  intendedAction: "resolve",
  targetEntity: "itsm:incident:INC0099001",
  relatedEntities: ["itsm:business_service:SVC-EMAIL"],
  timestamp: new Date("2026-02-17T03:15:00Z"),
  metadata: {
    change_freeze_active: true,
    priority: "P1",
    sla_breached: true,
    sla_has_penalty: true,
    target_group_active_tickets: 45,
    target_group_member_count: 3,
  },
});

console.log(`  → Verdict: ${verdict.allowed ? "ALLOWED" : "BLOCKED"}`);
for (const result of verdict.results) {
  const icon = result.satisfied ? "✅" : (result.severity === "block" ? "🛑" : "⚠️");
  console.log(`  ${icon} ${result.explanation}`);
}

// Step 5: Agent makes the correct decision
console.log("\nStep 5: Agent decision");
if (!verdict.allowed) {
  console.log("  → Do NOT attempt resolution");
  console.log("  → Escalate to human on-call with full context:");
  console.log("    • Change freeze is active (blocked by constraint)");
  console.log("    • Upstream dependency (db-cluster-prod-03) under maintenance");

  const sla = ontology.getEntity("itsm:sla_contract:SLA-EMAIL-P1");
  console.log(`    • SLA: ${sla!.properties["name"]} — ${sla!.properties["resolution_time_minutes"]}min resolution, penalty clause active`);
  console.log("    • Assignment group at 15:1 ticket/member ratio");
}

console.log(`\n${"═".repeat(60)}`);
console.log("OUTCOME COMPARISON");
console.log("═".repeat(60));
console.log("");
console.log("Without Basanos:");
console.log("  → Failed restart, SLA breach, change freeze violation");
console.log("  → No audit trail, no documentation");
console.log("  → Post-mortem: 'the agent had no architectural awareness'");
console.log("");
console.log("With Basanos:");
console.log("  → Correct escalation, all constraints respected");
console.log("  → Full audit: entity graph, constraint verdicts, reasoning chain");
console.log("  → The ontology was the human judgment, encoded");
console.log("");
