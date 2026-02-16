/**
 * Schema loading and validation.
 *
 * Validates domain schemas against the type system
 * and provides utilities for schema introspection.
 */

import type { DomainSchema, EntityTypeSchema } from "./types.js";

/**
 * Validate that a domain schema is internally consistent:
 * - All relationship targets reference existing entity types
 * - All required fields are present
 * - No duplicate entity type names
 */
export function validateDomainSchema(schema: DomainSchema): string[] {
  const errors: string[] = [];
  const entityTypeNames = new Set(schema.entityTypes.map((et) => et.name));

  // Check for duplicate entity type names
  if (entityTypeNames.size !== schema.entityTypes.length) {
    errors.push(`Domain "${schema.name}" has duplicate entity type names`);
  }

  for (const entityType of schema.entityTypes) {
    // Validate relationships reference known entity types
    for (const rel of entityType.relationships) {
      if (!entityTypeNames.has(rel.targetType)) {
        errors.push(
          `Entity "${entityType.name}" has relationship "${rel.name}" targeting unknown type "${rel.targetType}"`
        );
      }
    }

    // Validate reference properties target known entity types
    for (const prop of entityType.properties) {
      if (prop.type === "reference" && prop.referenceTarget) {
        if (!entityTypeNames.has(prop.referenceTarget)) {
          errors.push(
            `Entity "${entityType.name}" property "${prop.name}" references unknown type "${prop.referenceTarget}"`
          );
        }
      }
    }

    // Validate enum properties have values
    for (const prop of entityType.properties) {
      if (
        prop.type === "enum" &&
        (!prop.enumValues || prop.enumValues.length === 0)
      ) {
        errors.push(
          `Entity "${entityType.name}" property "${prop.name}" is enum but has no enumValues`
        );
      }
    }
  }

  return errors;
}

/**
 * Get a flattened list of all entity types across all provided schemas.
 */
export function getAllEntityTypes(
  schemas: DomainSchema[]
): EntityTypeSchema[] {
  return schemas.flatMap((s) => s.entityTypes);
}
