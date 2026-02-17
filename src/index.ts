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

import { existsSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { OntologyEngine } from "./ontology/engine.js";
import { ConstraintEngine } from "./constraints/engine.js";
import { validateDomainSchema } from "./ontology/schema.js";

import { itsmDomain } from "./domains/itsm/ontology.js";
import { itsmConstraints } from "./domains/itsm/constraints.js";
import { loadDomainFromYaml, loadConstraintsFromYaml } from "./loader.js";

import { readResource } from "./server/resources.js";
import { generateAgentCard } from "./a2a/types.js";
import { ServiceNowMCPClient } from "./connectors/servicenow-mcp.js";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

// ── Initialize engines ────────────────────────────────────────

const ontologyEngine = new OntologyEngine();
const constraintEngine = new ConstraintEngine();

// ── Load all domains dynamically ─────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const domainsDir = resolve(__dirname, "..", "domains");
let domainsLoaded = 0;
let constraintsLoaded = 0;

if (existsSync(domainsDir)) {
  for (const entry of readdirSync(domainsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const domainDir = resolve(domainsDir, entry.name);
    const ontologyYaml = resolve(domainDir, "ontology.yaml");
    const constraintsYaml = resolve(domainDir, "constraints.yaml");
    const discoveredYaml = resolve(domainDir, "discovered-constraints.yaml");

    if (existsSync(ontologyYaml)) {
      console.error(`Loading domain: ${entry.name}`);
      const domain = loadDomainFromYaml(ontologyYaml);
      const errors = validateDomainSchema(domain);
      if (errors.length > 0) {
        console.error(`  Validation warnings for ${entry.name}:`, errors);
      }
      ontologyEngine.registerDomain(domain);
      domainsLoaded++;
    }

    if (existsSync(constraintsYaml)) {
      console.error(`  Loading constraints: ${constraintsYaml}`);
      for (const c of loadConstraintsFromYaml(constraintsYaml)) {
        constraintEngine.register(c);
        constraintsLoaded++;
      }
    }

    if (existsSync(discoveredYaml)) {
      console.error(`  Loading discovered constraints: ${discoveredYaml}`);
      for (const c of loadConstraintsFromYaml(discoveredYaml)) {
        constraintEngine.register(c);
        constraintsLoaded++;
      }
    }
  }
}

// Fallback: if no YAML domains found, use built-in TypeScript definitions
if (domainsLoaded === 0) {
  console.error("No YAML domains found, using built-in ITSM TypeScript definitions");
  ontologyEngine.registerDomain(itsmDomain);
  for (const constraint of itsmConstraints) {
    constraintEngine.register(constraint);
    constraintsLoaded++;
  }
  domainsLoaded = 1;
}

console.error(`Loaded ${domainsLoaded} domain(s), ${constraintsLoaded} constraint(s)`);

// ── Initialize ServiceNow MCP Client (if configured) ────────

let snMCPClient: ServiceNowMCPClient | null = null;
const snMCPServerUrl = process.env.SERVICENOW_MCP_SERVER_URL;
const snInstanceUrl = process.env.SERVICENOW_INSTANCE_URL;
const snTokenFile = process.env.SERVICENOW_MCP_TOKEN_FILE || `${process.env.HOME}/.claude/servicenow-tokens.json`;
const snClientId = process.env.SERVICENOW_CLIENT_ID;
const snClientSecret = process.env.SERVICENOW_CLIENT_SECRET;

if ((snMCPServerUrl || snInstanceUrl) && existsSync(snTokenFile)) {
  snMCPClient = new ServiceNowMCPClient({
    mcpServerUrl: snMCPServerUrl || undefined,
    instanceUrl: snMCPServerUrl ? undefined : snInstanceUrl,
    serverName: snMCPServerUrl ? undefined : (process.env.SERVICENOW_MCP_SERVER || "sn_mcp_server_default"),
    tokenFile: snTokenFile,
    clientId: snClientId,
    clientSecret: snClientSecret,
  });
  console.error(`ServiceNow MCP Client initialized: ${snMCPClient.getInstanceUrl()} (server: ${snMCPClient.getServerName()})`);
} else {
  console.error("ServiceNow MCP proxy disabled (no MCP Server URL or token file)");
}

// ── Create MCP Server ─────────────────────────────────────────

const server = new McpServer({
  name: "basanos",
  version: "0.1.0",
});

// ── Register Resources (dynamic per domain) ─────────────────

for (const domain of ontologyEngine.getDomains()) {
  server.resource(
    `ontology-${domain.name}`,
    `basanos://ontology/${domain.name}`,
    {
      description: `Complete semantic ontology for the ${domain.label} domain.`,
      mimeType: "text/markdown",
    },
    async (uri) => {
      const result = readResource(uri.href, ontologyEngine, constraintEngine);
      return {
        contents: [{
          uri: uri.href,
          text: result?.content ?? "Resource not found",
          mimeType: result?.mimeType ?? "text/plain",
        }],
      };
    }
  );

  server.resource(
    `constraints-${domain.name}`,
    `basanos://constraints/${domain.name}`,
    {
      description: `Business logic constraints for the ${domain.label} domain.`,
      mimeType: "text/markdown",
    },
    async (uri) => {
      const result = readResource(uri.href, ontologyEngine, constraintEngine);
      return {
        contents: [{
          uri: uri.href,
          text: result?.content ?? "Resource not found",
          mimeType: result?.mimeType ?? "text/plain",
        }],
      };
    }
  );

  for (const entityType of domain.entityTypes) {
    server.resource(
      `entity-${domain.name}-${entityType.name}`,
      `basanos://ontology/${domain.name}/${entityType.name}`,
      {
        description: entityType.description,
        mimeType: "application/json",
      },
      async (uri) => {
        const result = readResource(uri.href, ontologyEngine, constraintEngine);
        return {
          contents: [{
            uri: uri.href,
            text: result?.content ?? "Resource not found",
            mimeType: result?.mimeType ?? "application/json",
          }],
        };
      }
    );
  }
}

const agentCard = generateAgentCard({
  url: "stdio://basanos",
  domains: ontologyEngine.getDomains().map((d) => d.name),
});

server.resource(
  "agent-card",
  "basanos://agent-card",
  {
    description: "A2A Agent Card describing Basanos capabilities, skills, and preconditions/postconditions.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: JSON.stringify(agentCard, null, 2),
      mimeType: "application/json",
    }],
  })
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

// ── Register Proxied ServiceNow MCP Tools ────────────────────

/**
 * Derive an action name from a ServiceNow MCP tool name.
 * This maps tool names to constraint-relevant actions.
 */
function deriveAction(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (lower.includes("look up") || lower.includes("lookup") || lower.includes("get")) return "lookup";
  if (lower.includes("summariz")) return "summarize";
  if (lower.includes("resolve")) return "resolve";
  if (lower.includes("close")) return "close";
  if (lower.includes("assign")) return "assign";
  if (lower.includes("approve")) return "approve";
  if (lower.includes("create")) return "create";
  if (lower.includes("update")) return "update";
  if (lower.includes("delete")) return "delete";
  return lower.replace(/\s+/g, "_");
}

async function registerProxiedTools() {
  if (!snMCPClient) return;

  try {
    const tools = await snMCPClient.fetchTools();
    console.error(`Registering ${tools.length} proxied ServiceNow MCP tools...`);

    for (const tool of tools) {
      const safeName = "sn_" + tool.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "");
      const action = deriveAction(tool.name);

      // Build zod schema from tool inputs
      const schemaFields: Record<string, z.ZodTypeAny> = {};
      for (const [inputName, inputDef] of Object.entries(tool.tool_inputs || {})) {
        let field: z.ZodTypeAny;
        if (inputDef.type === "number") {
          field = z.number().describe(inputDef.description || inputName);
        } else {
          field = z.string().describe(inputDef.description || inputName);
        }
        schemaFields[inputName] = inputDef.required ? field : field.optional();
      }

      // Add optional constraint context fields
      schemaFields["_target_entity"] = z.string().optional().describe(
        "Target entity ID for constraint checking (e.g., servicenow-live:incident:INC001)"
      );

      const description =
        `[Proxied from ServiceNow] ${tool.description || tool.name}\n\n` +
        `Basanos enforces promoted constraints before forwarding this call to ServiceNow. ` +
        `If a constraint blocks the action, the call will NOT reach ServiceNow.`;

      server.tool(
        safeName,
        description.substring(0, 1024),
        schemaFields,
        async (args: Record<string, unknown>) => {
          const targetEntity = (args._target_entity as string) || `servicenow:unknown:unknown`;
          // Remove internal fields before forwarding
          const snArgs = { ...args };
          delete snArgs._target_entity;

          // Check constraints before forwarding
          const verdict = await constraintEngine.evaluate({
            intendedAction: action,
            targetEntity,
            relatedEntities: [],
            timestamp: new Date(),
            metadata: { tool_name: tool.name, tool_type: tool.tool_type, ...snArgs },
          });

          if (!verdict.allowed) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    blocked: true,
                    tool: tool.name,
                    action,
                    verdict: {
                      allowed: false,
                      summary: verdict.summary,
                      results: verdict.results,
                      evaluatedAt: verdict.evaluatedAt,
                    },
                    message: "This action was BLOCKED by Basanos constraints. The call was NOT forwarded to ServiceNow.",
                  }, null, 2),
                },
              ],
            };
          }

          // Constraints passed - forward to ServiceNow
          try {
            const result = await snMCPClient!.executeTool(tool.name, snArgs);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    blocked: false,
                    tool: tool.name,
                    action,
                    constraintVerdict: {
                      allowed: true,
                      summary: verdict.summary,
                      evaluatedAt: verdict.evaluatedAt,
                    },
                    result,
                  }, null, 2),
                },
              ],
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: true,
                    tool: tool.name,
                    message: `ServiceNow MCP call failed: ${String(err)}`,
                    constraintVerdict: { allowed: true, summary: verdict.summary },
                  }, null, 2),
                },
              ],
            };
          }
        }
      );

      console.error(`  Registered: ${safeName} (action: ${action}, type: ${tool.tool_type})`);
    }
  } catch (err) {
    console.error("Failed to register proxied ServiceNow MCP tools:", String(err));
  }
}

// ── Start Server ──────────────────────────────────────────────

async function main() {
  // Register proxied SN MCP tools before connecting
  await registerProxiedTools();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Basanos MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
