/**
 * Jira Connector Plugin (Mock)
 *
 * Demonstrates the connector plugin pattern with mock Jira data.
 * No real Jira credentials are needed. This plugin provides:
 *   - Mock deploy data correlated to real ServiceNow CIs
 *   - Cross-system constraint: block resolve if Jira has active deploy
 *   - Context enrichment: returns deploy status for a given service
 *
 * To convert this to a production Jira connector:
 *   1. Replace mock data with Jira REST API calls
 *   2. Add real authentication (API token or OAuth 2.0)
 *   3. Implement schema import from Jira's field API
 *   4. Add discovery heuristics for Jira-specific patterns
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { dump as yamlDump } from "js-yaml";
import type {
  ConnectorPlugin,
  EnvVarSpec,
  ConnectionResult,
  SchemaImportResult,
  SyncOptions,
  SyncResult,
  DiscoveredConstraint,
} from "../types.js";
import type { OntologyEngine } from "../../ontology/engine.js";
import type {
  ConstraintContext,
  ConstraintResult,
  ConstraintSeverity,
} from "../../constraints/types.js";

// ── Mock Data ─────────────────────────────────────────────────

interface JiraDeploy {
  key: string;
  summary: string;
  status: string;
  service: string;
  assignee: string;
  created: string;
}

const MOCK_DEPLOYS: JiraDeploy[] = [
  {
    key: "DEPLOY-4455",
    summary: "Recommendation Engine ML Model Update",
    status: "In Progress",
    service: "recommendationservice",
    assignee: "s.patel",
    created: "2026-02-16",
  },
  {
    key: "DEPLOY-4460",
    summary: "Payment Gateway TLS Upgrade",
    status: "Done",
    service: "ePayment",
    assignee: "m.jones",
    created: "2026-02-10",
  },
];

// ── Plugin Implementation ─────────────────────────────────────

class JiraPlugin implements ConnectorPlugin {
  readonly id = "jira";
  readonly label = "Jira (Mock)";
  readonly description =
    "Mock Jira connector for cross-system demo. Uses hardcoded deploy data " +
    "correlated to ServiceNow CIs. Replace with real Jira REST API calls " +
    "for production use.";

  private deploys: JiraDeploy[] = MOCK_DEPLOYS;

  getRequiredEnvVars(): EnvVarSpec[] {
    return [
      {
        name: "JIRA_BASE_URL",
        description: "Jira instance URL (e.g., https://your-org.atlassian.net)",
        required: false,
      },
      {
        name: "JIRA_API_TOKEN",
        description: "Jira API token for authentication",
        required: false,
        secret: true,
      },
      {
        name: "JIRA_USER_EMAIL",
        description: "Email associated with the API token",
        required: false,
      },
    ];
  }

  configureFromEnv(): boolean {
    // Mock connector is always available - no real credentials needed.
    // When real Jira env vars are present, a production implementation
    // would use them instead of mock data.
    return true;
  }

  async testConnection(): Promise<ConnectionResult> {
    // A real implementation would call GET /rest/api/3/myself
    return {
      success: true,
      message: "Jira mock connector ready (using demo data)",
    };
  }

  getDefaultTables(): string[] {
    return ["issue", "deploy", "sprint"];
  }

  async importSchemas(
    tables: string[],
    outputDir: string
  ): Promise<SchemaImportResult> {
    // Mock: generate a minimal Jira ontology
    const entityTypes = [
      {
        name: "jira_deploy",
        label: "Jira Deploy",
        description: "A deployment ticket in Jira",
        properties: [
          { name: "key", label: "Issue Key", type: "string", required: true, description: "Jira issue key" },
          { name: "summary", label: "Summary", type: "string", required: true, description: "Deploy summary" },
          { name: "status", label: "Status", type: "enum", required: true, description: "Deploy status", enumValues: ["To Do", "In Progress", "Done"] },
          { name: "service", label: "Service", type: "string", required: false, description: "Target service name" },
          { name: "assignee", label: "Assignee", type: "string", required: false, description: "Assigned developer" },
        ],
        relationships: [],
      },
    ];

    const domain = {
      name: "jira-mock",
      label: "Jira (Mock)",
      version: "0.1.0-mock",
      description: "Mock Jira ontology for cross-system demo.",
      entityTypes,
    };

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      `${outputDir}/ontology.yaml`,
      yamlDump(domain, { lineWidth: 120, noRefs: true, sortKeys: false }),
      "utf-8"
    );
    writeFileSync(
      `${outputDir}/provenance.json`,
      JSON.stringify({
        source: "mock-jira",
        importedAt: new Date().toISOString(),
        pipeline: "jira mock plugin",
        tablesImported: 1,
        fieldsImported: 5,
        referencesFound: 0,
      }, null, 2),
      "utf-8"
    );

    return {
      entityTypes: entityTypes as Array<Record<string, unknown>>,
      tablesImported: 1,
      fieldsImported: 5,
      referencesFound: 0,
    };
  }

  async syncEntities(
    ontologyEngine: OntologyEngine,
    _options?: SyncOptions
  ): Promise<SyncResult> {
    // Mock: add deploy entities
    let synced = 0;
    for (const deploy of this.deploys) {
      ontologyEngine.addEntity({
        id: `jira:deploy:${deploy.key}`,
        type: "jira_deploy",
        domain: "jira",
        properties: {
          key: deploy.key,
          summary: deploy.summary,
          status: deploy.status,
          service: deploy.service,
          assignee: deploy.assignee,
        },
        relationships: {},
      });
      synced++;
    }
    return { totalSynced: synced, totalErrors: 0, tables: ["deploy"] };
  }

  async discoverConstraints(
    domainName: string,
    outputPath: string
  ): Promise<DiscoveredConstraint[]> {
    const constraints: DiscoveredConstraint[] = [
      {
        id: "cross-system:jira_deploy_active",
        name: "Active Jira Deploy on Service",
        domain: domainName,
        appliesTo: ["incident"],
        relevantActions: ["resolve", "close"],
        severity: "block",
        status: "candidate",
        description:
          "Blocks incident resolution when Jira has an active deploy ticket targeting the same " +
          "service or CI. A deploy in progress means the environment is changing - resolving " +
          "incidents against it risks false fixes.",
        conditions: [],
        violationMessage:
          "Jira has active deploy(s) on this service. Resolving the incident while a deploy " +
          "is in progress risks a false fix. Wait for deploy completion.",
        satisfiedMessage: "No active Jira deploys on this service.",
        evidence: `${this.getActiveDeploys().length} active deploy(s) in mock Jira data`,
        evaluate: async (context: ConstraintContext): Promise<ConstraintResult> => {
          const deploys = (context.metadata.jira_open_deploys as number) || 0;
          return {
            constraintId: "cross-system:jira_deploy_active",
            satisfied: deploys === 0,
            severity: "block" as ConstraintSeverity,
            explanation:
              deploys > 0
                ? `Jira has ${deploys} active deploy(s) on this service. Resolving the incident while a deploy is in progress risks a false fix. Wait for deploy completion.`
                : "No active Jira deploys on this service.",
            involvedEntities: [context.targetEntity],
          };
        },
      },
    ];

    // Write constraints YAML
    if (outputPath) {
      const yamlConstraints = constraints.map((c) => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        appliesTo: c.appliesTo,
        relevantActions: c.relevantActions,
        severity: c.severity,
        status: c.status,
        description: c.description,
        conditions: c.conditions,
        violationMessage: c.violationMessage,
        satisfiedMessage: c.satisfiedMessage,
      }));

      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(
        outputPath,
        yamlDump({ constraints: yamlConstraints }, { lineWidth: 120, noRefs: true, sortKeys: false }),
        "utf-8"
      );
    }

    return constraints;
  }

  async enrichContext(
    entityRef: string,
    _action: string
  ): Promise<Record<string, unknown>> {
    // entityRef is expected to be a CI/service name (e.g., "recommendationservice")
    const serviceKey = entityRef.split("/")[0].toLowerCase();
    const active = this.getActiveDeploys().filter((d) =>
      d.service.toLowerCase().includes(serviceKey)
    );

    return {
      source: "jira",
      jira_open_deploys: active.length,
      jira_deploy_details: active.map((d) => ({
        key: d.key,
        summary: d.summary,
        status: d.status,
        assignee: d.assignee,
      })),
    };
  }

  /**
   * Get active (non-Done) deploys.
   */
  getActiveDeploys(): JiraDeploy[] {
    return this.deploys.filter((d) => d.status !== "Done");
  }

  /**
   * Get all deploys (for API endpoint).
   */
  getAllDeploys(): JiraDeploy[] {
    return this.deploys;
  }
}

export function createPlugin(): ConnectorPlugin {
  return new JiraPlugin();
}
