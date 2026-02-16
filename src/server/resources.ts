/**
 * MCP Resource Handlers — expose ontology knowledge as readable resources.
 *
 * Resources are the "readings" that the Basanos touchstone provides:
 * structured, semantic descriptions of domains, entity types,
 * relationships, and constraints that agents can reason over.
 */

import type { OntologyEngine } from "../ontology/engine.js";
import type { ConstraintEngine } from "../constraints/engine.js";

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export function listResources(
  ontologyEngine: OntologyEngine,
  constraintEngine: ConstraintEngine
): ResourceDefinition[] {
  const resources: ResourceDefinition[] = [];

  for (const domain of ontologyEngine.getDomains()) {
    resources.push({
      uri: `basanos://ontology/${domain.name}`,
      name: `${domain.label} Ontology`,
      description: `Complete semantic ontology for the ${domain.label} domain — entity types, properties, relationships, and their meanings.`,
      mimeType: "text/markdown",
    });

    resources.push({
      uri: `basanos://constraints/${domain.name}`,
      name: `${domain.label} Constraints`,
      description: `Business logic constraints for the ${domain.label} domain — conditions agents must evaluate before taking actions.`,
      mimeType: "text/markdown",
    });

    for (const entityType of domain.entityTypes) {
      resources.push({
        uri: `basanos://ontology/${domain.name}/${entityType.name}`,
        name: `${entityType.label} Schema`,
        description: entityType.description,
        mimeType: "application/json",
      });
    }
  }

  return resources;
}

export function readResource(
  uri: string,
  ontologyEngine: OntologyEngine,
  constraintEngine: ConstraintEngine
): { content: string; mimeType: string } | null {
  const parts = uri.replace("basanos://", "").split("/");

  if (parts[0] === "ontology" && parts.length === 2) {
    const domainName = parts[1];
    const description = ontologyEngine.describeDomain(domainName);
    return { content: description, mimeType: "text/markdown" };
  }

  if (parts[0] === "ontology" && parts.length === 3) {
    const [, domainName, typeName] = parts;
    const entityType = ontologyEngine.getEntityType(domainName, typeName);
    if (!entityType) return null;
    return {
      content: JSON.stringify(entityType, null, 2),
      mimeType: "application/json",
    };
  }

  if (parts[0] === "constraints" && parts.length === 2) {
    const domainName = parts[1];
    const description = constraintEngine.describeConstraints(domainName);
    return { content: description, mimeType: "text/markdown" };
  }

  return null;
}
