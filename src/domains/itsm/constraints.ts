/**
 * ITSM Business Logic Constraints.
 *
 * These are not security rules — they encode operational awareness
 * that agents need to make correct decisions in ITSM contexts.
 */

import type {
  ConstraintContext,
  ConstraintDefinition,
  ConstraintResult,
} from "../../constraints/types.js";
import { ConstraintSeverity } from "../../constraints/types.js";

/**
 * Don't auto-resolve an incident if there's an active change freeze
 * affecting the related CI or business service.
 */
export const changeFreezeConstraint: ConstraintDefinition = {
  id: "itsm:change_freeze_active",
  name: "Active Change Freeze",
  domain: "itsm",
  appliesTo: ["incident"],
  relevantActions: ["resolve", "close", "auto_resolve"],
  severity: ConstraintSeverity.BLOCK,
  description:
    "Prevents incident resolution actions during an active change freeze. " +
    "When a change freeze is in effect, incident resolution may need manual " +
    "review to ensure the fix doesn't violate the freeze window.",
  evaluate: async (context: ConstraintContext): Promise<ConstraintResult> => {
    const changeFreezeActive =
      context.metadata["change_freeze_active"] === true;

    return {
      constraintId: "itsm:change_freeze_active",
      satisfied: !changeFreezeActive,
      severity: ConstraintSeverity.BLOCK,
      explanation: changeFreezeActive
        ? "An active change freeze is in effect. Incident resolution may require changes that violate the freeze window. Escalate to change management."
        : "No active change freeze detected.",
      involvedEntities: [context.targetEntity],
    };
  },
};

/**
 * Warn before reassigning a P1 incident — high-priority incidents
 * have visibility and reassignment can disrupt active war rooms.
 */
export const p1ReassignmentConstraint: ConstraintDefinition = {
  id: "itsm:p1_reassignment_caution",
  name: "P1 Reassignment Caution",
  domain: "itsm",
  appliesTo: ["incident"],
  relevantActions: ["reassign"],
  severity: ConstraintSeverity.WARN,
  description:
    "P1 incidents typically have active war rooms, executive visibility, " +
    "and established communication channels. Reassignment disrupts all of " +
    "these and should be done deliberately, not automatically.",
  evaluate: async (context: ConstraintContext): Promise<ConstraintResult> => {
    const priority = context.metadata["priority"] as string | undefined;
    const isP1 = priority === "P1";

    return {
      constraintId: "itsm:p1_reassignment_caution",
      satisfied: !isP1,
      severity: ConstraintSeverity.WARN,
      explanation: isP1
        ? "This is a P1 incident. Reassignment will disrupt the active war room and escalation chain. Confirm with the incident commander before proceeding."
        : "Incident is not P1. Standard reassignment procedures apply.",
      involvedEntities: [context.targetEntity],
    };
  },
};

/**
 * Check that the target assignment group has available capacity
 * before routing work to them.
 */
export const groupCapacityConstraint: ConstraintDefinition = {
  id: "itsm:group_capacity_check",
  name: "Assignment Group Capacity",
  domain: "itsm",
  appliesTo: ["incident", "problem", "change_request"],
  relevantActions: ["assign", "reassign"],
  severity: ConstraintSeverity.WARN,
  description:
    "Checks whether the target assignment group has available capacity. " +
    "Overloaded groups lead to SLA breaches and burnout.",
  evaluate: async (context: ConstraintContext): Promise<ConstraintResult> => {
    const activeCount =
      (context.metadata["target_group_active_tickets"] as number) ?? 0;
    const memberCount =
      (context.metadata["target_group_member_count"] as number) ?? 1;
    const ratio = activeCount / memberCount;
    const overloaded = ratio > 10;

    return {
      constraintId: "itsm:group_capacity_check",
      satisfied: !overloaded,
      severity: ConstraintSeverity.WARN,
      explanation: overloaded
        ? `Target group has ${activeCount} active tickets across ${memberCount} members (ratio: ${ratio.toFixed(1)}). Consider alternative assignment or escalation.`
        : `Target group capacity is within acceptable range (${ratio.toFixed(1)} tickets/member).`,
      involvedEntities: [context.targetEntity, ...context.relatedEntities],
    };
  },
};

/**
 * Prevent closing an incident if the related SLA has a penalty
 * clause and resolution time has been breached — flag for review.
 */
export const slaBreachReviewConstraint: ConstraintDefinition = {
  id: "itsm:sla_breach_review",
  name: "SLA Breach Review Required",
  domain: "itsm",
  appliesTo: ["incident"],
  relevantActions: ["close"],
  severity: ConstraintSeverity.WARN,
  description:
    "If an incident breached its SLA and the governing SLA contract has a " +
    "penalty clause, the closure should be reviewed by service management " +
    "before finalizing — documentation of the breach is required.",
  evaluate: async (context: ConstraintContext): Promise<ConstraintResult> => {
    const slaBreached = context.metadata["sla_breached"] === true;
    const hasPenalty = context.metadata["sla_has_penalty"] === true;
    const needsReview = slaBreached && hasPenalty;

    return {
      constraintId: "itsm:sla_breach_review",
      satisfied: !needsReview,
      severity: ConstraintSeverity.WARN,
      explanation: needsReview
        ? "This incident breached an SLA with a penalty clause. Closure requires a documented breach review. Route to service level management before closing."
        : "No SLA penalty breach detected. Standard closure procedures apply.",
      involvedEntities: [context.targetEntity],
    };
  },
};

/**
 * All ITSM constraints, ready for registration with the ConstraintEngine.
 */
export const itsmConstraints: ConstraintDefinition[] = [
  changeFreezeConstraint,
  p1ReassignmentConstraint,
  groupCapacityConstraint,
  slaBreachReviewConstraint,
];
