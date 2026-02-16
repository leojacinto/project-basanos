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
  /** ISO timestamp of evaluation */
  evaluatedAt: string;
  /** The context that was evaluated */
  context: ConstraintContext;
}

export interface AuditEntry {
  /** Sequential audit ID */
  id: number;
  /** ISO timestamp */
  timestamp: string;
  /** The full verdict */
  verdict: ConstraintVerdict;
}

export class ConstraintEngine {
  private constraints: Map<string, ConstraintDefinition> = new Map();
  private auditLog: AuditEntry[] = [];
  private nextAuditId: number = 1;

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
      const verdict: ConstraintVerdict = {
        allowed: true,
        results: [],
        summary: `No constraints apply to action: ${context.intendedAction}`,
        evaluatedAt: new Date().toISOString(),
        context,
      };
      this.auditLog.push({
        id: this.nextAuditId++,
        timestamp: verdict.evaluatedAt,
        verdict,
      });
      return verdict;
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

    const verdict: ConstraintVerdict = {
      allowed,
      results,
      summary: summaryParts.join(" | "),
      evaluatedAt: new Date().toISOString(),
      context,
    };

    this.auditLog.push({
      id: this.nextAuditId++,
      timestamp: verdict.evaluatedAt,
      verdict,
    });

    return verdict;
  }

  /**
   * Get the full audit log of all constraint evaluations.
   */
  getAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }

  /**
   * Get audit entries filtered by action or entity.
   */
  getAuditEntriesFor(filter: {
    action?: string;
    entityId?: string;
  }): AuditEntry[] {
    return this.auditLog.filter((entry) => {
      if (filter.action && entry.verdict.context.intendedAction !== filter.action) {
        return false;
      }
      if (filter.entityId && entry.verdict.context.targetEntity !== filter.entityId) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get count of blocked vs allowed verdicts.
   */
  getAuditSummary(): { total: number; allowed: number; blocked: number } {
    const total = this.auditLog.length;
    const blocked = this.auditLog.filter((e) => !e.verdict.allowed).length;
    return { total, allowed: total - blocked, blocked };
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
