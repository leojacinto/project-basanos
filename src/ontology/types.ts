/**
 * Core ontology type system for Basanos.
 *
 * These types define the semantic primitives that domain schemas
 * are built from. An ontology in Basanos is a typed, relationship-aware
 * knowledge graph — not a search index, not a vector store.
 */

/**
 * A unique identifier for any entity in the ontology.
 * Format: domain:entity_type:id (e.g., "itsm:incident:INC0012345")
 */
export type EntityId = string;

/**
 * Supported primitive value types for entity properties.
 */
export type PropertyValue =
  | string
  | number
  | boolean
  | Date
  | null
  | PropertyValue[];

/**
 * Cardinality of a relationship between entities.
 */
export enum Cardinality {
  ONE_TO_ONE = "one_to_one",
  ONE_TO_MANY = "one_to_many",
  MANY_TO_ONE = "many_to_one",
  MANY_TO_MANY = "many_to_many",
}

/**
 * Defines the schema for a property on an entity type.
 */
export interface PropertySchema {
  /** Machine-readable name */
  name: string;
  /** Human-readable label */
  label: string;
  /** Data type */
  type: "string" | "number" | "boolean" | "date" | "enum" | "reference";
  /** Whether this property is required */
  required: boolean;
  /** For enum types, the set of allowed values */
  enumValues?: string[];
  /** For reference types, the target entity type */
  referenceTarget?: string;
  /** Human-readable description for agent reasoning */
  description: string;
}

/**
 * Defines a relationship type between two entity types in the ontology.
 */
export interface RelationshipSchema {
  /** Machine-readable name (e.g., "affects", "owned_by", "caused_by") */
  name: string;
  /** Human-readable label */
  label: string;
  /** Source entity type */
  sourceType: string;
  /** Target entity type */
  targetType: string;
  /** Cardinality */
  cardinality: Cardinality;
  /** Inverse relationship name (e.g., "affected_by" for "affects") */
  inverseName?: string;
  /** Semantic description for agent reasoning */
  description: string;
}

/**
 * Defines an entity type in the domain ontology.
 */
export interface EntityTypeSchema {
  /** Machine-readable type name (e.g., "incident", "business_service") */
  name: string;
  /** Human-readable label */
  label: string;
  /** The domain this entity belongs to */
  domain: string;
  /** Property definitions */
  properties: PropertySchema[];
  /** Relationship definitions where this entity is the source */
  relationships: RelationshipSchema[];
  /** Semantic description for agent reasoning */
  description: string;
}

/**
 * A concrete entity instance in the ontology.
 */
export interface Entity {
  /** Unique identifier */
  id: EntityId;
  /** Entity type name */
  type: string;
  /** Domain */
  domain: string;
  /** Property values */
  properties: Record<string, PropertyValue>;
  /** Resolved relationships: relationship name -> target entity IDs */
  relationships: Record<string, EntityId[]>;
}

/**
 * A domain schema is a complete ontology definition for a specific domain.
 */
export interface DomainSchema {
  /** Domain identifier (e.g., "itsm") */
  name: string;
  /** Human-readable label */
  label: string;
  /** Version */
  version: string;
  /** Entity type definitions */
  entityTypes: EntityTypeSchema[];
  /** Semantic description of the domain for agent reasoning */
  description: string;
}
