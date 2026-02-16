/**
 * MCP Tool Handlers — expose ontology queries and constraint
 * evaluation as callable tools with semantic metadata.
 *
 * Each tool carries its business constraints as part of the
 * tool description, so agents are aware of guardrails before invocation.
 */

import { z } from "zod";
import type { OntologyEngine } from "../ontology/engine.js";
import type { ConstraintEngine } from "../constraints/engine.js";

/**
 * Tool definitions for MCP registration.
 */
export function getToolDefinitions() {
  return [
    {
      name: "basanos_describe_domain",
      description:
        "Get the complete semantic ontology for a domain — entity types, " +
        "properties, relationships, and their meanings. Use this to understand " +
        "what entities exist, how they relate, and what they mean before taking " +
        "any actions.",
      inputSchema: {
        type: "object" as const,
        properties: {
          domain: {
            type: "string",
            description: "Domain name (e.g., 'itsm')",
          },
        },
        required: ["domain"],
      },
    },
    {
      name: "basanos_get_entity_type",
      description:
        "Get the detailed schema for a specific entity type, including all " +
        "properties, relationships, and their semantic descriptions.",
      inputSchema: {
        type: "object" as const,
        properties: {
          domain: {
            type: "string",
            description: "Domain name (e.g., 'itsm')",
          },
          entity_type: {
            type: "string",
            description: "Entity type name (e.g., 'incident', 'business_service')",
          },
        },
        required: ["domain", "entity_type"],
      },
    },
    {
      name: "basanos_get_relationships",
      description:
        "Get all relationships for an entity type — both direct relationships " +
        "and inverse relationships from other types. Essential for understanding " +
        "impact paths and dependency chains.",
      inputSchema: {
        type: "object" as const,
        properties: {
          domain: {
            type: "string",
            description: "Domain name",
          },
          entity_type: {
            type: "string",
            description: "Entity type name",
          },
        },
        required: ["domain", "entity_type"],
      },
    },
    {
      name: "basanos_check_constraints",
      description:
        "Evaluate business logic constraints before taking an action. " +
        "Returns a verdict (allowed/blocked) with explanations. " +
        "ALWAYS call this before performing mutating operations on entities.",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            description:
              "The intended action (e.g., 'resolve', 'reassign', 'close', 'assign')",
          },
          target_entity_id: {
            type: "string",
            description: "ID of the entity the action targets (domain:type:id format)",
          },
          related_entity_ids: {
            type: "array",
            items: { type: "string" },
            description: "IDs of related entities relevant to constraint evaluation",
          },
          metadata: {
            type: "object",
            description:
              "Additional context for constraint evaluation (e.g., priority, " +
              "change_freeze_active, sla_breached, target_group_active_tickets)",
          },
        },
        required: ["action", "target_entity_id"],
      },
    },
    {
      name: "basanos_list_constraints",
      description:
        "List all business logic constraints for a domain. Use this to understand " +
        "what guardrails exist before planning a sequence of actions.",
      inputSchema: {
        type: "object" as const,
        properties: {
          domain: {
            type: "string",
            description: "Domain name (e.g., 'itsm')",
          },
        },
        required: ["domain"],
      },
    },
  ];
}

/**
 * Input validation schemas (Zod).
 */
const DescribeDomainInput = z.object({ domain: z.string() });
const GetEntityTypeInput = z.object({
  domain: z.string(),
  entity_type: z.string(),
});
const GetRelationshipsInput = z.object({
  domain: z.string(),
  entity_type: z.string(),
});
const CheckConstraintsInput = z.object({
  action: z.string(),
  target_entity_id: z.string(),
  related_entity_ids: z.array(z.string()).optional().default([]),
  metadata: z.record(z.unknown()).optional().default({}),
});
const ListConstraintsInput = z.object({ domain: z.string() });

/**
 * Handle a tool invocation.
 */
export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ontologyEngine: OntologyEngine,
  constraintEngine: ConstraintEngine
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  switch (toolName) {
    case "basanos_describe_domain": {
      const { domain } = DescribeDomainInput.parse(args);
      const description = ontologyEngine.describeDomain(domain);
      return { content: [{ type: "text", text: description }] };
    }

    case "basanos_get_entity_type": {
      const { domain, entity_type } = GetEntityTypeInput.parse(args);
      const entityType = ontologyEngine.getEntityType(domain, entity_type);
      if (!entityType) {
        return {
          content: [
            {
              type: "text",
              text: `Entity type "${entity_type}" not found in domain "${domain}"`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(entityType, null, 2) }],
      };
    }

    case "basanos_get_relationships": {
      const { domain, entity_type } = GetRelationshipsInput.parse(args);
      const relationships = ontologyEngine.getRelationshipsFor(
        domain,
        entity_type
      );
      return {
        content: [
          { type: "text", text: JSON.stringify(relationships, null, 2) },
        ],
      };
    }

    case "basanos_check_constraints": {
      const input = CheckConstraintsInput.parse(args);
      const verdict = await constraintEngine.evaluate({
        intendedAction: input.action,
        targetEntity: input.target_entity_id,
        relatedEntities: input.related_entity_ids,
        timestamp: new Date(),
        metadata: input.metadata,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(verdict, null, 2) }],
      };
    }

    case "basanos_list_constraints": {
      const { domain } = ListConstraintsInput.parse(args);
      const description = constraintEngine.describeConstraints(domain);
      return { content: [{ type: "text", text: description }] };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
      };
  }
}
