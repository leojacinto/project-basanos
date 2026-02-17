/**
 * Live Entity Sync — populates the Basanos entity store
 * from real ServiceNow data.
 *
 * Queries live tables, converts records to typed Basanos entities,
 * and wires up relationships so the ontology engine can traverse
 * actual production dependency graphs.
 */

import type { ServiceNowConnector, ServiceNowRecord } from "./servicenow.js";
import type { OntologyEngine } from "../ontology/engine.js";
import type { Entity, EntityId } from "../ontology/types.js";

/**
 * Field mappings: which ServiceNow fields map to Basanos entity properties
 * and relationships for the built-in ITSM domain.
 */
const ITSM_TABLE_MAP: Record<
  string,
  {
    basanosType: string;
    propertyFields: Record<string, string>;
    relationshipFields: Record<string, { name: string; targetType: string; targetTable: string }>;
  }
> = {
  incident: {
    basanosType: "incident",
    propertyFields: {
      number: "number",
      short_description: "short_description",
      state: "state",
      priority: "priority",
      impact: "impact",
      urgency: "urgency",
      opened_at: "opened_at",
    },
    relationshipFields: {
      business_service: {
        name: "affects_service",
        targetType: "business_service",
        targetTable: "cmdb_ci_service",
      },
      cmdb_ci: {
        name: "affects_ci",
        targetType: "configuration_item",
        targetTable: "cmdb_ci",
      },
      assignment_group: {
        name: "assigned_to_group",
        targetType: "assignment_group",
        targetTable: "sys_user_group",
      },
      problem_id: {
        name: "caused_by_problem",
        targetType: "problem",
        targetTable: "problem",
      },
    },
  },
  cmdb_ci_service: {
    basanosType: "business_service",
    propertyFields: {
      name: "name",
      busines_criticality: "criticality",
      operational_status: "operational_status",
    },
    relationshipFields: {
      owned_by: {
        name: "owned_by",
        targetType: "assignment_group",
        targetTable: "sys_user_group",
      },
    },
  },
  cmdb_ci: {
    basanosType: "configuration_item",
    propertyFields: {
      name: "name",
      sys_class_name: "ci_class",
      environment: "environment",
      operational_status: "operational_status",
    },
    relationshipFields: {},
  },
  change_request: {
    basanosType: "change_request",
    propertyFields: {
      number: "number",
      type: "type",
      state: "state",
      risk: "risk",
      start_date: "planned_start",
      end_date: "planned_end",
    },
    relationshipFields: {
      assignment_group: {
        name: "requested_by_group",
        targetType: "assignment_group",
        targetTable: "sys_user_group",
      },
    },
  },
  problem: {
    basanosType: "problem",
    propertyFields: {
      number: "number",
      state: "state",
      known_error: "known_error",
    },
    relationshipFields: {
      cmdb_ci: {
        name: "affects_ci",
        targetType: "configuration_item",
        targetTable: "cmdb_ci",
      },
      assignment_group: {
        name: "assigned_to_group",
        targetType: "assignment_group",
        targetTable: "sys_user_group",
      },
    },
  },
  sys_user_group: {
    basanosType: "assignment_group",
    propertyFields: {
      name: "name",
      type: "type",
    },
    relationshipFields: {},
  },
};

/**
 * Extract a display value or raw value from a ServiceNow field.
 */
function extractValue(field: unknown): string | null {
  if (field === null || field === undefined || field === "") return null;
  if (typeof field === "object" && field !== null) {
    const obj = field as Record<string, unknown>;
    if ("display_value" in obj) return String(obj.display_value ?? "");
    if ("value" in obj) return String(obj.value ?? "");
  }
  return String(field);
}

/**
 * Extract a sys_id reference from a ServiceNow field.
 */
function extractRefId(field: unknown): string | null {
  if (field === null || field === undefined || field === "") return null;
  if (typeof field === "object" && field !== null) {
    const obj = field as Record<string, unknown>;
    if ("value" in obj) return String(obj.value ?? "");
  }
  return String(field);
}

/**
 * Sync entities from a ServiceNow table into the Basanos ontology engine.
 */
export async function syncTable(
  connector: ServiceNowConnector,
  tableName: string,
  ontologyEngine: OntologyEngine,
  options?: { limit?: number; query?: string }
): Promise<{ synced: number; errors: number }> {
  const mapping = ITSM_TABLE_MAP[tableName];
  if (!mapping) {
    console.log(`  ⚠️  No mapping for table ${tableName}, skipping`);
    return { synced: 0, errors: 0 };
  }

  const allPropertyFields = Object.keys(mapping.propertyFields);
  const allRelFields = Object.keys(mapping.relationshipFields);
  const fields = ["sys_id", ...allPropertyFields, ...allRelFields];

  console.log(`  Querying ${tableName}...`);
  const records = await connector.queryTable(tableName, {
    fields,
    limit: options?.limit ?? 100,
    query: options?.query,
  });

  let synced = 0;
  let errors = 0;

  for (const record of records) {
    try {
      const entityId: EntityId = `itsm:${mapping.basanosType}:${record.sys_id}`;

      const properties: Record<string, string | null> = {};
      for (const [snowField, basanosField] of Object.entries(mapping.propertyFields)) {
        properties[basanosField] = extractValue(record[snowField]);
      }

      const relationships: Record<string, EntityId[]> = {};
      for (const [snowField, relMapping] of Object.entries(mapping.relationshipFields)) {
        const refId = extractRefId(record[snowField]);
        if (refId) {
          relationships[relMapping.name] = [
            `itsm:${relMapping.targetType}:${refId}`,
          ];
        }
      }

      const entity: Entity = {
        id: entityId,
        type: mapping.basanosType,
        domain: "itsm",
        properties,
        relationships,
      };

      ontologyEngine.addEntity(entity);
      synced++;
    } catch (err) {
      errors++;
    }
  }

  console.log(`  ✅ ${tableName}: synced ${synced} entities (${errors} errors)`);
  return { synced, errors };
}

/**
 * Sync all ITSM tables from ServiceNow.
 */
export async function syncAllTables(
  connector: ServiceNowConnector,
  ontologyEngine: OntologyEngine,
  options?: { limit?: number }
): Promise<{ totalSynced: number; totalErrors: number; tables: string[] }> {
  console.log("\nSyncing entities from ServiceNow...");

  let totalSynced = 0;
  let totalErrors = 0;
  const tables: string[] = [];

  // Sync in dependency order: referenced tables first
  const syncOrder = [
    "sys_user_group",
    "cmdb_ci",
    "cmdb_ci_service",
    "problem",
    "change_request",
    "incident",
  ];

  for (const table of syncOrder) {
    const result = await syncTable(connector, table, ontologyEngine, options);
    totalSynced += result.synced;
    totalErrors += result.errors;
    tables.push(table);
  }

  console.log(
    `\n✅ Sync complete: ${totalSynced} entities across ${tables.length} tables (${totalErrors} errors)`
  );
  return { totalSynced, totalErrors, tables };
}
