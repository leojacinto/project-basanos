/**
 * Constraint type definitions for Basanos.
 *
 * Constraints encode business logic guardrails — not security rules,
 * but domain-aware conditions that determine whether an agent action
 * is appropriate in a given context.
 */

import type { EntityId } from "../ontology/types.js";

/**
 * Severity level for a constraint violation.
 */
export enum ConstraintSeverity {
  /** Action must not proceed — hard business rule */
  BLOCK = "block",
  /** Action may proceed but agent should flag the risk */
  WARN = "warn",
  /** Informational — agent should be aware but no action needed */
  INFO = "info",
}

/**
 * Lifecycle status for a constraint.
 */
export enum ConstraintStatus {
  /** Discovered or hand-crafted but not yet enforced */
  CANDIDATE = "candidate",
  /** Reviewed and actively enforced */
  PROMOTED = "promoted",
  /** Explicitly turned off (was promoted, now paused) */
  DISABLED = "disabled",
}

/**
 * The result of evaluating a constraint against a context.
 */
export interface ConstraintResult {
  /** The constraint that was evaluated */
  constraintId: string;
  /** Whether the constraint was satisfied */
  satisfied: boolean;
  /** Severity if not satisfied */
  severity: ConstraintSeverity;
  /** Human-readable explanation for agent reasoning */
  explanation: string;
  /** Entities involved in this constraint evaluation */
  involvedEntities: EntityId[];
}

/**
 * Context provided to constraint evaluation — the "state of the world"
 * at the time an agent wants to take an action.
 */
export interface ConstraintContext {
  /** The action the agent intends to take */
  intendedAction: string;
  /** The primary entity the action targets */
  targetEntity: EntityId;
  /** Additional context entities relevant to evaluation */
  relatedEntities: EntityId[];
  /** Current timestamp for time-sensitive constraints */
  timestamp: Date;
  /** Additional key-value context */
  metadata: Record<string, unknown>;
}

/**
 * A constraint definition — a named business rule that can be
 * evaluated against a context.
 */
export interface ConstraintDefinition {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** The domain this constraint belongs to */
  domain: string;
  /** Which entity types this constraint applies to */
  appliesTo: string[];
  /** Which actions this constraint is relevant for */
  relevantActions: string[];
  /** Severity when violated */
  severity: ConstraintSeverity;
  /** Lifecycle status: candidate, promoted, or disabled */
  status: ConstraintStatus;
  /** Human-readable description for agent reasoning */
  description: string;
  /** Evaluation function — takes context, returns result */
  evaluate: (context: ConstraintContext) => Promise<ConstraintResult>;
}
