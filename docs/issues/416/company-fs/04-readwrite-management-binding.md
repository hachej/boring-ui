# PR 4 — Readwrite company management binding

## Objective

Implement policy-granted readwrite management binding for `company_context` through regular runtime providers.

Done when a privileged actor can manage company context as real files through a readwrite binding, while normal readonly actors cannot access that management projection.

## Depends on

- PR 1 foundation binding/provider lifecycle model.
- PR 2 readonly company binding.

## Scope

### In scope

- Policy-granted readwrite `company_context` management binding.
- Prepared-binding lifecycle for management projection/mount.
- Regular sandbox/runtime provider integration for the fixture/local provider first; do not invent a new sandbox type.
- Tests proving writes update provider/fixture state later visible through readonly policy-filtered views.

### Out of scope

- UI bridge/file tree/viewers.
- Product role names like `admin` hardcoded in contracts.
- Real provider persistence implementation details.
- MCP integration.
- Copy/export UX.

## Readwrite management binding

Policy may grant:

```ts
{
  filesystem: 'company_context',
  access: 'readwrite',
  mountPath: '/company_context',
  projection: 'management',
}
```

This binding uses the regular sandbox/runtime mechanism configured by the app/provider. V0 implementation is bounded to the fixture/local provider path; direct/vercel/other provider support should come via the provider lifecycle contract and conformance follow-ups. Contracts must not hardcode bwrap, direct, vercel, or product roles.

Rules:

- Only policy-granted actors can receive readwrite binding.
- In production, that policy grant comes from the host DB-backed resolver; file-backed grants are CLI/dev/test only.
- Readwrite management binding is distinct from normal readonly projection.
- Normal user sessions must not receive management projection.
- Management projection is selected only through an explicit policy-granted runtime/profile entrypoint.
- Provider owns persistence/snapshots/backups.
- Writes in management binding update the company_context provider state that later readonly projections observe.
- Management binding must be prepared/disposed/invalidate through the lifecycle contract from PR 1.

## Invocation / routing model

A management binding is selected by launching a session/runtime profile whose policy resolves a readwrite `company_context` binding. It is not a hidden upgrade inside an existing normal readonly session.

The app/host owns the entrypoint, for example:

```txt
agent profile: company-context-curator
resolved bindings: company_context readwrite management
runtime provider: fixture/local in V0
```

Tools and shell target the management binding because it is part of that runtime's prepared binding plan. Normal sessions cannot reuse this prepared binding; prepared bindings are scoped by `humanUserId + agentId + sessionId + workspaceId + requestId/runtime` and disposed/invalidated through the provider lifecycle.

## Relation to normal user runtime

A normal user may have:

```txt
user              readwrite  /workspace
company_context   readonly   /company_context policy-filtered
```

A privileged management session may have:

```txt
company_context   readwrite  /company_context management
```

The app/provider decides whether the management session also gets a private scratch/user workspace. This PR does not require mixing management projection into normal user sessions.

## Tests

- Non-granted actor cannot receive readwrite company binding.
- Normal readonly session cannot upgrade/reuse a prepared management binding.
- Granted actor receives readwrite management binding with the fixture/local provider path.
- Provider contract is sufficient for direct/vercel/other providers to add conformance later without changing shared types.
- Management binding is distinct from readonly prepared binding.
- Write/edit in management binding updates fixture/provider state.
- Normal readonly actor later sees updated allowed content but still not denied content.
- Normal readonly actor cannot access management projection.
- Disposing management binding cleans up provider/runtime handles.
- Policy invalidation does not leave stale management projection accessible to a no-longer-granted actor.

## Review checklist

Block if:

- readwrite binding is role-hardcoded instead of policy-granted;
- a new sandbox type is invented unnecessarily;
- normal readonly user can access management projection;
- readwrite projection lifecycle lacks cleanup/invalidation;
- management binding is implemented inside `@hachej/boring-agent` instead of boring-bash/provider seam;
- provider persistence details leak into shared contracts.
