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
import type { ServiceNowConnector } from "./client.js";

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
  connector: ServiceNowConnector,
  domainName: string
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
        id: `${domainName}:discovered:change_freeze`,
        name: "Active Change Freeze (Discovered)",
        domain: domainName,
        appliesTo: ["incident"],
        relevantActions: ["resolve", "close", "auto_resolve"],
        severity: "block",
        description:
          `Found ${recentChanges.length} recent change requests. ` +
          "Incident resolution during active change windows should be blocked.",
        conditions: [],
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
        id: `${domainName}:discovered:p1_reassignment`,
        name: "P1 Reassignment Caution (Discovered)",
        domain: domainName,
        appliesTo: ["incident"],
        relevantActions: ["reassign"],
        severity: "warn",
        description:
          `${Math.round(reassignRate * 100)}% of active P1 incidents have been reassigned. ` +
          "P1 reassignment disrupts war rooms and escalation chains.",
        conditions: [],
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
        id: `${domainName}:discovered:group_capacity`,
        name: "Group Capacity Warning (Discovered)",
        domain: domainName,
        appliesTo: ["incident", "problem", "change_request"],
        relevantActions: ["assign", "reassign"],
        severity: "warn",
        description:
          `${overloaded.length} groups have >20 active tickets. ` +
          `Highest: "${maxGroup[0]}" with ${maxGroup[1]} tickets. ` +
          "Overloaded groups lead to SLA breaches.",
        conditions: [],
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
        id: `${domainName}:discovered:sla_breach`,
        name: "SLA Breach Review (Discovered)",
        domain: domainName,
        appliesTo: ["incident"],
        relevantActions: ["close"],
        severity: "warn",
        description:
          `Found ${slaRecords.length} breached SLA records. ` +
          "Incidents with breached SLAs should be reviewed before closure.",
        conditions: [],
        violationMessage:
          "This incident breached an SLA. Review required before closing.",
        satisfiedMessage: "No SLA breach detected.",
        evidence: `${slaRecords.length} breached SLA records found`,
      });
    }
  } catch (err) {
    console.log("  ⚠️  Could not analyze SLA breaches:", String(err).substring(0, 100));
  }

  // 5. Check for unassigned high priority incidents
  console.log("  Analyzing unassigned high priority incidents...");
  try {
    const highPri = await connector.queryTable("incident", {
      query: "priorityIN1,2^stateIN1,2",
      fields: ["number", "priority", "state", "assignment_group", "assigned_to"],
      limit: 50,
    });

    const unassigned = highPri.filter((i) => {
      const assignee = i.assigned_to;
      return !assignee || assignee === "" || (typeof assignee === "object" && (!assignee || !(assignee as Record<string, unknown>).value));
    });

    if (unassigned.length > 0) {
      constraints.push({
        id: `${domainName}:discovered:unassigned_high_priority`,
        name: "Unassigned High Priority Incidents (Discovered)",
        domain: domainName,
        appliesTo: ["incident"],
        relevantActions: ["assign", "auto_resolve"],
        severity: "warn",
        description:
          `Found ${unassigned.length} P1/P2 incidents without a named assignee. ` +
          "High priority incidents need individual ownership, not just group assignment.",
        conditions: [],
        violationMessage: "Unassigned high priority incidents exist. Ensure a named owner before taking action.",
        satisfiedMessage: "All high priority incidents have assigned owners.",
        evidence: `${unassigned.length} of ${highPri.length} active P1/P2 incidents are unassigned`,
      });
    }
  } catch (err) {
    console.log("  ⚠️  Could not analyze unassigned incidents:", String(err).substring(0, 100));
  }

  // 6. Check incident reopen rate
  console.log("  Analyzing incident reopen rate...");
  try {
    const activeIncidents = await connector.queryTable("incident", {
      query: "stateIN1,2,3",
      fields: ["number", "reopen_count", "state", "category"],
      limit: 100,
    });

    const reopened = activeIncidents.filter((i) => {
      const count = parseInt(String(i.reopen_count ?? "0"), 10);
      return count > 0;
    });

    if (activeIncidents.length > 0) {
      const reopenRate = reopened.length / activeIncidents.length;
      if (reopenRate > 0.1 || reopened.length > 0) {
        constraints.push({
          id: `${domainName}:discovered:incident_reopen_rate`,
          name: "Incident Reopen Rate (Discovered)",
          domain: domainName,
          appliesTo: ["incident"],
          relevantActions: ["resolve", "close"],
          severity: "warn",
          description:
            `${reopened.length} of ${activeIncidents.length} active incidents have been reopened ` +
            `(${Math.round(reopenRate * 100)}% reopen rate). ` +
            "High reopen rates indicate premature closures.",
          conditions: [],
          violationMessage: "High reopen rate detected. Verify the fix addresses root cause.",
          satisfiedMessage: "Reopen rate is within acceptable range.",
          evidence: `${reopened.length} reopened out of ${activeIncidents.length} active (${Math.round(reopenRate * 100)}%)`,
        });
      }
    }
  } catch (err) {
    console.log("  ⚠️  Could not analyze reopen rate:", String(err).substring(0, 100));
  }

  // 7. Check for major incidents without problem records
  console.log("  Analyzing major incidents without problem records...");
  try {
    const resolvedP1 = await connector.queryTable("incident", {
      query: "priority=1^stateIN6,7",
      fields: ["number", "priority", "state", "problem_id", "resolved_at"],
      limit: 50,
    });

    const noProblem = resolvedP1.filter((i) => {
      const pid = i.problem_id;
      return !pid || pid === "" || (typeof pid === "object" && (!pid || !(pid as Record<string, unknown>).value));
    });

    if (noProblem.length > 0) {
      constraints.push({
        id: `${domainName}:discovered:major_incident_no_problem`,
        name: "Major Incident Without Problem Record (Discovered)",
        domain: domainName,
        appliesTo: ["incident", "problem"],
        relevantActions: ["close"],
        severity: "warn",
        description:
          `Found ${noProblem.length} resolved/closed P1 incidents without a linked problem record. ` +
          "Major incidents should trigger problem management for root cause analysis.",
        conditions: [],
        violationMessage: "This major incident has no linked problem record. Create a problem for root cause analysis.",
        satisfiedMessage: "Problem record exists for root cause tracking.",
        evidence: `${noProblem.length} resolved P1s without problem records`,
      });
    }
  } catch (err) {
    console.log("  ⚠️  Could not analyze major incidents:", String(err).substring(0, 100));
  }

  // 8. Check for recurring CI failures
  console.log("  Analyzing recurring CI failures...");
  try {
    const ciIncidents = await connector.queryTable("incident", {
      query: "stateIN1,2,3^cmdb_ciISNOTEMPTY",
      fields: ["cmdb_ci", "number", "state"],
      limit: 500,
    });

    const ciCounts: Record<string, { count: number; name: string }> = {};
    for (const inc of ciIncidents) {
      const ci = inc.cmdb_ci;
      const ciId = typeof ci === "object" && ci !== null
        ? String((ci as Record<string, unknown>).value ?? "")
        : String(ci ?? "");
      const ciName = typeof ci === "object" && ci !== null
        ? String((ci as Record<string, unknown>).display_value ?? ciId)
        : ciId;
      if (ciId) {
        if (!ciCounts[ciId]) ciCounts[ciId] = { count: 0, name: ciName };
        ciCounts[ciId].count++;
      }
    }

    const recurring = Object.entries(ciCounts).filter(([, v]) => v.count > 3);
    if (recurring.length > 0) {
      const worst = recurring.reduce((a, b) => (a[1].count > b[1].count ? a : b));
      constraints.push({
        id: `${domainName}:discovered:recurring_ci_failures`,
        name: "Recurring CI Failures (Discovered)",
        domain: domainName,
        appliesTo: ["incident", "change_request"],
        relevantActions: ["assign", "resolve"],
        severity: "warn",
        description:
          `${recurring.length} CIs have >3 active incidents. ` +
          `Worst: "${worst[1].name}" with ${worst[1].count} incidents. ` +
          "Systemic instability needs problem management investigation.",
        conditions: [],
        violationMessage: "This CI has recurring failures. Consider problem investigation before further changes.",
        satisfiedMessage: "No recurring failure pattern detected for this CI.",
        evidence: `${recurring.length} CIs with recurring failures, worst: ${worst[1].name} (${worst[1].count} incidents)`,
      });
    }
  } catch (err) {
    console.log("  ⚠️  Could not analyze recurring CI failures:", String(err).substring(0, 100));
  }

  // 9. Check for recent failed changes on CIs
  console.log("  Analyzing recent failed changes...");
  try {
    const failedChanges = await connector.queryTable("change_request", {
      query: "close_code=unsuccessful",
      fields: ["number", "cmdb_ci", "state", "close_code", "close_notes"],
      limit: 50,
    });

    if (failedChanges.length > 0) {
      const ciNames = failedChanges.map((c) => {
        const ci = c.cmdb_ci;
        return typeof ci === "object" && ci !== null
          ? String((ci as Record<string, unknown>).display_value ?? "unknown")
          : String(ci ?? "unknown");
      });
      constraints.push({
        id: `${domainName}:discovered:failed_changes_on_ci`,
        name: "Recent Failed Changes on CI (Discovered)",
        domain: domainName,
        appliesTo: ["change_request"],
        relevantActions: ["approve", "implement"],
        severity: "block",
        description:
          `Found ${failedChanges.length} failed change(s). ` +
          `Affected CIs: ${[...new Set(ciNames)].join(", ")}. ` +
          "CIs with recent failures are in a fragile state.",
        conditions: [],
        violationMessage: "Recent failed change on this CI. Review failure before approving new changes.",
        satisfiedMessage: "No recent failed changes on this CI.",
        evidence: `${failedChanges.length} failed changes on ${[...new Set(ciNames)].length} CI(s)`,
      });
    }
  } catch (err) {
    console.log("  ⚠️  Could not analyze failed changes:", String(err).substring(0, 100));
  }

  // 10. Check for stale incidents
  console.log("  Analyzing stale incidents...");
  try {
    const allActive = await connector.queryTable("incident", {
      query: "stateIN1,2",
      fields: ["number", "state", "priority", "sys_updated_on", "assigned_to"],
      limit: 100,
    });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const stale = allActive.filter((i) => {
      const updated = i.sys_updated_on ? new Date(String(i.sys_updated_on)) : null;
      return updated && updated < sevenDaysAgo;
    });

    if (stale.length > 0) {
      constraints.push({
        id: `${domainName}:discovered:stale_incidents`,
        name: "Stale Incident Warning (Discovered)",
        domain: domainName,
        appliesTo: ["incident"],
        relevantActions: ["auto_resolve", "close"],
        severity: "warn",
        description:
          `Found ${stale.length} active incidents with no updates in 7+ days. ` +
          "Stale incidents may be stuck or forgotten.",
        conditions: [],
        violationMessage: "Stale incidents detected. Investigate before auto-resolving.",
        satisfiedMessage: "No stale incidents found.",
        evidence: `${stale.length} incidents with no update in 7+ days`,
      });
    }
  } catch (err) {
    console.log("  ⚠️  Could not analyze stale incidents:", String(err).substring(0, 100));
  }

  // 11. Check for unapproved normal changes
  console.log("  Analyzing unapproved changes...");
  try {
    const normalChanges = await connector.queryTable("change_request", {
      query: "type=normal^stateIN-5,3",
      fields: ["number", "type", "state", "approval", "start_date", "end_date"],
      limit: 20,
    });

    const unapproved = normalChanges.filter((c) => {
      const approval = c.approval;
      const val = typeof approval === "object" && approval !== null
        ? String((approval as Record<string, unknown>).value ?? "")
        : String(approval ?? "");
      return val === "not requested" || val === "not_requested" || val === "";
    });

    if (unapproved.length > 0) {
      constraints.push({
        id: `${domainName}:discovered:after_hours_change`,
        name: "After-Hours Change Risk (Discovered)",
        domain: domainName,
        appliesTo: ["change_request"],
        relevantActions: ["implement", "approve"],
        severity: "warn",
        description:
          `Found ${unapproved.length} scheduled normal change(s) without approval. ` +
          "Normal changes require CAB or peer review before implementation.",
        conditions: [],
        violationMessage: "Unapproved normal change detected. Route through change approval before implementation.",
        satisfiedMessage: "All scheduled changes have proper approval.",
        evidence: `${unapproved.length} unapproved normal changes scheduled`,
      });
    }
  } catch (err) {
    console.log("  ⚠️  Could not analyze unapproved changes:", String(err).substring(0, 100));
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

  const domainName = dirname(outputPath).split("/").pop() || "servicenow";
  const discovered = await discoverIncidentConstraints(connector, domainName);

  if (discovered.length > 0) {
    const yamlConstraints = discovered.map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain,
      appliesTo: c.appliesTo,
      relevantActions: c.relevantActions,
      severity: c.severity,
      status: "candidate",
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
