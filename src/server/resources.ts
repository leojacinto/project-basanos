/**
 * MCP Resource Handlers — expose ontology knowledge as readable resources.
 *
 * Resources are the "readings" that the Basanos touchstone provides:
 * structured, semantic descriptions of domains, entity types,
 * relationships, and constraints that agents can reason over.
 */

import type { OntologyEngine } from "../ontology/engine.js";
import type { ConstraintEngine } from "../constraints/engine.js";

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
