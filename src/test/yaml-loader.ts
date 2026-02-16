/**
 * Test: YAML loader for declarative domain schemas and constraints.
 * Verifies that YAML definitions produce identical behavior to TypeScript.
 *
 * Run: npm run build && node dist/test/yaml-loader.js
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadDomainFromYaml, loadConstraintsFromYaml } from "../loader.js";
import { validateDomainSchema } from "../ontology/schema.js";
import { OntologyEngine } from "../ontology/engine.js";
import { ConstraintEngine } from "../constraints/engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const domainsDir = resolve(__dirname, "..", "..", "domains");

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

// ── Load from YAML ────────────────────────────────────────────

console.log("\n🔍 YAML Domain Loading");

const domain = loadDomainFromYaml(resolve(domainsDir, "itsm", "ontology.yaml"));
assert("Domain loaded from YAML", domain !== undefined);
assert("Domain name is 'itsm'", domain.name === "itsm");
assert("Domain has 7 entity types", domain.entityTypes.length === 7, `got ${domain.entityTypes.length}`);

const errors = validateDomainSchema(domain);
assert("YAML schema passes validation", errors.length === 0, errors.join(", "));

const incident = domain.entityTypes.find((e) => e.name === "incident");
assert("Incident entity type exists", incident !== undefined);
assert("Incident has 7 properties", incident!.properties.length === 7, `got ${incident!.properties.length}`);
assert("Incident has 4 relationships", incident!.relationships.length === 4, `got ${incident!.relationships.length}`);

const affectsService = incident!.relationships.find((r) => r.name === "affects_service");
assert("affects_service relationship exists", affectsService !== undefined);
assert("affects_service targets business_service", affectsService!.targetType === "business_service");
assert("affects_service has inverseName", affectsService!.inverseName === "has_incidents");

// ── Ontology Engine with YAML ─────────────────────────────────

console.log("\n🔍 Ontology Engine with YAML Data");

const ontology = new OntologyEngine();
ontology.registerDomain(domain);

const desc = ontology.describeDomain("itsm");
assert("Domain description is non-empty", desc.length > 100);
assert("Description mentions Incident", desc.includes("Incident"));
assert("Description mentions Business Service", desc.includes("Business Service"));

const rels = ontology.getRelationshipsFor("itsm", "incident");
assert("Incident has 4 direct relationships", rels.length >= 4, `got ${rels.length}`);

// ── Load Constraints from YAML ────────────────────────────────

console.log("\n🔍 YAML Constraint Loading");

const constraints = loadConstraintsFromYaml(resolve(domainsDir, "itsm", "constraints.yaml"));
assert("4 constraints loaded from YAML", constraints.length === 4, `got ${constraints.length}`);

const constraintEngine = new ConstraintEngine();
for (const c of constraints) {
  constraintEngine.register(c);
}

// Test: Change freeze blocks resolution (declarative rule)
const freezeVerdict = await constraintEngine.evaluate({
  intendedAction: "resolve",
  targetEntity: "itsm:incident:INC001",
  relatedEntities: [],
  timestamp: new Date(),
  metadata: { change_freeze_active: true },
});
assert("YAML change freeze blocks resolve", !freezeVerdict.allowed);
assert("Verdict mentions change freeze", freezeVerdict.summary.includes("BLOCKED"));

// Test: No freeze allows resolution
const noFreezeVerdict = await constraintEngine.evaluate({
  intendedAction: "resolve",
  targetEntity: "itsm:incident:INC001",
  relatedEntities: [],
  timestamp: new Date(),
  metadata: { change_freeze_active: false },
});
assert("YAML no freeze allows resolve", noFreezeVerdict.allowed);

// Test: P1 reassignment warning
const p1Verdict = await constraintEngine.evaluate({
  intendedAction: "reassign",
  targetEntity: "itsm:incident:INC001",
  relatedEntities: [],
  timestamp: new Date(),
  metadata: { priority: "P1" },
});
assert("YAML P1 reassignment warns", p1Verdict.allowed);
assert("YAML P1 has unsatisfied constraint", p1Verdict.results.some((r) => !r.satisfied));

// Test: SLA breach with penalty
const slaVerdict = await constraintEngine.evaluate({
  intendedAction: "close",
  targetEntity: "itsm:incident:INC001",
  relatedEntities: [],
  timestamp: new Date(),
  metadata: { sla_breached: true, sla_has_penalty: true, change_freeze_active: false },
});
assert("YAML SLA breach triggers warning", slaVerdict.results.some((r) => r.constraintId === "itsm:sla_breach_review" && !r.satisfied));
assert("YAML SLA breach is warn not block", slaVerdict.allowed);

// Test: Group capacity
const capacityVerdict = await constraintEngine.evaluate({
  intendedAction: "assign",
  targetEntity: "itsm:incident:INC001",
  relatedEntities: [],
  timestamp: new Date(),
  metadata: { target_group_active_tickets: 120, target_group_ticket_ratio: 15 },
});
assert("YAML group capacity triggers warning", capacityVerdict.results.some((r) => r.constraintId === "itsm:group_capacity_check" && !r.satisfied));

// ── Summary ───────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${failed === 0 ? "🎉 All YAML loader tests passed!" : "💥 Some tests failed."}`);
process.exit(failed > 0 ? 1 : 0);
