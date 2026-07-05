---
github: https://github.com/hachej/boring-ui/issues/475
issue: 475
state: active
phase: plan
track: owner
updated: 2026-07-05
source_plan: docs/issues/475/plan-tenant-yaml-governance.md
---

# gh-475 — Extract governance into `plugins/boring-governance`

## Why

`apps/full-app` is a reference/demo composition and must stay minimal. The
governance module currently lives in `apps/full-app/src/server/governance/`
(1,236 prod LOC + 977 test LOC) plus `GovernanceAdminView` in full-app front,
yet imports **nothing full-app-private** — only `@hachej/boring-core`,
`@hachej/boring-agent`, `@hachej/boring-bash`, and `yaml`. Every enforcement
point already flows through generic package seams (`filterModels`,
`metering: AgentMeteringSink`, `getFilesystemBindings`,
`pi.strictModelResolution`, `CoreWorkspaceAgentServerPlugin`,
`CompanyAdminProvider`). It is a plugin in the wrong folder.

## Target shape (boring-mcp precedent)

New trusted internal plugin package `plugins/boring-governance`
(`@hachej/boring-governance`), front + server bundle:

```
plugins/boring-governance/
  package.json            # exports ./server, ./front; boring.front/boring.server manifest
  README.md               # app integration guide (the ~10-line wiring recipe)
  src/server/             # moved as-is from apps/full-app/src/server/governance/
    loadPolicy.ts validatePolicy.ts policyTypes.ts governanceService.ts
    metering.ts filesystemBindings.ts companyContextBootstrap.ts routes.ts index.ts
    __tests__/            # 4 test files move as-is
  src/front/
    GovernanceAdminView.tsx        # moved from apps/full-app/src/front/
    index.tsx                      # createGovernanceCompanyAdmin(): CompanyAdminProvider callbacks
```

Public server API: keep the existing named exports **unchanged**
(`buildGovernanceService`, `createGovernanceServerPlugin`,
`createGovernanceMeteringSink`, `createGovernanceModelFilter`,
`createGovernanceFilesystemBindings`, `createDefaultCompanyContextRootResolver`,
types). Add one convenience composer:

```ts
createGovernance(config: CoreConfig): {
  service, status,
  serverPlugin,                       // routes + onReady company-context reconcile
  filterModels,
  createMeteringSink(delegate, getDb),// app supplies its credits delegate + db
  getFilesystemBindings(opts?),       // opts: resolveCompanyContextRoot override
  pi: { strictModelResolution },
}
```

Front API: `createGovernanceCompanyAdmin({ fetchImpl? })` returning
`{ loadStatus, renderContent }` for core's `CompanyAdminProvider` seam —
full-app's `/api/v1/governance/me` mapping moves into the package.

## Explicitly stays put

- `PostgresModelBudgetStore`, migrations 0015/0016, `managed_by` column —
  generic persistence stays in `@hachej/boring-core` (core owns drizzle).
- Error codes — central registry in `@hachej/boring-agent` shared (invariant).
- `CompanyAdminProvider`/`CompanyAdminPage` seam — stays in core front.
- `readonlyProjectionOperations`, binding manager, `COMPANY_CONTEXT_FILESYSTEM_ID`
  — stay in `@hachej/boring-bash`.
- Credits delegate sink, `CoreConfig` loading, env — stay in the app.
  Boot-order contract is unchanged: the app calls `createGovernance(config)`
  (which loads/validates policy and may refuse production boot) **before**
  `createCoreWorkspaceAgentServer`, then spreads the returned seams.

## Full-app after extraction

`dev.ts`/`main.ts` shrink to: import from `@hachej/boring-governance/server`,
one `createGovernance(config)` call, spread `{plugins: [gov.serverPlugin],
filterModels, metering, getFilesystemBindings, pi}`. Front `main.tsx` uses
`createGovernanceCompanyAdmin()` instead of local loader + view.
`apps/full-app/src/server/governance/` and `GovernanceAdminView.tsx` are
deleted (moved).

## Non-goals

- No behavior change anywhere (pure move + re-home; smoke-verified).
- No plugin-owned DB migrations infra.
- No changes to core/agent/boring-bash seams.

## Acceptance / proof

1. All 4 moved test files pass under the new package filter.
2. Full-app typecheck + build pass; grep proves no `server/governance` paths
   remain under `apps/full-app/src`.
3. Invariants pass for the new package and agent/core.
4. Behavior-preservation: re-run the governance smoke
   (`.demo-governance-smoke/` scripts from the 475 verification) — same
   PASS results for: governed model filtering, 403 forbidden model,
   402 budget, 409 metered command, company-context tree/read/deny,
   fail-closed missing source root.
5. PR stacked on `issue/475-company-context-policy`, review-looped per stack
   rules (proof comment, GPT-5.5 review, thermo, Fable pass).
