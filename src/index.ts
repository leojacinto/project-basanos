#!/usr/bin/env node

/**
 * Basanos — MCP Server Entry Point
 *
 * A living tarot for the agentic age.
 * Semantic ontology and context intelligence over MCP.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { OntologyEngine } from "./ontology/engine.js";
import { ConstraintEngine } from "./constraints/engine.js";
import { validateDomainSchema } from "./ontology/schema.js";

import { itsmDomain } from "./domains/itsm/ontology.js";
import { itsmConstraints } from "./domains/itsm/constraints.js";

import { readResource } from "./server/resources.js";

// ── Initialize engines ────────────────────────────────────────

const ontologyEngine = new OntologyEngine();
const constraintEngine = new ConstraintEngine();

// ── Load ITSM domain ─────────────────────────────────────────

const itsmErrors = validateDomainSchema(itsmDomain);
if (itsmErrors.length > 0) {
  console.error("ITSM domain schema validation errors:", itsmErrors);
  process.exit(1);
}

ontologyEngine.registerDomain(itsmDomain);

for (const constraint of itsmConstraints) {
  constraintEngine.register(constraint);
}

// ── Create MCP Server ─────────────────────────────────────────

const server = new McpServer({
  name: "basanos",
  version: "0.1.0",
});

// ── Register Resources ────────────────────────────────────────

server.resource(
  "ontology-itsm",
  "basanos://ontology/itsm",
  {
    description:
      "Complete semantic ontology for the ITSM domain — entity types, properties, relationships, and their meanings.",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const result = readResource(
      uri.href,
      ontologyEngine,
      constraintEngine
    );
    return {
      contents: [
        {
          uri: uri.href,
          text: result?.content ?? "Resource not found",
          mimeType: result?.mimeType ?? "text/plain",
        },
      ],
    };
  }
);

server.resource(
  "constraints-itsm",
  "basanos://constraints/itsm",
  {
    description:
      "Business logic constraints for the ITSM domain — conditions agents must evaluate before taking actions.",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const result = readResource(
      uri.href,
      ontologyEngine,
      constraintEngine
    );
    return {
      contents: [
        {
          uri: uri.href,
          text: result?.content ?? "Resource not found",
          mimeType: result?.mimeType ?? "text/plain",
        },
      ],
    };
  }
);

// ── Register Tools ────────────────────────────────────────────

server.tool(
  "basanos_describe_domain",
  "Get the complete semantic ontology for a domain — entity types, properties, relationships, and their meanings.",
  { domain: z.string().describe("Domain name (e.g., 'itsm')") },
  async ({ domain }) => {
    const description = ontologyEngine.describeDomain(domain);
    return { content: [{ type: "text" as const, text: description }] };
  }
);

server.tool(
  "basanos_get_entity_type",
  "Get the detailed schema for a specific entity type.",
  {
    domain: z.string().describe("Domain name"),
    entity_type: z.string().describe("Entity type name"),
  },
  async ({ domain, entity_type }) => {
    const entityType = ontologyEngine.getEntityType(domain, entity_type);
    if (!entityType) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Entity type "${entity_type}" not found in domain "${domain}"`,
          },
        ],
      };
    }
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(entityType, null, 2) },
      ],
    };
  }
);

server.tool(
  "basanos_get_relationships",
  "Get all relationships for an entity type — direct and inverse.",
  {
    domain: z.string().describe("Domain name"),
    entity_type: z.string().describe("Entity type name"),
  },
  async ({ domain, entity_type }) => {
    const relationships = ontologyEngine.getRelationshipsFor(
      domain,
      entity_type
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(relationships, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "basanos_check_constraints",
  "Evaluate business logic constraints before taking an action. ALWAYS call this before mutating operations.",
  {
    action: z.string().describe("Intended action (e.g., 'resolve', 'reassign', 'close', 'assign')"),
    target_entity_id: z.string().describe("Target entity ID (domain:type:id)"),
    related_entity_ids: z.string().optional().describe("Comma-separated related entity IDs"),
    metadata_json: z.string().optional().describe("JSON string of additional context metadata"),
  },
  async ({ action, target_entity_id, related_entity_ids, metadata_json }) => {
    const relatedIds = related_entity_ids
      ? related_entity_ids.split(",").map((s: string) => s.trim())
      : [];
    const metadata = metadata_json ? JSON.parse(metadata_json) : {};

    const verdict = await constraintEngine.evaluate({
      intendedAction: action,
      targetEntity: target_entity_id,
      relatedEntities: relatedIds,
      timestamp: new Date(),
      metadata,
    });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(verdict, null, 2) },
      ],
    };
  }
);

server.tool(
  "basanos_list_constraints",
  "List all business logic constraints for a domain.",
  { domain: z.string().describe("Domain name (e.g., 'itsm')") },
  async ({ domain }) => {
    const description = constraintEngine.describeConstraints(domain);
    return { content: [{ type: "text" as const, text: description }] };
  }
);

server.tool(
  "basanos_audit_log",
  "Retrieve the audit trail of all constraint evaluations. Every check_constraints call is logged with timestamp, context, and verdict. Use for compliance, post-mortems, and debugging agent behavior.",
  {
    action: z.string().optional().describe("Filter by action (e.g., 'resolve')"),
    entity_id: z.string().optional().describe("Filter by target entity ID"),
  },
  async ({ action, entity_id }) => {
    const filter: { action?: string; entityId?: string } = {};
    if (action) filter.action = action;
    if (entity_id) filter.entityId = entity_id;

    const hasFilter = filter.action || filter.entityId;
    const entries = hasFilter
      ? constraintEngine.getAuditEntriesFor(filter)
      : constraintEngine.getAuditLog();
    const summary = constraintEngine.getAuditSummary();

    const result = {
      summary,
      entries: entries.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        action: e.verdict.context.intendedAction,
        target: e.verdict.context.targetEntity,
        allowed: e.verdict.allowed,
        summary: e.verdict.summary,
      })),
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Start Server ──────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Basanos MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
