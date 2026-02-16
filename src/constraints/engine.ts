/**
 * Constraint Engine — evaluates business logic guardrails.
 *
 * Given an intended agent action and the current context,
 * the engine checks all applicable constraints and returns
 * a structured verdict: proceed, warn, or block.
 */

import type {
  ConstraintContext,
  ConstraintDefinition,
  ConstraintResult,
} from "./types.js";
import { ConstraintSeverity } from "./types.js";

export interface ConstraintVerdict {
  /** Can the action proceed? */
  allowed: boolean;
  /** All constraint results, including passed ones */
  results: ConstraintResult[];
  /** Summary explanation for agent reasoning */
  summary: string;
}

export class ConstraintEngine {
  private constraints: Map<string, ConstraintDefinition> = new Map();

  /**
   * Register a constraint definition.
   */
  register(constraint: ConstraintDefinition): void {
    this.constraints.set(constraint.id, constraint);
  }

  /**
   * Get all registered constraints for a domain.
   */
  getConstraints(domain: string): ConstraintDefinition[] {
    return Array.from(this.constraints.values()).filter(
      (c) => c.domain === domain
    );
  }

  /**
   * Evaluate all applicable constraints for a given context.
   * Returns a verdict with structured results and a summary.
   */
  async evaluate(context: ConstraintContext): Promise<ConstraintVerdict> {
    const applicable = Array.from(this.constraints.values()).filter(
      (c) =>
        c.relevantActions.includes(context.intendedAction) ||
        c.relevantActions.includes("*")
    );

    if (applicable.length === 0) {
      return {
        allowed: true,
        results: [],
        summary: `No constraints apply to action: ${context.intendedAction}`,
      };
    }

    const results: ConstraintResult[] = [];
    for (const constraint of applicable) {
      try {
        const result = await constraint.evaluate(context);
        results.push(result);
      } catch (error) {
        results.push({
          constraintId: constraint.id,
          satisfied: false,
          severity: ConstraintSeverity.WARN,
          explanation: `Constraint evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
          involvedEntities: [context.targetEntity],
        });
      }
    }

    const blocked = results.filter(
      (r) => !r.satisfied && r.severity === ConstraintSeverity.BLOCK
    );
    const warnings = results.filter(
      (r) => !r.satisfied && r.severity === ConstraintSeverity.WARN
    );

    const allowed = blocked.length === 0;

    const summaryParts: string[] = [];
    if (blocked.length > 0) {
      summaryParts.push(
        `BLOCKED by ${blocked.length} constraint(s): ${blocked.map((b) => b.explanation).join("; ")}`
      );
    }
    if (warnings.length > 0) {
      summaryParts.push(
        `${warnings.length} warning(s): ${warnings.map((w) => w.explanation).join("; ")}`
      );
    }
    if (summaryParts.length === 0) {
      summaryParts.push(
        `All ${results.length} constraint(s) satisfied for action: ${context.intendedAction}`
      );
    }

    return {
      allowed,
      results,
      summary: summaryParts.join(" | "),
    };
  }

  /**
   * Describe all constraints for a domain — for agent awareness.
   */
  describeConstraints(domain: string): string {
    const constraints = this.getConstraints(domain);
    if (constraints.length === 0) {
      return `No constraints registered for domain: ${domain}`;
    }

    const lines: string[] = [
      `# Business Constraints for ${domain}`,
      "",
    ];

    for (const c of constraints) {
      lines.push(`## ${c.name} (${c.id})`);
      lines.push(`Severity: ${c.severity}`);
      lines.push(`Applies to: ${c.appliesTo.join(", ")}`);
      lines.push(`Relevant actions: ${c.relevantActions.join(", ")}`);
      lines.push(c.description);
      lines.push("");
    }

    return lines.join("\n");
  }
}
