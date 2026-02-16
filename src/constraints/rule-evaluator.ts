/**
 * Declarative Rule Evaluator — interprets YAML constraint conditions
 * against runtime context metadata.
 *
 * This replaces hardcoded TypeScript constraint functions with
 * a configurable rules engine. Operators can define constraints
 * in YAML without writing code.
 */

/**
 * A single condition in a declarative constraint rule.
 */
export interface RuleCondition {
  /** Metadata field to check */
  field: string;
  /** Comparison operator */
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "exists";
  /** Expected value (omit for 'exists') */
  value?: unknown;
}

/**
 * A declarative constraint definition loaded from YAML.
 */
export interface DeclarativeConstraint {
  id: string;
  name: string;
  domain: string;
  appliesTo: string[];
  relevantActions: string[];
  severity: "block" | "warn" | "info";
  description: string;
  conditions: RuleCondition[];
  violationMessage: string;
  satisfiedMessage: string;
}

/**
 * Evaluate a single condition against a metadata context.
 * Returns true if the condition is MET (i.e., the constraint IS triggered).
 */
export function evaluateCondition(
  condition: RuleCondition,
  metadata: Record<string, unknown>
): boolean {
  const fieldValue = metadata[condition.field];

  switch (condition.operator) {
    case "exists":
      return fieldValue !== undefined && fieldValue !== null;

    case "eq":
      return fieldValue === condition.value;

    case "neq":
      return fieldValue !== condition.value;

    case "gt":
      return typeof fieldValue === "number" && fieldValue > (condition.value as number);

    case "gte":
      return typeof fieldValue === "number" && fieldValue >= (condition.value as number);

    case "lt":
      return typeof fieldValue === "number" && fieldValue < (condition.value as number);

    case "lte":
      return typeof fieldValue === "number" && fieldValue <= (condition.value as number);

    case "in":
      return Array.isArray(condition.value) && condition.value.includes(fieldValue);

    default:
      return false;
  }
}

/**
 * Evaluate all conditions in a constraint against metadata.
 * All conditions must be true for the constraint to be triggered (AND logic).
 */
export function evaluateAllConditions(
  conditions: RuleCondition[],
  metadata: Record<string, unknown>
): boolean {
  if (conditions.length === 0) return false;
  return conditions.every((c) => evaluateCondition(c, metadata));
}
