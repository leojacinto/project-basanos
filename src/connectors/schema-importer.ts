/**
 * Schema Importer — reads a ServiceNow instance's table schemas
 * via sys_dictionary and generates Basanos ontology YAML.
 *
 * This is the "connect to a system and discover its structure" step.
 */

import { writeFileSync, mkdirSync } from "fs";
import { dump as yamlDump } from "js-yaml";
import type { ServiceNowConnector, DictionaryEntry } from "./servicenow.js";

/**
 * Map ServiceNow internal types to Basanos property types.
 */
function mapFieldType(
  internalType: string,
  hasReference: boolean,
  hasChoices: boolean
): string {
  if (hasReference) return "reference";
  if (hasChoices) return "enum";

  const typeMap: Record<string, string> = {
    string: "string",
    integer: "number",
    decimal: "number",
    float: "number",
    boolean: "boolean",
    glide_date: "date",
    glide_date_time: "date",
    due_date: "date",
    calendar_date_time: "date",
    reference: "reference",
    choice: "enum",
    sys_class_name: "string",
    journal: "string",
    journal_input: "string",
    html: "string",
    url: "string",
    email: "string",
    phone_number_e164: "string",
    currency: "number",
    price: "number",
  };

  return typeMap[internalType] || "string";
}

/**
 * Fields to skip during import (system/internal fields).
 */
const SKIP_FIELDS = new Set([
  "sys_id",
  "sys_created_on",
  "sys_created_by",
  "sys_updated_on",
  "sys_updated_by",
  "sys_mod_count",
  "sys_tags",
  "sys_domain",
  "sys_domain_path",
  "sys_class_name",
  "sys_class_path",
]);

/**
 * Import table schemas from ServiceNow and generate ontology YAML.
 */
export async function importSchemas(
  connector: ServiceNowConnector,
  tables: string[],
  outputDir: string
): Promise<{
  domain: Record<string, unknown>;
  tablesImported: number;
  fieldsImported: number;
  referencesFound: number;
}> {
  console.log(`Importing schemas for ${tables.length} tables...`);

  const entityTypes: Array<Record<string, unknown>> = [];
  let totalFields = 0;
  let totalRefs = 0;

  const referenceMap: Map<string, Set<string>> = new Map();

  for (const tableName of tables) {
    console.log(`  Reading schema for: ${tableName}`);
    const dictEntries = await connector.getTableSchema(tableName);

    if (dictEntries.length === 0) {
      console.log(`  ⚠️  No dictionary entries for ${tableName}, skipping`);
      continue;
    }

    const properties: Array<Record<string, unknown>> = [];
    const relationships: Array<Record<string, unknown>> = [];

    for (const entry of dictEntries) {
      if (SKIP_FIELDS.has(entry.element)) continue;
      if (!entry.element || entry.element.startsWith("sys_")) continue;

      const hasReference = !!entry.reference && entry.reference !== "";
      const hasChoices = entry.choice === "1" || entry.choice === "3";
      const fieldType = mapFieldType(entry.internal_type, hasReference, hasChoices);

      if (fieldType === "reference" && entry.reference) {
        const targetTable = entry.reference;
        if (tables.includes(targetTable)) {
          relationships.push({
            name: entry.element,
            label: entry.column_label || entry.element,
            targetType: targetTable,
            cardinality: "many_to_one",
            description: entry.comments || `Reference to ${targetTable}`,
          });
          totalRefs++;

          if (!referenceMap.has(tableName)) referenceMap.set(tableName, new Set());
          referenceMap.get(tableName)!.add(targetTable);
        } else {
          properties.push({
            name: entry.element,
            label: entry.column_label || entry.element,
            type: "string",
            required: entry.mandatory === "true",
            description: entry.comments || `Reference to ${entry.reference} (external)`,
          });
        }
      } else {
        const prop: Record<string, unknown> = {
          name: entry.element,
          label: entry.column_label || entry.element,
          type: fieldType,
          required: entry.mandatory === "true",
          description: entry.comments || `${entry.column_label || entry.element}`,
        };

        if (hasChoices) {
          try {
            const choices = await connector.getChoiceValues(tableName, entry.element);
            if (choices.length > 0) {
              prop.enumValues = choices.map((c) => c.value);
            }
          } catch {
            // Choice fetch failed, keep as string
            prop.type = "string";
          }
        }

        properties.push(prop);
      }

      totalFields++;
    }

    entityTypes.push({
      name: tableName,
      label: dictEntries[0]?.name || tableName,
      description: `Imported from ServiceNow table: ${tableName}`,
      properties,
      relationships,
    });
  }

  const domain = {
    name: "servicenow",
    label: "ServiceNow",
    version: "0.1.0-imported",
    description:
      "Auto-imported ontology from a live ServiceNow instance. " +
      `Contains ${entityTypes.length} entity types with ${totalFields} fields ` +
      `and ${totalRefs} cross-table relationships. ` +
      "Review and refine this schema to add business context that the API schema cannot express.",
    entityTypes,
  };

  mkdirSync(outputDir, { recursive: true });
  const yamlContent = yamlDump(domain, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  writeFileSync(`${outputDir}/ontology.yaml`, yamlContent, "utf-8");
  console.log(`\n✅ Wrote ${outputDir}/ontology.yaml`);
  console.log(`   ${entityTypes.length} entity types, ${totalFields} fields, ${totalRefs} relationships`);

  return {
    domain,
    tablesImported: entityTypes.length,
    fieldsImported: totalFields,
    referencesFound: totalRefs,
  };
}
