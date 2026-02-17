/**
 * YAML Schema Loader — loads domain ontologies and constraints
 * from declarative YAML files.
 *
 * This is the "dbt for agent ontology" pattern: define your
 * domain model in YAML, not TypeScript. Operators can customize
 * schemas and constraints without writing code.
 */

import { readFileSync } from "fs";
import { load as yamlLoad } from "js-yaml";

import type { DomainSchema, EntityTypeSchema, RelationshipSchema, PropertySchema } from "./ontology/types.js";
import { Cardinality } from "./ontology/types.js";
import type { ConstraintDefinition, ConstraintContext, ConstraintResult } from "./constraints/types.js";
import { ConstraintSeverity, ConstraintStatus } from "./constraints/types.js";
import type { DeclarativeConstraint } from "./constraints/rule-evaluator.js";
import { evaluateAllConditions } from "./constraints/rule-evaluator.js";

// ── Cardinality mapping ───────────────────────────────────────

const CARDINALITY_MAP: Record<string, Cardinality> = {
  one_to_one: Cardinality.ONE_TO_ONE,
  one_to_many: Cardinality.ONE_TO_MANY,
  many_to_one: Cardinality.MANY_TO_ONE,
  many_to_many: Cardinality.MANY_TO_MANY,
};

const SEVERITY_MAP: Record<string, ConstraintSeverity> = {
  block: ConstraintSeverity.BLOCK,
  warn: ConstraintSeverity.WARN,
  info: ConstraintSeverity.INFO,
};

const STATUS_MAP: Record<string, ConstraintStatus> = {
  candidate: ConstraintStatus.CANDIDATE,
  promoted: ConstraintStatus.PROMOTED,
  disabled: ConstraintStatus.DISABLED,
};

// ── Ontology Loader ───────────────────────────────────────────

interface RawYamlRelationship {
  name: string;
  label: string;
  targetType: string;
  cardinality: string;
  inverseName?: string;
  description: string;
}

interface RawYamlEntityType {
  name: string;
  label: string;
  description: string;
  properties: PropertySchema[];
  relationships: RawYamlRelationship[];
}

interface RawYamlDomain {
  name: string;
  label: string;
  version: string;
  description: string;
  entityTypes: RawYamlEntityType[];
}

export function loadDomainFromYaml(filePath: string): DomainSchema {
  const raw = yamlLoad(readFileSync(filePath, "utf-8")) as RawYamlDomain;

  const entityTypes: EntityTypeSchema[] = raw.entityTypes.map((et) => ({
    name: et.name,
    label: et.label,
    domain: raw.name,
    description: et.description.trim(),
    properties: et.properties.map((p) => ({
      ...p,
      description: typeof p.description === "string" ? p.description.trim() : p.description,
    })),
    relationships: (et.relationships || []).map(
      (r): RelationshipSchema => ({
        name: r.name,
        label: r.label,
        sourceType: et.name,
        targetType: r.targetType,
        cardinality: CARDINALITY_MAP[r.cardinality] || Cardinality.MANY_TO_ONE,
        inverseName: r.inverseName,
        description: r.description.trim(),
      })
    ),
  }));

  return {
    name: raw.name,
    label: raw.label,
    version: raw.version,
    description: raw.description.trim(),
    entityTypes,
  };
}

// ── Constraint Loader ─────────────────────────────────────────

interface RawYamlConstraints {
  constraints: DeclarativeConstraint[];
}

export function loadConstraintsFromYaml(
  filePath: string
): ConstraintDefinition[] {
  const raw = yamlLoad(readFileSync(filePath, "utf-8")) as RawYamlConstraints;

  return raw.constraints.map((dc): ConstraintDefinition => {
    const severity = SEVERITY_MAP[dc.severity] || ConstraintSeverity.WARN;

    const status = STATUS_MAP[dc.status || "promoted"] || ConstraintStatus.PROMOTED;

    return {
      id: dc.id,
      name: dc.name,
      domain: dc.domain,
      appliesTo: dc.appliesTo,
      relevantActions: dc.relevantActions,
      severity,
      status,
      description: dc.description.trim(),
      evaluate: async (context: ConstraintContext): Promise<ConstraintResult> => {
        const metadata = context.metadata as Record<string, unknown>;
        const triggered = evaluateAllConditions(dc.conditions, metadata);

        return {
          constraintId: dc.id,
          satisfied: !triggered,
          severity,
          explanation: triggered
            ? dc.violationMessage.trim()
            : dc.satisfiedMessage.trim(),
          involvedEntities: [context.targetEntity],
        };
      },
    };
  });
}
