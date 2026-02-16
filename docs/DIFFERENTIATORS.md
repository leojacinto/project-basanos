# Why Basanos? (And why not just Claude Desktop?)

A critical, honest assessment of where Basanos adds value and where it doesn't.

## Where Claude Desktop is genuinely enough

If the use case is a knowledgeable human sitting at a desk, asking Claude about a ServiceNow instance through an MCP server, Claude's general reasoning is strong enough to figure out most entity relationships on the fly. You give it raw CMDB data and incident records, it'll infer the dependency chain. For a single expert interacting with a top-tier model, Basanos is arguably redundant.

Claude Desktop with a good MCP server already provides:
- Direct querying of ServiceNow data
- On-the-fly relationship reasoning
- Human-correctable output (you catch the mistakes)

**If your entire use case is "me + Claude + my data," you probably don't need Basanos.**

## Where Basanos earns its existence

The value appears the moment there is no human in the loop.

### 1. Autonomous agents need encoded judgment

Claude Desktop is a human-in-the-loop tool. You are the touchstone. You read Claude's output and course-correct when it misunderstands a relationship or misses a constraint. You know a change freeze is active because you were in the CAB meeting yesterday. Claude doesn't.

An A2A agent resolving incidents at 3am doesn't have you to sanity-check it. The ontology *is* the human judgment, encoded. Without it, the agent reasons from raw data every single time, re-deriving relationships that should be known facts.

### 2. Not every model is Claude

Claude's reasoning is best-in-class. A DeepSeek agent, a smaller task-specific model, a customer running GPT-4o-mini to keep costs down: they need the domain understanding *given* to them because they can't reliably infer it from raw data. Basanos levels up weaker models by handing them structured understanding they can't generate themselves.

### 3. Multiple agents need shared truth

Two agents operating on the same incident via A2A will each independently reason about the entity graph and potentially reach different conclusions. Basanos gives them a single source of semantic truth. No drift, no contradictions.

### 4. Constraints are architectural, not conversational

Claude Desktop can be *told* "don't resolve during a change freeze" in a system prompt. That is a suggestion to a reasoning engine. It can be ignored, forgotten mid-conversation, or overridden by creative prompting.

Basanos returns a structured `BLOCK` verdict with entity IDs, severity levels, and explanations. The difference is the same as "please don't drop the production database" versus a database permission that prevents it. Enterprise operations teams will never trust a suggestion where they need a guarantee.

### 5. Ontology compounds, conversations don't

Every Claude Desktop session starts from zero context. Basanos persists the domain model. As the ontology accumulates knowledge (new relationships discovered, constraints refined, edge cases encoded), every connected agent benefits immediately. Knowledge becomes a persistent, growing asset rather than an ephemeral conversation.

### 6. Testability and auditability

You can unit test an ontology. You can regression-test constraint logic. You can audit every verdict with timestamps, entity references, and structured explanations.

You cannot unit test a Claude conversation. For enterprise adoption, compliance requirements, and incident post-mortems, this is non-negotiable.

### 7. Composition over monoliths

Claude Desktop is an end-user product. Basanos is infrastructure.

You can plug Basanos into a CI/CD pipeline, embed it in a ServiceNow workflow, wire it into an A2A mesh, or run it as a sidecar for any MCP-compatible agent. You cannot plug Claude Desktop into any of those.

## The honest framing

Basanos is not competing with Claude Desktop. It is infrastructure for the world where agents operate without a human in the chair. That is the world ServiceNow, Google, Microsoft, and every major platform vendor is actively building toward.

Claude Desktop is the present. Basanos is a bet on the autonomous future.

## Scenario: 3am incident resolution

### Without Basanos

```
Agent receives: INC0099001 - P1 - "Email service down"
Agent queries ServiceNow MCP: gets incident record, raw fields
Agent reasons: "This is P1, I should resolve it quickly"
Agent attempts resolution
  → Doesn't know a change freeze started at midnight
  → Doesn't know the email service has a penalty SLA
  → Doesn't know the assignment group is at 150% capacity
  → Doesn't know the CI depends on a database cluster under maintenance
Result: Agent resolves the incident by restarting the email service,
        which fails because the underlying database is under maintenance.
        SLA breach goes undocumented. Change freeze is violated.
        Post-mortem reveals the agent had no architectural awareness.
```

### With Basanos

```
Agent receives: INC0099001 - P1 - "Email service down"
Agent calls basanos_describe_domain("itsm")
  → Gets full entity relationship map
Agent calls basanos_get_relationships("itsm", "incident")
  → Understands: incident → business_service → sla_contract
  → Understands: incident → configuration_item → depends_on
Agent calls basanos_check_constraints("resolve", "itsm:incident:INC0099001",
  metadata: { change_freeze_active: true, sla_breached: true,
              sla_has_penalty: true })
  → BLOCKED: "Active change freeze in effect. Escalate to change management."
  → WARN: "SLA breach with penalty clause. Route to service level management."
Agent decision: Do not attempt resolution. Escalate to human on-call
  with full context: change freeze, SLA status, dependency chain.
Result: Correct escalation. No violations. Full audit trail.
```

## Measuring the difference

The proof is measurable:
- **Fewer incorrect escalations** (agent understands org structure and ownership)
- **Zero change freeze violations** (hard constraint, not a suggestion)
- **Accurate impact assessment** (traverses dependency graph, not guessing)
- **SLA breach documentation** (constraint engine flags and logs every breach)
- **Consistent multi-agent behavior** (shared ontology, not independent reasoning)

These aren't theoretical. They're testable assertions against the constraint engine, today, with the smoke test suite already in the repo.
