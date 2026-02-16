/**
 * A2A Agent Card Types — typed capability descriptions
 * for agent-to-agent discovery.
 *
 * When another agent discovers Basanos via A2A, it sees
 * typed capabilities with preconditions and postconditions,
 * like a proper API contract but for agent reasoning.
 *
 * Based on the Google A2A protocol specification.
 */

/**
 * A skill that the agent can perform, with semantic metadata
 * describing what it does, what it needs, and what it produces.
 */
export interface AgentSkill {
  /** Unique skill identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semantic description for agent reasoning */
  description: string;
  /** MIME types this skill can consume */
  inputModes: string[];
  /** MIME types this skill can produce */
  outputModes: string[];
  /** Tags for skill discovery */
  tags: string[];
  /** Preconditions that must be met before invoking this skill */
  preconditions: SkillCondition[];
  /** Postconditions guaranteed after successful invocation */
  postconditions: SkillCondition[];
}

/**
 * A condition (pre or post) for a skill invocation.
 */
export interface SkillCondition {
  /** Condition identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Entity types this condition relates to */
  relatedEntityTypes: string[];
}

/**
 * An A2A Agent Card — the identity and capability description
 * that Basanos publishes for discovery by other agents.
 */
export interface AgentCard {
  /** Agent name */
  name: string;
  /** Agent description */
  description: string;
  /** Semantic version */
  version: string;
  /** URL where this agent can be reached */
  url: string;
  /** Supported protocol versions */
  protocolVersions: string[];
  /** Domains this agent has knowledge of */
  domains: string[];
  /** Skills this agent offers */
  skills: AgentSkill[];
  /** Authentication requirements */
  authentication: {
    schemes: string[];
  };
}

/**
 * Generate a Basanos agent card from registered domains and capabilities.
 */
export function generateAgentCard(config: {
  url: string;
  domains: string[];
}): AgentCard {
  return {
    name: "basanos",
    description:
      "Semantic ontology and context intelligence server. " +
      "Provides typed domain knowledge, entity relationship graphs, " +
      "and constraint-aware guardrails for autonomous agent reasoning.",
    version: "0.1.0",
    url: config.url,
    protocolVersions: ["0.2.0"],
    domains: config.domains,
    skills: [
      {
        id: "ontology:describe",
        name: "Describe Domain Ontology",
        description:
          "Returns the complete semantic ontology for a domain, including " +
          "entity types, properties, relationships, and their meanings.",
        inputModes: ["application/json"],
        outputModes: ["text/markdown", "application/json"],
        tags: ["ontology", "schema", "discovery"],
        preconditions: [],
        postconditions: [
          {
            id: "agent_has_domain_context",
            description:
              "The requesting agent now has full semantic context for the domain.",
            relatedEntityTypes: [],
          },
        ],
      },
      {
        id: "ontology:relationships",
        name: "Get Entity Relationships",
        description:
          "Returns all direct and inverse relationships for an entity type, " +
          "enabling impact analysis and dependency chain traversal.",
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        tags: ["ontology", "relationships", "impact"],
        preconditions: [
          {
            id: "domain_exists",
            description: "The target domain must be registered.",
            relatedEntityTypes: [],
          },
        ],
        postconditions: [
          {
            id: "agent_has_relationship_graph",
            description:
              "The requesting agent can traverse entity relationships.",
            relatedEntityTypes: [],
          },
        ],
      },
      {
        id: "constraints:check",
        name: "Check Business Constraints",
        description:
          "Evaluates all applicable business logic constraints before an " +
          "agent takes an action. Returns a structured verdict: allowed or blocked.",
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        tags: ["constraints", "guardrails", "compliance"],
        preconditions: [
          {
            id: "action_specified",
            description: "The intended action and target entity must be provided.",
            relatedEntityTypes: [],
          },
        ],
        postconditions: [
          {
            id: "verdict_issued",
            description:
              "A structured verdict (allowed/blocked) with explanations " +
              "and audit trail has been issued.",
            relatedEntityTypes: [],
          },
        ],
      },
      {
        id: "audit:query",
        name: "Query Audit Trail",
        description:
          "Retrieves the audit log of constraint evaluations for " +
          "compliance, post-mortems, and agent behavior debugging.",
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        tags: ["audit", "compliance", "debugging"],
        preconditions: [],
        postconditions: [
          {
            id: "audit_entries_returned",
            description:
              "Filtered audit entries with timestamps, verdicts, and context.",
            relatedEntityTypes: [],
          },
        ],
      },
    ],
    authentication: {
      schemes: ["none"],
    },
  };
}
