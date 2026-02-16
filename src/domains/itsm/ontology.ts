/**
 * ITSM Domain Ontology — the proof domain for Basanos.
 *
 * Models IT Service Management entities and their relationships:
 * Incidents, Problems, Change Requests, Configuration Items,
 * Business Services, SLA Contracts, and Assignment Groups.
 *
 * This is not a ServiceNow data model — it's a semantic abstraction
 * that captures the relationships any ITSM platform should understand.
 */

import { Cardinality, type DomainSchema } from "../../ontology/types.js";

export const itsmDomain: DomainSchema = {
  name: "itsm",
  label: "IT Service Management",
  version: "0.1.0",
  description:
    "Semantic ontology for IT Service Management. Models the entity relationships " +
    "that govern incident management, change control, problem resolution, and " +
    "service level governance. Designed to give agents architectural awareness " +
    "of how ITSM entities relate — not just what data exists, but what it means.",
  entityTypes: [
    // ── Incident ──────────────────────────────────────────────
    {
      name: "incident",
      label: "Incident",
      domain: "itsm",
      description:
        "An unplanned interruption or reduction in quality of an IT service. " +
        "Incidents have priority, impact, and urgency that determine handling " +
        "procedures and escalation paths.",
      properties: [
        {
          name: "number",
          label: "Number",
          type: "string",
          required: true,
          description: "Unique incident identifier (e.g., INC0012345)",
        },
        {
          name: "short_description",
          label: "Short Description",
          type: "string",
          required: true,
          description: "Brief summary of the incident",
        },
        {
          name: "state",
          label: "State",
          type: "enum",
          required: true,
          enumValues: [
            "new",
            "in_progress",
            "on_hold",
            "resolved",
            "closed",
            "cancelled",
          ],
          description: "Current lifecycle state of the incident",
        },
        {
          name: "priority",
          label: "Priority",
          type: "enum",
          required: true,
          enumValues: ["P1", "P2", "P3", "P4", "P5"],
          description:
            "Priority derived from impact × urgency. P1 = critical, P5 = planning",
        },
        {
          name: "impact",
          label: "Impact",
          type: "enum",
          required: true,
          enumValues: ["high", "medium", "low"],
          description: "Measure of the business impact of the incident",
        },
        {
          name: "urgency",
          label: "Urgency",
          type: "enum",
          required: true,
          enumValues: ["high", "medium", "low"],
          description: "How quickly the incident needs to be resolved",
        },
        {
          name: "opened_at",
          label: "Opened At",
          type: "date",
          required: true,
          description: "Timestamp when the incident was created",
        },
      ],
      relationships: [
        {
          name: "affects_service",
          label: "Affects Service",
          sourceType: "incident",
          targetType: "business_service",
          cardinality: Cardinality.MANY_TO_ONE,
          inverseName: "has_incidents",
          description:
            "The business service impacted by this incident. Determines SLA applicability.",
        },
        {
          name: "affects_ci",
          label: "Affects Configuration Item",
          sourceType: "incident",
          targetType: "configuration_item",
          cardinality: Cardinality.MANY_TO_ONE,
          inverseName: "has_incidents",
          description: "The specific CI experiencing the issue",
        },
        {
          name: "assigned_to_group",
          label: "Assigned To Group",
          sourceType: "incident",
          targetType: "assignment_group",
          cardinality: Cardinality.MANY_TO_ONE,
          inverseName: "assigned_incidents",
          description: "The team responsible for resolving this incident",
        },
        {
          name: "caused_by_problem",
          label: "Caused By Problem",
          sourceType: "incident",
          targetType: "problem",
          cardinality: Cardinality.MANY_TO_ONE,
          inverseName: "caused_incidents",
          description: "The underlying problem record, if identified",
        },
      ],
    },

    // ── Business Service ──────────────────────────────────────
    {
      name: "business_service",
      label: "Business Service",
      domain: "itsm",
      description:
        "A service delivered to the business. Business services are the bridge " +
        "between technical infrastructure and business value. They carry SLA " +
        "commitments and have defined ownership.",
      properties: [
        {
          name: "name",
          label: "Name",
          type: "string",
          required: true,
          description: "Service name (e.g., 'Email Service', 'ERP Production')",
        },
        {
          name: "criticality",
          label: "Criticality",
          type: "enum",
          required: true,
          enumValues: ["critical", "high", "medium", "low"],
          description:
            "Business criticality — determines escalation speed and stakeholder notification",
        },
        {
          name: "operational_status",
          label: "Operational Status",
          type: "enum",
          required: true,
          enumValues: ["operational", "degraded", "outage", "maintenance"],
          description: "Current operational state of the service",
        },
      ],
      relationships: [
        {
          name: "governed_by_sla",
          label: "Governed By SLA",
          sourceType: "business_service",
          targetType: "sla_contract",
          cardinality: Cardinality.ONE_TO_MANY,
          inverseName: "governs_service",
          description:
            "SLA contracts that define performance commitments for this service",
        },
        {
          name: "depends_on",
          label: "Depends On CIs",
          sourceType: "business_service",
          targetType: "configuration_item",
          cardinality: Cardinality.MANY_TO_MANY,
          inverseName: "supports_service",
          description:
            "Configuration items that this service depends on. A CI failure may impact this service.",
        },
        {
          name: "owned_by",
          label: "Owned By Group",
          sourceType: "business_service",
          targetType: "assignment_group",
          cardinality: Cardinality.MANY_TO_ONE,
          inverseName: "owns_services",
          description: "The group accountable for this service's health",
        },
      ],
    },

    // ── Configuration Item ────────────────────────────────────
    {
      name: "configuration_item",
      label: "Configuration Item",
      domain: "itsm",
      description:
        "Any component that needs to be managed in order to deliver an IT service. " +
        "CIs form the CMDB — the dependency graph that connects infrastructure to services.",
      properties: [
        {
          name: "name",
          label: "Name",
          type: "string",
          required: true,
          description: "CI name (e.g., 'prod-db-01', 'api-gateway-cluster')",
        },
        {
          name: "ci_class",
          label: "CI Class",
          type: "enum",
          required: true,
          enumValues: [
            "server",
            "database",
            "application",
            "network_device",
            "storage",
            "cluster",
            "virtual_machine",
          ],
          description: "Classification of the CI within the CMDB taxonomy",
        },
        {
          name: "environment",
          label: "Environment",
          type: "enum",
          required: true,
          enumValues: ["production", "staging", "development", "dr"],
          description: "Deployment environment. Production CIs have stricter change controls.",
        },
        {
          name: "operational_status",
          label: "Operational Status",
          type: "enum",
          required: true,
          enumValues: ["operational", "non_operational", "retired", "under_maintenance"],
          description: "Current operational state of the CI",
        },
      ],
      relationships: [
        {
          name: "depends_on",
          label: "Depends On",
          sourceType: "configuration_item",
          targetType: "configuration_item",
          cardinality: Cardinality.MANY_TO_MANY,
          inverseName: "depended_on_by",
          description:
            "Upstream dependencies. If a dependency fails, this CI may be impacted.",
        },
      ],
    },

    // ── Change Request ────────────────────────────────────────
    {
      name: "change_request",
      label: "Change Request",
      domain: "itsm",
      description:
        "A formal request to modify the IT environment. Changes have risk assessments, " +
        "approval workflows, and blackout windows. Agents must respect change freezes " +
        "and approval states.",
      properties: [
        {
          name: "number",
          label: "Number",
          type: "string",
          required: true,
          description: "Unique change identifier (e.g., CHG0005678)",
        },
        {
          name: "type",
          label: "Type",
          type: "enum",
          required: true,
          enumValues: ["standard", "normal", "emergency"],
          description:
            "Change type determines approval requirements. Emergency bypasses normal approval.",
        },
        {
          name: "state",
          label: "State",
          type: "enum",
          required: true,
          enumValues: [
            "new",
            "assess",
            "authorize",
            "scheduled",
            "implement",
            "review",
            "closed",
            "cancelled",
          ],
          description: "Current lifecycle state of the change",
        },
        {
          name: "risk",
          label: "Risk",
          type: "enum",
          required: true,
          enumValues: ["high", "moderate", "low"],
          description: "Assessed risk level of the change",
        },
        {
          name: "planned_start",
          label: "Planned Start",
          type: "date",
          required: false,
          description: "Scheduled implementation start",
        },
        {
          name: "planned_end",
          label: "Planned End",
          type: "date",
          required: false,
          description: "Scheduled implementation end",
        },
      ],
      relationships: [
        {
          name: "affects_ci",
          label: "Affects CI",
          sourceType: "change_request",
          targetType: "configuration_item",
          cardinality: Cardinality.MANY_TO_MANY,
          inverseName: "has_changes",
          description: "CIs that will be modified by this change",
        },
        {
          name: "requested_by_group",
          label: "Requested By Group",
          sourceType: "change_request",
          targetType: "assignment_group",
          cardinality: Cardinality.MANY_TO_ONE,
          inverseName: "requested_changes",
          description: "The group requesting this change",
        },
      ],
    },

    // ── Problem ───────────────────────────────────────────────
    {
      name: "problem",
      label: "Problem",
      domain: "itsm",
      description:
        "The root cause of one or more incidents. Problems represent structural " +
        "issues that need permanent resolution rather than workarounds.",
      properties: [
        {
          name: "number",
          label: "Number",
          type: "string",
          required: true,
          description: "Unique problem identifier (e.g., PRB0001234)",
        },
        {
          name: "state",
          label: "State",
          type: "enum",
          required: true,
          enumValues: [
            "new",
            "assessed",
            "root_cause_analysis",
            "fix_in_progress",
            "resolved",
            "closed",
          ],
          description: "Current lifecycle state of the problem",
        },
        {
          name: "known_error",
          label: "Known Error",
          type: "boolean",
          required: true,
          description:
            "Whether a root cause has been identified and a workaround documented",
        },
      ],
      relationships: [
        {
          name: "affects_ci",
          label: "Root Cause CI",
          sourceType: "problem",
          targetType: "configuration_item",
          cardinality: Cardinality.MANY_TO_ONE,
          inverseName: "has_problems",
          description: "The CI identified as the root cause",
        },
        {
          name: "assigned_to_group",
          label: "Assigned To Group",
          sourceType: "problem",
          targetType: "assignment_group",
          cardinality: Cardinality.MANY_TO_ONE,
          inverseName: "assigned_problems",
          description: "The team investigating this problem",
        },
      ],
    },

    // ── SLA Contract ──────────────────────────────────────────
    {
      name: "sla_contract",
      label: "SLA Contract",
      domain: "itsm",
      description:
        "A service level agreement defining performance commitments. SLAs bind " +
        "response and resolution times to priority levels and carry penalty clauses.",
      properties: [
        {
          name: "name",
          label: "Name",
          type: "string",
          required: true,
          description: "SLA contract name",
        },
        {
          name: "response_time_minutes",
          label: "Response Time (minutes)",
          type: "number",
          required: true,
          description: "Maximum time to first response, in minutes",
        },
        {
          name: "resolution_time_minutes",
          label: "Resolution Time (minutes)",
          type: "number",
          required: true,
          description: "Maximum time to resolution, in minutes",
        },
        {
          name: "applies_to_priority",
          label: "Applies To Priority",
          type: "enum",
          required: true,
          enumValues: ["P1", "P2", "P3", "P4", "P5"],
          description: "The incident priority level this SLA target applies to",
        },
        {
          name: "has_penalty",
          label: "Has Penalty Clause",
          type: "boolean",
          required: true,
          description: "Whether a financial or contractual penalty applies on breach",
        },
      ],
      relationships: [],
    },

    // ── Assignment Group ──────────────────────────────────────
    {
      name: "assignment_group",
      label: "Assignment Group",
      domain: "itsm",
      description:
        "A team responsible for handling work items. Groups have capacity, " +
        "skills, and operational hours that affect assignment decisions.",
      properties: [
        {
          name: "name",
          label: "Name",
          type: "string",
          required: true,
          description: "Group name (e.g., 'Database Team', 'Network Operations')",
        },
        {
          name: "type",
          label: "Type",
          type: "enum",
          required: true,
          enumValues: ["operations", "engineering", "management", "vendor"],
          description: "The functional classification of this group",
        },
        {
          name: "active_member_count",
          label: "Active Member Count",
          type: "number",
          required: false,
          description: "Number of currently active team members",
        },
      ],
      relationships: [],
    },
  ],
};
