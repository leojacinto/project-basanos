/**
 * Smoke test for Basanos engines.
 * Run: npm run build && node dist/test/smoke.js
 */

import { OntologyEngine } from "../ontology/engine.js";
import { ConstraintEngine } from "../constraints/engine.js";
import { validateDomainSchema } from "../ontology/schema.js";
import { itsmDomain } from "../domains/itsm/ontology.js";
import { itsmConstraints } from "../domains/itsm/constraints.js";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── Schema Validation ─────────────────────────────────────────

console.log("\n🔍 Schema Validation");

const errors = validateDomainSchema(itsmDomain);
assert("ITSM schema has no validation errors", errors.length === 0, errors.join(", "));

// ── Ontology Engine ───────────────────────────────────────────

console.log("\n🔍 Ontology Engine");

const ontology = new OntologyEngine();
ontology.registerDomain(itsmDomain);

const domains = ontology.getDomains();
assert("Domain registered", domains.length === 1);
assert("Domain name is 'itsm'", domains[0].name === "itsm");

const incident = ontology.getEntityType("itsm", "incident");
assert("Can retrieve 'incident' entity type", incident !== undefined);
assert(
  "Incident has expected properties",
  incident!.properties.length === 7,
  `got ${incident!.properties.length}`
);
assert(
  "Incident has 4 relationships",
  incident!.relationships.length === 4,
  `got ${incident!.relationships.length}`
);

const bizService = ontology.getEntityType("itsm", "business_service");
assert("Can retrieve 'business_service' entity type", bizService !== undefined);

const unknownType = ontology.getEntityType("itsm", "nonexistent");
assert("Unknown entity type returns undefined", unknownType === undefined);

const incidentRels = ontology.getRelationshipsFor("itsm", "incident");
assert(
  "Incident relationships include direct ones",
  incidentRels.some((r) => r.name === "affects_service")
);

const ciRels = ontology.getRelationshipsFor("itsm", "configuration_item");
assert(
  "CI has inverse relationships from incidents",
  ciRels.some((r) => r.name === "has_incidents")
);

// ── Domain Description ────────────────────────────────────────

console.log("\n🔍 Domain Description");

const description = ontology.describeDomain("itsm");
assert("Description is non-empty", description.length > 0);
assert(
  "Description mentions entity types",
  description.includes("Incident") && description.includes("Business Service")
);
assert("Unknown domain handled", ontology.describeDomain("fake").includes("Unknown domain"));

// ── Entity Storage & Traversal ────────────────────────────────

console.log("\n🔍 Entity Storage & Traversal");

ontology.addEntity({
  id: "itsm:incident:INC001",
  type: "incident",
  domain: "itsm",
  properties: { number: "INC001", priority: "P1", state: "new" },
  relationships: { affects_service: ["itsm:business_service:SVC001"] },
});

ontology.addEntity({
  id: "itsm:business_service:SVC001",
  type: "business_service",
  domain: "itsm",
  properties: { name: "Email Service", criticality: "critical" },
  relationships: { governed_by_sla: ["itsm:sla_contract:SLA001"] },
});

ontology.addEntity({
  id: "itsm:sla_contract:SLA001",
  type: "sla_contract",
  domain: "itsm",
  properties: { name: "Email SLA P1", response_time_minutes: 15, has_penalty: true },
  relationships: {},
});

const entity = ontology.getEntity("itsm:incident:INC001");
assert("Can retrieve stored entity", entity !== undefined);
assert("Entity has correct type", entity!.type === "incident");

const graph = ontology.traverse("itsm:incident:INC001", 2);
assert("Traversal finds 3 entities at depth 2", graph.size === 3, `got ${graph.size}`);
assert("Traversal includes SLA via service", graph.has("itsm:sla_contract:SLA001"));

const shallowGraph = ontology.traverse("itsm:incident:INC001", 1);
assert("Depth-1 traversal finds 2 entities", shallowGraph.size === 2, `got ${shallowGraph.size}`);

// ── Constraint Engine ─────────────────────────────────────────

console.log("\n🔍 Constraint Engine");

const constraints = new ConstraintEngine();
for (const c of itsmConstraints) {
  constraints.register(c);
}

assert(
  "4 ITSM constraints registered",
  constraints.getConstraints("itsm").length === 4,
  `got ${constraints.getConstraints("itsm").length}`
);

// Test: Change freeze blocks resolution
const freezeVerdict = await constraints.evaluate({
  intendedAction: "resolve",
  targetEntity: "itsm:incident:INC001",
  relatedEntities: [],
  timestamp: new Date(),
  metadata: { change_freeze_active: true },
});
assert("Change freeze blocks resolve action", !freezeVerdict.allowed);
assert(
  "Verdict summary mentions BLOCKED",
  freezeVerdict.summary.includes("BLOCKED")
);

// Test: No freeze allows resolution
const noFreezeVerdict = await constraints.evaluate({
  intendedAction: "resolve",
  targetEntity: "itsm:incident:INC001",
  relatedEntities: [],
  timestamp: new Date(),
  metadata: { change_freeze_active: false },
});
assert("No freeze allows resolve action", noFreezeVerdict.allowed);

// Test: P1 reassignment warning
const p1Verdict = await constraints.evaluate({
  intendedAction: "reassign",
  targetEntity: "itsm:incident:INC001",
  relatedEntities: [],
  timestamp: new Date(),
  metadata: { priority: "P1" },
});
assert("P1 reassignment is allowed (warn, not block)", p1Verdict.allowed);
assert(
  "P1 reassignment has warnings",
  p1Verdict.results.some((r) => !r.satisfied)
);

// Test: Group capacity overload
const overloadVerdict = await constraints.evaluate({
  intendedAction: "assign",
  targetEntity: "itsm:incident:INC001",
  relatedEntities: [],
  timestamp: new Date(),
  metadata: { target_group_active_tickets: 120, target_group_member_count: 5 },
});
assert(
  "Overloaded group triggers warning",
  overloadVerdict.results.some((r) => r.constraintId === "itsm:group_capacity_check" && !r.satisfied)
);

// Test: SLA breach with penalty
const slaVerdict = await constraints.evaluate({
  intendedAction: "close",
  targetEntity: "itsm:incident:INC001",
  relatedEntities: [],
  timestamp: new Date(),
  metadata: { sla_breached: true, sla_has_penalty: true, change_freeze_active: false },
});
assert(
  "SLA breach with penalty triggers review warning",
  slaVerdict.results.some((r) => r.constraintId === "itsm:sla_breach_review" && !r.satisfied)
);
assert("SLA breach is warn, not block (still allowed)", slaVerdict.allowed);

// Test: No constraints for unknown action
const noConstraints = await constraints.evaluate({
  intendedAction: "totally_unknown_action",
  targetEntity: "itsm:incident:INC001",
  relatedEntities: [],
  timestamp: new Date(),
  metadata: {},
});
assert("Unknown action has no applicable constraints", noConstraints.results.length === 0);
assert("Unknown action is allowed", noConstraints.allowed);

// ── Constraint Descriptions ───────────────────────────────────

console.log("\n🔍 Constraint Descriptions");

const constraintDesc = constraints.describeConstraints("itsm");
assert("Constraint description is non-empty", constraintDesc.length > 0);
assert(
  "Description mentions change freeze",
  constraintDesc.includes("Change Freeze")
);
assert(
  "Unknown domain handled",
  constraints.describeConstraints("fake").includes("No constraints")
);

// ── Summary ───────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${failed === 0 ? "🎉 All tests passed!" : "💥 Some tests failed."}`);
process.exit(failed > 0 ? 1 : 0);
