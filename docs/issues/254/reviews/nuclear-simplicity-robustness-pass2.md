# Thermo-nuclear review pass 2 — simplicity + robustness

Reviewed after simplification edits:

- `context.md`
- `implementation-plan.md`
- `prs/01-foundation.md`
- `prs/02-server-runtime-mvp.md`
- `prs/03-cli-install-and-verification.md`

Verdict: **ship the plan with minor clarifications**

The plan now has the right simplicity/robustness balance. The big complexity traps were removed:

- no `runtimeBackendAllowed` boolean;
- no automatic string/bytes response coercion;
- no raw/text body helpers;
- no PR 02 host health route requirement;
- no required PR 03 update/self-test work;
- install is separated from server MVP.

This is now a realistic implementation sequence rather than a framework design.

## What is now right

### 1. PR split is correct

```txt
PR 01 — foundation only
PR 02 — server runtime MVP only
PR 03 — install/list/remove only
```

This is the right granularity. Fewer PRs would mix concerns. More PRs would create orchestration overhead.

### 2. Source policy is simple and robust

Good:

```ts
type BoringPluginSource = {
  rootDir: string
  kind: "internal" | "external"
  workspaceId?: string
}
```

This is much better than `runtimeBackendAllowed` and reflects the simple model: internal plugins are fixed/boot-time; external plugins are hot-reloaded through the gateway.

The classification is visible, testable, and hard to accidentally drift.

### 3. PR 02 is no longer trying to become an HTTP framework

Good MVP contract:

```txt
JSON body only
JSON return only
explicit response escape hatch
exact path only
```

This gives plugins enough power without creating body/response machinery before it is needed.

### 4. Host health route is correctly deferred

Reload diagnostics are enough for the server MVP. A host health route can be added later from registry diagnostics if actual UX needs it.

### 5. PR 03 is now a proper CLI install MVP

Install/list/remove is enough. Update and backend self-test would have made the PR too wide.

## Minor clarifications before implementation

These are not blockers, but they should be added or kept in mind during implementation.

### A. Keep internal vs external source assignment boring

Current simplified policy says:

```txt
internal => fixed/boot-time
external => hot gateway
```

Good. Keep the MVP mapping small:

- app/default/composed sources are internal;
- workspace/global `.pi` installed roots are external.

Do not let advanced host escape hatches automatically become external because of array order or path shape.

### B. Define `rootDir` normalization once

PR 01 says absolute normalized host path. Implementation should choose one exact rule:

```txt
rootDir = path.resolve(input)
containment checks use realpath when needed
```

Avoid mixing display paths, resolved paths, and realpaths in one field.

If display path is needed later, add separate `displaySource`.

### C. Keep reload extraction genuinely behavior-preserving

Do not sneak diagnostics behavior changes into PR 01. If current `opts.beforeReload` throws, preserve that exact behavior in PR 01.

PR 02 can add backend diagnostics after there is only one canonical reload endpoint. Extract a helper only if it reduces complexity.

### D. Loader should validate even if helper validates

`defineRuntimeServerPlugin()` can validate for good author UX, but loader must still validate the default export. Third-party code can bypass helper.

### E. Gateway path normalization tests matter more than code volume

Keep exact-match routing, but test the ugly cases:

- empty tail path;
- trailing slash;
- duplicate slashes;
- encoded `..` if Fastify decodes it;
- backslash;
- invalid plugin id.

This is robustness, not over-engineering.

## Non-negotiable implementation guardrails

If implementation violates these, stop and simplify:

1. `createWorkspaceAgentServer.ts` must not grow materially. It is already large.
2. `BoringPluginAssetManager` must not own runtime backend execution or policy.
3. Gateway must not know jiti, manifests, source classification, or install.
4. Registry must keep old plugin handler live on failed reload.
5. Response/body support must stay JSON-first until a real plugin proves need.
6. No route params/wildcards in PR 02.
7. No install/update/self-test leakage into PR 02.

## Final verdict

Plan is now strong enough to execute.

Recommended final implementation target:

```txt
PR 01:
  source origin model
  internal/external source classification
  remove old reload route
  shared jiti helper

PR 02:
  runtime-server API
  exact route capture
  registry snapshot with per-plugin safe reload
  thin Fastify gateway
  reload diagnostics

PR 03:
  install/list/remove
  global default + local flag
  manifest validation
  security warning
```

This is simple enough to build and robust enough not to collapse on first bad plugin.
