/**
 * Ontology Engine — resolves and traverses the semantic knowledge graph.
 *
 * The engine loads domain schemas and provides typed traversal
 * capabilities so agents can reason over entity relationships
 * rather than querying flat tables.
 */

import type {
  DomainSchema,
  Entity,
  EntityId,
  EntityTypeSchema,
  RelationshipSchema,
} from "./types.js";

export class OntologyEngine {
  private domains: Map<string, DomainSchema> = new Map();
  private entities: Map<EntityId, Entity> = new Map();

  /**
   * Register a domain schema with the engine.
   */
  registerDomain(schema: DomainSchema): void {
    this.domains.set(schema.name, schema);
  }

  /**
   * Get all registered domain schemas.
   */
  getDomains(): DomainSchema[] {
    return Array.from(this.domains.values());
  }

  /**
   * Get a specific domain schema by name.
   */
  getDomain(name: string): DomainSchema | undefined {
    return this.domains.get(name);
  }

  /**
   * Get an entity type schema from any registered domain.
   */
  getEntityType(
    domain: string,
    typeName: string
  ): EntityTypeSchema | undefined {
    const domainSchema = this.domains.get(domain);
    if (!domainSchema) return undefined;
    return domainSchema.entityTypes.find((et) => et.name === typeName);
  }

  /**
   * Get all relationships for an entity type, including inverse
   * relationships from other entity types that target it.
   */
  getRelationshipsFor(
    domain: string,
    typeName: string
  ): RelationshipSchema[] {
    const domainSchema = this.domains.get(domain);
    if (!domainSchema) return [];

    const direct: RelationshipSchema[] = [];
    const inverse: RelationshipSchema[] = [];

    for (const entityType of domainSchema.entityTypes) {
      for (const rel of entityType.relationships) {
        if (entityType.name === typeName) {
          direct.push(rel);
        }
        if (rel.targetType === typeName && rel.inverseName) {
          inverse.push({
            ...rel,
            name: rel.inverseName,
            label: `Inverse: ${rel.label}`,
            sourceType: rel.targetType,
            targetType: rel.sourceType,
            inverseName: rel.name,
          });
        }
      }
    }

    return [...direct, ...inverse];
  }

  /**
   * Store an entity instance in the engine.
   */
  addEntity(entity: Entity): void {
    this.entities.set(entity.id, entity);
  }

  /**
   * Get all stored entity instances.
   */
  getAllEntities(): Entity[] {
    return Array.from(this.entities.values());
  }

  /**
   * Retrieve an entity by ID.
   */
  getEntity(id: EntityId): Entity | undefined {
    return this.entities.get(id);
  }

  /**
   * Traverse relationships from a given entity, returning
   * connected entities up to a specified depth.
   */
  traverse(
    startId: EntityId,
    maxDepth: number = 2
  ): Map<EntityId, { entity: Entity; depth: number }> {
    const visited = new Map<EntityId, { entity: Entity; depth: number }>();
    const queue: Array<{ id: EntityId; depth: number }> = [
      { id: startId, depth: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id) || current.depth > maxDepth) continue;

      const entity = this.entities.get(current.id);
      if (!entity) continue;

      visited.set(current.id, { entity, depth: current.depth });

      if (current.depth < maxDepth) {
        for (const relatedIds of Object.values(entity.relationships)) {
          for (const relatedId of relatedIds) {
            if (!visited.has(relatedId)) {
              queue.push({ id: relatedId, depth: current.depth + 1 });
            }
          }
        }
      }
    }

    return visited;
  }

  /**
   * Generate a human-readable ontology summary for agent reasoning.
   * This is what gets exposed as an MCP resource — the "reading"
   * that the Basanos touchstone provides.
   */
  describeDomain(domainName: string): string {
    const domain = this.domains.get(domainName);
    if (!domain) return `Unknown domain: ${domainName}`;

    const lines: string[] = [
      `# ${domain.label} (${domain.name}) v${domain.version}`,
      domain.description,
      "",
      "## Entity Types",
    ];

    for (const et of domain.entityTypes) {
      lines.push(`\n### ${et.label} (${et.name})`);
      lines.push(et.description);
      lines.push("\nProperties:");
      for (const prop of et.properties) {
        const req = prop.required ? " [required]" : "";
        lines.push(`  - ${prop.label} (${prop.type}${req}): ${prop.description}`);
      }
      if (et.relationships.length > 0) {
        lines.push("\nRelationships:");
        for (const rel of et.relationships) {
          lines.push(
            `  - ${rel.label}: ${et.name} → ${rel.targetType} (${rel.cardinality}) — ${rel.description}`
          );
        }
      }
    }

    return lines.join("\n");
  }
}
