/**
 * Constraint Discovery — analyzes live ServiceNow data patterns
 * and suggests business logic constraints.
 *
 * This doesn't replace human judgment. It identifies patterns
 * in the data that likely represent unstated business rules,
 * then generates candidate constraint YAML for review.
 */

import { writeFileSync, existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { dump as yamlDump } from "js-yaml";
import type { ServiceNowConnector } from "./servicenow.js";

export interface DiscoveredConstraint {
  id: string;
  name: string;
  domain: string;
  appliesTo: string[];
  relevantActions: string[];
  severity: string;
  description: string;
  conditions: Array<{ field: string; operator: string; value: unknown }>;
  violationMessage: string;
  satisfiedMessage: string;
  evidence: string;
}

/**
 * Analyze incident patterns to discover potential constraints.
 */
async function discoverIncidentConstraints(
  connector: ServiceNowConnector
): Promise<DiscoveredConstraint[]> {
  const constraints: DiscoveredConstraint[] = [];

  // 1. Check for change freeze patterns (resolved incidents during freeze windows)
  console.log("  Analyzing change freeze patterns...");
  try {
    const recentChanges = await connector.queryTable("change_request", {
      query: "stateIN-5,3^ORDERBYDESCsys_created_on",
      fields: ["number", "state", "start_date", "end_date", "type"],
      limit: 10,
    });

    if (recentChanges.length > 0) {
      constraints.push({
        id: "discovered:change_freeze",
        name: "Active Change Freeze (Discovered)",
        domain: "itsm",
        appliesTo: ["incident"],
        relevantActions: ["resolve", "close", "auto_resolve"],
        severity: "block",
        description:
          `Found ${recentChanges.length} recent change requests. ` +
          "Incident resolution during active change windows should be blocked.",
        conditions: [{ field: "change_freeze_active", operator: "eq", value: true }],
        violationMessage:
          "An active change freeze is in effect. Escalate to change management.",
        satisfiedMessage: "No active change freeze detected.",
        evidence: `${recentChanges.length} change requests found in recent history`,
      });
    }
  } catch (err) {
    console.log("  ⚠️  Could not analyze change requests:", String(err).substring(0, 100));
  }

  // 2. Analyze P1 incident handling patterns
  console.log("  Analyzing P1 incident patterns...");
  try {
    const p1Incidents = await connector.queryTable("incident", {
      query: "priority=1^stateIN1,2,3",
      fields: ["number", "priority", "state", "assignment_group", "reassignment_count"],
      limit: 50,
    });

    const reassigned = p1Incidents.filter((i) => {
      const count = parseInt(String(i.reassignment_count ?? "0"), 10);
      return count > 0;
    });

    if (p1Incidents.length > 0) {
      const reassignRate = reassigned.length / p1Incidents.length;
      constraints.push({
        id: "discovered:p1_reassignment",
        name: "P1 Reassignment Caution (Discovered)",
        domain: "itsm",
        appliesTo: ["incident"],
        relevantActions: ["reassign"],
        severity: "warn",
        description:
          `${Math.round(reassignRate * 100)}% of active P1 incidents have been reassigned. ` +
          "P1 reassignment disrupts war rooms and escalation chains.",
        conditions: [{ field: "priority", operator: "eq", value: "P1" }],
        violationMessage:
          "This is a P1 incident. Confirm with incident commander before reassigning.",
        satisfiedMessage: "Standard reassignment procedures apply.",
        evidence:
          `${p1Incidents.length} active P1s, ${reassigned.length} reassigned ` +
          `(${Math.round(reassignRate * 100)}% rate)`,
      });
    }
  } catch (err) {
    console.log("  ⚠️  Could not analyze P1 incidents:", String(err).substring(0, 100));
  }

  // 3. Analyze group workload distribution
  console.log("  Analyzing group workload...");
  try {
    const groupIncidents = await connector.queryTable("incident", {
      query: "stateIN1,2,3^assignment_groupISNOTEMPTY",
      fields: ["assignment_group"],
      limit: 500,
    });

    const groupCounts: Record<string, number> = {};
    for (const inc of groupIncidents) {
      const group = String(
        typeof inc.assignment_group === "object" && inc.assignment_group !== null
          ? (inc.assignment_group as Record<string, unknown>).display_value ?? "unknown"
          : inc.assignment_group ?? "unknown"
      );
      groupCounts[group] = (groupCounts[group] || 0) + 1;
    }

    const overloaded = Object.entries(groupCounts).filter(
      ([, count]) => count > 20
    );

    if (overloaded.length > 0) {
      const maxGroup = overloaded.reduce((a, b) => (a[1] > b[1] ? a : b));
      constraints.push({
        id: "discovered:group_capacity",
        name: "Group Capacity Warning (Discovered)",
        domain: "itsm",
        appliesTo: ["incident", "problem", "change_request"],
        relevantActions: ["assign", "reassign"],
        severity: "warn",
        description:
          `${overloaded.length} groups have >20 active tickets. ` +
          `Highest: "${maxGroup[0]}" with ${maxGroup[1]} tickets. ` +
          "Overloaded groups lead to SLA breaches.",
        conditions: [
          { field: "target_group_active_tickets", operator: "gt", value: 0 },
          { field: "target_group_ticket_ratio", operator: "gt", value: 10 },
        ],
        violationMessage:
          "Target group is overloaded. Consider alternative assignment.",
        satisfiedMessage: "Group capacity is within acceptable range.",
        evidence:
          `${overloaded.length} overloaded groups, max: ${maxGroup[0]} (${maxGroup[1]} tickets)`,
      });
    }
  } catch (err) {
    console.log("  ⚠️  Could not analyze group workload:", String(err).substring(0, 100));
  }

  // 4. Analyze SLA breach patterns
  console.log("  Analyzing SLA breach patterns...");
  try {
    const slaRecords = await connector.queryTable("task_sla", {
      query: "has_breached=true^taskISNOTEMPTY",
      fields: ["task", "sla", "has_breached", "business_percentage"],
      limit: 100,
    });

    if (slaRecords.length > 0) {
      constraints.push({
        id: "discovered:sla_breach",
        name: "SLA Breach Review (Discovered)",
        domain: "itsm",
        appliesTo: ["incident"],
        relevantActions: ["close"],
        severity: "warn",
        description:
          `Found ${slaRecords.length} breached SLA records. ` +
          "Incidents with breached SLAs should be reviewed before closure.",
        conditions: [
          { field: "sla_breached", operator: "eq", value: true },
          { field: "sla_has_penalty", operator: "eq", value: true },
        ],
        violationMessage:
          "This incident breached an SLA. Review required before closing.",
        satisfiedMessage: "No SLA breach detected.",
        evidence: `${slaRecords.length} breached SLA records found`,
      });
    }
  } catch (err) {
    console.log("  ⚠️  Could not analyze SLA breaches:", String(err).substring(0, 100));
  }

  return constraints;
}

/**
 * Run full constraint discovery and write results to YAML.
 */
export async function discoverConstraints(
  connector: ServiceNowConnector,
  outputPath: string
): Promise<DiscoveredConstraint[]> {
  console.log("\nDiscovering constraints from live data...");

  const discovered = await discoverIncidentConstraints(connector);

  if (discovered.length > 0) {
    const yamlConstraints = discovered.map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain,
      appliesTo: c.appliesTo,
      relevantActions: c.relevantActions,
      severity: c.severity,
      description: c.description + ` [Evidence: ${c.evidence}]`,
      conditions: c.conditions,
      violationMessage: c.violationMessage,
      satisfiedMessage: c.satisfiedMessage,
    }));

    const yamlContent = yamlDump(
      { constraints: yamlConstraints },
      { lineWidth: 120, noRefs: true, sortKeys: false }
    );
    writeFileSync(outputPath, yamlContent, "utf-8");
    console.log(`\n✅ Wrote ${discovered.length} discovered constraints to ${outputPath}`);

    // Update provenance with discovery results
    const provenancePath = resolve(dirname(outputPath), "provenance.json");
    let provenance: Record<string, unknown> = {};
    if (existsSync(provenancePath)) {
      provenance = JSON.parse(readFileSync(provenancePath, "utf-8"));
    }
    provenance.discoveredAt = new Date().toISOString();
    provenance.constraintsDiscovered = discovered.length;
    provenance.discoveryEvidence = discovered.map((c) => ({
      id: c.id,
      name: c.name,
      severity: c.severity,
      evidence: c.evidence,
    }));
    writeFileSync(provenancePath, JSON.stringify(provenance, null, 2), "utf-8");
  } else {
    console.log("\n⚠️  No constraints discovered (insufficient data or access)");
  }

  return discovered;
}
