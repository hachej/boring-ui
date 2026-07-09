# P6-plugin-child-app — Plan

> Phase: Phase 6 — Plugin and child-app integration (split into P6a / P6b) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [04-plugin-child-app-runtime.md](../../architecture/04-plugin-child-app-runtime.md) — child-app target, "consume, do not define" the shared child-app platform, plugin manifest requirements, hosted fail-closed, `RuntimePluginContext`, shared per-workspace runtime, hot reload.
- [05-multi-agent-sessions-hooks.md](../../architecture/05-multi-agent-sessions-hooks.md) — the workspace agent registry / `agents: [...]` declaration P6a seeds and Phase 7 consumes.

## Design context

P6 lets plugins and child apps declare runtime needs safely so one full-app
deployment can host multiple product shells (generic Seneca + Macro) without
leaking tools/prompts/provisioning into generic workspaces. It splits into two
independently-gated slices. **P6a** is the child-app-independent core and the only
P6 prerequisite for P7/P8; it extends the landed manifest validator/scanner (no
second scanner), introduces a minimal Map-backed `AgentRegistry` + the canonical
workspace `agents: [...]` `AgentDefinitionDeclaration`, composes per-agent plugin refs, and keeps the `/api/v1/plugins/:pluginId/*` route
family. P6a is **grep-gated**: its contracts carry zero `childAppId`/`workspaceKind`/`ChildApp`
fields. **P6b** consumes resolved child-app context and scopes Macro requirements;
it is **HARD BLOCKED** on the shared child-app platform implementation exporting
the owner-approved resolved context type (expected name: `ResolvedChildAppContext`,
#376) with no local fallback shape — STOP-and-report until it lands. P6b is a
tracked follow-up outside the epic exit: it does not gate P7 or P8, and P8 only
verifies the P6b follow-up issue is filed. Secrets follow the P5 brokering rule
(status only; no raw values); do not define a competing child-app registry.

**Amendment (2026-07-08):** `boring.requires` and skill filters target resolved
environment facts, not scalar bash/fs labels. `AgentDefinitionDeclaration` is
the same-definition surface for P7, M1/M2, S1, S2, S3, S4, D1, and later
factory/provisioning flows. It includes instruction/persona refs, capability
bundles, tools, environment attachments, sandbox policy, governance/model/demo/
pricing refs, and exposure config; unknown refs fail closed.

## Deliverables

### Phase 6a — plugin core (child-app-independent; the only P7/P8 prerequisite)
Import-free `boring.requires`/`bash` manifest validation lowered to resolved environment facts; lightweight skill filters at the skill-loading boundary; generated skills-index prompt fragment derived from the filtered skill set; plugin runtime context; `AgentRegistry` introduction + the workspace `agents: [...]` `AgentDefinitionDeclaration`; per-agent plugin composition; hosted plugin fail-closed; shared per-workspace plugin runtime; multi-tenant reload. **Amendment (2026-07-08):** per-agent plugin composition resolves `AgentDefinitionDeclaration.plugins?: PluginRef[]`, gates workspace-scoped plugin UI/routes to declaring agents, and reuses the environment-bundle -> plugins -> host duplicate-resolution law. Prerequisite unchanged: do not define a competing child-app registry here. P6a is grep-gated: the plugin-runtime context contracts carry zero `childAppId`/`workspaceKind`/`ChildApp` fields. P7 and P8 depend on P6a only.

### Phase 6b — child-app / Macro scoping (follow-up outside the epic exit)
Consume the resolved child-app context (`childAppId`/`workspaceKind`); child-app/workspace-kind requirement narrowing; Macro scoping so Macro tools/prompts/provisioning do not leak into a generic workspace. HARD BLOCKED on the shared child-app platform implementation exporting the owner-approved resolved context type (expected name: `ResolvedChildAppContext`, #376) — STOP-and-report, no local fallback shape. P6b is a tracked follow-up gated on that shared platform, not part of the epic exit: the epic ships without it, and P8 only verifies the P6b follow-up plus M2/D1/S4 follow-up or status tracking (P8 never waits on P6b landing).

### Deferred design notes

**Amendment (2026-07-06, #550 gap 10) — plugin-owned migrations trigger:** `PostgresModelBudgetStore` and migrations 0015/0016 live in core because core owns drizzle. That stays the model for now. **Trigger to revisit:** if internal plugins multiply and need their own tables, design plugin-owned migration infra then — P6 does not build it, and no P6 bead may add a second migration owner in the meantime.

## Exit criteria

### Phase 6a
Import-free manifest validation; skills filtered by resolved environment facts before Pi resources, `/api/v1/agent/skills`, skill slash suggestions, and the generated skills-index prompt fragment; hosted-plugin fail-closed before code exec; managed-service lifecycle; `AgentRegistry`/`AgentDefinitionDeclaration` seeded — as v1, minus any child-app scoping.

### Phase 6b (when unblocked)
Child-app/workspace-kind requirement narrowing; Macro requirements do not leak into a generic workspace.
