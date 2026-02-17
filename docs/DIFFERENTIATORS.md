# Why Basanos? (And why not just Claude Desktop?)

An honest look at where Basanos helps and where it doesn't.

## Where Claude Desktop is enough

If you're a human asking Claude about your ServiceNow instance through an MCP server, Claude is smart enough to figure out most relationships on the fly. Give it CMDB data and incident records, and it'll work out the dependency chain. For one expert talking to a top-tier model, Basanos is redundant.

Claude Desktop with a good MCP server already gives you:
- Direct querying of ServiceNow data
- Relationship reasoning on the fly
- You catch the mistakes (human in the loop)

**If your use case is "me + Claude + my data," you probably don't need Basanos.**

## Where Basanos matters

The value shows up when there's no human in the loop.

### 1. Agents running solo need pre-loaded knowledge

With Claude Desktop, *you* are the safety net. You read the output, catch mistakes, and know about the change freeze because you were in the CAB meeting yesterday. Claude doesn't know any of that.

An agent resolving incidents at 3am doesn't have you. It needs the knowledge baked in: what connects to what, what's frozen, what's under SLA. Without that, it reasons from raw data every time, re-figuring out things that should be known facts.

### 2. Not every model is Claude

Claude's reasoning is best-in-class. But a DeepSeek agent, a small task-specific model, or a team running GPT-4o-mini to save costs? They need domain knowledge *given* to them because they can't reliably work it out from raw data. Basanos hands weaker models the understanding they can't generate themselves.

### 3. Multiple agents need one truth

Two agents working on the same incident will each reason independently and may reach different conclusions. Basanos gives them a shared map. No drift, no contradictions.

### 4. Verdicts beat suggestions

Claude Desktop can be *told* "don't resolve during a change freeze" in a system prompt. That's a suggestion. It can be ignored, forgotten mid-conversation, or overridden by creative prompting.

Basanos returns a `BLOCK` verdict with entity IDs, severity levels, and explanations. The difference is "please don't drop the production database" versus a permission that prevents it. Operations teams will never trust a suggestion where they need a guarantee.

### 5. Knowledge compounds, conversations don't

Every Claude Desktop session starts from zero. Basanos persists the domain model. As relationships are discovered, constraints refined, and edge cases encoded, every connected agent benefits immediately. Knowledge grows over time instead of resetting every session.

### 6. You can test it

You can unit test a domain model. You can regression-test constraint logic. You can audit every verdict with timestamps and entity references.

You can't unit test a conversation. For enterprise adoption, compliance, and post-mortems, that matters.

### 7. It plugs into everything

Claude Desktop is an end-user product. Basanos is infrastructure.

You can plug it into a CI/CD pipeline, embed it in a ServiceNow workflow, wire it into an agent mesh, or run it as a sidecar for any MCP-compatible agent. You can't do any of that with Claude Desktop.

## The honest framing

Basanos isn't competing with Claude Desktop. It's infrastructure for a world where agents operate without a human in the chair. That's the world ServiceNow, Google, Microsoft, and every major platform vendor is building toward.

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

- **Fewer wrong escalations** - agent knows the org structure and ownership
- **Zero change freeze violations** - hard constraint, not a suggestion
- **Accurate impact assessment** - walks the dependency graph instead of guessing
- **SLA breach documentation** - every breach is flagged and logged
- **Consistent multi-agent behavior** - shared knowledge, not independent guessing

These aren't theoretical. They're testable assertions against the constraint engine, today, in the smoke test suite already in the repo.
